import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createFrameCapture } from '../../src/diagnostics/frame-capture';

it('writes offline CPU-only reports and maps compiled frames without injecting function names into HTML', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'neko-profile-test-'));
  try {
    const profile = { startTime: 0, endTime: 2000, nodes: [{ id: 1, callFrame: { functionName: '<script>bad()</script>', url: 'http://localhost/bundle.js', lineNumber: 0, columnNumber: 0 } }], samples: [1], timeDeltas: [2000] };
    await writeFile(path.join(root, 'profile.json'), JSON.stringify(profile));
    await writeFile(path.join(root, 'bundle.js.map'), JSON.stringify({ version: 3, file: 'bundle.js', sources: ['world.ts'], names: ['World.update'], mappings: 'AAAAA' }));
    const cli = path.resolve('scripts/performance/report.mjs');
    execFileSync(process.execPath, [cli, '--cpu', path.join(root, 'profile.json'), '--map', path.join(root, 'bundle.js.map'), '--out', path.join(root, 'mapped')]);
    const report = JSON.parse(await readFile(path.join(root, 'mapped/report.json'), 'utf8'));
    expect(report.capture).toBeNull(); expect(report.sourceMapping.mappedNodes).toBe(1);
    expect(report.cpu.functions[0].frame).toMatchObject({ functionName: 'World.update', lineNumber: 0, columnNumber: 0, url: path.join(root, 'world.ts') });
    execFileSync(process.execPath, [cli, '--cpu', path.join(root, 'profile.json'), '--out', path.join(root, 'plain')]);
    const html = await readFile(path.join(root, 'plain/index.html'), 'utf8');
    expect(html).not.toContain('<script>bad()'); expect(html).toContain('&lt;script&gt;bad()');
  } finally { await rm(root, { recursive: true, force: true }); }
});

describe('frame report CLI', () => {
  it('limits statistics and CPU spans to the requested wave', async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'neko-wave-report-'));
    try {
      let now=0;const capture=createFrameCapture(()=>now);capture.start({});
      for(const [t,wave] of [[0,49],[100,49],[120,50],[140,50],[240,51],[340,51]]){
        now=t;capture.beginFrame(t);capture.record('renderSubmit',t,t+1);
        capture.frame({phase:'playing',wave,combat:true,actors:1,projectiles:0,effects:0,pickups:0});
      }
      await writeFile(path.join(root,'capture.json'),JSON.stringify(capture.stop()));
      execFileSync(process.execPath,[path.resolve('scripts/performance/report.mjs'),'--capture',path.join(root,'capture.json'),'--wave','50','--out',path.join(root,'report')]);
      const report=JSON.parse(await readFile(path.join(root,'report/report.json'),'utf8'));
      const trace=JSON.parse(await readFile(path.join(root,'report/cpu-stages.trace.json'),'utf8'));
      expect(report.capture.validIntervals).toBe(1);
      expect(report.capture.intervalMs.mean).toBe(20);
      expect(report.capture.filter).toContain('wave 50');
      expect(trace.traceEvents).toHaveLength(2);
      expect(trace.traceEvents.every((e:{args:{wave:number}})=>e.args.wave===50)).toBe(true);
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('exports current-callback spans into Chrome trace format and preserves non-combat raw data', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'neko-frame-test-'));
    try {
      let now = 0; const capture = createFrameCapture(() => now); capture.start({ case: 'fixture' });
      const frame = { phase: 'title' as const, wave: 0, combat: false, actors: 0, projectiles: 0, effects: 0, pickups: 0 };
      capture.beginFrame(0); capture.record('renderSubmit', 0, 1); capture.frame(frame);
      now = 16; capture.beginFrame(now); capture.record('renderSubmit', 16, 18); capture.frame(frame);
      const captured = capture.stop(); captured.gpuExecution = { available: true, samplesMs: [2, 4], pending: 0, disjoint: 0, dropped: 0 };
      captured.mainThread = structuredClone(captured);
      await writeFile(path.join(root, 'capture.json'), JSON.stringify(captured));
      execFileSync(process.execPath, [path.resolve('scripts/performance/report.mjs'), '--capture', path.join(root, 'capture.json'), '--out', path.join(root, 'result'), '--all-phases']);
      const report = JSON.parse(await readFile(path.join(root, 'result/report.json'), 'utf8'));
      const trace = JSON.parse(await readFile(path.join(root, 'result/cpu-stages.trace.json'), 'utf8'));
      expect(report.capture.validIntervals).toBe(1); expect(report.capture.gpuTiming.available).toBe(false);
      expect(report.capture.gpuExecution.elapsedMs.mean).toBe(3);
      expect(report.capture.uiThread.averageRafFps).toBe(62.5);
      const html = await readFile(path.join(root, 'result/index.html'), 'utf8');
      expect(html).toContain('异步GPU执行诊断'); expect(html).not.toContain('GPU执行时间：N/A');
      expect(html).toContain('Main界面循环'); expect(html).toContain('62.50');
      expect(trace.traceEvents[1]).toMatchObject({ name: 'renderSubmit', ph: 'X', ts: 16000, dur: 2000 });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
