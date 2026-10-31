import { runInNewContext } from 'node:vm';
import { getEventListeners } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import frameRuntime from '../../src/host/avatar/legacy-avatar-frame.ts?avatar-runtime';
import type { AvatarManifest, HostResult } from '../../src/host';
type AvatarSource = { syncAvatar(signal?: AbortSignal): Promise<HostResult<AvatarManifest>> };
import { mountPluginAvatar } from '../../src/host/avatar/plugin-avatar';

afterEach(() => vi.unstubAllGlobals());
const origin = 'http://localhost:48916';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function parentEmotionFixture() {
  const target = new EventTarget();
  const frame = { style: { cssText: '' }, srcdoc: '', title: '', contentWindow: { postMessage: vi.fn() }, setAttribute: vi.fn(), remove: vi.fn() };
  vi.stubGlobal('location', { origin });
  vi.stubGlobal('document', { createElement: () => frame });
  vi.stubGlobal('window', target);
  const resources = Object.fromEntries(['neko-minigame-avatar-host.js','engine/live2dcubismcore.min.js','engine/live2d.min.js','engine/pixi.min.js','engine/index.min.js','engine/live2d-core.js','engine/live2d-emotion.js','engine/live2d-model.js','model/cat.json'].map(name => [name, `/fixture/${name}`]));
  const host = { syncAvatar: vi.fn().mockResolvedValue({ status: 'completed', data: { name: 'YUI', generation: 'test', modelUrl: resources['model/cat.json'], scripts: Object.values(resources).filter(url => url.endsWith('.js')) } }) } as unknown as AvatarSource;
  const container = { append: vi.fn(), ownerDocument: { baseURI: origin } } as unknown as HTMLElement;
  const mount = mountPluginAvatar(container, host);
  await vi.waitFor(() => expect(container.append).toHaveBeenCalled());
  const mountId = /"mountId":"([^"]+)"/.exec(frame.srcdoc)![1];
  const emit = (data: object) => {
    const event = new Event('message');
    Object.defineProperties(event, { origin: { value: origin }, source: { value: frame.contentWindow },
      data: { value: { type: 'neko-survivors-react-avatar', mountId, ...data } } });
    target.dispatchEvent(event);
  };
  emit({ status: 'ready' }); await mount.ready;
  const ack = (requestId: string, status = 'completed') => emit({ status: 'emotion', requestId, result: { status } });
  const controls = (action: string) => frame.contentWindow.postMessage.mock.calls.map(call => call[0]).filter(message => message.action === action);
  const dispose = async () => {
    mount.dispose(); emit({ status: 'disposed', report: { confirmed: true, reason: 'test-ack' } });
    await mount.released;
  };
  return { mount, frame, ack, controls, dispose };
}
function engineFixture(hold?: 'init' | 'load') {
  const init = deferred<void>(), load = deferred<void>();
  if (hold !== 'init') init.resolve(undefined);
  if (hold !== 'load') load.resolve(undefined);
  const messages: Record<string, unknown>[] = [];
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const calls: string[] = [];
  const parent = { postMessage(data: Record<string, unknown>) { messages.push(data); } };
  let contextLost = false;
  const gl = { isContextLost: () => contextLost, getExtension: () => ({ loseContext() { contextLost = true; calls.push('lose-context'); } }) };
  const ticker = () => ({ started: true, stop() { this.started = false; calls.push('stop-ticker'); } });
  const appTicker = ticker(), shared = ticker(), system = ticker();
  const app = { renderer: { gl, resize: vi.fn() } as { gl: typeof gl; resize: ReturnType<typeof vi.fn> } | null,
    stage: {} as object | null, ticker: appTicker, stop: vi.fn(),
    destroy: vi.fn(function () { calls.push('destroy-app'); app.renderer = null; app.stage = null; }),
  };
  const model = { destroyed: false, destroy: vi.fn(function () { model.destroyed = true; calls.push('destroy-model'); }) };
  const managers: Manager[] = [];
  class Manager {
    pixi_app: typeof app | null = null;
    currentModel: typeof model | null = null;
    _activeLoadToken = 0;
    _screenChangeHandler = () => {};
    _displayChangeHandler = () => {};
    constructor() { managers.push(this); }
    async initPIXI() { await init.promise; this.pixi_app = app; return app; }
    loadModel = vi.fn(async () => {
      const token = ++this._activeLoadToken;
      await load.promise;
      if (token !== this._activeLoadToken) { model.destroy(); throw Object.assign(new Error('Retired'), { name: 'LoadSuperseded' }); }
      this.currentModel = model; return model;
    });
    pauseRendering() { calls.push('pause-manager'); this.pixi_app?.ticker.stop(); }
    _stopIdleFpsGovernor() { calls.push('stop-idle-governor'); }
    _cancelAvatarOperations() { calls.push('cancel-operations'); }
    setEmotion = vi.fn(async (_name: string, _options?: { signal: AbortSignal; isCurrent(): boolean }) => true);
    async removeModel() { this.currentModel?.destroy(); this.currentModel = null; }
  }
  interface Raw { dispose(): void; resize(viewport: { width: number; height: number }, fit: unknown): void }
  let raw: Raw | undefined;
  const avatarHost = { disposed: false,
    async mount() { raw = await createController(); if (this.disposed) { raw.dispose(); throw new DOMException('Retired', 'AbortError'); } raw.resize({ width: 100, height: 100 }, {}); return raw; },
    dispose() { this.disposed = true; raw?.dispose(); },
  };
  let createController!: () => Promise<Raw>;
  const window = {
    fetch: vi.fn().mockResolvedValue(new Response('{}')),
    addEventListener(name: string, handler: (event: unknown) => void) { const set = listeners.get(name) ?? new Set(); set.add(handler); listeners.set(name, set); },
    removeEventListener(name: string, handler: (event: unknown) => void) { listeners.get(name)?.delete(handler); },
    Live2DManager: Manager,
    PIXI: { Ticker: { shared, system } },
    NekoMiniGameAvatarHost: { create(options: { slots: { cat: { createController: () => Promise<Raw> } } }) { createController = options.slots.cat.createController; return avatarHost; }, fitLive2DModel: vi.fn() },
  };
  const config = { mountId: 'mount-1', parentOrigin: origin, baseUrl: `${origin}/plugin/game/ui/`, model: '/fixture.json', scripts: [] };
  const context = { window, parent, document: {}, location: { href: 'about:srcdoc', origin: 'null' }, URL, Response, DOMException, AbortController, Promise, config };
  runInNewContext(`${frameRuntime}\nstartLegacyAvatar(config);`, context);
  const dispose = () => {
    for (const listener of [...(listeners.get('message') ?? [])]) listener({ source: parent, origin, data: { type: 'neko-survivors-react-avatar-control', mountId: 'mount-1', action: 'dispose' } });
  };
  const control = (data: Record<string, unknown>, overrides: Record<string, unknown> = {}) => {
    for (const listener of [...(listeners.get('message') ?? [])]) listener({ source: parent, origin,
      data: { type: 'neko-survivors-react-avatar-control', mountId: 'mount-1', ...data }, ...overrides });
  };
  return { init, load, messages, calls, app, model, managers, dispose, control, raw: () => raw, window, listeners };
}

