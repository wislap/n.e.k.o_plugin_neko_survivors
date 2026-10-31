import { CAPTURE_STAGES, FRAME_COLUMNS, type FrameCapture } from '../../src/diagnostics/frame-capture.ts';

const quantile = (sorted: number[], q: number) => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? null;
function distribution(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mean = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null;
  return { count: sorted.length, mean, p50: quantile(sorted, .5), p95: quantile(sorted, .95), p99: quantile(sorted, .99), max: sorted.at(-1) ?? null };
}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new TypeError(message); }

/** Complete-window statistics; filters never bridge pauses, waves, hidden gaps or discarded frames. */
export function analyzeCapture(source: unknown, combatOnly = true, wave?: number) {
  check(source && typeof source === 'object', 'Expected a capture object');
  const c = source as FrameCapture;
  check(c.format === 'neko-performance-capture' && c.version === 1, 'Unsupported capture format');
  check(JSON.stringify(c.columns) === JSON.stringify(FRAME_COLUMNS), 'Unexpected capture columns');
  check(Array.isArray(c.frames) && Array.isArray(c.phases) && Array.isArray(c.spans), 'Missing capture arrays');
  for (const r of c.frames) check(Array.isArray(r) && r.length === FRAME_COLUMNS.length && r.every(Number.isFinite)
    && r[3] >= 0 && Number.isInteger(r[5]) && r[5] >= 0 && r[5] < c.phases.length, 'Invalid frame row');
  if(c.gpuExecution)check(Array.isArray(c.gpuExecution.samplesMs)&&c.gpuExecution.samplesMs.length<=4096&&c.gpuExecution.samplesMs.every(n=>Number.isFinite(n)&&n>=0),'Invalid GPU elapsed samples');
  const selected = c.frames.map((r, index) => ({ r, index })).filter(({ r }) => (!combatOnly || r[7] === 1) && (wave === undefined || r[6] === wave));
  const intervals = selected.filter(({ r, index }) => index > 0 && r[3] > 0
    && (!combatOnly || c.frames[index - 1][7] === 1) && (wave === undefined || c.frames[index - 1][6] === wave) && c.frames[index - 1][4] === r[4]);
  const times = intervals.map(({ r }) => r[3]), sum = times.reduce((a, b) => a + b, 0);
  const tail = times.slice().sort((a, b) => b - a).slice(0, Math.ceil(times.length * .01));
  const columns = Object.fromEntries(FRAME_COLUMNS.map((name, i) => [name, i]));
  const threaded = ['simulation-worker/main-render','simulation-worker/render-worker','main-ui/simulation-worker/render-worker'].includes(String(c.context.threadModel));
  const stages = CAPTURE_STAGES.map(stage => ({ stage, ...distribution((threaded && (stage === 'simulation' || stage === 'projection') || c.context.threadModel==='simulation-worker/render-worker'&&stage!=='renderSubmit') ? [] : selected.map(({ r }) => r[columns[`${stage}Ms`]])) }));
  const worst = intervals.slice().sort((a, b) => b.r[3] - a.r[3]).slice(0, 30).map(({ r, index }) => {
    const previous = c.frames[index - 1];
    return { frame: index, intervalMs: r[3], phase: c.phases[r[5]], wave: r[6], rafMs: r[0],
      previousCallbackSpanMs: previous[2] - previous[1], currentCallbackSpanMs: r[2] - r[1],
      previousStagesMs: Object.fromEntries(CAPTURE_STAGES.map(stage => [stage, previous[columns[`${stage}Ms`]]])),
      previousEntities: { actors: previous[8], projectiles: previous[9], effects: previous[10], pickups: previous[11] } };
  });
  const bins = new Map<number, number[]>();
  for (const { r } of intervals) { const bucket = Math.floor((r[0] - c.startedMs) / 1000); const values = bins.get(bucket) ?? []; values.push(r[3]); bins.set(bucket, values); }
  const selectedIndices = new Set(selected.map(({ index }) => index));
  const traceEvents = c.spans.map(r => {
    check(Array.isArray(r) && r.length === 4 && r.every(Number.isFinite) && Number.isInteger(r[0]) && r[0] >= 0 && r[0] < c.frames.length
      && Number.isInteger(r[1]) && r[1] >= 0 && r[1] < CAPTURE_STAGES.length && r[3] >= r[2], 'Invalid CPU span');
    return { name: CAPTURE_STAGES[r[1]], cat: 'neko.cpu', ph: 'X', pid: 1, tid: 1, ts: r[2] * 1000, dur: (r[3] - r[2]) * 1000,
      args: { frame: r[0], phase: c.phases[c.frames[r[0]][5]], wave: c.frames[r[0]][6] } };
  }).filter(e => selectedIndices.has(e.args.frame));
  return { format: 'neko-hotspot-report', version: 1, context: c.context, stopReason: c.stopReason, truncated: c.truncated,
    filter: `${combatOnly ? 'combat frames only' : 'all phases'}${wave === undefined ? '' : `, wave ${wave}`}`, recordedFrames: c.frames.length, selectedFrames: selected.length,
    validIntervals: times.length, sampledIntervalSeconds: sum / 1000,
    averageRafFps: sum > 0 ? times.length * 1000 / sum : null,
    onePercentLowRafFps: tail.length && tail.some(t => t > 0) ? tail.length * 1000 / tail.reduce((a, b) => a + b, 0) : null,
    onePercentTailSamples: tail.length, intervalMs: distribution(times),
    overBudget: [6.25, 8.333333, 16.666667, 33.333333, 50].map(budgetMs => ({ budgetMs, frames: times.filter(t => t > budgetMs).length,
      fraction: times.length ? times.filter(t => t > budgetMs).length / times.length : null })),
    droppedSimulationSeconds: selected.reduce((sum, { r }) => sum + r[13], 0),
    worker: c.worker ? (() => {
      const { start, end, samples, note } = c.worker;
      check(start && end && Array.isArray(samples) && samples.length <= 60000, 'Incomplete worker measurement window');
      const validStats = (value: typeof end) => value && Object.values(value).every(n => Number.isFinite(n) && n >= 0)
        && Number.isSafeInteger(value.steps) && value.steps >= 0 && value.elapsedMs >= 0
        && [1, 2, 4, 8].includes(value.speed) && value.buffersInFlight >= 0 && value.buffersInFlight <= 3;
      check(validStats(start) && validStats(end) && (['steps','combatSteps','simulationMs','projectionMs','packets','bytes','unservedSeconds','elapsedMs'] as const).every(key => end[key] >= start[key]), 'Invalid worker counters');
      for (const sample of samples) check(sample && Number.isFinite(sample.receivedAt) && Number.isFinite(sample.frameAgeMs)
        && sample.frameAgeMs >= 0 && validStats(sample.stats), 'Invalid worker sample');
      const speeds = [...new Set([start.speed, end.speed, ...samples.map(s => s.stats.speed)])];
      const elapsed = (end.elapsedMs - start.elapsedMs) / 1000;
      const selectedRafs = new Set(selected.map(({r}) => r[0]));
      const displayed = samples.filter(s => s.rafMs === undefined || selectedRafs.has(s.rafMs));
      const distinctSteps = new Set(displayed.flatMap(s => s.step === undefined ? [] : [s.step]));
      return { note, elapsedSeconds: elapsed, targetSpeed: speeds.length === 1 ? end.speed : null, speeds,
        actualSpeed: elapsed > 0 ? (end.steps - start.steps) / 60 / elapsed : null,
        combatSpeed: elapsed > 0 ? (end.combatSteps - start.combatSteps) / 60 / elapsed : null,
        simulationMs: end.simulationMs - start.simulationMs, projectionMs: end.projectionMs - start.projectionMs,
        steps: end.steps - start.steps, packets: end.packets - start.packets, bytes: end.bytes - start.bytes,
        unservedSeconds: end.unservedSeconds - start.unservedSeconds,
        resetDebtSeconds: end.resetDebtSeconds !== undefined && start.resetDebtSeconds !== undefined ? end.resetDebtSeconds - start.resetDebtSeconds : null,
        frameAgeMs: distribution(displayed.map(s => s.frameAgeMs)), inputLatencyMs: distribution(displayed.map(s => s.stats.inputLatencyMs)),
        uniqueDisplayedStates: distinctSteps.size || null,
        uniqueDisplayedStatesPerSecond: distinctSteps.size && sum > 0 ? Math.max(0, distinctSteps.size - 1) / (sum / 1000) : null,
        repeatedStateFrames: distinctSteps.size ? displayed.length - distinctSteps.size : null,
        packetAgeMs: distribution(displayed.flatMap(s => s.packetAgeMs === undefined ? [] : [s.packetAgeMs])),
        buffersInFlight: distribution(samples.map(s => s.stats.buffersInFlight)),
      };
    })() : null,
    uiThread:c.mainThread?(()=>{const values=c.mainThread!.frames.filter(r=>r[3]>0).map(r=>r[3]),total=values.reduce((a,b)=>a+b,0);return{recordedFrames:c.mainThread!.frames.length,averageRafFps:total?values.length*1000/total:null,note:'Main UI callbacks only; this cadence is not game rendering FPS.'};})():undefined,
    interpolation:c.interpolation,
    gpuExecution:c.gpuExecution?{available:c.gpuExecution.available,elapsedMs:distribution(c.gpuExecution.samplesMs),disjoint:c.gpuExecution.disjoint,dropped:c.gpuExecution.dropped,note:'Diagnostic elapsed GPU queries; asynchronous and separate from RAF/CPU. Not scanout/presentation latency.'}:undefined,
    stages, worstIntervals: worst,
    timeline: [...bins].map(([second, values]) => ({ second, ...distribution(values) })),
    gpuTiming: { available: false, reason: 'RAF/renderSubmit are CPU cadence only; optional elapsed GPU queries are reported separately.' },
    limitations: [
      ...(threaded ? ['Simulation and projection run in a worker: their main-thread stages are N/A. Worker markers have a separate window; output arrivals may occur between display callbacks. Frame age is measured at CPU submission, not presentation.'] : []),
      'RAF cadence is not a measured display presentation/completion rate.',
      'An interval ends at the current RAF start; inspect previous CPU callback spans as a candidate, not proof of causation.',
      'CPU-stage wall durations may include GC/driver waits; they are not OS thread CPU time. CPU and GPU work must not be added as serial work.',
      'Sampling instrumentation overhead has not been calibrated for scoring. CPU-profile timing is not automatically aligned to this capture.',
    ], traceEvents };
}

