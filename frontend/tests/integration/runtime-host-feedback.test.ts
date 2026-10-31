import { uiSnapshot } from '../support/views';
import { setImmediate } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameCommand, GameEvent, GameFrame, GameSession, GameUiSnapshot } from '../../src/game';
import type { HostResult, NekoHost } from '../../src/host';

const ports = vi.hoisted(() => ({
  createSession: vi.fn(),
  createRenderer: vi.fn(),
  watchAvatar: vi.fn(),
  audio: {
    initResult: true,
    init: vi.fn(),
    lastIssue: null as { id: number; kind: 'initialization' | 'music' | 'sound'; reason: string; recoverable: boolean; waitingForGesture: boolean; resource?: string } | null,
  },
  renderer: {
    backend: 'webgl2', contextLost: false, diagnostics: {},
    canvas: { width: 1024, height: 768 },
    setPlayerEffectOpacity: vi.fn(),setPlayerSoftQuality:vi.fn(), render: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
    screenToWorld: (x: number, y: number) => ({ x, y }),
  },
  keyboard: {
    sample: () => ({ moveX: 0, moveY: 0, slow: false, clear: false, ultimate: false,
      p2MoveX: 0, p2MoveY: 0, p2Slow: false, p2Clear: false }),
    clear: vi.fn(), dispose: vi.fn(),
  },
  pointer: { sample: () => ({ x: 0, y: 0, down: false }), dispose: vi.fn() },
}));

vi.mock('../../src/game', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/game')>();
  return { ...actual, createGameSession: (...args: Parameters<typeof actual.createGameSession>) =>
    ports.createSession.getMockImplementation() ? ports.createSession(...args) : actual.createGameSession(...args) };
});
// Host-output tests drive the public simulation connection through an in-process
// transferable port. Dedicated tests separately exercise real Node/browser workers.
vi.mock('../../src/simulation/client', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/simulation/client')>();
  const { SimulationHost } = await import('../../src/simulation/host');
  class TestWorker extends EventTarget {
    private readonly host = new SimulationHost((message, transfer) => {
      const data = structuredClone(message, { transfer: transfer ?? [] });
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data })));
    }, { now: () => now, schedule: callback => {
      const id = ++simulationTimer; simulationTimers.set(id, callback); return id;
    }, cancel: id => { simulationTimers.delete(id as unknown as number); } });
    postMessage(message: import('../../src/simulation/protocol').WorkerInput, transfer: ArrayBuffer[] = []) {
      const data = structuredClone(message, { transfer }); queueMicrotask(() => this.host.receive(data));
    }
    terminate() { this.host.dispose(); }
  }
  return { createSimulation: (options: Parameters<typeof actual.createSimulation>[0]) => actual.createSimulation(options, () => new TestWorker() as unknown as Worker) };
});
vi.mock('../../src/rendering', () => ({ createGameRenderer: async (options: unknown) => { ports.createRenderer(options); return ports.renderer; } }));
vi.mock('../../src/input/keyboard', () => ({ createKeyboardInput: () => ports.keyboard }));
vi.mock('../../src/input/pointer', () => ({ createPointerInput: () => ports.pointer }));
vi.mock('../../src/app/avatar-watch', () => ({ watchAvatar: ports.watchAvatar }));
vi.mock('../../src/audio/audio-player.ts', () => ({
  AudioSystem: class {
    enabled = true;
    get lastIssue() { return ports.audio.lastIssue; }
    init() { ports.audio.init(); return ports.audio.initResult; }
    setVolumes() {} unlock() {} beginFrame() {} play() {} playWeapon() {} applyMusicCue() {} dispose() {}
    toggle() { this.enabled = !this.enabled; }
  },
}));

