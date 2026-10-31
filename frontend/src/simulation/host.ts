import { createGameSession, EMPTY_INPUT, GameFrameBuffer, GameDisplayBuffer, type GameSession, type InputFrame, type GameUiSnapshot, type GameEvent } from '../game/index.ts';
import type { GameOutput, Progress, Reply, Request, SimulationStats, WorkerInput, WorkerOutput } from './protocol.ts';
import type { FramePacket } from './frame-packet.ts';
import { encodeFrame, frameBuffers, transfers } from './frame-packet.ts';
import { PlayerTrailPreparation } from '../game/index.ts';
import { PlayerBodyPreparation } from '../render-data/player-bodies.ts';
import { SimulationClock } from './clock.ts';

import { createSimulationEnvironment, type SimulationEnvironment } from './scheduler.ts';

/** The browser worker and the Node worker harness use this same implementation. */
export class SimulationHost {
  private game?: GameSession;
  private lastRequest = 0;
  private readonly receipts = new Map<number, Reply>();
  private platform?: Parameters<typeof createGameSession>[0];
  private readonly clock = new SimulationClock();
  private renderPort?: MessagePort;
  private slots: { compact?:boolean; display?: GameDisplayBuffer; buffer: GameFrameBuffer; busy: boolean; lease: number; transferred: boolean; prepared?: boolean; bodies?: PlayerBodyPreparation; trails?: PlayerTrailPreparation }[] = [];
  private epoch = 1;
  private started = false;
  private suspended = false;
  private failed = false;
  private closed = false;
  private timer?: number;
  private pendingFrame = false;
  private frameAfterStep = -1;
  private frameAfterStateAt = 0;
  private input: InputFrame = { ...EMPTY_INPUT };
  private edgeInputs: { sequence: number; input: InputFrame; sentAt: number }[] = [];
  private latestInput = 0;
  private latestInputSentAt = 0;
  private inputLatencyMs = 0;
  private rateStart = 0;
  private rateSteps = 0;
  private appliedInput = 0;
  private displaySeconds?: number;
  private outputs: GameOutput[] = [];
  private updateSequence = 0;
  private awaitingAck = 0;
  private dirtyUi = false;
  private lastUi?: Readonly<GameUiSnapshot>;
  private lastUiPublication = 0;
  private lastUpdate = 0;
  private began = 0;
  private stateAt = 0;
  private steps = 0;
  private combatSteps = 0;
  private simulationMs = 0;
  private projectionMs = 0;
  private packets = 0;
  private bytes = 0;
  private profile = false;
  private width = 1;
  private height = 1;
  private readonly send: (message: WorkerOutput, transfer?: ArrayBuffer[]) => void;
  private readonly env: SimulationEnvironment;
  constructor(send: (message: WorkerOutput, transfer?: ArrayBuffer[]) => void, env?: SimulationEnvironment) {
    this.send = send; this.env = env ?? createSimulationEnvironment();
  }
  get stats(): SimulationStats {
    const elapsedMs = Math.max(0, this.env.now() - this.began);
    return { speed: this.clock.speed, steps: this.steps, combatSteps: this.combatSteps,
      simulationMs: this.simulationMs, projectionMs: this.projectionMs, packets: this.packets, bytes: this.bytes,
      buffersInFlight: this.slots.filter(s => s.busy).length, inputSequence: this.appliedInput,
      elapsedMs, actualSpeed: this.env.now() > this.rateStart ? (this.steps - this.rateSteps) / 60 / ((this.env.now() - this.rateStart) / 1000) : 0,
      backlogSeconds: this.clock.backlog, unservedSeconds: this.clock.unserved, resetDebtSeconds: this.clock.resetDebt,
      updatesInFlight: Number(!!this.awaitingAck), bufferedEvents: this.outputs.length, queuedInputEdges: this.edgeInputs.length, inputLatencyMs: this.inputLatencyMs };
  }
  receive(message: WorkerInput): void {
    if (this.failed || this.closed) return;
    try {
      if ('id' in message) {
        if (!Number.isSafeInteger(message.id) || message.id < 1) throw new Error('Invalid request sequence');
        const receipt = this.receipts.get(message.id);
        if (receipt) { this.send({ ...receipt, preceding: undefined, stats: this.stats }); return; }
        if (message.id <= this.lastRequest) throw new Error('Expired simulation request');
        this.lastRequest = message.id; this.request(message); this.publishFrame();
      }
      else if (message.kind === 'ack') {
        if (message.sequence === this.awaitingAck) this.awaitingAck = 0;
      } else if (message.kind === 'input') this.acceptInput(message.sequence, message.input, message.sentAt);
      else if (message.kind === 'frame') { this.pendingFrame = true; this.frameAfterStep = message.afterStep ?? -1; this.frameAfterStateAt = message.afterStateAt ?? 0; this.publishFrame(); }
      else if (message.kind === 'recycle') {
        const slot = this.slots[message.slot];
        if (!slot?.busy || slot.lease !== message.lease) throw new Error('Invalid display buffer lease');
        if (slot.transferred && (slot.buffer.packed || slot.display)) {
          if (!message.buffers) throw new Error('Missing returned display buffers');
          const { bodies, trails, groups, ids, ...values } = message.buffers;
          if (slot.compact&&slot.display) {
            if (!groups || groups.length !== 4 || !ids) throw new Error('Missing compact display buffers');
            Object.assign(slot.display.stream.raw, values); if(slot.prepared&&!trails)throw new Error('Missing returned compact trail buffer');slot.display.restore(groups, ids,trails);
          } else Object.assign(slot.buffer.packed!, values);
          if (slot.prepared && slot.bodies) { if (!bodies) throw new Error('Missing returned body buffer'); slot.bodies.data = bodies; }
          if (slot.prepared && slot.trails) { if (!trails) throw new Error('Missing returned trail buffer'); slot.trails.data = trails; }
        }
        slot.busy = false; this.publishFrame();
      }
      this.schedule();
    } catch (error) { this.fail(error); }
  }
  private requireGame(): GameSession { if (!this.game) throw new Error('Simulation is not initialized'); return this.game; }
  private progress(): Progress { const game = this.requireGame(); return { run: game.exportSave(), meta: game.getMeta() }; }
  private request(message: Request & { id: number }): void {
    let result: { ok: true } | { ok: false; reason: string } = { ok: true }, progress: Progress | undefined;
    const preceding = this.outputs.length ? { epoch: this.epoch, outputs: this.outputs } : undefined;
    this.outputs = [];
    try {
      switch (message.kind) {
        case 'initialize': {
          if (this.game) throw new Error('Simulation already initialized');
          this.platform = { platform: message.options.platform };
          this.game = createGameSession(message.options); this.width = message.width; this.height = message.height;
          this.game.setViewport(this.width, this.height); this.profile = message.profile;
          this.renderPort = message.renderPort;
          if (this.renderPort) { this.renderPort.onmessage = event => this.receive(event.data); this.renderPort.start(); }
          this.slots = Array.from({ length: 3 }, () => ({ display: message.renderPort ? new GameDisplayBuffer() : undefined, buffer: new GameFrameBuffer({ packed: message.packed,stableActorIds:!!message.renderPort }), busy: false, lease: 0, transferred: false, bodies: message.packed&&!message.renderPort ? new PlayerBodyPreparation() : undefined, trails: message.packed&&!message.renderPort ? new PlayerTrailPreparation() : undefined }));
          this.began = this.rateStart = this.env.now(); this.stateAt = performance.timeOrigin + this.env.now(); break;
        }
        case 'command': {
          const game = this.requireGame(), phase = game.readUi().phase; result = game.dispatch(message.command);
          if (result.ok && ['start-run', 'start-challenge', 'retry-wave', 'return-title', 'abandon-run'].includes(message.command.type)) this.newEpoch();
          if (result.ok) this.stateAt = performance.timeOrigin + this.env.now();
          if (phase !== game.readUi().phase) this.clock.reset(this.env.now()); break;
        }
        case 'shortcut': {
          const game = this.requireGame(), ui = game.readUi();
          if (message.action === 'pause' && !['title', 'result', 'endless-prompt'].includes(ui.phase))
            result = game.dispatch({ type: ui.phase === 'paused' ? 'resume' : 'pause' });
          else if (message.action === 'auto-upgrade' && ui.phase === 'upgrade') result = game.dispatch({ type: 'auto-upgrade' });
          else if (message.action === 'toggle-auto-upgrade' && ['playing', 'upgrade'].includes(ui.phase))
            result = game.dispatch({ type: 'set-auto-upgrade', enabled: !ui.autoUpgrade });
          if (result.ok) this.stateAt = performance.timeOrigin + this.env.now();
          if (ui.phase !== game.readUi().phase) this.clock.reset(this.env.now()); break;
        }
        case 'replace': {
          // Construct first: invalid saves do not retire the running session.
          const next = createGameSession({ ...this.platform, ...message.options, meta: message.options.meta ?? this.requireGame().getMeta() });
          next.setViewport(this.width, this.height); this.game = next; this.stateAt = performance.timeOrigin + this.env.now(); this.newEpoch(); break;
        }
        case 'save': progress = this.progress(); break;
        case 'speed': this.clock.setSpeed(message.speed); this.clock.reset(this.env.now()); this.rateStart = this.env.now(); this.rateSteps = this.steps; break;
        case 'suspend': this.suspended = message.suspended; this.clock.reset(this.env.now()); this.clearInput(); break;
        case 'viewport': this.width = message.width; this.height = message.height; this.requireGame().setViewport(this.width, this.height); this.stateAt = performance.timeOrigin + this.env.now(); break;
        case 'start': this.started = true; this.rateStart = this.env.now(); this.rateSteps = this.steps; this.clock.reset(this.env.now()); break;
        case 'advance': {
          if (this.started) throw new Error('Cannot manually step a real-time simulation');
          if (!Number.isInteger(message.steps) || message.steps < 0 || message.steps > 64) throw new RangeError('Invalid manual step count');
          for (let i = 0; i < message.steps; i++) this.advance(message.input);
          progress = this.progress(); break;
        }
        case 'inspect': progress = this.progress(); break;
      }
    } catch (error) {
      if (!this.game) throw error;
      result = { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    const game = this.requireGame();
    const ui = game.readUi();
    const outputs = ['initialize', 'command', 'shortcut', 'replace'].includes(message.kind) ? this.captureOutputs(game.drainEvents(), message.id) : undefined;
    if (['initialize', 'command', 'shortcut', 'replace', 'save', 'speed'].includes(message.kind)) { this.lastUi = ui; this.lastUiPublication = this.env.now(); this.dirtyUi = false; }
    const reply: Reply = { kind: 'reply', id: message.id, epoch: this.epoch, result, ui, stats: this.stats, progress, preceding, outputs };
    this.receipts.set(message.id, structuredClone({ ...reply, preceding: undefined, outputs: undefined }));
    if (this.receipts.size > 64) this.receipts.delete(this.receipts.keys().next().value!);
    this.send(reply);
  }
  private newEpoch(): void {
    // Save/checkpoint messages already posted remain ordered before this command's reply.
    this.epoch++;this.renderPort?.postMessage({kind:'epoch',epoch:this.epoch}); this.rateStart = this.env.now(); this.rateSteps = this.steps; this.clearInput(); this.clock.reset(this.env.now()); this.pendingFrame = false;
  }
  private clearInput(): void { this.input = { ...EMPTY_INPUT }; this.edgeInputs.length = 0; this.displaySeconds = undefined; }
  private acceptInput(sequence: number, input: InputFrame, sentAt = performance.timeOrigin + this.env.now()): void {
    if (sequence <= this.latestInput) return;
    this.latestInput = sequence; this.latestInputSentAt = sentAt;
    this.input = { ...input, clear: false, ultimate: false, p2Clear: false, displaySeconds: undefined };
    if (input.displaySeconds !== undefined) this.displaySeconds = input.displaySeconds;
    if (input.clear || input.ultimate || input.p2Clear) {
      if (this.edgeInputs.length >= 64) throw new Error('Input edge queue overflow');
      this.edgeInputs.push({ sequence, input: { ...input }, sentAt });
    }
  }
  private advance(input: InputFrame): void {
    const game = this.requireGame(), start = this.profile ? this.env.now() : 0;
    const combat = game.readUi().combat;
    const result = game.advance(input); this.stateAt = performance.timeOrigin + this.env.now(); this.steps++; if (combat) this.combatSteps++;
    if (this.profile) this.simulationMs += this.env.now() - start;
    this.dirtyUi ||= result.uiChanged;
    if (result.events.some(event => event.type === 'attempt-restarted')) this.newEpoch();
    this.outputs.push(...this.captureOutputs(result.events));
  }
  private captureOutputs(events: readonly GameEvent[], commandId?: number): GameOutput[] {
    let progress: Progress | undefined;
    return events.map(event => {
      if (event.type === 'checkpoint' || event.type === 'run-ended') progress ??= structuredClone(this.progress());
      return { event, step: this.steps, ...(commandId === undefined ? {} : { commandId }),
        ...(event.type === 'checkpoint' || event.type === 'run-ended' ? { progress } : {}) };
    });
  }
  private flush(): void {
    if (!this.game || this.awaitingAck) return;
    const now = this.env.now(), latestUi = this.dirtyUi ? this.game.readUi() : undefined;
    const phaseChanged = latestUi !== undefined && latestUi.phase !== this.lastUi?.phase;
    // Combat summaries have a wall-clock budget. HUD live scalars travel with
    // display packets; phase changes and command receipts remain immediate.
    const uiDue = latestUi !== undefined && (phaseChanged || now - this.lastUiPublication >= 100);
    if (!phaseChanged && now - this.lastUpdate < 1000 / 60 && this.outputs.length < 128) return;
    if (!this.outputs.length && !uiDue && now - this.lastUpdate < 250) return;
    const ui = uiDue ? latestUi : undefined;
    if (ui) { this.lastUi = ui; this.lastUiPublication = now; this.dirtyUi = false; }
    const sequence = ++this.updateSequence, outputs = this.outputs;
    this.outputs = []; this.awaitingAck = sequence; this.lastUpdate = now;
    this.send({ kind: 'update', epoch: this.epoch, sequence, ui, outputs, stats: this.stats });
  }
  private publishFrame(): void {
    if (!this.pendingFrame || !this.game || this.steps <= this.frameAfterStep && this.stateAt <= this.frameAfterStateAt) return;
    const index = this.slots.findIndex(slot => !slot.busy); if (index < 0) return;
    const slot = this.slots[index], start = this.profile ? this.env.now() : 0;
    if(slot.display)slot.display.stream.prepareTrails=this.clock.speed===1;
    const compact = slot.display&&this.clock.speed===1 ? this.game.readDisplay(slot.display) : undefined;
    const frame = compact ? undefined : this.game.readFrame(slot.buffer);
    const packet: FramePacket = compact ? {kind:'compact',compact} : encodeFrame(frame!);
    // Accelerated simulation reserves this worker for rules. Main uses the same
    // pure preparation on new packets; the GPU geometry and visual count stay fixed.
    if (this.clock.speed === 1 && slot.bodies && slot.trails && frame?.transients) { packet.bodies = slot.bodies.prepare(frame.transients); packet.trails = slot.trails.prepare(frame.transients); }
    if (this.profile) this.projectionMs += this.env.now() - start;
    slot.compact=!!compact;
    slot.prepared = !!(packet.bodies||compact?.trails);
    slot.busy = true; slot.lease++; this.pendingFrame = false; this.packets++;
    const transfer = transfers(frameBuffers(packet)); slot.transferred = transfer.length > 0; this.bytes += transfer.reduce((n, b) => n + b.byteLength, 0);
    (this.renderPort ? (message: WorkerOutput, values: ArrayBuffer[]) => this.renderPort!.postMessage(message, values) : this.send)({ kind: 'frame', epoch: this.epoch, slot: index, lease: slot.lease, packet,
      producedAt: performance.timeOrigin + this.env.now(), stateAt: this.stateAt, step: this.steps, stats: this.stats }, transfer);
  }
  private schedule(): void {
    if (this.timer !== undefined || !this.started || this.suspended || this.failed || this.awaitingAck && this.outputs.length >= 128) return;
    this.timer = this.env.schedule(() => { this.timer = undefined; this.pump(); }, Math.max(0, Math.min(8, this.clock.delayMs)));
  }
  private pump(): void {
    if (this.suspended || this.failed) return;
    try {
      const start = this.env.now(); this.clock.update(start);
      let count = 0;
      // Reliable output backpressure bounds event memory even when the UI stalls.
      while (this.clock.due && count < 64 && this.outputs.length < 512 && this.env.now() - start < 4) {
        if (this.awaitingAck && this.outputs.length >= 128) break;
        const edge = this.edgeInputs.shift();
        const input = { ...this.input, clear: edge?.input.clear ?? false, ultimate: edge?.input.ultimate ?? false,
          p2Clear: edge?.input.p2Clear ?? false, displaySeconds: this.displaySeconds };
        const sequence = this.edgeInputs.length ? Math.min(this.latestInput, this.edgeInputs[0].sequence - 1) : this.latestInput;
        if (sequence !== this.appliedInput) this.inputLatencyMs = Math.max(0, performance.timeOrigin + this.env.now() - (edge?.sentAt ?? this.latestInputSentAt));
        this.appliedInput = sequence; this.displaySeconds = undefined;
        this.clock.consume(); this.advance(input); count++;
      }
      this.flush(); this.publishFrame(); this.schedule();
    } catch (error) { this.fail(error); }
  }
  dispose(): void { this.renderPort?.close(); this.closed = true; this.started = false; if (this.timer !== undefined) this.env.cancel(this.timer); this.timer = undefined; this.env.close?.(); }
  private fail(error: unknown): void { this.failed = true; this.dispose(); this.send({ kind: 'fatal', message: error instanceof Error ? error.message : String(error) }); }
}
