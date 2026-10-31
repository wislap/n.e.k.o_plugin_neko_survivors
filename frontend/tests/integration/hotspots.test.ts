import { describe, expect, it } from 'vitest';
import { createFrameCapture, CAPTURE_STAGES } from '../../src/diagnostics/frame-capture';
import { analyzeCapture, analyzeCpuProfile } from '../../scripts/performance/analyze';

const entities = { phase: 'playing' as const, wave: 50, combat: true, actors: 600, projectiles: 4000, effects: 200, pickups: 1000 };
function fixture(intervals: number[]) {
  let now = 0;
  const capture = createFrameCapture(() => now);
  capture.start({ fixture: true }, { maxFrames: intervals.length + 2, maxSpans: 100, durationMs: 600_000 });
  capture.beginFrame(0); capture.frame(entities);
  for (const dt of intervals) { now += dt; capture.beginFrame(now); capture.frame(entities); }
  return capture.stop();
}

describe('complete opt-in frame capture', () => {
  it('retains early slow frames after 4096 samples and computes low FPS from the slowest tail', () => {
    const raw = fixture([100, ...Array(5999).fill(10)]);
    const report = analyzeCapture(raw);
    expect(raw.frames).toHaveLength(6001);
    expect(report.intervalMs.max).toBe(100);
    expect(report.onePercentTailSamples).toBe(60);
    expect(report.onePercentLowRafFps).toBeCloseTo(60_000 / (100 + 590));
    expect(report.worstIntervals[0].frame).toBe(1);
    expect(report.gpuTiming.available).toBe(false);
  });
  it('does not substitute reciprocal p99 for 1% low', () => {
    const report = analyzeCapture(fixture([...Array(98).fill(10), 20, 100]));
    expect(report.intervalMs.p99).toBe(20);
    expect(report.onePercentLowRafFps).toBe(10);
    expect(report.averageRafFps).toBeCloseTo(100_000 / 1100);
  });
  it('accumulates multiple fixed steps and exports measured current-callback spans', () => {
    let now = 0;
    const capture = createFrameCapture(() => now);
    capture.start({}); capture.beginFrame(0);
    capture.record('simulation', 0, 2); capture.record('output', 2, 3); capture.record('simulation', 3, 7);
    capture.dropped(.1); now = 9; capture.frame(entities);
    now = 60; capture.beginFrame(60); capture.frame({ ...entities, projectiles: 10 });
    const raw = capture.stop(), report = analyzeCapture(raw);
    expect(raw.frames[0][12]).toBe(2);
    expect(report.stages.find(s => s.stage === 'simulation')?.max).toBe(6);
    expect(report.traceEvents.map(e => [e.name, e.ts, e.dur])).toEqual([['simulation', 0, 2000], ['output', 2000, 1000], ['simulation', 3000, 4000]]);
    expect(report.worstIntervals[0].previousEntities.projectiles).toBe(4000);
    expect(report.worstIntervals[0].previousCallbackSpanMs).toBe(9);
    expect(report.worstIntervals[0].currentCallbackSpanMs).toBe(0);
    expect(report.droppedSimulationSeconds).toBe(.1);
    expect(CAPTURE_STAGES).not.toContain('gpu');
  });
  it('separates hidden gaps, menus, wave changes and regressing clocks', () => {
    let now = 0;
    const capture = createFrameCapture(() => now); capture.start({}, { durationMs: 600_000 });
    const tick = (t: number, frame = entities) => { now = t; capture.beginFrame(t); capture.frame(frame); };
    tick(0); tick(10); capture.discontinuity('hidden'); tick(100_000); tick(100_010);
    tick(100_020, { ...entities, wave: 51 }); tick(100_030, { ...entities, wave: 51 });
    tick(100_040, { ...entities, combat: false }); tick(100_050); tick(100_045); tick(100_055);
    const raw = capture.stop(), report = analyzeCapture(raw);
    expect(report.intervalMs.max).toBe(10); expect(report.validIntervals).toBe(4);
    expect(raw.discontinuities.some(d => d.reason === 'non-monotonic-raf')).toBe(true);
  });
  it('filters a requested wave without joining intervals across other waves', () => {
    let now = 0;
    const capture = createFrameCapture(() => now); capture.start({});
    for (const [t, wave] of [[0,49],[5,49],[10,50],[30,50],[40,51],[70,51],[80,50],[120,50]]) {
      now=t; capture.beginFrame(t); capture.frame({...entities,wave});
    }
    const raw=capture.stop(), report=analyzeCapture(raw,true,50);
    expect(report.selectedFrames).toBe(4);
    expect(report.validIntervals).toBe(2);
    expect(report.sampledIntervalSeconds).toBe(.06);
    expect(report.intervalMs.max).toBe(40);
    expect(report.traceEvents.every(e=>e.args.wave===50)).toBe(true);
    expect(raw.frames).toHaveLength(8);
  });
  it('stops at limits without overwriting, and reports incomplete tail spans', () => {
    const frames = createFrameCapture(() => 0); frames.start({}, { maxFrames: 1 }); frames.beginFrame(0); frames.frame(entities);
    frames.beginFrame(5); frames.frame(entities);
    expect(frames.stop().stopReason).toBe('frame-limit'); expect(frames.stop().frames).toHaveLength(1);
    const spans = createFrameCapture(() => 0); spans.start({}, { maxSpans: 1 }); spans.beginFrame(0);
    spans.record('simulation', 0, 1); spans.record('simulation', 1, 2); spans.frame(entities);
    expect(spans.stop()).toMatchObject({ stopReason: 'span-limit', truncated: true, incompleteSpans: 1, spans: [], frames: [] });
  });
  it('ends on duration, isolates exports and rejects invalid input without inventing FPS', () => {
    let now = 0; const capture = createFrameCapture(() => now);
    expect(() => capture.stop()).toThrow(); expect(() => capture.start({}, { maxFrames: Infinity })).toThrow();
    const meta = { label: 'original' }; capture.start(meta, { durationMs: 5 }); meta.label = 'changed';
    now = 5; capture.beginFrame(5); capture.frame(entities);
    const first = capture.stop(); expect(first.stopReason).toBe('duration'); first.context.label = 'mutated';
    expect(capture.stop().context.label).toBe('original'); expect(analyzeCapture(first).averageRafFps).toBeNull();
    expect(() => analyzeCapture({ ...first, frames: [[NaN]] })).toThrow();
  });
});

