import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostResult, NekoHost } from '../../src/host';
const ports = vi.hoisted(() => ({ mount: vi.fn() }));
import { watchAvatar } from '../../src/app/avatar-watch';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function fixture() {
  const ready = deferred<void>();
  return { ready, lease: { ready: ready.promise, dispose: vi.fn(),
    setEmotion: vi.fn(async (_name: string, _signal?: AbortSignal): Promise<HostResult> => ({ status: 'completed' })) } };
}
function environment() {
  vi.useFakeTimers(); ports.mount.mockReset();
  let identity = 'YUI';
  let available = true;
  const host: NekoHost = {
    mode: 'plugin',
    mountAvatar: async () => { const lease = ports.mount(); await lease.ready; return lease; },
    getAvatarState: vi.fn(async (): Promise<import('../../src/host').HostResult<import('../../src/host').AvatarState>> => available ? { status: 'completed', data: { identity } } : { status: 'unavailable' }),
    resetSession: async () => ({ status: 'completed' }), closeSession: async () => ({ status: 'completed' }),
    report: async () => ({ status: 'queued' }), speak: async () => ({ status: 'queued' }),
    dispose() {},
  };
  const lifetime = new AbortController();
  const visible = vi.fn();
  return { host, lifetime, visible, setIdentity: (value: string) => { identity = value; }, disconnect: () => { available = false; } };
}
afterEach(() => vi.useRealTimers());

