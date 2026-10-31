import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHost, type NekoHost } from '../../src/host';

const location = { origin: 'http://localhost:48916', pathname: '/plugin/neko_survivors_react/ui/index.html' };
const bootstrapPath = '/security/csrf-token';
const completed = () => Response.json({ result: { status: 'completed', identity: 'YUI-live2d', name: 'YUI', modelType: 'live2d' } });
const denied = (failure?: string) => Response.json({ detail: failure ? { csrf_failure: failure } : 'permission_denied' }, { status: 403 });
const tokenReply = (token: string) => Response.json({ csrf_token: token });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const hosts: NekoHost[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) { await host.closeSession(); host.dispose(); } vi.restoreAllMocks(); });
function connect(handler: (url: URL, options: RequestInit) => Promise<Response> | Response) {
  const fetcher = vi.fn((url: URL, options: RequestInit) => Promise.resolve(handler(url, options)));
  const host = createHost({ location, fetch: fetcher as unknown as typeof fetch });
  hosts.push(host);
  return { host, fetcher, gets: () => fetcher.mock.calls.filter(([url]) => url.pathname === bootstrapPath), posts: () => fetcher.mock.calls.filter(([, options]) => options.method === 'POST') };
}
const sentToken = (options: RequestInit) => new Headers(options.headers).get('X-CSRF-Token');

