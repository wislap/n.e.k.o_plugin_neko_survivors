import type { GameFrame, InputFrame, SessionOptions } from '../game/index.ts';
import type { PreparedTrails } from '../game';
import type { PreparedBodies } from '../render-data/player-bodies';
import { decodeFrame, frameBuffers, transfers } from './frame-packet.ts';
import type { GameOutput, Reply, Request, SimulationStats, WorkerInput, WorkerOutput } from './protocol.ts';

export interface SimulationConnection {
  initial: Reply;
  request(request: Request): Promise<Reply>;
  setInput(input: InputFrame): void;
  requestFrame(): void;
  takeFrame(): { frame: Readonly<GameFrame>; revision: number; bodies?: PreparedBodies; trails?: PreparedTrails; producedAt: number; stateAt: number; step: number; stats: SimulationStats } | undefined;
  subscribe(listener: (message: Extract<WorkerOutput, { kind: 'update' }> | { kind: 'failure'; message: string }) => void): () => void;
  readonly stats: SimulationStats;
  readonly frameAgeMs: number;
  dispose(): void;
}
/** One port owns command receipts, reliable output acknowledgments and three
 * transferred display slots. Neither React nor the renderer sees worker handles. */
export async function createSimulation(options: {
  session: SessionOptions; width: number; height: number; packed: boolean; profile: boolean; signal?: AbortSignal; renderPort?: MessagePort;
}, createWorker: () => Worker = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'neko-simulation' })): Promise<SimulationConnection> {
  const worker = createWorker();
  let disposed = false, fatal: Error | undefined, nextId = 1, inputSequence = 0, epoch = 1, pendingFrame = false, lastUpdate = 0;
  let lastInput: InputFrame | undefined;
  let suspended = false, frameRequestedAt = 0,lastReceived=performance.now();
  let stats!: SimulationStats;
  let displayRevision = 0;
  type DisplayMessage = Extract<WorkerOutput, { kind: 'frame' }>;
  let front: DisplayMessage | undefined, pending: DisplayMessage | undefined, frame: Readonly<GameFrame> | undefined;
  const requests = new Map<number, { resolve(reply: Reply): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; kind: Request['kind'] }>();
  const listeners = new Set<Parameters<SimulationConnection['subscribe']>[0]>();
  function send(message: WorkerInput, transfer?: Transferable[]) { worker.postMessage(message, transfer ?? []); }
  function release(display?: DisplayMessage) {
    if (!display || disposed || fatal) return;
    const buffers = frameBuffers(display.packet);
    send({ kind: 'recycle', slot: display.slot, lease: display.lease, buffers }, transfers(buffers));
  }
  function clearFrames() { release(front); release(pending); front = pending = undefined; frame = undefined; pendingFrame = false; }
  function adoptEpoch(next: number) { if (next > epoch) { clearFrames(); epoch = next; lastInput = undefined; } }
  function outputs(messageEpoch: number, values: GameOutput[]) {
    if (messageEpoch !== epoch || !values.length) return;
    for (const listener of listeners) listener({ kind: 'update', epoch, sequence: 0, outputs: values, stats });
  }
  function fail(error: Error) {
    if (fatal || disposed) return;
    fatal = error; worker.terminate();
    for (const request of requests.values()) { clearTimeout(request.timer); request.reject(error); }
    requests.clear(); front = pending = undefined; frame = undefined;
    for (const listener of listeners) listener({ kind: 'failure', message: error.message });
  }
  function receive(event: MessageEvent<WorkerOutput>) {
    if (disposed || fatal) return;
    const message = event.data;lastReceived=performance.now();
    if (message.kind === 'fatal') { fail(new Error(message.message)); return; }
    if (message.kind === 'reply') {
      const request = requests.get(message.id); if (!request) return;
      stats = message.stats;
      if (message.preceding) outputs(message.preceding.epoch, message.preceding.outputs);
      adoptEpoch(message.epoch);
      clearTimeout(request.timer); requests.delete(message.id);
      if (request.kind === 'suspend') lastInput = undefined;
      request.resolve(message);
    } else if (message.kind === 'update') {
      adoptEpoch(message.epoch); stats = message.stats;
      try { if (message.sequence > lastUpdate && message.epoch === epoch) for (const listener of listeners) listener(message); }
      finally { lastUpdate = Math.max(lastUpdate, message.sequence); send({ kind: 'ack', sequence: message.sequence }); }
    } else {
      adoptEpoch(message.epoch); stats = message.stats; pendingFrame = false;
      if (message.epoch !== epoch) { release(message); return; }
      release(pending); pending = message;
    }
  }
  worker.addEventListener('message', receive);
  worker.addEventListener('error', event => { event.preventDefault(); fail(new Error(event.message || 'Simulation worker failed')); });
  worker.addEventListener('messageerror', () => fail(new Error('Simulation message could not be decoded')));
  function request(request: Request): Promise<Reply> {
    if (disposed || fatal) return Promise.reject(fatal ?? new Error('Simulation is disposed'));
    if (requests.size >= 64) return Promise.reject(new Error('Too many pending simulation operations'));
    if (request.kind === 'suspend') { suspended = request.suspended; frameRequestedAt = performance.now(); }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error(`Simulation request timed out: ${request.kind}`)), 10000);
      requests.set(id, { resolve, reject, timer, kind: request.kind });
      try { send({ ...request, id }, request.kind === 'initialize' && request.renderPort ? [request.renderPort] : undefined); } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  function dispose() {
    if (disposed) return;
    disposed = true; if (!fatal) worker.terminate(); options.signal?.removeEventListener('abort', dispose);
    for (const request of requests.values()) { clearTimeout(request.timer); request.reject(new DOMException('Simulation disposed', 'AbortError')); }
    requests.clear(); listeners.clear(); front = pending = undefined; frame = undefined;
  }
  options.signal?.addEventListener('abort', dispose, { once: true });
  if (options.signal?.aborted) dispose();
  try {
    const initial = await request({ kind: 'initialize', options: options.session, width: options.width, height: options.height, packed: options.packed, profile: options.profile, renderPort: options.renderPort });
    if (!initial.result.ok) throw new Error(initial.result.reason);
    return {
      initial, request,
      setInput(input) {
        if (disposed || fatal) return;
        if (!input.clear && !input.ultimate && !input.p2Clear && lastInput
          && (Object.keys(input) as (keyof InputFrame)[]).every(key => input[key] === lastInput![key])) return;
        lastInput = { ...input }; send({ kind: 'input', sequence: ++inputSequence, input, sentAt: performance.timeOrigin + performance.now() });
      },
      requestFrame() {
        if (disposed||fatal)return;
        if(options.renderPort){if(!suspended&&performance.now()-lastReceived>10000)fail(new Error('Simulation response timed out'));return;}
        if(pending)return;
        if (pendingFrame) {
          if (!suspended && performance.now() - frameRequestedAt > 10000) fail(new Error('Simulation display response timed out'));
          return;
        }
        pendingFrame = true; frameRequestedAt = performance.now(); send({ kind: 'frame', afterStep: front?.step ?? -1, afterStateAt: front?.stateAt ?? 0 });
      },
      takeFrame() {
        if (pending) { release(front); front = pending; pending = undefined; frame = decodeFrame(front.packet); displayRevision++; }
        return front && frame ? { frame, revision: displayRevision, bodies: front.packet.bodies, trails: front.packet.trails, producedAt: front.producedAt, stateAt: front.stateAt, step: front.step, stats: front.stats } : undefined;
      },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      get stats() { return stats; },
      get frameAgeMs() { return front ? Math.max(0, performance.timeOrigin + performance.now() - front.stateAt) : 0; },
      dispose,
    };
  } catch (error) { dispose(); throw error; }
}
