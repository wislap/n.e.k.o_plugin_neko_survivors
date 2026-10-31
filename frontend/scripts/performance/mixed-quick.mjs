/** One command for the short, controlled player-bullet regression. No campaign generation. */
import {spawn} from 'node:child_process';
import {mkdir,readFile,access,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const flags=new Map(process.argv.slice(2).map(a=>{const[k,...v]=a.split('=');return[k,v.join('=')||true]}));
if(String(flags.get('--backend')||'webgl2').split(',').some(b=>!['webgl2'].includes(b)))throw Error('Mixed quick supports webgl2 only');
if(String(flags.get('--scenario')||'mixed,mixed-heavy').split(',').some(s=>!['mixed','mixed-heavy'].includes(s)))throw Error('Mixed quick supports mixed and mixed-heavy only');
if(flags.has('--pose')&&(typeof flags.get('--pose')!=='string'||!Number.isFinite(Number(flags.get('--pose')))||Number(flags.get('--pose'))<0))throw Error('Use --pose=nonnegative-seconds');
const out=path.resolve(String(flags.get('--out')||`test-results/player-mixed-${Date.now()}`));
if(!out.startsWith(path.resolve('test-results')+path.sep))throw Error('--out must be inside test-results');
await mkdir(out,{recursive:true});
function run(args){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{stdio:'inherit'});p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(Error(args[0]+' exited '+code)))})}
const runName=String(flags.get('--run-name')||'runs');
if(!/^[a-zA-Z0-9_-]+$/.test(runName))throw Error('Invalid --run-name');
try{await access(path.join(out,runName,'summary.json'));throw Error('Results exist; choose a fresh --out or --run-name')}catch(error){if(error.code!=='ENOENT')throw error}
if(flags.has('--reuse-build'))await readFile(path.join(out,'manifest.json'));
else {
  try{await access(path.join(out,'manifest.json'));throw Error('Frozen build exists; use a new --out or --reuse-build')}catch(error){if(error.code!=='ENOENT')throw error}
  await run(['scripts/performance/prepare-benchmark.mjs',`--out=${out}`,'--controlled-only']);
}
const server=spawn('python',['scripts/performance/serve-benchmark.py',`--out=${out}`,'--controlled-only'],{stdio:['ignore','pipe','inherit']});
try {
  let line='';const port=await new Promise((resolve,reject)=>{server.stdout.on('data',b=>{line+=b;if(line.includes('\n'))resolve(Number(line.split('\n')[0]))});server.once('exit',c=>reject(Error('Server exited '+c)))});
  const args=['scripts/performance/run-benchmark.mjs',`--port=${port}`,`--seconds=${flags.get('--seconds')||8}`,`--warmup=${flags.get('--warmup')||2}`,`--repeats=${flags.get('--repeats')||1}`,`--gpu=${flags.get('--gpu')||'discrete'}`,`--backend=${flags.get('--backend')||'webgl2'}`,`--scenario=${flags.get('--scenario')||'mixed,mixed-heavy'}`,'--mode=normal',`--out=${path.join(out,runName)}`];
  if(flags.has('--cpu-profile'))args.push('--cpu-profile');
  if(flags.has('--pose'))args.push(`--pose=${flags.get('--pose')}`);
  await run(args);
  const summary=JSON.parse(await readFile(path.join(out,runName,'summary.json'),'utf8'));
  if(flags.has('--cpu-profile')){
    const maps=(await readdir(path.join(out,'site/assets'))).filter(f=>f.endsWith('.js.map')).flatMap(f=>['--map',path.join(out,'site/assets',f)]);
    for(const row of summary.filter(r=>!r.error))await run(['scripts/performance/report.mjs','--capture',row.file,'--cpu',path.join(out,runName,row.id+'.cpuprofile'),'--out',path.join(out,runName,'hotspots',row.id),...maps]);
  }
  const table=['| 场景 | 后端 | 平均 RAF FPS | 1% low | P99 ms | 有效间隔 | 状态 |','|---|---|---:|---:|---:|---:|---|',...summary.map(r=>'| '+[r.scenario,r.backend,r.averageRafFps?.toFixed(2)??'N/A',r.onePercentLowRafFps?.toFixed(2)??'N/A',r.p99Ms?.toFixed(2)??'N/A',r.validIntervals??0,r.error?'FAIL':'OK'].join(' | ')+' |')];
  await writeFile(path.join(out,runName,'summary.md'),'# 玩家弹丸混合快测\n\n短窗口仅用于回归和热点定位；不是完整玩法、校准成绩或GPU执行时间。'+(flags.has('--cpu-profile')?' 本轮启用CPU采样器，不参与基线成绩。':'')+'\n\n'+table.join('\n')+'\n');
  console.table(summary.map(r=>({scene:r.scenario,backend:r.backend,rafFps:r.averageRafFps?.toFixed(2),low:r.onePercentLowRafFps?.toFixed(2),status:r.error?'FAIL':'OK'})));
  if(summary.some(r=>r.error))throw Error('Mixed regression failed: '+summary.filter(r=>r.error).map(r=>r.id).join(', '));
  for(const row of summary){const raw=JSON.parse(await readFile(row.file,'utf8')),c=raw.context.config;
    if(raw.context.renderer.assets.pending||raw.context.renderer.assets.failed.length)throw Error('Assets incomplete');
    if(raw.frames.some(f=>f[8]!==c.enemies+c.bosses+1||f[9]!==c.bullets+c.playerBullets||f[11]!==c.pickups))throw Error('Mixed population changed');
    if(Object.values(raw.context.scene.styles).some(n=>n!==c.playerBullets/4))throw Error('Mixed styles changed');
  }
  console.log(JSON.stringify({output:out,note:'Quick RAF/CPU regression, not full gameplay or calibrated acceptance scores.'}));
} finally {server.kill('SIGINT')}
