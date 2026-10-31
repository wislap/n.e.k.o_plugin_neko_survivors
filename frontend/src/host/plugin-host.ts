import { mountPluginAvatar } from './avatar/plugin-avatar';
import { decodeAvatarManifest, decodeAvatarState } from './avatar/manifest';
import { PLUGIN_ID, requestLifetime, isHostStatus, type HostResult, type NekoHost } from './neko-host';

interface Generation {
  id: string; routeId: string; abort: AbortController; started: boolean;
  ready: Promise<HostResult>; timer?: ReturnType<typeof setTimeout>;
}
interface CsrfBootstrap { ready: Promise<string | undefined> }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const cancelled = (): HostResult => ({ status: 'cancelled', reason: 'session_closed' });
const visibility = () => typeof document === 'undefined' ? 'visible' : document.visibilityState;

/** Formal route lifecycle: abort local waits and close the host's exact route generation. */
export function createPluginHost(origin: string, fetcher: typeof fetch = fetch): NekoHost {
  const lifetime = requestLifetime();
  const pendingClose = new Map<string, Generation>();
  let current: Generation | undefined;
  let disposed = false;
  let closing: Promise<HostResult> | undefined;
  let csrf: CsrfBootstrap | undefined;
  function bootstrapCsrf(): CsrfBootstrap {
    if (csrf) return csrf;
    const request: CsrfBootstrap = { ready: Promise.resolve(undefined) };
    csrf = request;
    request.ready = (async () => {
      try {
        // Shared bootstrap has its own deadline: retiring one caller must not
        // abort other actions or the independent route-close acknowledgement.
        // A missing token is a transport failure; never guess that an older host accepts unsigned writes.
        const response = await fetcher(new URL('/security/csrf-token', origin), {
          credentials: 'same-origin', signal: AbortSignal.timeout(5_000),
        });
        if (response.ok) {
          const data: unknown = await response.json();
          if (object(data) && typeof data.csrf_token === 'string' && data.csrf_token.trim()) return data.csrf_token;
        }
      } catch { /* Retry the bootstrap only on a later explicit action. */ }
      if (csrf === request) csrf = undefined;
      return undefined;
    })();
    return request;
  }
  function csrfToken(request: CsrfBootstrap, signal: AbortSignal): Promise<string | undefined> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const aborted = () => { release(); reject(signal.reason); };
      const release = () => signal.removeEventListener('abort', aborted);
      signal.addEventListener('abort', aborted, { once: true });
      void request.ready.then(token => { release(); resolve(token); });
    });
  }
  function action(id: 'sync_avatar' | 'avatar_state', args: Record<string, string>, external?: AbortSignal, cleanup?: boolean): Promise<HostResult<unknown>>;
  function action(id: string, args: Record<string, string>, external?: AbortSignal, cleanup?: boolean): Promise<HostResult>;
  async function action(id: string, args: Record<string, string>, external?: AbortSignal, cleanup = false): Promise<HostResult<unknown>> {
    // Cleanup survives application/session abort; it has its own bounded deadline.
    const signal = cleanup ? AbortSignal.any([AbortSignal.timeout(15_000), ...(external ? [external] : [])]) : lifetime.signal(external, id === 'sync_avatar' ? 300_000 : id === 'game_event' ? 45_000 : 15_000);
    try {
      signal.throwIfAborted();
      let response!: Response;
      for (let attempt = 0; attempt < 2; attempt++) {
        const bootstrap = bootstrapCsrf();
        const token = await csrfToken(bootstrap, signal);
        signal.throwIfAborted();
        if (!token) return { status: 'unavailable', reason: 'csrf_token_unavailable' };
        response = await fetcher(new URL(`/plugin/${PLUGIN_ID}/hosted-ui/action/${id}`, origin), {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
          body: JSON.stringify({ args, kind: 'panel', surface_id: 'main' }), signal, keepalive: cleanup,
        });
        signal.throwIfAborted();
        if (response.status !== 403) break;
        let denial: unknown;
        try { denial = await response.json(); } catch { /* A generic/malformed 403 is not retryable. */ }
        signal.throwIfAborted();
        if (!object(denial) || !object(denial.detail) || denial.detail.csrf_failure !== 'token') break;
        // A delayed failure from an old token cannot evict a newer bootstrap.
        if (csrf === bootstrap) csrf = undefined;
        if (attempt === 1) break;
      }
      if (!response.ok) return { status: response.status === 403 ? 'rejected' : 'unavailable', reason: `http_${response.status}` };
      const envelope: unknown = await response.json();
      signal.throwIfAborted();
      if (!object(envelope)) return { status: 'rejected', reason: 'invalid_response' };
      const data = envelope.result;
      if (!object(data)) return { status: 'rejected', reason: 'invalid_response' };
      if (id === 'sync_avatar') return data.synced === true ? { status: 'completed', data }
        : { status: 'unavailable', reason: String(data.reason ?? 'avatar_unavailable') };
      const status = data.status;
      if (isHostStatus(status)) {
        return { status, reason: typeof data.reason === 'string' ? data.reason : undefined, ...(id === 'avatar_state' ? { data } : {}) };
      }
      return { status: 'rejected', reason: 'invalid_response' };
    } catch {
      // Transport errors must not accidentally expose a credential-bearing URL/header.
      return external?.aborted || !cleanup && disposed ? cancelled()
        : { status: 'unavailable', reason: signal.aborted ? 'request_timeout' : 'request_failed' };
    }
  }
  function retire(generation: Generation | undefined) {
    if (!generation) return;
    generation.abort.abort(); clearTimeout(generation.timer);
    if (generation.started) pendingClose.set(generation.id, generation);
  }
  async function flushCloses(reason: string): Promise<HostResult> {
    // Serial close acknowledgements prevent delayed old starts superseding a new game.
    for (const generation of pendingClose.values()) {
      const result = await action('close_session', { session_id: generation.id, reason }, undefined, true);
      if (result.status !== 'completed') return result;
      pendingClose.delete(generation.id);
    }
    return { status: 'completed' };
  }
  function schedule(generation: Generation) {
    if (disposed || current !== generation) return;
    generation.timer = setTimeout(() => {
      if (disposed || current !== generation) return;
      void generation.ready.then(async ready => {
        if (disposed || current !== generation) return;
        const result = ready.status === 'completed'
          ? await action('heartbeat_session', { session_id: generation.id, visibility_state: visibility() }, generation.abort.signal) : ready;
        if (disposed || current !== generation) return;
        if (result.status === 'completed') schedule(generation);
        else void resetSession(); // New identity also handles desktop character changes.
      });
    }, 3000);
  }
  function resetSession(external?: AbortSignal): Promise<HostResult> {
    if (disposed || external?.aborted) return Promise.resolve(cancelled());
    retire(current);
    const generation: Generation = { id: crypto.randomUUID(), routeId: crypto.randomUUID(), abort: new AbortController(), started: false, ready: Promise.resolve(cancelled()) };
    current = generation;
    const signal = external ? AbortSignal.any([generation.abort.signal, external]) : generation.abort.signal;
    generation.ready = (async () => {
      // A close failed during an earlier disconnected interval remains pending.
      const closed = await (closing ?? flushCloses('session_reset'));
      if (closed.status !== 'completed') return closed;
      if (disposed || current !== generation || signal.aborted) return cancelled();
      generation.started = true;
      const result = await action('open_session', { session_id: generation.id, route_id: generation.routeId, visibility_state: visibility() }, signal);
      return disposed || current !== generation || signal.aborted ? cancelled() : result;
    })();
    void generation.ready.finally(() => schedule(generation));
    return generation.ready;
  }
  function closeSession(reason = 'game_exit'): Promise<HostResult> {
    retire(current); current = undefined;
    if (closing) return closing;
    closing = flushCloses(reason).finally(() => { closing = undefined; });
    return closing;
  }
  async function inSession(id: string, args: Record<string, string>, external?: AbortSignal): Promise<HostResult> {
    const generation = current;
    if (!generation || disposed) return cancelled();
    const ready = await generation.ready;
    if (current !== generation || external?.aborted || generation.abort.signal.aborted) return cancelled();
    if (ready.status !== 'completed') return ready;
    return action(id, { ...args, session_id: generation.id }, external ? AbortSignal.any([external, generation.abort.signal]) : generation.abort.signal);
  }
  function changedVisibility() {
    const generation = current;
    if (!generation || disposed) return;
    void generation.ready.then(async result => {
      if (result.status !== 'completed' || current !== generation || disposed) return;
      await action('heartbeat_session', { session_id: generation.id, visibility_state: visibility() }, generation.abort.signal);
    });
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', changedVisibility);
  const avatarHost = {
    async syncAvatar(signal?: AbortSignal) {
      const result = await action('sync_avatar', {}, signal);
      if (result.status !== 'completed') return { status: result.status, reason: result.reason };
      const data = decodeAvatarManifest(result.data);
      return data ? { status: 'completed' as const, data } : { status: 'rejected' as const, reason: 'invalid_avatar_manifest' };
    },
  };
  return {
    mode: 'plugin', resetSession, closeSession,
    report: (event, text, signal) => inSession('game_event', { event, text, correlation_id: crypto.randomUUID() }, signal),
    speak: (text, signal) => inSession('speak', { text, correlation_id: crypto.randomUUID() }, signal),
    async getAvatarState(signal) {
      const result = await action('avatar_state', {}, signal);
      if (result.status !== 'completed') return { status: result.status, reason: result.reason };
      const data = decodeAvatarState(result.data);
      return data ? { status: 'completed', data } : { status: 'rejected', reason: 'invalid_avatar_state' };
    },
    async mountAvatar({ container, signal }) {
      const mount = mountPluginAvatar(container, avatarHost, lifetime.ownedSignal(signal));
      await mount.ready;
      return mount;
    },
    dispose() { if (disposed) return; disposed = true; if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', changedVisibility); void closeSession('runtime_dispose'); lifetime.dispose(); },
  };
}