import { createRuntime, type GameRuntime } from '../../src/app/runtime';
import { createEmptyMeta } from '../../src/game';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** Only the public GameSession surface is supplied to the real runtime. */
function controlledSession() {
  let ui: GameUiSnapshot = { ...uiSnapshot(),
    revision: 0, phase: 'title', wave: 1, secondsLeft: 30, difficulty: 'normal',
    players: [], offers: [], upgrades: [], rewards: [], retryStats: { wave: 0, total: 0, manual: 0 },
    rerollCost: 0, pilot: false, canRetry: false, won: false, endless: false,
  };
  const batches: { events: GameEvent[]; phase?: GameUiSnapshot['phase'] }[] = [];
  const meta = createEmptyMeta();
  const session: GameSession = {
    dispatch(command) {
      if (command.type === 'start-run' || command.type === 'start-challenge') {
        ui = { ...ui, revision: ui.revision + 1, phase: 'playing' };
      } else if (command.type === 'return-title') {
        ui = { ...ui, revision: ui.revision + 1, phase: 'title' };
      }
      return { ok: true };
    },
    drainEvents: () => [],
    advance() {
      const batch = batches.shift();
      if (batch?.phase) ui = { ...ui, revision: ui.revision + 1, phase: batch.phase };
      return { events: batch?.events ?? [], uiChanged: !!batch?.phase };
    },
    readDisplay() { throw new Error('This fixture exercises canonical Main frames only'); },
    readFrame(): GameFrame {
      return { tick: 0, time: 0, phase: ui.phase, combat: ui.combat, camera: { x: 0, y: 0, zoom: 1 },
        backgroundId: 'stage', worldHalfSize: 1000, actors: [], projectiles: [],
        pickups: [], effects: [], telegraphs: [] };
    },
    readUi: () => ui,
    exportSave: () => null,
    getMeta: () => meta,
    setViewport() {},
  };
  return { session, enqueue: (events: GameEvent[], phase?: GameUiSnapshot['phase']) => batches.push({ events, phase }) };
}

function hostPort(mode: NekoHost['mode'] = 'plugin') {
  return {
    mode,
    resetSession: vi.fn(async (_signal?: AbortSignal): Promise<HostResult> => ({ status: 'completed' })),
    closeSession: vi.fn(async (_reason?: string, _signal?: AbortSignal): Promise<HostResult> => ({ status: 'completed' })),
    report: vi.fn(async (_event: string, _text: string, _signal?: AbortSignal): Promise<HostResult> => ({ status: 'queued' })),
    speak: vi.fn(async (_text: string, _signal?: AbortSignal): Promise<HostResult> => ({ status: 'queued' })),
    getAvatarState: vi.fn(async (): Promise<HostResult<never>> => ({ status: 'unavailable' })),
    mountAvatar: vi.fn(async () => null),
    dispose: vi.fn(),
  } satisfies NekoHost;
}

const start: GameCommand = { type: 'start-run', options: { characterId: 'mimi', difficulty: 'normal', partySize: 1, seed: 7 } };
const report: GameEvent = { type: 'report', event: 'boss_kill', text: 'Boss defeated' };
const speech: GameEvent = { type: 'speech', text: 'A game line', key: 'test-line' };
const runtimes: GameRuntime[] = [];
let frames: Map<number, FrameRequestCallback>;
let frameId: number;
let simulationTimers: Map<number, () => void>;
let simulationTimer: number;
let now: number;

async function frame() {
  now += 20;
  const simulation = [...simulationTimers.values()]; simulationTimers.clear();
  for (const callback of simulation) callback();
  await setImmediate();
  const pending = [...frames.values()]; frames.clear();
  for (const callback of pending) callback(now);
  await setImmediate();
}

async function setup(mode?: NekoHost['mode']) {
  const game = controlledSession();
  ports.createSession.mockReturnValue(game.session);
  const host = hostPort(mode);
  const runtime = await createRuntime({ clientWidth: 800, clientHeight: 600 } as HTMLElement, { host });
  runtimes.push(runtime);
  await runtime.dispatch(start);
  await setImmediate();
  await frame(); // Establish the real fixed-step loop's first timestamp.
  return { game, host, runtime };
}

