import { decodeSdkReceipt, type SdkReceipt, type DialogueReceipt } from './sdk-receipt';
import policy from '../../../protocol/commentary.json';
import type { AvatarController, AvatarCharacterDescriptor, Client } from './official-sdk';
import { requestLifetime, type AvatarLease, type AvatarMountOptions, type HostResult, type NekoHost } from './neko-host';

/** Connected official client. Runtime is required to own and retire game speech. */
export type MiniGameClient = Pick<Client, 'capabilities' | 'dialogue' | 'speech' | 'runtime' | 'avatar' | 'dispose'>;
const cancelled = (): HostResult => ({ status: 'cancelled', reason: 'session_closed' });

export function createSdkHost(client: MiniGameClient, options: { ownsClient?: boolean; avatarSlot?: string } = {}): NekoHost {
  const lifetime = requestLifetime();
  let generation: AbortController | undefined;
  let ready: Promise<HostResult> = Promise.resolve(cancelled());
  let queue: Promise<HostResult> = Promise.resolve({ status: 'completed' });
  let disposed = false;
  const avatars = new Set<AvatarLease>();
  const pendingAvatars = new Set<AbortController>();
  const lastReport = new Map<string, number>();
  let lastAnyReport = -Infinity;

  function closeSession(reason = 'game_exit'): Promise<HostResult> {
    const previous = generation;
    generation = undefined; previous?.abort(); client.runtime.stopMonitoring();
    if (!previous) return queue;
    queue = queue.then(async () => {
      try {
        const response = await client.runtime.end({ reason, postgameProactive: { enabled: false } }, { signal: AbortSignal.timeout(15_000) });
        return decodeSdkReceipt(response, 'runtime').status === 'submitted' ? { status: 'completed' } : { status: 'rejected', reason: 'sdk_route_close_rejected' };
      } catch (error) { return { status: 'unavailable', reason: String(error) }; }
    });
    return queue;
  }
  function resetSession(external?: AbortSignal): Promise<HostResult> {
    if (disposed || external?.aborted) return Promise.resolve(cancelled());
    const closed = closeSession('session_reset');
    const next = new AbortController(); generation = next;
    const signal = external ? AbortSignal.any([external, next.signal]) : next.signal;
    ready = closed.then(async closedResult => {
      if (closedResult.status !== 'completed') return closedResult;
      if (disposed || generation !== next || signal.aborted) return cancelled();
      try {
        client.runtime.reset({ newSession: true, keepCharacter: avatars.size > 0 });
        const result = await client.runtime.start({ session_id: client.runtime.session.id }, { signal });
        if (disposed || generation !== next || signal.aborted) return cancelled();
        return decodeSdkReceipt(result, 'runtime').status === 'submitted' && client.runtime.state === 'running' ? { status: 'completed' } : { status: 'rejected', reason: 'sdk_route_start_rejected' };
      } catch (error) { return { status: signal.aborted ? 'cancelled' : 'unavailable', reason: String(error) }; }
    });
    return ready;
  }
  function call(capability: 'dialogue', request: (signal: AbortSignal) => Promise<unknown>, external?: AbortSignal): Promise<DialogueReceipt>;
  function call(capability: 'speech-output', request: (signal: AbortSignal) => Promise<unknown>, external?: AbortSignal): Promise<HostResult>;
  async function call(capability: 'dialogue' | 'speech-output', request: (signal: AbortSignal) => Promise<unknown>, external?: AbortSignal): Promise<SdkReceipt> {
    const owner = generation;
    if (!owner || disposed) return cancelled();
    const signal = lifetime.signal(external ? AbortSignal.any([owner.signal, external]) : owner.signal, 45_000);
    try {
      signal.throwIfAborted();
      const active = await ready;
      if (active.status !== 'completed') return active;
      if (generation !== owner) return cancelled();
      if (!client.capabilities.has(capability)) return { status: 'unavailable', reason: `missing_${capability}` };
      const response = await request(signal);
      signal.throwIfAborted();
      return decodeSdkReceipt(response, capability);
    } catch (error) {
      return { status: signal.aborted || disposed ? 'cancelled' : 'unavailable', reason: error instanceof Error ? error.message : String(error) };
    }
  }
  function releaseAvatars(except?: AbortController) {
    for (const operation of pendingAvatars) if (operation !== except) operation.abort();
    for (const lease of avatars) lease.dispose();
  }
  async function currentCharacter(signal?: AbortSignal, pending?: AbortController): Promise<AvatarCharacterDescriptor | null> {
    const character = await client.avatar.getCurrentCharacter({ signal: lifetime.signal(signal) });
    if (character?.name && client.runtime.session.characterName && character.name !== client.runtime.session.characterName) {
      releaseAvatars(pending);
      if (generation) { const result = await resetSession(signal); if (result.status !== 'completed') return null; }
      else client.runtime.reset({ newSession: true });
    }
    return character;
  }
  async function mountAvatar({ signal: external }: AvatarMountOptions): Promise<AvatarLease | null> {
    if (!options.avatarSlot || disposed || !client.capabilities.has('avatar-renderer')) return null;
    const pending = new AbortController(); pendingAvatars.add(pending);
    const signal = lifetime.signal(external ? AbortSignal.any([pending.signal, external]) : pending.signal, 45_000);
    try {
      const character = await currentCharacter(signal, pending);
      signal.throwIfAborted();
      if (!character?.model || !character.rendererAvailable) return null;
      const operation = client.avatar.mount({ slot: options.avatarSlot, characterName: character.name, model: character.model,
        viewport: { mode: 'container' }, resize: { mode: 'container' }, fit: { mode: 'contain', align: 'bottom-center', padding: 4 } });
      const lease = await new Promise<AvatarLease | null>((resolve, reject) => {
        const abort = () => reject(new DOMException('Avatar mount cancelled', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        void operation.then((controller: AvatarController) => {
          signal.removeEventListener('abort', abort);
          if (signal.aborted || disposed) { controller.dispose(); resolve(null); return; }
          let released = false;
          const retirement = new AbortController();
          const lease: AvatarLease = {
            async setEmotion(name, external) {
              const signal = lifetime.signal(external ? AbortSignal.any([external, retirement.signal]) : retirement.signal);
              if (signal.aborted || released || disposed || controller.disposed) return { status: 'cancelled', reason: 'avatar_retired' };
              if (!client.capabilities.has('avatar-renderer') || typeof controller.setEmotion !== 'function') return { status: 'unavailable', reason: 'emotion_not_available' };
              if (!name.trim() || name.length > 64) return { status: 'rejected', reason: 'invalid_emotion' };
              // Public SDK setEmotion has no per-call cancellation parameter.
              // Retire the receipt locally; never claim to retract an accepted action.
              return new Promise<HostResult>(resolve => {
                let settled = false;
                const finish = (result: HostResult) => {
                  if (settled) return;
                  settled = true; signal.removeEventListener('abort', abort); resolve(result);
                };
                const abort = () => finish({ status: 'cancelled', reason: 'avatar_emotion_cancelled' });
                signal.addEventListener('abort', abort, { once: true });
                try {
                  void Promise.resolve(controller.setEmotion(name)).then(result => {
                    finish(signal.aborted || released || disposed ? { status: 'cancelled', reason: 'avatar_retired' }
                      : result === false ? { status: 'unavailable', reason: 'emotion_not_applied' } : { status: 'completed' });
                  }, error => finish({ status: signal.aborted || released || disposed ? 'cancelled' : 'unavailable', reason: String(error) }));
                } catch (error) { finish({ status: 'unavailable', reason: String(error) }); }
              });
            },
            dispose() { if (released) return; released = true; retirement.abort(); controller.dispose(); avatars.delete(lease); },
          };
          avatars.add(lease); resolve(lease);
        }, error => { signal.removeEventListener('abort', abort); reject(error); });
      });
      return lease;
    } finally { pendingAvatars.delete(pending); }
  }
  return {
    mode: 'sdk', resetSession, closeSession, mountAvatar,
    report: async (event, text, signal) => {
      event = [...event.trim()].slice(0, policy.maxEventLength).join('');
      const owner = generation;
      if (!owner || disposed) return cancelled();
      const safeText = [...text.trim()].slice(0, policy.maxTextLength).join('');
      if (!safeText) return { status: 'rejected', reason: 'empty_text' };
      const now = performance.now() / 1000;
      if (now - (lastReport.get(event) ?? -Infinity) < (policy.eventGapsSeconds[event as keyof typeof policy.eventGapsSeconds] ?? policy.defaultEventGapSeconds) || now - lastAnyReport < policy.globalGapSeconds) return { status: 'throttled' };
      lastReport.set(event, now); lastAnyReport = now;
      const generated = await call('dialogue', active => client.dialogue.request({ prompt: { mode: 'author-managed', messages: [{ role: 'user', content: policy.prompt.replace('{text}', safeText) }] } }, { signal: active }), signal);
      if (generated.status !== 'submitted') return { status: generated.status, reason: generated.reason };
      if (generation !== owner || !owner || owner.signal.aborted) return cancelled();
      const line = [...generated.line].slice(0, policy.maxTextLength).join('');
      return call('speech-output', active => client.speech.speak({ text: line, source: 'game-comment', eventKey: `survivors-react:${event}`, interruptExisting: false }, { signal: active, timeoutMs: 12_000 }), signal);
    },
    speak: async (text, signal) => {
      const safeText = [...text.trim()].slice(0, policy.maxTextLength).join('');
      if (!safeText) return { status: 'rejected', reason: 'empty_text' };
      return call('speech-output', active => client.speech.speak({ text: safeText, source: 'game-comment', eventKey: 'survivors-react:line', interruptExisting: false }, { signal: active, timeoutMs: 12_000 }), signal);
    },
    getAvatarState: async signal => {
      try {
        const character = await currentCharacter(signal);
        return character ? { status: 'completed', data: { identity: JSON.stringify(character) } } : { status: 'unavailable', reason: 'no_current_character' };
      } catch (error) { return { status: signal?.aborted || disposed ? 'cancelled' : 'unavailable', reason: String(error) }; }
    },
    dispose() {
      if (disposed) return;
      disposed = true; releaseAvatars();
      void closeSession('runtime_dispose').finally(() => { if (options.ownsClient) client.dispose(); });
      lifetime.dispose();
    },
  };
}
