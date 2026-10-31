import type { GameRenderer, GameRendererOptions } from '../rendering';
import { screenToWorld } from '../rendering/camera';
import type { SimulationStats } from '../simulation/protocol';
import type { FrameCapture } from '../diagnostics/frame-capture';
import type { RenderInput, RenderOutput, RenderStatus } from './protocol';

interface ThreadControl {
  readonly renderPort: MessagePort;
  readonly status: RenderStatus | undefined;
  readonly failure: string | undefined;
  startCapture(context: Record<string, unknown>, stats: SimulationStats): Promise<void>;
  stopCapture(): Promise<FrameCapture>;
  visible(value: boolean): void;
  gpuTiming(enabled: boolean): void;
  probeContext(lost: boolean): void;
}
interface WorkerDisplay extends Pick<GameRenderer, 'setPlayerEffectOpacity' | 'setPlayerSoftQuality' | 'playerEffectOpacity'
  | 'contextLost' | 'backend' | 'canvas' | 'diagnostics' | 'resize' | 'screenToWorld' | 'dispose'> {
  thread: ThreadControl;
}
type MainDisplay = GameRenderer & { thread: undefined };
export type GameDisplay = MainDisplay | WorkerDisplay;

/** Main owns the element and commands; the worker owns every GPU resource. A
 * failed initialization retires the transferred canvas before a fresh fallback. */
export async function createGameDisplay(options: GameRendererOptions,
  factory: (options: GameRendererOptions) => Promise<GameRenderer>): Promise<GameDisplay> {
  if (options.presentation.mobile || typeof OffscreenCanvas === 'undefined'
    || typeof HTMLCanvasElement.prototype.transferControlToOffscreen !== 'function'
    || typeof Worker === 'undefined') {
    return Object.assign(await factory(options), { thread: undefined });
  }
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', '猫娘幸存者游戏画面');
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none' });
  options.container.appendChild(canvas);
  let worker: Worker;
  let channel: MessageChannel;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'neko-render' });
    try { channel = new MessageChannel(); }
    catch(error) { worker.terminate(); throw error; }
  } catch(error) {
    canvas.remove();
    console.warn('Render worker unavailable; using main renderer',error);
    return Object.assign(await factory(options),{thread:undefined});
  }
  let disposed = false, failure: string | undefined, opacity = 1, visible = true;
  let lastMessage = performance.now(), status: RenderStatus | undefined;
  let diagnostics: GameRenderer['diagnostics'], nextId = 0;
  const requests = new Map<number, { resolve(value?: FrameCapture): void; reject(error: Error): void;
    timer: ReturnType<typeof setTimeout> }>();
  function send(message: RenderInput, transfer: Transferable[] = []) {
    if (!disposed && !failure) worker.postMessage(message, transfer);
  }
  let readyResolve: () => void, readyReject: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const readyTimer = setTimeout(() => fail('Render worker initialization timed out'), 10000);
  function fail(message: string) {
    if (failure || disposed) return;
    failure = message;
    clearTimeout(readyTimer);
    readyReject(new Error(message));
    worker.terminate();
    channel.port1.close(); channel.port2.close();
    for (const request of requests.values()) { clearTimeout(request.timer); request.reject(new Error(message)); }
    requests.clear();
  }
  worker.onmessage = (event: MessageEvent<RenderOutput>) => {
    const message = event.data; lastMessage = performance.now();
    if (message.kind === 'ready') {
      diagnostics = message.diagnostics; clearTimeout(readyTimer); readyResolve();
    } else if (message.kind === 'status') {
      status = message.status; diagnostics = status.diagnostics;
    } else if (message.kind === 'failure') fail(message.message);
    else {
      const request = requests.get(message.id);
      if (request) {
        requests.delete(message.id); clearTimeout(request.timer);
        if (message.error) request.reject(new Error(message.error)); else request.resolve(message.capture);
      }
    }
  };
  worker.onerror = event => { event.preventDefault(); fail(event.message || 'Render worker failed'); };
  worker.onmessageerror = () => fail('Render worker message could not be decoded');
  function request(message: { kind: 'capture-start'; context: Record<string, unknown>; stats: SimulationStats }
    | { kind: 'capture-stop' }): Promise<FrameCapture | undefined> {
    if (disposed || failure) return Promise.reject(new Error(failure ?? 'Display disposed'));
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { requests.delete(id); reject(new Error('Display capture request timed out')); }, 10000);
      requests.set(id, { resolve, reject, timer }); send({ ...message, id });
    });
  }
  try {
    const offscreen = canvas.transferControlToOffscreen();
    send({ kind: 'initialize', canvas: offscreen, port: channel.port1,
      width: options.width ?? options.container.clientWidth, height: options.height ?? options.container.clientHeight,
      presentation: options.presentation, assetBaseUrl: new URL(options.assetBaseUrl ?? './assets', document.baseURI).href },
    [offscreen, channel.port1]);
    await ready;
  } catch (error) {
    clearTimeout(readyTimer); worker.terminate(); channel.port1.close(); channel.port2.close(); canvas.remove();
    console.warn('Render worker unavailable; using main renderer', error);
    return Object.assign(await factory(options), { thread: undefined });
  }
  return {
    thread: {
      renderPort: channel.port2,
      get status() { return status; },
      get failure() {
        if (!disposed && !failure && visible && performance.now() - lastMessage > 10000) fail('Render worker response timed out');
        return failure;
      },
      async startCapture(context, stats) { await request({ kind: 'capture-start', context, stats }); },
      async stopCapture() {
        const value = await request({ kind: 'capture-stop' });
        if (!value) throw new Error('Missing render capture');
        return value;
      },
      visible(value) { visible = value; lastMessage = performance.now(); send({ kind: 'visible', visible: value }); },
      gpuTiming: enabled => send({ kind: 'gpu-timing', enabled }),
      probeContext: lost => send({ kind: 'probe-context', lost }),
    },
    canvas, backend: 'webgl2',
    get contextLost() { return diagnostics.contextLost; },
    get diagnostics() { return diagnostics; },
    get playerEffectOpacity() { return opacity; },
    setPlayerSoftQuality(value){if(value!=='native'&&value!=='balanced')throw new RangeError('Unknown player soft quality');send({kind:'soft-quality',value});},
    setPlayerEffectOpacity(value) {
      if (!Number.isFinite(value)) throw new RangeError('Player effect opacity must be finite');
      opacity = Math.max(0, Math.min(1, value)); send({ kind: 'opacity', value: opacity });
    },
    resize(width, height) { send({ kind: 'resize', width, height }); },
    screenToWorld(x, y) {
      return screenToWorld(status?.viewCamera ?? { x: 0, y: 0, zoom: 1,
        width: options.container.clientWidth, height: options.container.clientHeight }, x, y);
    },
    dispose() {
      if (disposed) return;
      send({ kind: 'dispose' }); disposed = true; clearTimeout(readyTimer);
      for (const request of requests.values()) { clearTimeout(request.timer); request.reject(new Error('Display disposed')); }
      requests.clear(); channel.port2.close(); canvas.remove(); setTimeout(() => worker.terminate(), 250);
    },
  };
}