beforeEach(() => {
  vi.clearAllMocks();
  ports.audio.initResult = true; ports.audio.lastIssue = null;
  ports.watchAvatar.mockReset();
  ports.watchAvatar.mockImplementation(() => ({ dispose: vi.fn(), setEmotion: vi.fn() }));
  frames = new Map(); frameId = 0; now = 0; simulationTimers = new Map(); simulationTimer = 0;
  const records = new Map<string, string>();
  const storage: Storage = {
    get length() { return records.size; },
    clear: () => records.clear(), key: index => [...records.keys()][index] ?? null,
    getItem: key => records.get(key) ?? null, setItem: (key, value) => { records.set(key, value); },
    removeItem: key => { records.delete(key); },
  };
  vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage }));
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++frameId; frames.set(id, callback); return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
});

afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.dispose();
  vi.unstubAllGlobals();
});

describe('real runtime host feedback wiring', () => {
  it('locks rendering quality throughout capture startup and recording, then allows switching after export',async()=>{
    const game=controlledSession();ports.createSession.mockReturnValue(game.session);
    const runtime=await createRuntime({clientWidth:800,clientHeight:600} as HTMLElement,{host:hostPort('standalone'),capture:true});runtimes.push(runtime);
    const starting=runtime.startPerformanceCapture();runtime.setPlayerSoftQuality('balanced');
    expect(ports.renderer.setPlayerSoftQuality).not.toHaveBeenCalled();
    await expect(runtime.stopPerformanceCapture()).rejects.toThrow();
    await starting;
    runtime.setPlayerSoftQuality('balanced');expect(runtime.getSnapshot().softQuality).toBe('native');
    expect(runtime.getSnapshot().notice?.text).toContain('采集');
    await runtime.stopPerformanceCapture();runtime.setPlayerSoftQuality('balanced');
    expect(runtime.getSnapshot().softQuality).toBe('balanced');expect(ports.renderer.setPlayerSoftQuality).toHaveBeenCalledOnce();
  });
  it.each(['{"wins":3}', '{bad-json', '[]', '{"wins":3,"fxAlpha":25}'])('initializes safely with invalid current growth %s, reports it and preserves the stored bytes', async raw => {
    const real = await vi.importActual<typeof import('../../src/game')>('../../src/game');
    ports.createSession.mockImplementation(options => real.createGameSession(options));
    const key='neko_survivors_react:meta:v2';window.localStorage.setItem(key,raw);
    const runtime=await createRuntime({clientWidth:800,clientHeight:600} as HTMLElement,{host:hostPort('standalone')});runtimes.push(runtime);
    expect(runtime.getSnapshot().game.phase).toBe('title');
    expect(runtime.getSnapshot().notice).toMatchObject({tone:'bad',text:expect.stringContaining('成长记录无效')});
    expect(ports.createSession.mock.results.at(-1)!.value.getMeta()).toEqual(real.createEmptyMeta());
    expect(window.localStorage.getItem(key)).toBe(raw);
  });
  it('accepts complete current growth and treats an absent record as a normal new game', async () => {
    const real=await vi.importActual<typeof import('../../src/game')>('../../src/game');
    ports.createSession.mockImplementation(options=>real.createGameSession(options));
    const key='neko_survivors_react:meta:v2',meta={...real.createEmptyMeta(),wins:7};
    window.localStorage.setItem(key,JSON.stringify(meta));
    const runtime=await createRuntime({clientWidth:800,clientHeight:600} as HTMLElement,{host:hostPort('standalone')});runtimes.push(runtime);
    expect(runtime.getSnapshot().notice).toBeNull();expect(ports.createSession.mock.results.at(-1)!.value.getMeta()).toEqual(meta);
    window.localStorage.removeItem(key);
    const fresh=await createRuntime({clientWidth:800,clientHeight:600} as HTMLElement,{host:hostPort('standalone')});runtimes.push(fresh);
    expect(fresh.getSnapshot().notice).toBeNull();expect(window.localStorage.getItem(key)).toBeNull();
  });
  it.each(['continue', 'legacy'] as const)('retains the detected mobile platform through %s and renderer setup', async branch => {
    vi.stubGlobal('navigator', { userAgent: 'Android Chrome' }); vi.stubGlobal('devicePixelRatio', 3);
    const real = await vi.importActual<typeof import('../../src/game')>('../../src/game');
    ports.createSession.mockImplementation(options => real.createGameSession(options));
    const saved = real.createGameSession(); saved.dispatch(start);
    const currentSave = saved.exportSave();
    window.localStorage.setItem(branch === 'continue' ? 'neko_survivors_react:run:v2' : 'neko_survivors_react:run:v1',
      JSON.stringify(branch === 'continue' ? currentSave : { ...currentSave, version: 1 }));
    const runtime = await createRuntime({ clientWidth: 800, clientHeight: 600 } as HTMLElement, { host: hostPort('standalone') });
    runtimes.push(runtime);
    if (branch === 'continue') await runtime.continueRun(); else await runtime.importLegacyRun();
    expect(runtime.getSnapshot().game.phase).toBe('playing');
    expect(ports.createSession.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [options] of ports.createSession.mock.calls) expect(options.platform).toBe('mobile');
    expect(ports.createRenderer).toHaveBeenCalledWith(expect.objectContaining({ presentation: { resolution: 1, mobile: true, displayFps: 30 } }));
    expect(runtime.diagnostics.environment).toMatchObject({ platform: 'mobile', resolution: 1, displayFps: 30 });
  });
  it('commits retry output before a following return-title without a later session resurrection', async () => {
    const actual = await vi.importActual<typeof import('../../src/game')>('../../src/game');
    ports.createSession.mockImplementation(options => actual.createGameSession(options));
    const host = hostPort(), runtime = await createRuntime({ clientWidth: 800, clientHeight: 600 } as HTMLElement, { host });
    runtimes.push(runtime); await runtime.dispatch(start); await runtime.dispatch({ type: 'retry-wave' });
    expect(host.resetSession).toHaveBeenCalledTimes(2);
    await runtime.dispatch({ type: 'return-title' }); expect(host.closeSession).toHaveBeenCalledTimes(1);
    await frame(); await frame();
    expect(runtime.getSnapshot().game.phase).toBe('title'); expect(host.resetSession).toHaveBeenCalledTimes(2);
  });
  it.each(['new-run', 'return-title', 'dispose'] as const)('routes avatar emotion through the current watcher and retires its session signal on %s', async transition => {
    const { game, host, runtime } = await setup();
    const watcher = { dispose: vi.fn(), setEmotion: vi.fn() };
    ports.watchAvatar.mockReturnValueOnce(watcher);
    const slot = {} as HTMLElement, visible = vi.fn();
    runtime.watchAvatar(slot, visible);
    const lifetime = ports.watchAvatar.mock.calls[0]![3] as AbortSignal;
    expect(ports.watchAvatar).toHaveBeenCalledExactlyOnceWith(host, slot, visible, lifetime, expect.any(Function));
    game.enqueue([{ type: 'avatar-emotion', emotion: 'happy' }]); await frame();
    const sessionSignal = host.resetSession.mock.calls.at(-1)![0]!;
    expect(watcher.setEmotion).toHaveBeenCalledExactlyOnceWith('happy', sessionSignal);
    expect(sessionSignal.aborted).toBe(false);
    if (transition === 'new-run') await runtime.dispatch(start);
    else if (transition === 'return-title') await runtime.dispatch({ type: 'return-title' });
    else runtime.dispose();
    expect(sessionSignal.aborted).toBe(true);
    if (transition === 'dispose') {
      expect(lifetime.aborted).toBe(true);
      expect(watcher.dispose).toHaveBeenCalledTimes(1);
    } else {
      expect(lifetime.aborted).toBe(false);
      game.enqueue([{ type: 'avatar-emotion', emotion: 'surprised' }]); await frame();
      const latest = watcher.setEmotion.mock.calls.at(-1)!;
      expect(latest[0]).toBe('surprised');
      expect(latest[1]).not.toBe(sessionSignal);
      expect((latest[1] as AbortSignal).aborted).toBe(false);
    }
  });

  it('does not let an old avatar cleanup clear or dispose the new owned watcher', async () => {
    const { game, runtime } = await setup();
    const first = { dispose: vi.fn(), setEmotion: vi.fn() };
    const second = { dispose: vi.fn(), setEmotion: vi.fn() };
    ports.watchAvatar.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const cleanupFirst = runtime.watchAvatar({} as HTMLElement, vi.fn());
    const cleanupSecond = runtime.watchAvatar({} as HTMLElement, vi.fn());
    expect(first.dispose).toHaveBeenCalledTimes(1);
    cleanupFirst();
    game.enqueue([{ type: 'avatar-emotion', emotion: 'sad' }]); await frame();
    expect(first.setEmotion).not.toHaveBeenCalled();
    expect(second.setEmotion).toHaveBeenCalledExactlyOnceWith('sad', expect.any(AbortSignal));
    expect(second.dispose).not.toHaveBeenCalled();
    cleanupSecond();
    game.enqueue([{ type: 'avatar-emotion', emotion: 'happy' }]); await frame();
    expect(second.setEmotion).toHaveBeenCalledTimes(1);
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps the initial audio gesture gate silent and reports actual failures once per issue ID', async () => {
    const { runtime } = await setup();
    await setImmediate();
    ports.audio.lastIssue = { id: 1, kind: 'music', reason: 'audio_autoplay_blocked', recoverable: true, waitingForGesture: true, resource: 'assets/bgm/stage.ogg' };
    await frame();
    expect(runtime.getSnapshot().audioIssue).toEqual({ reason: 'audio_autoplay_blocked', recoverable: true, waitingForGesture: true, resource: 'assets/bgm/stage.ogg' });
    const first = runtime.getSnapshot().notice;
    expect(first).toBeNull();
    const changed = vi.fn(); runtime.subscribe(changed);
    await frame(); await frame();
    expect(runtime.getSnapshot().notice).toBe(first);
    expect(changed).not.toHaveBeenCalled();
    ports.audio.lastIssue = { id: 2, kind: 'sound', reason: 'audio_decode_failed', recoverable: false, waitingForGesture: false };
    await frame();
    expect(runtime.getSnapshot().audioIssue).toEqual({ reason: 'audio_decode_failed', recoverable: false, waitingForGesture: false, resource: undefined });
    expect(runtime.getSnapshot().notice).toMatchObject({ tone: 'bad', text: expect.stringContaining('audio_decode_failed') });
    expect(runtime.getSnapshot().notice!.id).toBeGreaterThan(0);
  });

  it.each([true, false])('records false audio initialization with a supplied issue=%s', async supplied => {
    ports.audio.initResult = false;
    if (supplied) ports.audio.lastIssue = { id: 1, kind: 'initialization', reason: 'audio_context_unavailable', recoverable: false, waitingForGesture: false };
    const { runtime } = await setup();
    expect(ports.audio.init).toHaveBeenCalledTimes(1);
    expect(runtime.diagnostics.outputFailures['audio:init']).toBe(supplied ? 'audio_context_unavailable' : 'audio_initialization_failed');
    await frame();
    if (supplied) expect(runtime.getSnapshot().audioIssue).toMatchObject({ reason: 'audio_context_unavailable', recoverable: false, waitingForGesture: false });
    else expect(runtime.getSnapshot().audioIssue).toBeNull();
  });

  it('keeps an interrupted retry distinct from an autoplay gesture requirement', async () => {
    const { runtime } = await setup();
    ports.audio.lastIssue = { id: 1, kind: 'music', reason: 'media request aborted', recoverable: true, waitingForGesture: false };
    await frame();
    expect(runtime.getSnapshot().audioIssue).toMatchObject({ recoverable: true, waitingForGesture: false });
    expect(runtime.getSnapshot().notice?.text).toContain('you can retry');
    expect(runtime.getSnapshot().notice?.text).not.toContain('waiting for a click');
  });

  it('clears a recovered current audio issue and its own notification', async () => {
    const { runtime } = await setup();
    ports.audio.lastIssue = { id: 1, kind: 'music', reason: 'audio_retry', recoverable: true, waitingForGesture: false };
    await frame();
    expect(runtime.getSnapshot().audioIssue).not.toBeNull();
    expect(runtime.getSnapshot().notice).not.toBeNull();
    ports.audio.lastIssue = null; await frame();
    expect(runtime.getSnapshot().audioIssue).toBeNull();
    expect(runtime.getSnapshot().notice).toBeNull();
  });

  it('does not clear a newer game notification when the audio issue recovers', async () => {
    const { game, runtime } = await setup();
    ports.audio.lastIssue = { id: 1, kind: 'music', reason: 'audio_retry', recoverable: true, waitingForGesture: false };
    await frame();
    game.enqueue([{ type: 'notice', text: 'A game reward was earned', tone: 'good' }]); await frame();
    const gameNotice = runtime.getSnapshot().notice;
    expect(gameNotice?.text).toBe('A game reward was earned');
    ports.audio.lastIssue = null; await frame();
    expect(runtime.getSnapshot().audioIssue).toBeNull();
    expect(runtime.getSnapshot().notice).toBe(gameNotice);
  });

  it('keeps an audio failure visible in settings while muted without interrupting with a notice', async () => {
    const { runtime } = await setup();
    runtime.setAudio({ ...runtime.getSnapshot().audio, enabled: false });
    ports.audio.lastIssue = { id: 1, kind: 'music', reason: 'muted_asset_missing', recoverable: false, waitingForGesture: false, resource: 'assets/bgm/missing.ogg' };
    await frame();
    expect(runtime.getSnapshot().audio.enabled).toBe(false);
    expect(runtime.getSnapshot().audioIssue).toEqual({ reason: 'muted_asset_missing', recoverable: false, waitingForGesture: false, resource: 'assets/bgm/missing.ogg' });
    expect(runtime.getSnapshot().notice).toBeNull();
    ports.audio.lastIssue = null; await frame();
    expect(runtime.getSnapshot().audioIssue).toBeNull();
    expect(runtime.getSnapshot().audio.enabled).toBe(false);
    expect(runtime.getSnapshot().notice).toBeNull();
  });

  it('releases GPU, input and subscriptions even when a host disposer fails', async () => {
    const { host, runtime } = await setup();
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      host.dispose.mockImplementation(() => { throw new Error('host cleanup failed'); });
      expect(() => runtime.dispose()).not.toThrow();
      expect(ports.renderer.dispose).toHaveBeenCalledOnce();
      expect(ports.keyboard.dispose).toHaveBeenCalledOnce();
      expect(ports.pointer.dispose).toHaveBeenCalledOnce();
      expect(frames.size).toBe(0);
      expect(runtime.diagnostics.outputFailures.dispose).toContain('host cleanup failed');
      expect(diagnostic).toHaveBeenCalledOnce();
      runtime.dispose();
      expect(ports.renderer.dispose).toHaveBeenCalledOnce();
    } finally { diagnostic.mockRestore(); }
  });
  it.each([
    ['report', 'rejected'], ['report', 'unavailable'], ['report', 'queued'],
    ['speech', 'rejected'], ['speech', 'unavailable'], ['speech', 'queued'],
  ] as const)('publishes %s %s receipts without implying audio playback', async (kind, status) => {
    const { game, host, runtime } = await setup();
    const pending = deferred<HostResult>();
    const operation = kind === 'report' ? host.report : host.speak;
    operation.mockReturnValueOnce(pending.promise);
    game.enqueue([kind === 'report' ? report : speech]);
    await frame();
    expect(operation).toHaveBeenCalledTimes(1);
    const reason = status === 'queued' ? undefined : 'mock_transport_failure';
    pending.resolve({ status, reason });
    await setImmediate();
    expect(runtime.getSnapshot().hostFeedback).toEqual({ status, reason });
    if (status === 'queued') {
      expect(runtime.getSnapshot().notice).toBeNull();
      expect(runtime.getSnapshot().hostFeedback).not.toHaveProperty('played');
    } else {
      expect(runtime.getSnapshot().notice).toMatchObject({ tone: 'bad', text: expect.stringContaining(reason!) });
    }
  });

  it.each(['new-run', 'return-title', 'dispose'] as const)('discards old delayed resolve/reject after %s', async transition => {
    const { game, host, runtime } = await setup();
    const lateReport = deferred<HostResult>();
    const lateSpeech = deferred<HostResult>();
    host.report.mockReturnValueOnce(lateReport.promise);
    host.speak.mockReturnValueOnce(lateSpeech.promise);
    const changed = vi.fn();
    runtime.subscribe(changed);
    game.enqueue([report, speech]); await frame();
    const reportSignal = host.report.mock.calls[0]?.[2];
    const speechSignal = host.speak.mock.calls[0]?.[1];
    expect(reportSignal?.aborted).toBe(false);
    if (transition === 'new-run') await runtime.dispatch(start);
    else if (transition === 'return-title') await runtime.dispatch({ type: 'return-title' });
    else runtime.dispose();
    await setImmediate();
    expect(reportSignal?.aborted).toBe(true);
    expect(speechSignal?.aborted).toBe(true);
    const snapshot = runtime.getSnapshot();
    const publications = changed.mock.calls.length;
    // Both promises settle after a real async boundary, and rejection must be
    // consumed even when disposal has removed all UI subscribers.
    lateReport.resolve({ status: 'rejected', reason: 'OLD_REPORT_MUST_NOT_APPEAR' });
    lateSpeech.reject(new Error('OLD_SPEECH_MUST_NOT_APPEAR'));
    await setImmediate();
    expect(runtime.getSnapshot()).toBe(snapshot);
    expect(changed).toHaveBeenCalledTimes(publications);
    expect(runtime.getSnapshot().hostFeedback?.reason ?? '').not.toContain('OLD_');
  });

  it.each(['return-title', 'dispose'] as const)('keeps the final commentary alive on results until %s', async exit => {
    const { game, host, runtime } = await setup();
    const final = deferred<HostResult>();
    host.report.mockReturnValueOnce(final.promise);
    game.enqueue([report, { type: 'run-ended', won: true, wave: 20 }], 'result');
    await frame();
    expect(runtime.getSnapshot().game.phase).toBe('result');
    const signal = host.report.mock.calls[0]?.[2];
    expect(signal?.aborted).toBe(false);
    expect(host.closeSession).not.toHaveBeenCalled();
    await setImmediate();
    expect(host.closeSession).not.toHaveBeenCalled();
    final.resolve({ status: 'queued' });
    await setImmediate();
    expect(runtime.getSnapshot().hostFeedback).toEqual({ status: 'queued', reason: undefined });
    expect(signal?.aborted).toBe(false);
    if (exit === 'return-title') await runtime.dispatch({ type: 'return-title' });
    else runtime.dispose();
    expect(signal?.aborted).toBe(true);
    expect(host.closeSession).toHaveBeenCalledExactlyOnceWith(exit);
  });

  it('deduplicates equal failure notices while preserving each receipt, and leaves standalone quiet', async () => {
    const { game, host, runtime } = await setup();
    host.report.mockResolvedValue({ status: 'unavailable', reason: 'same_failure' });
    game.enqueue([report]); await frame(); await setImmediate();
    const notice = runtime.getSnapshot().notice;
    expect(notice?.text).toContain('same_failure');
    game.enqueue([report]); await frame(); await setImmediate();
    expect(runtime.getSnapshot().notice).toBe(notice);
    expect(runtime.getSnapshot().hostFeedback).toEqual({ status: 'unavailable', reason: 'same_failure' });

    runtime.dispose();
    const standalone = await setup('standalone');
    standalone.host.report.mockResolvedValue({ status: 'unavailable', reason: 'standalone_output_disabled' });
    standalone.game.enqueue([report]); await frame(); await setImmediate();
    expect(standalone.runtime.getSnapshot().hostFeedback).toEqual({ status: 'unavailable', reason: 'standalone_output_disabled' });
    expect(standalone.runtime.getSnapshot().notice).toBeNull();
  });
});


