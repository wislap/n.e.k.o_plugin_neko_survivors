/** Offline aggregation. Never pools failed cases or calls RAF cadence presentation FPS. */
import {readFile, writeFile, mkdir, access} from 'node:fs/promises';
import path from 'node:path';
import {analyzeCapture} from './analyze.ts';

const root=path.resolve(process.argv.find(a=>a.startsWith('--root='))?.slice(7)||'test-results/gpu-benchmark-20261029');
const records=JSON.parse(await readFile(path.join(root,'baseline/summary.json'),'utf8'));
const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
let runManifest=null;
try{runManifest=JSON.parse(await readFile(path.join(root,'baseline/run-manifest.json'),'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
const config=runManifest?.config??manifest.config;
const expected=config?config.gpus.length*config.backends.length*config.scenarios.length*config.modes.length*config.repeats*(config.speeds?.length??1):records.length;
if(new Set(records.map(r=>r.id)).size!==records.length)throw Error('Duplicate run identities');
if(records.length!==expected&&!process.argv.includes('--partial'))throw Error(`Incomplete matrix: ${records.length}/${expected}; use --partial for an explicitly partial report`);
const valid=row=>!row.error&&row.validIntervals>0&&!row.truncated&&Number.isFinite(row.averageRafFps);
const groups=new Map(), detailed=[];
function stats(values) {
  const v=values.filter(Number.isFinite).sort((a,b)=>a-b);
  return v.length?{median:v.length%2?v[(v.length-1)/2]:(v[v.length/2-1]+v[v.length/2])/2,min:v[0],max:v.at(-1),samples:v.length}:null;
}
for(const row of records) {
  const key=[row.gpu,row.uncapped?'unlimited':'normal',row.scenario,row.backend,row.speed??1].join('/');
  const group=groups.get(key)||{key,gpu:row.gpu,mode:row.uncapped?'unlimited':'normal',scenario:row.scenario,backend:row.backend,speed:row.speed??1,runs:[]};
  group.runs.push(row);groups.set(key,group);
  if(row.error){detailed.push(row);continue;}
  const raw=JSON.parse(await readFile(row.file,'utf8'));
  const report=analyzeCapture(raw,true,row.scenario==='native'?50:undefined);
  delete report.traceEvents;
  detailed.push({...row,report,blankRafProbe:raw.context.benchmark?.launcher?.blankRafProbe});
}
const metrics=['averageRafFps','onePercentLowRafFps','p99Ms','sampleSeconds','droppedSeconds','completedThroughputFps'];
const aggregates=[...groups.values()].map(group=>{
  const ok=group.runs.filter(valid);
  return {...group,attempts:group.runs.length,passed:ok.length,failed:group.runs.length-ok.length,
    metrics:Object.fromEntries(metrics.map(name=>[name,stats(ok.map(r=>r[name]))])),
    errorMessages:[...new Set(group.runs.filter(r=>r.error).map(r=>r.error))]};
});
const blocks=new Map();
for(const row of detailed){const launcher=row.report?.context?.benchmark?.launcher;if(launcher?.blankRafProbe)blocks.set(launcher.profile,{gpu:row.gpu,mode:row.uncapped?'unlimited flags':'normal',repeat:row.repeat,...launcher.blankRafProbe});}
let warmedProbes=[];
for(const [folder,platform] of [['framerate-probes','default'],['framerate-probes-x11','forced x11']]){
  try{warmedProbes.push(...JSON.parse(await readFile(path.join(root,folder,'summary.json'),'utf8')).map(p=>({platform,gpu:p.gpu,uncapped:p.uncapped,frames:p.sample.frames,elapsedMs:p.sample.elapsedMs,averageRafFps:p.sample.averageRafFps,visibility:p.sample.visibility,screen:p.sample.screen,window:p.window})))}catch(error){if(error.code!=='ENOENT')throw error}
}
const result={manifest,runManifest,expected,complete:records.length===expected,attempts:records.length,passed:records.filter(valid).length,failed:records.filter(r=>!valid(r)).length,aggregates,detailed,blankPageProbes:[...blocks.values()],warmedProbes,
  interpretation:[
    'Each aggregate is the median of per-run statistics; min/max show run spread. No confidence interval is claimed for three runs.',
    'RAF cadence measures callback starts, not display presentation or GPU execution. 1% low = 1000 / mean of the slowest ceil(N*0.01) intervals.',
    'Controlled scenes run real renderers/projection with identical entity inputs, no gameplay simulation and no HUD; original native visual LOD remains enabled. Images are not claimed pixel-equivalent.',
    'Native wave 50 uses matching saved character growth, but variable-step original and fixed-step community gameplay evolve differently. Entity counts, pauses, early endings and dropped simulation time matter; FPS ratios do not isolate the renderer.',
    'Native actor counters differ: original adapter counts enemies.items + P1 (including not-yet-compacted dead entries, excluding pet/turrets/phantoms); community counts projected actors including pet/turrets/phantoms and filters dead enemies. Native projectile/pickup counters also use raw original lists versus live projected views. Controlled fixtures keep all entries alive and use the same populations.',
    'Vulkan/ANGLE is forced for reproducible GPU selection. These are not stock daily-browser default-driver results.',
    'Normal and unlimited labels describe launch flags. Blank-page RAF probes check their effect; game throughput may remain below refresh rate.',
    'WebGL fence completion throughput (historical backends retain their recorded completion method) is only for controlled scenes. It is not per-frame GPU time or scanout FPS. Canvas2D final-pixel readback does not prove all-frame completion.',
    'Frame-capture and CDP polling overhead are not calibrated. CPU sampler results are collected in separate rounds and excluded from baseline scores.',
    'This first baseline is three target-30-second repeats, with target-10-second controlled warmup and at-most-2-second native warmup after first HUD. It is not the proposed five-by-90-second acceptance matrix.',
    'Native samples are entry windows, not fully warmed steady-state runs: some captures still have pending assets at their start. The fixture is naturally generated by the community engine and translated into the original save format; this is not evidence of a separate original-engine campaign from wave 1.',
  ]};
const output=path.join(root,'report');await mkdir(output,{recursive:true});
await writeFile(path.join(output,'summary.json'),JSON.stringify(result,null,2));
const escape=x=>String(x??'N/A').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=x=>typeof x==='number'?x.toFixed(2):'N/A';
const lines=['| GPU | 模式 | 场景 | 后端 | 通过/尝试 | 平均 RAF FPS 中位数 [最小–最大] | 1% low 中位数 | P99 ms 中位数 |', '|---|---|---|---|---:|---:|---:|---:|'];
for(const row of aggregates){const m=row.metrics.averageRafFps;lines.push(`| ${row.gpu} | ${row.mode} | ${row.scenario} | ${row.backend}／${row.speed??1}× | ${row.passed}/${row.attempts} | ${m?`${num(m.median)} [${num(m.min)}–${num(m.max)}]`:'FAIL'} | ${num(row.metrics.onePercentLowRafFps?.median)} | ${num(row.metrics.p99Ms?.median)} |`);}
await writeFile(path.join(output,'table.md'),lines.join('\n')+'\n');
const data=JSON.stringify(result).replace(/</g,'\\u003c');
const evidenceLinks=[];
for(const [file,label] of [['hotspots/index.html','CPU 函数与源码位置（独立采样轮次）'],['overflow/failure.json','历史溢出断点和缓冲状态']]){
  try{await access(path.join(root,file));evidenceLinks.push(`<a href="../${file}">${escape(label)}</a>`)}catch(error){if(error.code!=='ENOENT')throw error}
}
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NEKO 4K 双显卡基线</title>
<style>body{font:15px system-ui;margin:30px auto;max-width:1400px;padding:0 20px;background:#f0f4fa;color:#152a40}section{background:white;padding:20px;border-radius:12px;margin:20px 0;overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:9px;border-bottom:1px solid #dbe3ed;text-align:left}th button{font:inherit;border:0;background:none;color:inherit;cursor:pointer}tr[data-id]{cursor:pointer}tr[data-id]:hover{background:#eef5ff}select{padding:7px;margin-right:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.bad{color:#b52339}.note{color:#4c6178}svg{width:100%;height:240px;background:#f5f8fc}a{color:#1a5ec0}</style>
<h1>NEKO 4K 双显卡性能基线</h1><p>${result.attempts}/${result.expected} 次尝试 · ${result.passed} 次有效结果 · ${result.failed} 次失败／无成绩。${result.complete?'矩阵已完成。':'部分矩阵，尚未完成。'} GPU执行时间／实际呈现FPS：未测得。</p><p class="note">3840×2160 backing；1920×1080 CSS × DPR 2。主表为各次统计值的中位数，括号为最小–最大。unlimited 代表开启解限参数，实际回调节奏见下方探针，不等于已证明解除上限。点击单次采集查看时间线、CPU阶段和前一回调负载。</p>
<section><label>GPU <select id="gpu"><option value="">全部</option><option>discrete</option><option>integrated</option></select></label><label>模式 <select id="mode"><option value="">全部</option><option>normal</option><option>unlimited</option></select></label><label>场景 <select id="scenario"><option value="">全部</option><option>horde</option><option>boss</option><option>native</option></select></label><div id="aggregate"></div></section>
<section><h2>单次采集</h2><div id="runs"></div></section><section id="detail"><p>选择上方一次采集。</p></section>
<section><h2>每个浏览器进程的初始空白页探针</h2><p class="note">启动后首次 120 个 RAF 间隔，可能包含冷启动抖动；用于检查参数，不能当成游戏或呈现 FPS。低于屏幕上限的样本不足以证明解限成功。</p><table><thead><tr><th>GPU</th><th>模式</th><th>轮次</th><th>RAF/秒</th><th>屏幕 CSS 尺寸／DPR</th></tr></thead><tbody>${result.blankPageProbes.map(p=>`<tr><td>${escape(p.gpu)}</td><td>${escape(p.mode)}</td><td>${p.repeat}</td><td>${num(p.averageRafFps)}</td><td>${escape(JSON.stringify(p.screen))}</td></tr>`).join('')}</tbody></table></section>
${warmedProbes.length?`<section><h2>独立预热后解限复核</h2><p class="note">每个全新进程空白页预热 2 秒，再测约 2 秒。只验证回调节奏，不能当成游戏或呈现 FPS。</p><table><thead><tr><th>窗口后端</th><th>GPU</th><th>解限参数</th><th>RAF/秒</th><th>样本秒数</th><th>可见性</th></tr></thead><tbody>${warmedProbes.map(p=>`<tr><td>${escape(p.platform)}</td><td>${escape(p.gpu)}</td><td>${p.uncapped?'开启':'关闭'}</td><td>${num(p.averageRafFps)}</td><td>${num(p.elapsedMs/1000)}</td><td>${escape(p.visibility)}</td></tr>`).join('')}</tbody></table></section>`:''}
${evidenceLinks.length?`<section><h2>独立热点证据</h2><p>${evidenceLinks.join(' · ')}</p></section>`:''}
<section><h2>如何解释</h2>${result.interpretation.map(x=>`<p>${escape(x)}</p>`).join('')}<p>horde：600 怪 + 4000 敌弹 + 2000 掉落；boss：300 怪 + 4 Boss + 6000 敌弹 + 1200 掉落；native：真实第 50 波续档完整战斗。</p><details><summary>构建和存档指纹</summary><pre>${escape(JSON.stringify(manifest,null,2))}</pre></details></section>
<script>const data=${data};
const esc=x=>String(x??'N/A').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const n=x=>typeof x==='number'?x.toFixed(2):'N/A';
const tab=(heads,rows)=>'<table><thead><tr>'+heads.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table>';
const cells=values=>values.map(x=>'<td>'+esc(x)+'</td>').join('');
function matches(row){return ['gpu','mode','scenario'].every(k=>!document.getElementById(k).value||document.getElementById(k).value===(k==='mode'?(row.mode??(row.uncapped?'unlimited':'normal')):row[k]))}
function render(){const a=data.aggregates.filter(matches);document.getElementById('aggregate').innerHTML=tab(['GPU','模式','场景','后端','通过/尝试','平均RAF FPS 中位数 [min–max]','1% low','P99 ms'],a.map(r=>{const m=r.metrics.averageRafFps;return '<tr class="'+(r.failed?'bad':'')+'">'+cells([r.gpu,r.mode,r.scenario,r.backend+' / '+r.speed+'×',r.passed+'/'+r.attempts,m?n(m.median)+' ['+n(m.min)+'–'+n(m.max)+']':'FAIL',n(r.metrics.onePercentLowRafFps?.median),n(r.metrics.p99Ms?.median)])+'</tr>'}));
document.getElementById('runs').innerHTML=tab(['样本','有效秒','有效间隔／1%尾部样本','平均RAF FPS','1% low','P99 ms','丢时秒','弹丸峰值','状态'],data.detailed.filter(matches).map(r=>'<tr data-id="'+esc(r.id)+'">'+cells([r.id,n(r.sampleSeconds),r.report?r.validIntervals+'/'+r.report.onePercentTailSamples:'N/A',n(r.averageRafFps),n(r.onePercentLowRafFps),n(r.p99Ms),n(r.droppedSeconds),r.peakProjectiles,r.error||'OK'])+'</tr>'));for(const row of document.querySelectorAll('[data-id]'))row.onclick=()=>detail(data.detailed.find(r=>r.id===row.dataset.id));}
function detail(r){const target=document.getElementById('detail');if(r.error){target.innerHTML='<h2>'+esc(r.id)+'</h2><pre class="bad">'+esc(JSON.stringify(r,null,2))+'</pre><a href="../baseline/'+encodeURIComponent(r.id)+'.failure.jpg">失败截图</a>';return;}const p=r.report,t=p.timeline,max=Math.max(16.67,...t.map(x=>x.max||0)),lo=t[0]?.second||0,hi=t.at(-1)?.second||lo,points=t.map((x,i)=>(i===0||x.second>t[i-1].second+1?'M':'L')+(40+(x.second-lo)/Math.max(1,hi-lo)*1080)+','+(215-(x.p99||0)/max*185)).join(' ');target.innerHTML='<h2>'+esc(r.id)+'</h2><p>每秒 P99 帧间隔；纵轴上限 '+n(max)+' ms。GPU执行时间 N/A。</p><svg viewBox="0 0 1160 250"><path d="M40 215H1120" stroke="#acbed2"/><path d="'+points+'" fill="none" stroke="#1b62c4" stroke-width="2"/><text x="40" y="245">'+lo+'s</text><text x="1080" y="245">'+hi+'s</text></svg>'+tab(['CPU阶段','均值ms','P95 ms','P99 ms','最大ms'],p.stages.map(s=>'<tr>'+cells([s.stage,n(s.mean),n(s.p95),n(s.p99),n(s.max)])+'</tr>'))+'<p>阶段是墙钟跨度，可能含 GC／驱动等待；阶段总和不等于 GPU 帧时间。</p><p><a href="../baseline/'+encodeURIComponent(r.id)+'.json">原始帧数据</a> · <a href="../baseline/'+encodeURIComponent(r.id)+'.jpg">采样后截图</a></p><details><summary>负载、慢帧和上下文</summary><pre>'+esc(JSON.stringify({blankRafProbe:r.blankRafProbe,worst:p.worstIntervals,context:p.context},null,2))+'</pre></details>';target.scrollIntoView({behavior:'smooth'});}
for(const e of document.querySelectorAll('select'))e.onchange=render;render();</script></html>`;
await writeFile(path.join(output,'index.html'),html);
console.log(JSON.stringify({output,attempts:result.attempts,passed:result.passed,failed:result.failed,groups:aggregates.length}));