const cf = (functionName: string) => ({ functionName, url: functionName.startsWith('(') ? '' : 'http://localhost/app.js', lineNumber: 0, columnNumber: 0 });
const cpu = { startTime: 0, endTime: 20_000, nodes: [
  { id: 1, callFrame: cf('(root)'), children: [2, 4, 5] },
  { id: 2, callFrame: cf('World.update'), children: [3, 6] },
  { id: 3, callFrame: cf('collisions') }, { id: 4, callFrame: cf('(garbage collector)') },
  { id: 5, callFrame: cf('(idle)') }, { id: 6, callFrame: cf('World.update') },
], samples: [6, 3, 4, 5], timeDeltas: [5000, 8000, 2000, 3000] };
describe('V8 CPU sampling analysis', () => {
  it('weights actual sample deltas, separates self/inclusive, GC and idle, and avoids double recursive attribution', () => {
    const report = analyzeCpuProfile(cpu);
    const world = report.functions.find(f => f.frame.functionName === 'World.update')!;
    expect(world.selfMs).toBe(5); expect(world.inclusiveMs).toBe(13);
    expect(report.functions[0].frame.functionName).toBe('collisions'); expect(report.functions[0].selfMs).toBe(8);
    expect(report.functions.find(f => f.frame.functionName === '(garbage collector)')?.selfMs).toBe(2);
    expect(report.unsampledTailMs).toBe(2);
  });
  it('sorts real V8 timestamp jitter without clamping or silently discarding samples', () => {
    const report = analyzeCpuProfile({ ...cpu, endTime: 200, samples: [2, 3, 4], timeDeltas: [100, -1, 51] });
    expect(report.negativeTimeDeltas).toBe(1); expect(report.reorderedSamples).toBe(2);
    expect(report.sampledMs).toBe(.15); expect(report.unsampledTailMs).toBe(.05);
    expect(report.functions.find(f => f.frame.functionName === 'collisions')?.selfMs).toBe(.099);
    expect(report.functions.find(f => f.frame.functionName === 'World.update')?.selfMs).toBe(.001);
  });
  it('supports source remapping and rejects cyclic, unknown-node and invalid-duration profiles', () => {
    expect(analyzeCpuProfile(cpu, frame => ({ ...frame, url: 'src/world.ts', lineNumber: 41 })).functions[0].frame.lineNumber).toBe(41);
    expect(() => analyzeCpuProfile({ ...cpu, samples: [99], timeDeltas: [1000] })).toThrow();
    expect(() => analyzeCpuProfile({ ...cpu, endTime: 1 })).toThrow();
    expect(() => analyzeCpuProfile({ ...cpu, nodes: cpu.nodes.map(n => n.id === 6 ? { ...n, children: [1] } : n) })).toThrow();
  });
});

describe('independent worker capture windows', () => {
  it('keeps worker costs separate, reports real progress and rejects invalid counter samples', () => {
    const raw = fixture([16, 16]); raw.context.threadModel = 'simulation-worker/main-render';
    const start = { speed: 4, steps: 100, combatSteps: 100, simulationMs: 10, projectionMs: 2, packets: 5, bytes: 100,
      buffersInFlight: 2, inputSequence: 1, elapsedMs: 1000, actualSpeed: 1, backlogSeconds: 0, unservedSeconds: 0,
      updatesInFlight: 0, bufferedEvents: 0, queuedInputEdges: 0, inputLatencyMs: 3 };
    const end = { ...start, steps: 340, combatSteps: 340, simulationMs: 210, projectionMs: 22, packets: 65, bytes: 1100, elapsedMs: 2000 };
    const capture = { ...raw, worker: { start, end, samples: [{ receivedAt: 2000, frameAgeMs: 8, stats: end }], note: 'Separate clock window' } };
    const report = analyzeCapture(capture);
    expect(report.stages.find(s => s.stage === 'simulation')?.mean).toBeNull();
    expect(report.worker).toMatchObject({ targetSpeed: 4, actualSpeed: 4, combatSpeed: 4, simulationMs: 200, projectionMs: 20, packets: 60, bytes: 1000 });
    expect(() => analyzeCapture({ ...capture, worker: { ...capture.worker, end: { ...end, steps: NaN } } })).toThrow('Invalid worker counters');
  });
});
it('marks other threads CPU stages unavailable in a render-worker capture',()=>{
 const raw=fixture([10,10]);raw.context.threadModel='simulation-worker/render-worker';
 const report=analyzeCapture(raw);
 expect(report.stages.find(s=>s.stage==='renderSubmit')?.count).toBe(3);
 for(const stage of['input','simulation','projection','output','hud'])expect(report.stages.find(s=>s.stage===stage)?.mean).toBeNull();
});