describe('static plugin action CSRF contract', () => {
  it('opens and closes a strict host session with a cached same-origin token', async () => {
    const { host, gets, posts } = connect((url, options) => url.pathname === bootstrapPath ? tokenReply('instance-a')
      : sentToken(options) === 'instance-a' ? completed() : denied('token'));
    expect(await host.resetSession()).toMatchObject({ status: 'completed' });
    expect(await host.report('wave_start', 'wave 2')).toMatchObject({ status: 'completed' });
    expect(await host.closeSession()).toMatchObject({ status: 'completed' });
    expect(gets()).toHaveLength(1);
    expect(gets()[0]?.[1]).toMatchObject({ credentials: 'same-origin' });
    expect(posts()).toHaveLength(3);
    for (const [, options] of posts()) expect(sentToken(options)).toBe('instance-a');
  });

  it.each(['missing-endpoint', 'network-failure', 'invalid-body'])('does not write when token bootstrap has %s', async mode => {
    const { host, gets, posts } = connect(url => {
      if (url.pathname !== bootstrapPath) return completed();
      if (mode === 'network-failure') throw new Error('bootstrap offline');
      return mode === 'missing-endpoint' ? new Response('', { status: 404 }) : Response.json({ csrf_token: 17 });
    });
    expect(await host.getAvatarState()).toMatchObject({ status: 'unavailable', reason: 'csrf_token_unavailable' });
    expect(await host.getAvatarState()).toMatchObject({ status: 'unavailable', reason: 'csrf_token_unavailable' });
    expect(gets()).toHaveLength(2);
    expect(posts()).toHaveLength(0);
  });

  it('does not POST after a bounded bootstrap timeout', async () => {
    let bootstrapAborted = false;
    const { host, gets, posts } = connect((_url, options) => new Promise<Response>((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => { bootstrapAborted = true; reject(options.signal!.reason); }, { once: true });
    }));
    expect(await host.getAvatarState()).toMatchObject({ status: 'unavailable', reason: 'csrf_token_unavailable' });
    expect(bootstrapAborted).toBe(true); expect(gets()).toHaveLength(1); expect(posts()).toHaveLength(0);
  }, 7_000);

  it('shares one pending bootstrap without a cancelled caller aborting another owner', async () => {
    const boot = deferred<Response>();
    const { host, gets, posts } = connect(url => url.pathname === bootstrapPath ? boot.promise : completed());
    const owner = new AbortController();
    const retired = host.getAvatarState(owner.signal);
    const active = host.getAvatarState();
    await vi.waitFor(() => expect(gets()).toHaveLength(1));
    owner.abort();
    expect(await retired).toMatchObject({ status: 'cancelled' });
    expect(gets()[0]?.[1].signal?.aborted).toBe(false);
    boot.resolve(tokenReply('shared'));
    expect(await active).toMatchObject({ status: 'completed' });
    expect(posts()).toHaveLength(1);
    expect(sentToken(posts()[0]![1])).toBe('shared');
  });

  it('refreshes exactly once for a token 403, while an old late 403 cannot evict the refreshed token', async () => {
    const old = [deferred<Response>(), deferred<Response>()];
    let bootstrap = 0, stalePosts = 0;
    const { host, gets, posts } = connect((url, options) => {
      if (url.pathname === bootstrapPath) return tokenReply(++bootstrap === 1 ? 'old' : 'fresh');
      return sentToken(options) === 'old' ? old[stalePosts++]!.promise : completed();
    });
    const first = host.getAvatarState(), second = host.getAvatarState();
    await vi.waitFor(() => expect(posts()).toHaveLength(2));
    old[0]!.resolve(denied('token'));
    expect(await first).toMatchObject({ status: 'completed' });
    old[1]!.resolve(denied('token'));
    expect(await second).toMatchObject({ status: 'completed' });
    expect(gets()).toHaveLength(2);
    expect(posts()).toHaveLength(4);
    expect(posts().slice(2).map(([, options]) => sentToken(options))).toEqual(['fresh', 'fresh']);
  });

  it('shares a refresh already in flight when two actions reject the same stale token', async () => {
    const refresh = deferred<Response>();
    let bootstrap = 0;
    const { host, gets, posts } = connect((url, options) => url.pathname === bootstrapPath
      ? ++bootstrap === 1 ? tokenReply('old') : refresh.promise
      : sentToken(options) === 'old' ? denied('token') : completed());
    const first = host.getAvatarState(), second = host.getAvatarState();
    await vi.waitFor(() => expect(gets()).toHaveLength(2));
    expect(posts()).toHaveLength(2);
    refresh.resolve(tokenReply('fresh'));
    expect(await first).toMatchObject({ status: 'completed' });
    expect(await second).toMatchObject({ status: 'completed' });
    expect(gets()).toHaveLength(2); expect(posts()).toHaveLength(4);
  });

  it('stops instead of writing without a token when refresh is unavailable', async () => {
    let bootstrap = 0;
    const { host, gets, posts } = connect((url, options) => url.pathname === bootstrapPath
      ? ++bootstrap === 1 ? tokenReply('stale') : new Response('', { status: 503 })
      : sentToken(options) ? denied('token') : completed());
    expect(await host.getAvatarState()).toMatchObject({ status: 'unavailable', reason: 'csrf_token_unavailable' });
    expect(gets()).toHaveLength(2); expect(posts()).toHaveLength(1);

  });

  it('sends neither bootstrap nor action for an already cancelled caller', async () => {
    const { host, fetcher } = connect(() => { throw new Error('must not request'); });
    const owner = new AbortController(); owner.abort();
    expect(await host.getAvatarState(owner.signal)).toMatchObject({ status: 'cancelled' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not expose credential-bearing transport errors to the public result', async () => {
    const { host } = connect(url => {
      if (url.pathname === bootstrapPath) return tokenReply('private-instance-credential');
      throw new Error('transport echoed X-CSRF-Token: private-instance-credential');
    });
    const result = await host.getAvatarState();
    expect(result).toMatchObject({ status: 'unavailable', reason: 'request_failed' });
    expect(JSON.stringify(result)).not.toContain('private-instance-credential');
  });

  it.each(['origin', undefined])('never retries an ordinary or origin 403 (%s)', async failure => {
    const { host, gets, posts } = connect(url => url.pathname === bootstrapPath ? tokenReply('cached') : denied(failure));
    expect(await host.getAvatarState()).toMatchObject({ status: 'rejected', reason: 'http_403' });
    expect(gets()).toHaveLength(1); expect(posts()).toHaveLength(1);
  });

  it('does not refresh or retry network failures and non-403 HTTP errors', async () => {
    let failNetwork = true;
    const { host, gets, posts } = connect(url => {
      if (url.pathname === bootstrapPath) return tokenReply('cached');
      if (failNetwork) throw new Error('offline');
      return new Response('', { status: 503 });
    });
    expect(await host.getAvatarState()).toMatchObject({ status: 'unavailable' });
    failNetwork = false;
    expect(await host.getAvatarState()).toMatchObject({ status: 'unavailable', reason: 'http_503' });
    expect(gets()).toHaveLength(1); expect(posts()).toHaveLength(2);
  });

  it('stops after the first retry if the refreshed token is still rejected', async () => {
    const { host, gets, posts } = connect(url => url.pathname === bootstrapPath ? tokenReply('still-rejected') : denied('token'));
    expect(await host.getAvatarState()).toMatchObject({ status: 'rejected', reason: 'http_403' });
    expect(gets()).toHaveLength(2); expect(posts()).toHaveLength(2);
  });

  it('does not send a retired generation after bootstrap, but opens its replacement after independent close', async () => {
    const boot = deferred<Response>();
    const { host, gets, posts } = connect(url => url.pathname === bootstrapPath ? boot.promise : completed());
    const retired = host.resetSession();
    await vi.waitFor(() => expect(gets()).toHaveLength(1));
    const replacement = host.resetSession();
    boot.resolve(tokenReply('current'));
    expect(await retired).toMatchObject({ status: 'cancelled' });
    expect(await replacement).toMatchObject({ status: 'completed' });
    expect(posts().map(([url]) => url.pathname.split('/').at(-1))).toEqual(['close_session', 'open_session']);
  });

  it('disposal aborts a waiting open while close retains its own signal and keepalive', async () => {
    const boot = deferred<Response>();
    const { host, gets, posts } = connect(url => url.pathname === bootstrapPath ? boot.promise : completed());
    const opening = host.resetSession();
    await vi.waitFor(() => expect(gets()).toHaveLength(1));
    host.dispose();
    expect(await opening).toMatchObject({ status: 'cancelled' });
    boot.resolve(tokenReply('cleanup'));
    await vi.waitFor(() => expect(posts()).toHaveLength(1));
    const [url, options] = posts()[0]!;
    expect(url.pathname).toMatch(/close_session$/);
    expect(options).toMatchObject({ keepalive: true });
    expect(options.signal?.aborted).toBe(false);
  });

  it('bounds an unresponsive cleanup independently after disposal', async () => {
    const { host, posts } = connect((url, options) => {
      if (url.pathname === bootstrapPath) return tokenReply('cleanup');
      if (!url.pathname.endsWith('/close_session')) return completed();
      return new Promise<Response>((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true }));
    });
    expect(await host.resetSession()).toMatchObject({ status: 'completed' });
    host.dispose();
    const cleanup = host.closeSession();
    await vi.waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[1]![1].signal?.aborted).toBe(false);
    expect(await cleanup).toMatchObject({ status: 'unavailable', reason: 'request_timeout' });
    expect(posts()[1]![1].signal?.aborted).toBe(true);
    expect(posts()).toHaveLength(2);
    hosts.splice(hosts.indexOf(host), 1); // Retained failed-close retry belongs to a later explicit close.
  }, 20_000);

  it('does not refresh or resend after cancellation while reading a token rejection', async () => {
    const body = deferred<unknown>();
    const owner = new AbortController();
    const { host, gets, posts } = connect(url => url.pathname === bootstrapPath ? tokenReply('old')
      : { ok: false, status: 403, json: () => body.promise } as Response);
    const pending = host.getAvatarState(owner.signal);
    await vi.waitFor(() => expect(posts()).toHaveLength(1));
    owner.abort(); body.resolve({ detail: { csrf_failure: 'token' } });
    expect(await pending).toMatchObject({ status: 'cancelled' });
    expect(gets()).toHaveLength(1); expect(posts()).toHaveLength(1);
  });
});
