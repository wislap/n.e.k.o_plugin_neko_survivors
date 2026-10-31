import type { GamePhase } from '../game';
import type { SimulationStats } from '../simulation/protocol';

export const CAPTURE_STAGES = ['input', 'simulation', 'output', 'projection', 'renderSubmit', 'hud'] as const;
export type CaptureStage = typeof CAPTURE_STAGES[number];
export const FRAME_COLUMNS = ['rafMs', 'callbackStartMs', 'callbackEndMs', 'intervalMs', 'segment', 'phase', 'wave', 'combat',
  'actors', 'projectiles', 'effects', 'pickups', 'simulationSteps', 'droppedSeconds', ...CAPTURE_STAGES.map(stage => `${stage}Ms`)] as const;
export interface FrameCapture {
  format: 'neko-performance-capture'; version: 1;
  context: Record<string, unknown>;
  startedMs: number; endedMs: number; stopReason: string;
  truncated: boolean; incompleteSpans: number;
  columns: readonly string[]; phases: readonly GamePhase[];
  frames: number[][];
  /** frame index, stage index, start/end in performance.now() milliseconds. */
  spans: number[][];
  discontinuities: { frame: number; reason: string }[];
  gpuTiming: { available: false; reason: string };
  /** Optional independent worker clock window. Never added to main-thread spans. */
  interpolation?:{frames:number;changedFrames:number;maxDelayMs:number;policy:string};
  gpuExecution?: {available:boolean;reason?:string;samplesMs:number[];pending:number;disjoint:number;dropped:number};
  mainThread?: FrameCapture;
  worker?: { start?: SimulationStats; end: SimulationStats;
    samples: { receivedAt: number; frameAgeMs: number; stats: SimulationStats; step?: number; rafMs?: number; packetAgeMs?: number }[]; note: string };
}
interface CaptureFrame {
  phase: GamePhase; wave: number; combat: boolean;
  actors: number; projectiles: number; effects: number; pickups: number;
}
interface Limits { maxFrames?: number; maxSpans?: number; durationMs?: number }

/** Opt-in, fixed-capacity recording. A full buffer stops; it never overwrites early slow frames. */
export function createFrameCapture(now = () => performance.now()) {
  let frames = new Float64Array(0), spans = new Float64Array(0);
  let frameCount = 0, spanCount = 0, maxFrames = 0, maxSpans = 0, duration = 0;
  let started = 0, ended = 0, reason = 'not-started', active = false;
  let callbackStart = -1, raf = 0, previousRaf = -1, segment = 0, steps = 0, dropped = 0;
  let lastPhase: GamePhase | undefined, lastWave = -1;
  let context: Record<string, unknown> = {};
  let phases: GamePhase[] = [], discontinuities: FrameCapture['discontinuities'] = [];
  const totals = new Float64Array(CAPTURE_STAGES.length);
  const clearPending = () => { totals.fill(0); steps = 0; dropped = 0; callbackStart = -1; };
  const finish = (why: string) => { if (active) { active = false; ended = now(); reason = why; performance.mark('neko-capture-end'); } };
  function boundary(why: string) {
    if (!active) return;
    previousRaf = -1; segment++;
    discontinuities.push({ frame: frameCount, reason: why });
  }
  return {
    get running() { return active; },
    start(metadata: Record<string, unknown>, limits: Limits = {}) {
      if (active) throw new Error('A capture is already running');
      const f = limits.maxFrames ?? 120_000, s = limits.maxSpans ?? 600_000, d = limits.durationMs ?? 90_000;
      if (!Number.isSafeInteger(f) || f < 1 || f > 1_000_000 || !Number.isSafeInteger(s) || s < 1 || s > 4_000_000
        || !Number.isFinite(d) || d <= 0 || d > 600_000) throw new RangeError('Invalid capture limits');
      // Allocate before the measurement clock starts. Export/aggregation happens after stopping.
      const metadataCopy = structuredClone(metadata);
      performance.clearMarks('neko-capture-start'); performance.clearMarks('neko-capture-end');
      frames = new Float64Array(f * FRAME_COLUMNS.length); spans = new Float64Array(s * 4);
      maxFrames = f; maxSpans = s; duration = d; context = metadataCopy;
      frameCount = spanCount = 0; phases = []; discontinuities = [];
      segment = 0; previousRaf = -1; lastPhase = undefined; lastWave = -1;
      clearPending(); started = now(); performance.mark('neko-capture-start'); ended = started; reason = 'running'; active = true;
    },
    beginFrame(timestamp: number) {
      if (!active) return;
      raf = timestamp;
      if (callbackStart < 0) callbackStart = now();
    },
    record(stage: CaptureStage, startMs: number, endMs: number) {
      if (!active || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return;
      if (spanCount === maxSpans) { finish('span-limit'); return; }
      const index = CAPTURE_STAGES.indexOf(stage);
      totals[index] += endMs - startMs;
      if (stage === 'simulation') steps++;
      const at = spanCount++ * 4;
      spans[at] = frameCount; spans[at + 1] = index; spans[at + 2] = startMs; spans[at + 3] = endMs;
    },
    dropped(seconds: number) { if (active && Number.isFinite(seconds) && seconds > 0) dropped += seconds; },
    discontinuity: boundary,
    finish,
    frame(value: CaptureFrame) {
      if (!active) return;
      if (lastPhase !== undefined && (lastPhase !== value.phase || lastWave !== value.wave)) boundary('phase-or-wave');
      if (previousRaf >= 0 && raf <= previousRaf) boundary('non-monotonic-raf');
      let phase = phases.indexOf(value.phase);
      if (phase < 0) { phase = phases.length; phases.push(value.phase); }
      const at = frameCount * FRAME_COLUMNS.length, end = now();
      // Interval belongs between rendered RAF starts; these CPU spans belong to the current callback.
      frames.set([raf, callbackStart < 0 ? end : callbackStart, end, previousRaf < 0 ? 0 : raf - previousRaf, segment, phase,
        value.wave, Number(value.combat), value.actors, value.projectiles, value.effects, value.pickups, steps, dropped], at);
      frames.set(totals, at + 14);
      frameCount++; previousRaf = raf; lastPhase = value.phase; lastWave = value.wave; clearPending();
      if (frameCount === maxFrames) finish('frame-limit');
      else if (end - started >= duration) finish('duration');
    },
    stop(why = 'manual'): FrameCapture {
      if (reason === 'not-started') throw new Error('No capture has started');
      finish(why);
      const rows = Array.from({ length: frameCount }, (_, i) => Array.from(frames.subarray(i * FRAME_COLUMNS.length, (i + 1) * FRAME_COLUMNS.length)));
      const completeSpans: number[][] = [];
      let incompleteSpans = 0;
      for (let i = 0; i < spanCount; i++) {
        const row = spans.subarray(i * 4, (i + 1) * 4);
        if (row[0] < frameCount) completeSpans.push(Array.from(row)); else incompleteSpans++;
      }
      return { format: 'neko-performance-capture', version: 1, context: structuredClone(context), startedMs: started, endedMs: ended,
        stopReason: reason, truncated: reason.endsWith('-limit'), incompleteSpans, columns: FRAME_COLUMNS, phases: [...phases],
        frames: rows, spans: completeSpans, discontinuities: [...discontinuities],
        gpuTiming: { available: false, reason: 'CPU stages and RAF intervals only; no GPU execution/presentation timestamps.' } };
    },
  };
}
