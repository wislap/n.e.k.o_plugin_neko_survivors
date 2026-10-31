/** Offline only: run after the timing matrix and separate CPU-sampling rounds. */
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve(process.argv.find(a=>a.startsWith('--root='))?.slice(7)||'test-results/gpu-benchmark-20261029');
async function maps(dir){return(await readdir(dir)).filter(x=>x.endsWith('.js.map')).map(x=>path.join(dir,x));}
const sourceMaps=[...await maps(path.join(root,'site/assets')),...await maps(path.join(root,'tools')),...await maps('test-results/profile-build/app')];
const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
const pinned=new Map(manifest.files.map(f=>[path.resolve(f.path),f.sha256]));
for(const file of sourceMaps)if(pinned.get(path.resolve(file))!==createHash('sha256').update(await readFile(file)).digest('hex'))throw Error('Source map differs from the frozen benchmark build: '+file);
const summaries=[];
for(const file of(await readdir(path.join(root,'cpu'))).filter(x=>x.endsWith('.cpuprofile')&&!x.includes('.failure.'))){
  const id=file.slice(0,-11),capture=path.join(root,'cpu',id+'.json'),profile=path.join(root,'cpu',file),out=path.join(root,'hotspots',id);
  const args=['scripts/performance/report.mjs','--capture',capture,'--cpu',profile,'--out',out,...sourceMaps.flatMap(m=>['--map',m]),...(id.includes('-native-')?['--wave','50']:[])];
  const ran=spawnSync(process.execPath,args,{encoding:'utf8'});if(ran.status!==0)throw Error(id+': '+ran.stderr);
  const report=JSON.parse(await readFile(path.join(out,'report.json'),'utf8'));
  summaries.push({id,path:out,sourceMapping:report.sourceMapping,capture:{averageRafFps:report.capture.averageRafFps,stages:report.capture.stages},cpu:report.cpu});
  console.log(ran.stdout.trim());
}
const out=path.join(root,'hotspots');await mkdir(out,{recursive:true});
await writeFile(path.join(out,'summary.json'),JSON.stringify(summaries,null,2));
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
await writeFile(path.join(out,'index.html'),'<!doctype html><meta charset="utf-8"><title>独立 CPU 热点轮次</title><style>body{font:16px system-ui;max-width:1100px;margin:40px auto;line-height:1.7}li{margin:20px 0}code{font-size:13px}</style><h1>独立 CPU 热点轮次</h1><p>这些采样器轮次不参与基线成绩。Self / Inclusive 是统计 CPU 采样，不能当作 GPU 时间或逐帧因果证明。</p><ul>'+summaries.map(s=>'<li><a href="'+encodeURIComponent(s.id)+'/index.html">'+esc(s.id)+'</a> · 映射 '+s.sourceMapping.mappedNodes+' 节点<ul>'+s.cpu.functions.filter(f=>f.frame.url).slice(0,5).map(f=>'<li><code>'+esc(f.frame.functionName||'(anonymous)')+'</code> · Self '+f.selfPercent.toFixed(2)+'% · '+esc(f.frame.url)+':'+(f.frame.lineNumber+1)+'</li>').join('')+'</ul></li>').join('')+'</ul>');