describe('legacy frame explicit teardown', () => {
  it('authenticates emotion controls and acknowledges the actual manager result', async () => {
    const fixture = engineFixture();
    await vi.waitFor(() => expect(fixture.messages.some(message => message.status === 'ready')).toBe(true));
    const action = { action: 'emotion', requestId: 'emotion-123', name: 'happy' };
    fixture.control(action, { origin: 'https://foreign.example' });
    fixture.control(action, { source: {} });
    fixture.control({ ...action, mountId: 'wrong-generation' });
    expect(fixture.managers[0]?.setEmotion).not.toHaveBeenCalled();
    fixture.control(action);
    await vi.waitFor(() => expect(fixture.messages).toContainEqual(expect.objectContaining({ status: 'emotion', requestId: 'emotion-123', result: { status: 'completed' } })));
    expect(fixture.managers[0]?.setEmotion).toHaveBeenCalledWith('happy', expect.objectContaining({ signal: expect.any(AbortSignal), isCurrent: expect.any(Function) }));
    fixture.managers[0]!.setEmotion.mockResolvedValueOnce(false);
    fixture.control({ action: 'emotion', requestId: 'emotion-456', name: 'sad' });
    await vi.waitFor(() => expect(fixture.messages).toContainEqual(expect.objectContaining({ requestId: 'emotion-456', result: { status: 'unavailable', reason: 'emotion_not_applied' } })));
    fixture.dispose();
  });
  it('cancels pending model operations and never reports a late completion as applied', async () => {
    const fixture = engineFixture();
    await vi.waitFor(() => expect(fixture.messages.some(message => message.status === 'ready')).toBe(true));
    const pending = deferred<boolean>();
    fixture.managers[0]!.setEmotion.mockReturnValueOnce(pending.promise);
    fixture.control({ action: 'emotion', requestId: 'emotion-pending', name: 'surprised' });
    const operation = fixture.managers[0]!.setEmotion.mock.calls[0]![1]!;
    fixture.control({ action: 'cancel-emotion', requestId: 'emotion-pending' });
    expect(operation.signal.aborted).toBe(true);
    expect(operation.isCurrent()).toBe(false);
    pending.resolve(true);
    await vi.waitFor(() => expect(fixture.messages).toContainEqual(expect.objectContaining({ requestId: 'emotion-pending', result: expect.objectContaining({ status: 'cancelled' }) })));
    fixture.dispose();
  });
  it('destroys model/app/context exactly once and stops all owned tickers', async () => {
    const fixture = engineFixture();
    await vi.waitFor(() => expect(fixture.messages.some(message => message.status === 'ready')).toBe(true));
    await fixture.window.fetch('/plugin/game/ui/model.json'); // about:srcdoc resolves against injected parent base.
    fixture.dispose(); fixture.dispose(); fixture.raw()?.dispose();
    await vi.waitFor(() => expect(fixture.messages.some(message => message.status === 'disposed')).toBe(true));
    const report = fixture.messages.find(message => message.status === 'disposed')?.report;
    expect(report).toMatchObject({ confirmed: true, modelsObserved: 1, modelsDestroyed: true, appsObserved: 1, appsDestroyed: true, tickersStopped: true, contextsObserved: 1, contextsLost: 1, sharedTickersStopped: true });
    expect(fixture.app.destroy).toHaveBeenCalledTimes(1); expect(fixture.model.destroy).toHaveBeenCalledTimes(1);
    expect(fixture.calls.indexOf('destroy-model')).toBeLessThan(fixture.calls.indexOf('destroy-app'));
    expect(fixture.calls.indexOf('destroy-app')).toBeLessThan(fixture.calls.indexOf('lose-context'));
    const resizeCount = fixture.app.renderer?.resize.mock.calls.length ?? 1;
    fixture.raw()?.resize({ width: 999, height: 999 }, {});
    expect(fixture.app.renderer).toBeNull(); expect(resizeCount).toBe(1);
  });
  it('waits for pending renderer initialization and destroys its late application before ack', async () => {
    const fixture = engineFixture('init');
    await vi.waitFor(() => expect(fixture.managers).toHaveLength(1));
    fixture.dispose(); await Promise.resolve();
    expect(fixture.messages.some(message => message.status === 'disposed')).toBe(false);
    fixture.init.resolve(undefined);
    await vi.waitFor(() => expect(fixture.messages.some(message => message.status === 'disposed')).toBe(true));
    expect(fixture.app.destroy).toHaveBeenCalledTimes(1); expect(fixture.managers[0]?.loadModel).not.toHaveBeenCalled();
    expect(fixture.messages.some(message => message.status === 'ready')).toBe(false);
  });
  it('retires a pending load so its late model cannot attach or restart rendering', async () => {
    const fixture = engineFixture('load');
    await vi.waitFor(() => expect(fixture.managers[0]?.loadModel).toHaveBeenCalledTimes(1));
    fixture.dispose();
    await vi.waitFor(() => expect(fixture.messages.some(message => message.status === 'disposed')).toBe(true));
    fixture.load.resolve(undefined);
    await vi.waitFor(() => expect(fixture.model.destroyed).toBe(true));
    expect(fixture.managers[0]?.currentModel).toBeNull(); expect(fixture.managers[0]?.pixi_app).toBeNull();
    expect(fixture.messages.some(message => message.status === 'ready')).toBe(false);
    expect(fixture.app.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('parent disposal acknowledgement', () => {
  it('retains cancellation after completion and cannot resolve again or cancel a newer intention', async () => {
    const fixture = await parentEmotionFixture();
    const owner = new AbortController(), delivered = vi.fn();
    const first = fixture.mount.setEmotion('happy', owner.signal); void first.then(delivered);
    await setImmediate();
    const request = fixture.controls('emotion').at(-1)!;
    fixture.ack(request.requestId); await first;
    expect(delivered).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'completed' }));
    owner.abort();
    expect(fixture.controls('cancel-emotion')).toEqual([expect.objectContaining({ requestId: request.requestId })]);
    fixture.ack(request.requestId, 'cancelled'); await setImmediate();
    expect(delivered).toHaveBeenCalledTimes(1);

    const nextOwner = new AbortController();
    const next = fixture.mount.setEmotion('sad', nextOwner.signal);
    let nextSettled = false; void next.then(() => { nextSettled = true; });
    await setImmediate();
    const nextRequest = fixture.controls('emotion').at(-1)!;
    owner.abort(); fixture.ack(request.requestId); await setImmediate();
    expect(nextSettled).toBe(false);
    expect(fixture.controls('cancel-emotion')).toHaveLength(1);
    fixture.ack(nextRequest.requestId); await next;
    nextOwner.abort();
    expect(fixture.controls('cancel-emotion').at(-1)).toMatchObject({ requestId: nextRequest.requestId });
    await fixture.dispose();
  });

  it('keeps at most one live abort listener across many accepted emotions and retires it on disposal', async () => {
    const fixture = await parentEmotionFixture();
    const nativeAny = AbortSignal.any.bind(AbortSignal), channels: AbortSignal[] = [];
    const spy = vi.spyOn(AbortSignal, 'any').mockImplementation(signals => {
      const signal = nativeAny(signals); channels.push(signal); return signal;
    });
    try {
      const owners: AbortController[] = [];
      for (let index = 0; index < 40; index++) {
        const owner = new AbortController(); owners.push(owner);
        const operation = fixture.mount.setEmotion('happy', owner.signal);
        await setImmediate();
        fixture.ack(fixture.controls('emotion').at(-1)!.requestId); await operation;
        expect(channels.reduce((count, signal) => count + getEventListeners(signal, 'abort').length, 0)).toBe(1);
      }
      expect(fixture.controls('cancel-emotion')).toHaveLength(39);
      for (const old of owners.slice(0, -1)) old.abort();
      expect(fixture.controls('cancel-emotion')).toHaveLength(39);
      const currentId = fixture.controls('emotion').at(-1)!.requestId;
      await fixture.dispose();
      expect(fixture.controls('cancel-emotion')).toHaveLength(40);
      expect(fixture.controls('cancel-emotion').at(-1)).toMatchObject({ requestId: currentId });
      expect(channels.reduce((count, signal) => count + getEventListeners(signal, 'abort').length, 0)).toBe(0);
    } finally { spy.mockRestore(); }
  });

  it('cleans failed and timed-out intentions without retaining cancellation listeners', async () => {
    const fixture = await parentEmotionFixture();
    const nativeAny = AbortSignal.any.bind(AbortSignal), channels: AbortSignal[] = [];
    const spy = vi.spyOn(AbortSignal, 'any').mockImplementation(signals => {
      const signal = nativeAny(signals); channels.push(signal); return signal;
    });
    try {
      const owner = new AbortController();
      const failure = fixture.mount.setEmotion('happy', owner.signal); await setImmediate();
      fixture.ack(fixture.controls('emotion').at(-1)!.requestId, 'unavailable');
      await expect(failure).resolves.toMatchObject({ status: 'unavailable' });
      expect(channels.reduce((count, signal) => count + getEventListeners(signal, 'abort').length, 0)).toBe(0);
      owner.abort(); expect(fixture.controls('cancel-emotion')).toHaveLength(1);
      vi.useFakeTimers();
      const timeout = fixture.mount.setEmotion('sad', new AbortController().signal);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(15_000);
      await expect(timeout).resolves.toMatchObject({ status: 'unavailable', reason: 'avatar_emotion_timeout' });
      expect(channels.reduce((count, signal) => count + getEventListeners(signal, 'abort').length, 0)).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      await fixture.dispose();
    } finally { spy.mockRestore(); vi.useRealTimers(); }
  });
  it('waits for readiness and only accepts the matching emotion acknowledgement', async () => {
    const handlers = new Set<(event: unknown) => void>();
    const frame = { style: { cssText: '' }, srcdoc: '', title: '', contentWindow: { postMessage: vi.fn() }, setAttribute: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('location', { origin }); vi.stubGlobal('document', { createElement: () => frame });
    vi.stubGlobal('window', { addEventListener: (_: string, handler: (event: unknown) => void) => handlers.add(handler), removeEventListener: (_: string, handler: (event: unknown) => void) => handlers.delete(handler) });
    const resources = Object.fromEntries(['neko-minigame-avatar-host.js','engine/live2dcubismcore.min.js','engine/live2d.min.js','engine/pixi.min.js','engine/index.min.js','engine/live2d-core.js','engine/live2d-emotion.js','engine/live2d-model.js','model/cat.json'].map(name => [name, `/fixture/${name}`]));
    const host = { syncAvatar: vi.fn().mockResolvedValue({ status: 'completed', data: { name: 'YUI', generation: 'test', modelUrl: resources['model/cat.json'], scripts: Object.values(resources).filter(url => url.endsWith('.js')) } }) } as unknown as AvatarSource;
    const container = { append: vi.fn(), ownerDocument: { baseURI: origin } } as unknown as HTMLElement;
    const mount = mountPluginAvatar(container, host);
    const emotion = mount.setEmotion('happy');
    await vi.waitFor(() => expect(container.append).toHaveBeenCalled());
    expect(frame.contentWindow.postMessage).not.toHaveBeenCalled();
    const mountId = /"mountId":"([^"]+)"/.exec(frame.srcdoc)![1];
    const emit = (data: object, extra: object = {}) => {
      for (const handler of [...handlers]) handler({ source: frame.contentWindow, origin, data: { type: 'neko-survivors-react-avatar', mountId, ...data }, ...extra });
    };
    emit({ status: 'ready' }); await mount.ready;
    await vi.waitFor(() => expect(frame.contentWindow.postMessage).toHaveBeenCalledTimes(1));
    const request = frame.contentWindow.postMessage.mock.calls[0]![0];
    expect(request).toMatchObject({ action: 'emotion', name: 'happy', mountId });
    let settled = false; void emotion.then(() => { settled = true; });
    const ack = { status: 'emotion', requestId: request.requestId, result: { status: 'completed' } };
    emit(ack, { origin: 'https://foreign.example' }); emit(ack, { source: {} }); emit({ ...ack, mountId: 'wrong' });
    await Promise.resolve(); expect(settled).toBe(false);
    emit(ack); await expect(emotion).resolves.toMatchObject({ status: 'completed' });
    const owner = new AbortController(); const cancelled = mount.setEmotion('sad', owner.signal);
    await Promise.resolve(); owner.abort();
    await expect(cancelled).resolves.toMatchObject({ status: 'cancelled' });
    expect(frame.contentWindow.postMessage.mock.calls.some(call => call[0].action === 'cancel-emotion')).toBe(true);
    mount.dispose(); emit({ status: 'disposed', report: { confirmed: true, reason: 'test-ack' } });
    await mount.released;
    const callCount = frame.contentWindow.postMessage.mock.calls.length;
    await expect(mount.setEmotion('surprised')).resolves.toMatchObject({ status: 'cancelled' });
    expect(frame.contentWindow.postMessage).toHaveBeenCalledTimes(callCount);
  });
  it('keeps the iframe until a matching release report and makes dispose idempotent', async () => {
    const handlers = new Set<(event: unknown) => void>();
    const frame = { style: { cssText: '' }, srcdoc: '', title: '', contentWindow: { postMessage: vi.fn() }, setAttribute: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('location', { href: `${origin}/plugin/neko_survivors_react/ui/index.html`, origin });
    vi.stubGlobal('document', { createElement: () => frame });
    vi.stubGlobal('window', { addEventListener: (_: string, handler: (event: unknown) => void) => handlers.add(handler), removeEventListener: (_: string, handler: (event: unknown) => void) => handlers.delete(handler) });
    const resources: Record<string, string> = {};
    for (const name of ['neko-minigame-avatar-host.js','engine/live2dcubismcore.min.js','engine/live2d.min.js','engine/pixi.min.js','engine/index.min.js','engine/live2d-core.js','engine/live2d-emotion.js','engine/live2d-model.js','model/猫/角色.model3.json']) resources[name] = `/plugin/neko_survivors_react/ui/vendor/generation/${name}`;
    const host = { syncAvatar: vi.fn().mockResolvedValue({ status: 'completed', data: { name: 'YUI', generation: 'test', modelUrl: resources['model/猫/角色.model3.json'], scripts: Object.values(resources).filter(url => url.endsWith('.js')) } }) } as unknown as AvatarSource;
    const container = { append: vi.fn(), ownerDocument: { baseURI: `${origin}/plugin/neko_survivors_react/ui/index.html` } } as unknown as HTMLElement;
    const abort = new AbortController(); const mount = mountPluginAvatar(container, host, abort.signal);
    await vi.waitFor(() => expect(container.append).toHaveBeenCalledWith(frame));
    expect(frame.srcdoc).toContain('config.baseUrl'); expect(frame.srcdoc).toContain('config.parentOrigin');
    abort.abort(); await expect(mount.ready).rejects.toMatchObject({ name: 'AbortError' });
    expect(frame.remove).not.toHaveBeenCalled();
    const data = frame.contentWindow.postMessage.mock.calls[0]?.[0];
    for (const handler of [...handlers]) handler({ source: frame.contentWindow, origin, data: { type: 'neko-survivors-react-avatar', mountId: data.mountId, status: 'disposed', report: { confirmed: true, reason: 'test-engine-ack' } } });
    expect(await mount.released).toMatchObject({ confirmed: true });
    mount.dispose(); expect(frame.remove).toHaveBeenCalledTimes(1); expect(handlers.size).toBe(0);
  });
});
