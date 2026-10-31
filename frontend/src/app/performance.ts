import type { GamePhase } from '../game';

export type TimingChannel = 'simulation' | 'projection' | 'renderSubmit' | 'frameInterval';
type EntityCounts = Readonly<{ actors: number; projectiles: number; effects: number; pickups: number }>;
class Samples {
  private values: Float64Array;
  private cursor = 0;
  private size = 0;
  private count = 0;
  constructor(limit: number) { this.values = new Float64Array(limit); }
  record(milliseconds: number) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    this.values[this.cursor] = milliseconds;
    this.cursor = (this.cursor + 1) % this.values.length;
    this.size = Math.min(this.size + 1, this.values.length);
    this.count++;
  }
  snapshot() {
    const values = Array.from(this.values.subarray(0, this.size)).sort((a, b) => a - b);
    const round = (value: number) => Math.round(value * 1000) / 1000;
    const percentile = (fraction: number) => round(values[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0);
    return { totalSamples: this.count, windowSamples: this.size,
      meanMs: round(values.reduce((sum, value) => sum + value, 0) / (values.length || 1)),
      p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: percentile(1) };
  }
}

/** Explicit diagnostics only. Bounded samples describe CPU work, never GPU duration. */
export function createPerformanceProfile(now = () => performance.now(), sampleLimit = 4096) {
  if (!Number.isInteger(sampleLimit) || sampleLimit < 1) throw new RangeError('Invalid performance sample limit');
  const started = now();
  const channels = { simulation: new Samples(sampleLimit), projection: new Samples(sampleLimit),
    renderSubmit: new Samples(sampleLimit), frameInterval: new Samples(sampleLimit) };
  const phases: Partial<Record<GamePhase, number>> = {};
  const peaks = { actors: 0, projectiles: 0, effects: 0, pickups: 0 };
  let lastFrame: number | undefined;
  let droppedSeconds = 0, frames = 0, longFrames = 0;
  let cachedAt = -Infinity;
  function snapshotValue() {
    return { wallSeconds: (now() - started) / 1000, frames, longFramesOver50ms: longFrames, droppedSimulationSeconds: droppedSeconds,
      sampleLimit, phases: { ...phases }, peakEntities: { ...peaks },
      timings: { simulation: channels.simulation.snapshot(), projection: channels.projection.snapshot(),
        renderSubmit: channels.renderSubmit.snapshot(), frameInterval: channels.frameInterval.snapshot() },
      limitation: 'CPU timings and RAF intervals only; renderSubmit is not GPU execution time. Percentiles use the bounded recent window. Diagnostics add measurement overhead.' };
  }
  let cached: ReturnType<typeof snapshotValue> | undefined;
  return {
    record(channel: TimingChannel, milliseconds: number) { channels[channel].record(milliseconds); },
    frame(phase: GamePhase, entities: EntityCounts, current = now()) {
      if (lastFrame !== undefined) {
        const interval = current - lastFrame;
        channels.frameInterval.record(interval);
        if (interval > 50) longFrames++;
      }
      lastFrame = current; frames++; phases[phase] = (phases[phase] ?? 0) + 1;
      for (const key of Object.keys(peaks) as (keyof EntityCounts)[]) peaks[key] = Math.max(peaks[key], entities[key]);
    },
    dropped(seconds: number) { if (Number.isFinite(seconds) && seconds > 0) droppedSeconds += seconds; },
    resetFrameClock() { lastFrame = undefined; },
    snapshot(force = false) {
      if (!cached || force || now() - cachedAt >= 1000) { cached = snapshotValue(); cachedAt = now(); }
      return cached;
    },
  };
}