it('shows actual avatar receipts in diagnostics and reports failed teardown after runtime disposal', async () => {
  const { runtime } = await setup(); runtime.watchAvatar({} as HTMLElement, vi.fn());
  const deliver = ports.watchAvatar.mock.calls[0]![4] as (kind: 'emotion' | 'release', result: HostResult) => void;
  deliver('emotion', { status: 'unavailable', reason: 'expression_unavailable' });
  expect(runtime.diagnostics.avatarFeedback.emotion).toEqual({ status: 'unavailable', reason: 'expression_unavailable' });
  expect(runtime.diagnostics.outputFailures['avatar:emotion']).toBe('expression_unavailable');
  deliver('emotion', { status: 'completed' });
  expect(runtime.diagnostics.outputFailures['avatar:emotion']).toBeUndefined();
  expect(runtime.getSnapshot()).not.toHaveProperty('hostMode');
  expect(runtime.diagnostics.hostMode).toBe('plugin');
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  runtime.dispose(); deliver('release', { status: 'unavailable', reason: 'context_not_released' });
  expect(errors).toHaveBeenCalledWith('Avatar cleanup was not confirmed', 'context_not_released');
  expect(runtime.diagnostics.avatarFeedback.release?.reason).toBe('context_not_released'); errors.mockRestore();
});