describe('avatar watcher expression ownership', () => {
  it('retains only the latest valid emotion before the first model is ready', async () => {
    const env = environment(), model = fixture(); ports.mount.mockReturnValue(model.lease);
    const watcher = watchAvatar(env.host, {} as HTMLElement, env.visible, env.lifetime.signal);
    watcher.setEmotion('happy'); watcher.setEmotion('sad');
    await vi.advanceTimersByTimeAsync(0);
    expect(model.lease.setEmotion).not.toHaveBeenCalled();
    model.ready.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(model.lease.setEmotion).toHaveBeenCalledExactlyOnceWith('sad', expect.any(AbortSignal));
    watcher.dispose();
  });
  it('drops pre-ready intent from an aborted game session and accepts the replacement session intent', async () => {
    const env = environment(), model = fixture(); ports.mount.mockReturnValue(model.lease);
    const watcher = watchAvatar(env.host, {} as HTMLElement, env.visible, env.lifetime.signal);
    const old = new AbortController(); watcher.setEmotion('happy', old.signal);
    old.abort(); model.ready.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(model.lease.setEmotion).not.toHaveBeenCalled();
    const next = new AbortController(); watcher.setEmotion('surprised', next.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(model.lease.setEmotion).toHaveBeenCalledExactlyOnceWith('surprised', expect.any(AbortSignal));
    const signal = model.lease.setEmotion.mock.calls[0]![1]!;
    next.abort(); expect(signal.aborted).toBe(true);
    watcher.dispose();
  });
  it('retires the old character lease and never replays its late action onto a replacement', async () => {
    const env = environment(), first = fixture(), second = fixture();
    ports.mount.mockReturnValueOnce(first.lease).mockReturnValueOnce(second.lease);
    const watcher = watchAvatar(env.host, {} as HTMLElement, env.visible, env.lifetime.signal);
    first.ready.resolve(); await vi.advanceTimersByTimeAsync(0);
    const late = deferred<HostResult>(); first.lease.setEmotion.mockReturnValueOnce(late.promise);
    watcher.setEmotion('happy'); await vi.advanceTimersByTimeAsync(0);
    const signal = first.lease.setEmotion.mock.calls[0]![1]!;
    env.setIdentity('Kuro'); await vi.advanceTimersByTimeAsync(5000);
    expect(first.lease.dispose).toHaveBeenCalledTimes(1); expect(signal.aborted).toBe(true);
    second.ready.resolve(); late.resolve({ status: 'completed' }); await vi.advanceTimersByTimeAsync(0);
    expect(second.lease.setEmotion).not.toHaveBeenCalled();
    watcher.setEmotion('sad'); await vi.advanceTimersByTimeAsync(0);
    expect(second.lease.setEmotion).toHaveBeenCalledExactlyOnceWith('sad', expect.any(AbortSignal));
    watcher.dispose();
  });
  it('does not revive a disposed watcher when a model becomes ready late', async () => {
    const env = environment(), model = fixture(); ports.mount.mockReturnValue(model.lease);
    const watcher = watchAvatar(env.host, {} as HTMLElement, env.visible, env.lifetime.signal);
    watcher.setEmotion('happy'); await vi.advanceTimersByTimeAsync(0);
    watcher.dispose(); watcher.dispose();
    model.ready.resolve(); await vi.advanceTimersByTimeAsync(0);
    watcher.setEmotion('sad');
    expect(model.lease.setEmotion).not.toHaveBeenCalled();
    expect(env.visible).not.toHaveBeenCalledWith(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('releases a disconnected avatar and cancels its active expression signal', async () => {
    const env = environment(), model = fixture(); ports.mount.mockReturnValue(model.lease);
    const watcher = watchAvatar(env.host, {} as HTMLElement, env.visible, env.lifetime.signal);
    model.ready.resolve(); await vi.advanceTimersByTimeAsync(0);
    watcher.setEmotion('happy'); await vi.advanceTimersByTimeAsync(0);
    const signal = model.lease.setEmotion.mock.calls[0]![1]!;
    env.disconnect(); await vi.advanceTimersByTimeAsync(5000);
    expect(model.lease.dispose).toHaveBeenCalledTimes(1); expect(signal.aborted).toBe(true);
    expect(env.visible).toHaveBeenLastCalledWith(false);
    watcher.dispose();
  });
});

it('delivers current expression failures and consumes a failed engine release acknowledgement', async () => {
  const env = environment(), model = fixture(), released = deferred<import('../../src/host').AvatarDisposalReport>();
  ports.mount.mockReturnValue({ ...model.lease, released: released.promise });
  const feedback = vi.fn();
  const watcher = watchAvatar(env.host, {} as HTMLElement, env.visible, env.lifetime.signal, feedback);
  model.ready.resolve(); await vi.advanceTimersByTimeAsync(0);
  model.lease.setEmotion.mockResolvedValueOnce({ status: 'unavailable', reason: 'missing_expression' });
  watcher.setEmotion('happy'); await vi.advanceTimersByTimeAsync(0);
  expect(feedback).toHaveBeenCalledWith('emotion', { status: 'unavailable', reason: 'missing_expression' });
  watcher.dispose();
  released.resolve({ confirmed: false, reason: 'engine_cleanup_failed', errors: ['context still live'] });
  await vi.advanceTimersByTimeAsync(0);
  expect(feedback).toHaveBeenCalledWith('release', { status: 'unavailable', reason: 'engine_cleanup_failed: context still live' });
  expect(vi.getTimerCount()).toBe(0);
});

it('suppresses a retired expression receipt while retaining its cancellation channel', async () => {
  const env = environment(), model = fixture(), late = deferred<HostResult>(), feedback = vi.fn();
  ports.mount.mockReturnValue(model.lease);
  const watcher = watchAvatar(env.host, {} as HTMLElement, env.visible, env.lifetime.signal, feedback);
  model.ready.resolve(); await vi.advanceTimersByTimeAsync(0);
  model.lease.setEmotion.mockReturnValueOnce(late.promise);
  watcher.setEmotion('happy'); await vi.advanceTimersByTimeAsync(0);
  const signal = model.lease.setEmotion.mock.calls[0]![1]!;
  watcher.setEmotion('sad'); await vi.advanceTimersByTimeAsync(0);
  expect(signal.aborted).toBe(true);
  late.resolve({ status: 'unavailable', reason: 'OLD failure' }); await vi.advanceTimersByTimeAsync(0);
  expect(feedback).toHaveBeenCalledExactlyOnceWith('emotion', { status: 'completed' });
  watcher.dispose();
});


it.each(['failed-report', 'rejection', 'success'])('keeps A→B→C late %s isolated without losing retired resource failures', async outcome => {
  const env = environment(), a = fixture(), b = fixture(), c = fixture();
  const releaseA = deferred<import('../../src/host').AvatarDisposalReport>();
  const releaseB = deferred<import('../../src/host').AvatarDisposalReport>();
  a.ready.resolve(); b.ready.resolve(); c.ready.resolve();
  ports.mount.mockReturnValueOnce({ ...a.lease, released: releaseA.promise })
    .mockReturnValueOnce({ ...b.lease, released: releaseB.promise }).mockReturnValueOnce(c.lease);
  const feedback = vi.fn();
  const watcher = watchAvatar(env.host, {} as HTMLElement, env.visible, env.lifetime.signal, feedback);
  await vi.advanceTimersByTimeAsync(0);
  watcher.setEmotion('happy'); await vi.advanceTimersByTimeAsync(0);
  const emotion = a.lease.setEmotion.mock.calls[0]![1]!;
  env.setIdentity('B'); await vi.advanceTimersByTimeAsync(5000);
  env.setIdentity('C'); await vi.advanceTimersByTimeAsync(5000);
  expect(emotion.aborted).toBe(true); expect(a.lease.dispose).toHaveBeenCalledOnce(); expect(b.lease.dispose).toHaveBeenCalledOnce();
  releaseB.resolve({ confirmed: false, reason: 'B current failure' }); await vi.advanceTimersByTimeAsync(0);
  if (outcome === 'rejection') releaseA.reject(new Error('A late rejection'));
  else releaseA.resolve({ confirmed: outcome === 'success', reason: 'A late report' });
  await vi.advanceTimersByTimeAsync(0);
  expect(feedback.mock.calls.filter(([kind]) => kind === 'release')).toEqual([['release', { status: 'unavailable', reason: 'B current failure' }]]);
  const retired = feedback.mock.calls.filter(([kind]) => kind === 'retired-release');
  if (outcome === 'success') expect(retired).toEqual([]);
  else expect(retired).toEqual([['retired-release', { status: 'unavailable', reason: outcome === 'rejection' ? 'Error: A late rejection' : 'A late report' }]]);
  watcher.dispose(); expect(vi.getTimerCount()).toBe(0);
});
