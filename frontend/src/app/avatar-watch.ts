import { type AvatarLease, type NekoHost, type HostResult } from '../host';

export type AvatarFeedbackKind = 'emotion' | 'release' | 'retired-release';
export interface AvatarWatcher {
  dispose(): void;
  setEmotion(name: string, signal?: AbortSignal): void;
}

/** Optional host presentation owns I/O lifetimes, never game state or time. */
export function watchAvatar(host: NekoHost, container: HTMLElement, visible: (value: boolean) => void, signal: AbortSignal, feedback?: (kind: AvatarFeedbackKind, result: HostResult) => void): AvatarWatcher {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let identity: string | undefined;
  let mounted: AvatarLease | undefined;
  let releaseSequence = 0;
  let mountLifetime = new AbortController();
  const cancellation = new AbortController();
  const active = AbortSignal.any([signal, cancellation.signal]);
  let intent: { name: string; controller: AbortController; signal?: AbortSignal; abort(): void; started: boolean } | undefined;

  function clearIntent() {
    const previous = intent; intent = undefined;
    if (previous) {
      previous.signal?.removeEventListener('abort', previous.abort);
      previous.controller.abort();
    }
  }
  function notify(kind: AvatarFeedbackKind, result: HostResult) {
    try { feedback?.(kind, result); } catch (error) { console.error('Could not consume avatar feedback', error); }
  }
  function retireMount() {
    mountLifetime.abort(); mountLifetime = new AbortController();
    const previous = mounted; mounted = undefined;
    if (!previous) return;
    const sequence = ++releaseSequence;
    let failure: string | undefined;
    try { previous.dispose(); } catch (error) { failure = String(error); }
    if (failure) notify('release', { status: 'unavailable', reason: failure });
    const deliverRelease = (result: HostResult) => {
      if (sequence === releaseSequence) notify('release', result);
      else if (result.status !== 'completed') notify('retired-release', result);
    };
    void previous.released?.then(report => {
      deliverRelease(report.confirmed && !failure ? { status: 'completed' } : {
        status: 'unavailable', reason: [report.reason, ...(failure ? [failure] : []), ...(report.errors ?? [])].join(': ').slice(0, 1024),
      });
    }, error => deliverRelease({ status: 'unavailable', reason: String(error) }));
  }
  function flushEmotion() {
    const pending = intent, lease = mounted;
    if (!pending || pending.started || !lease || active.aborted) return;
    pending.started = true;
    const operationSignal = AbortSignal.any([active, mountLifetime.signal, pending.controller.signal]);
    // Presentation failures never throw into simulation or replay an old intent.
    void Promise.resolve().then(() => {
      if (operationSignal.aborted || mounted !== lease) return;
      return lease.setEmotion(pending.name, operationSignal);
    }).then(result => {
      if (result && !operationSignal.aborted && intent === pending && mounted === lease) notify('emotion', result);
    }).catch(error => {
      if (!operationSignal.aborted && intent === pending && mounted === lease) notify('emotion', { status: 'unavailable', reason: String(error) });
    });
  }
  function setEmotion(name: string, owner?: AbortSignal) {
    clearIntent();
    if (stopped || active.aborted || owner?.aborted || !name.trim() || name.length > 64) return;
    const next = { name, controller: new AbortController(), signal: owner, started: false,
      abort() { if (intent === next) clearIntent(); } };
    intent = next;
    owner?.addEventListener('abort', next.abort, { once: true });
    flushEmotion();
  }
  function dispose() {
    if (stopped) return;
    stopped = true; clearIntent(); cancellation.abort();
    if (timer !== undefined) clearTimeout(timer);
    active.removeEventListener('abort', dispose);
    retireMount();
  }
  async function poll() {
    try {
      if (stopped || active.aborted || host.mode === 'standalone') return;
      const state = await host.getAvatarState(active);
      active.throwIfAborted();
      if (state.status !== 'completed' || !state.data?.identity) {
        clearIntent(); retireMount(); visible(false);
      } else {
        const next = state.data.identity;
        if (next !== identity || !mounted) {
          // An initial intent may wait for the first identity. Once known, a
          // character change always discards that character's intention.
          if (identity !== undefined && next !== identity) clearIntent();
          retireMount(); visible(false); identity = next;
          const mountSignal = AbortSignal.any([active, mountLifetime.signal]);
          mounted = await host.mountAvatar({ container, signal: mountSignal }) ?? undefined;
          if (active.aborted) { retireMount(); return; }
          flushEmotion();
        }
        visible(!!mounted);
      }
    } catch {
      clearIntent(); retireMount();
      if (!stopped && !active.aborted) visible(false);
    } finally {
      if (!stopped && !active.aborted && host.mode !== 'standalone') timer = setTimeout(() => { void poll(); }, 5000);
    }
  }
  active.addEventListener('abort', dispose, { once: true });
  if (!active.aborted) void poll();
  else dispose();
  return { dispose, setEmotion };
}