export interface CpuFrame { functionName: string; url: string; lineNumber: number; columnNumber: number; scriptId?: string }
interface CpuNode { id: number; callFrame: CpuFrame; children?: number[] }
export function analyzeCpuProfile(source: unknown, resolve: (frame: CpuFrame) => CpuFrame = value => value) {
  check(source && typeof source === 'object', 'Expected a CPU profile');
  const p = source as { nodes: CpuNode[]; samples: number[]; timeDeltas: number[]; startTime: number; endTime: number };
  check(Array.isArray(p.nodes) && Array.isArray(p.samples) && Array.isArray(p.timeDeltas) && p.samples.length === p.timeDeltas.length
    && Number.isFinite(p.startTime) && Number.isFinite(p.endTime) && p.endTime >= p.startTime, 'Expected Chrome/V8 sampled CPU profile with timeDeltas');
  const nodes = new Map<number, CpuNode>(), parents = new Map<number, number>();
  for (const n of p.nodes) {
    check(Number.isSafeInteger(n.id) && !nodes.has(n.id) && n.callFrame && typeof n.callFrame.functionName === 'string'
      && typeof n.callFrame.url === 'string' && Number.isInteger(n.callFrame.lineNumber) && Number.isInteger(n.callFrame.columnNumber), 'Invalid CPU node');
    nodes.set(n.id, n);
  }
  for (const n of p.nodes) for (const child of n.children ?? []) {
    check(nodes.has(child) && !parents.has(child), 'Invalid CPU profile tree'); parents.set(child, n.id);
  }
  const keys = new Map<number, string>(), functions = new Map<string, { frame: CpuFrame; selfMs: number; inclusiveMs: number; samples: number }>();
  for (const n of p.nodes) {
    const frame = resolve(n.callFrame), key = JSON.stringify([frame.url, frame.functionName, frame.lineNumber, frame.columnNumber]);
    keys.set(n.id, key); if (!functions.has(key)) functions.set(key, { frame, selfMs: 0, inclusiveMs: 0, samples: 0 });
    const seen = new Set<number>(); let current: number | undefined = n.id;
    while (current !== undefined) { check(!seen.has(current), 'Cycle in CPU profile'); seen.add(current); current = parents.get(current); }
  }
  // V8 may emit out-of-order sample timestamps (observed -1us in Chrome150).
  // Reconstruct and sort absolute timestamps, as DevTools does; retain the raw profile.
  let timestamp = p.startTime, negativeTimeDeltas = 0;
  const ordered = p.samples.map((id, index) => {
    const delta = p.timeDeltas[index];
    check(nodes.has(id) && Number.isFinite(delta), 'Invalid CPU sample');
    if (delta < 0) negativeTimeDeltas++;
    timestamp += delta;
    check(timestamp >= p.startTime && timestamp <= p.endTime + 1, 'CPU sample timestamp outside profile');
    return { id, timestamp, index };
  }).sort((a, b) => a.timestamp - b.timestamp || a.index - b.index);
  let sampledUs = 0, previousTimestamp = p.startTime;
  const reorderedSamples = ordered.filter((sample, index) => sample.index !== index).length;
  for (const { id, timestamp } of ordered) {
    const delta = timestamp - previousTimestamp; previousTimestamp = timestamp; sampledUs += delta;
    const self = functions.get(keys.get(id)!)!; self.selfMs += delta / 1000; self.samples++;
    const included = new Set<string>(); let current: number | undefined = id;
    while (current !== undefined) {
      const key = keys.get(current)!;
      if (!included.has(key)) { functions.get(key)!.inclusiveMs += delta / 1000; included.add(key); }
      current = parents.get(current);
    }
  }
  const durationUs = p.endTime - p.startTime;
  check(sampledUs <= durationUs + 1, 'CPU samples exceed profile duration');
  const rows = [...functions.values()].filter(f => f.samples || f.inclusiveMs).map(f => ({ ...f,
    selfPercent: sampledUs ? f.selfMs / (sampledUs / 1000) * 100 : 0 }));
  return { negativeTimeDeltas, reorderedSamples, durationMs: durationUs / 1000, sampledMs: sampledUs / 1000, unsampledTailMs: Math.max(0, durationUs - sampledUs) / 1000,
    functions: rows.slice().sort((a, b) => b.selfMs - a.selfMs),
    limitation: 'Statistical CPU sampling, including idle/native/GC; absolute sample timestamps are sorted before duration attribution, and corrections are reported. Inclusive times overlap; recursive function identity is counted once per stack. Original/compiled locations depend on supplied source maps. No GPU time or automatic frame alignment.' };
}
