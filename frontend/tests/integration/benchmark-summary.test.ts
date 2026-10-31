import {it, expect} from 'vitest';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createFrameCapture} from '../../src/diagnostics/frame-capture';

it('aggregates per-run medians, preserves failed attempts and never treats missing GPU throughput as zero', async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'neko-benchmark-summary-'));
  try {
    await mkdir(path.join(root,'baseline'));
    const records=[];
    for(const [index,dt] of [10,20].entries()) {
      let now=0;const capture=createFrameCapture(()=>now);capture.start({});
      for(const t of [0,dt,dt*2]){now=t;capture.beginFrame(t);capture.frame({phase:'playing',wave:50,combat:true,actors:1,projectiles:0,effects:0,pickups:0});}
      const file=path.join(root,'raw-'+index+'.json');await writeFile(file,JSON.stringify(capture.stop()));
      records.push({id:'fixture-'+index,gpu:'integrated',uncapped:false,scenario:'horde',backend:'canvas2d',repeat:index+1,file,validIntervals:2,truncated:false,averageRafFps:1000/dt,onePercentLowRafFps:1000/dt,p99Ms:dt,sampleSeconds:dt*2/1000,droppedSeconds:0,completedThroughputFps:null});
    }
    records.push({id:'failed',gpu:'integrated',uncapped:false,scenario:'horde',backend:'canvas2d',repeat:3,error:'real renderer failed'});
    await writeFile(path.join(root,'baseline/summary.json'),JSON.stringify(records));
    await writeFile(path.join(root,'manifest.json'),'{}');
    execFileSync(process.execPath,[path.resolve('scripts/performance/summarize-benchmark.mjs'),'--root='+root]);
    const report=JSON.parse(await readFile(path.join(root,'report/summary.json'),'utf8'));
    expect(report).toMatchObject({attempts:3,passed:2,failed:1});
    expect(report.aggregates[0].metrics.averageRafFps).toEqual({median:75,min:50,max:100,samples:2});
    expect(report.aggregates[0].metrics.completedThroughputFps).toBeNull();
    expect(report.aggregates[0].errorMessages).toEqual(['real renderer failed']);
    const html=await readFile(path.join(root,'report/index.html'),'utf8');
    expect(()=>new Function(html.match(/<script>([\s\S]*)<\/script>/)![1])).not.toThrow();
  } finally {await rm(root,{recursive:true,force:true});}
});