it('consumes a bounded host cleanup failure after local lifetime cancellation', async () => {
  const { host, runtime } = await setup(), closing = deferred<HostResult>();
  host.closeSession.mockReturnValueOnce(closing.promise);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  runtime.dispose(); closing.resolve({ status: 'unavailable', reason: 'host_end_timeout' }); await setImmediate();
  expect(runtime.diagnostics.outputFailures['host:dispose']).toBe('host_end_timeout');
  expect(errors).toHaveBeenCalledWith('Host session cleanup was not confirmed', 'host_end_timeout'); errors.mockRestore();
});


it('does not let a retired watcher receipt erase the replacement watcher failure', async () => {
  const { runtime } = await setup(); const slot = {} as HTMLElement;
  runtime.watchAvatar(slot, vi.fn());
  const older = ports.watchAvatar.mock.calls[0]![4] as (kind: 'emotion' | 'release', result: HostResult) => void;
  runtime.watchAvatar(slot, vi.fn());
  const current = ports.watchAvatar.mock.calls[1]![4] as typeof older;
  current('release', { status: 'unavailable', reason: 'NEW release failure' });
  older('release', { status: 'completed' }); older('emotion', { status: 'completed' });
  expect(runtime.diagnostics.avatarFeedback.release?.reason).toBe('NEW release failure');
  expect(runtime.diagnostics.outputFailures['avatar:release']).toBe('NEW release failure');
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  older('release', { status: 'unavailable', reason: 'OLD unconfirmed resources' });
  expect(runtime.diagnostics.outputFailures['avatar:retired-release']).toBe('OLD unconfirmed resources');
  expect(errors).toHaveBeenCalledWith('Retired avatar cleanup was not confirmed', 'OLD unconfirmed resources'); errors.mockRestore();
});


it('consumes a same-watcher retired release failure without replacing the current release status', async () => {
  const { runtime } = await setup(); runtime.watchAvatar({} as HTMLElement, vi.fn());
  const deliver = ports.watchAvatar.mock.calls[0]![4] as (kind: import('../../src/app/avatar-watch').AvatarFeedbackKind, result: HostResult) => void;
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  deliver('release', { status: 'completed' });
  deliver('retired-release', { status: 'unavailable', reason: 'late engine failure' });
  expect(runtime.diagnostics.avatarFeedback.release).toEqual({ status: 'completed' });
  expect(runtime.diagnostics.outputFailures['avatar:retired-release']).toBe('late engine failure');
  expect(errors).toHaveBeenCalledWith('Retired avatar cleanup was not confirmed', 'late engine failure'); errors.mockRestore();
});
