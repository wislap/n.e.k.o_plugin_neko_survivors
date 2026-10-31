/** Fixed render complexity + independent real simulation pressure. No paid host calls. */
import{spawn,execFileSync}from'node:child_process';import{createHash}from'node:crypto';import{mkdir,readFile,writeFile,copyFile,access,readdir}from'node:fs/promises';import path from'node:path';import{build}from'vite';import{Cdp}from'./cdp.mjs';import{analyzeCapture}from'./analyze.ts';
const flags=new Map(process.argv.slice(2).map(a=>{const[k,...v]=a.split('=');return[k,v.join('=')||true]}));
const seconds=Number(flags.get('--seconds')||8),warmup=Number(flags.get('--warmup')||3),repeats=Number(flags.get('--repeats')||3);
const gpus=String(flags.get('--gpu')||'discrete,integrated').split(','),speeds=String(flags.get('--speeds')||'1,2,4,8').split(',').map(Number);
if(typeof flags.get('--fixture')!=='string'||!Number.isFinite(seconds)||seconds<1||seconds>90||!Number.isFinite(warmup)||warmup<0||warmup>60||!Number.isInteger(repeats)||repeats<1||repeats>10||gpus.some(g=>!['discrete','integrated'].includes(g))||speeds.some(s=>![1,2,4,8].includes(s)))throw Error('Use --fixture=natural-wave50.json [--gpu=discrete,integrated --speeds=1,2,4,8 --seconds=8 --warmup=3 --repeats=3]');
const out=path.resolve(String(flags.get('--out')||`test-results/thread-isolation-${Date.now()}`));if(!out.startsWith(path.resolve('test-results')+path.sep))throw Error('--out must be in test-results');
try{await access(path.join(out,'manifest.json'));throw Error('Choose a new output directory')}catch(error){if(error.code!=='ENOENT')throw error}
await mkdir(out,{recursive:true});await copyFile(String(flags.get('--fixture')),path.join(out,'natural-wave50.json'));
await writeFile(path.join(out,'probe.html'),'<!doctype html><title>Thread isolation probe</title>');
await build({configFile:false,publicDir:false,base:'/bench/',build:{outDir:path.join(out,'site'),emptyOutDir:true,sourcemap:true,rollupOptions:{input:'tests/e2e/simulation-render-isolation.html'}}});
const fingerprints=[];async function visit(dir){for(const e of(await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,e.name);if(e.isDirectory())await visit(file);else fingerprints.push({path:path.resolve(file),sha256:createHash('sha256').update(await readFile(file)).digest('hex')});}}await visit('src');await visit(path.join(out,'site'));
await writeFile(path.join(out,'manifest.json'),JSON.stringify({communityBaseCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:fingerprints,scope:'Fixed-pose rendered world plus separate natural simulation worker; not application gameplay FPS',seconds,warmup,repeats,gpus,speeds,fixture:path.resolve(String(flags.get('--fixture')))},null,2));
const server=spawn('python',['scripts/performance/serve-benchmark.py','--out='+out,'--controlled-only'],{stdio:['ignore','pipe','inherit']}),results=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function firstLine(stream){return new Promise((resolve,reject)=>{let text='';stream.on('data',b=>{text+=b;if(text.includes('\n'))resolve(text.split('\n')[0])});stream.on('error',reject)})}
try{
 const port=Number(await firstLine(server.stdout)),base=`http://127.0.0.1:${port}`;
 for(let repeat=1;repeat<=repeats;repeat++)for(const gpu of gpus){let browser,cdp;
  try{
   browser=spawn(process.execPath,['scripts/performance/launch-browser.mjs','--gpu='+gpu,'--url='+base+'/results/probe.html'],{stdio:['ignore','pipe','inherit']});
   const launch=JSON.parse(await firstLine(browser.stdout));await writeFile(path.join(out,`launch-${gpu}-${repeat}.json`),JSON.stringify(launch,null,2));cdp=new Cdp(launch.browserWebSocket);
   const target=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='page'),{sessionId:sid}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
   await cdp.send('Page.enable',{},sid);await cdp.send('Runtime.enable',{},sid);await cdp.send('Log.enable',{},sid);await cdp.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:2,mobile:false},sid);await cdp.send('Page.bringToFront',{},sid);
   const system=await cdp.send('SystemInfo.getInfo');if(!(gpu==='integrated'?/intel/i:/amd/i).test(system.gpu.auxAttributes.glRenderer||''))throw Error('Wrong GPU');
   async function wait(expr,limit=120000){const start=Date.now();while(Date.now()-start<limit){const failed=await cdp.evaluate("window.__benchFailure??(window.__benchState?.phase==='failed'?window.__benchState:null)",sid);if(failed)throw Error(JSON.stringify(failed));if(await cdp.evaluate(`Boolean(${expr})`,sid))return;await delay(100)}throw Error('Deadline '+expr)}
   for(const speed of(repeat%2?speeds:speeds.slice().reverse())){
    const id=`${gpu}-speed${speed}-r${repeat}`,url=`${base}/bench/tests/e2e/simulation-render-isolation.html?backend=webgl2&scenario=mixed-heavy&pose=2&freezeMotion=1&simulationSpeed=${speed}&seconds=${seconds}&warmup=${warmup}`;
    cdp.events.length=0;await cdp.send('Page.navigate',{url},sid);await wait(`location.href===${JSON.stringify(url)}&&window.__benchState?.phase==='ready'`);
    await cdp.evaluate(`document.getElementById('start').click()`,sid);await wait(`window.__benchState?.phase==='measuring'`);const start=await cdp.evaluate('window.__simulationIsolation.marker()',sid);
    await wait(`window.__benchState?.phase==='done'`,(seconds+30)*1000);const end=await cdp.evaluate('window.__simulationIsolation.marker()',sid),raw=await cdp.evaluate('window.__benchResult',sid);
    const report=analyzeCapture(raw),elapsed=(end.stats.elapsedMs-start.stats.elapsedMs)/1000;
    const errors=cdp.events.filter(e=>e.method==='Runtime.exceptionThrown'||e.method==='Runtime.consoleAPICalled'&&e.params.type==='error'||e.method==='Log.entryAdded'&&e.params.entry.source==='rendering'&&/INVALID_|error|failed/i.test(e.params.entry.text));if(errors.length)throw Error('Rendering errors '+JSON.stringify(errors).slice(0,1000));
    if(raw.context.canvas.width!==3840||raw.context.canvas.height!==2160||raw.context.renderer.assets.pending||raw.context.renderer.assets.failed.length||raw.frames.some(r=>r[8]!==601||r[9]!==7000||r[11]!==600))throw Error('Render population, resolution or assets changed');
    raw.context.backgroundSimulation={scope:'Separate natural world; worker marker window differs from render capture',start,end};raw.context.benchmark={gpu,speed,repeat,launch,systemGpu:system.gpu};await writeFile(path.join(out,id+'.json'),JSON.stringify(raw));
    await cdp.evaluate(`document.getElementById('info').style.visibility='hidden'`,sid);const shot=await cdp.send('Page.captureScreenshot',{format:'png'},sid);await writeFile(path.join(out,id+'.png'),Buffer.from(shot.data,'base64'));
    const row={id,gpu,speed,repeat,averageRafFps:report.averageRafFps,onePercentLowRafFps:report.onePercentLowRafFps,p99Ms:report.intervalMs.p99,stages:report.stages,actualRuleSpeed:(end.stats.steps-start.stats.steps)/60/elapsed,backgroundWindowSeconds:elapsed,backgroundSimulationMs:end.stats.simulationMs-start.stats.simulationMs,backgroundStartPhase:start.phase,backgroundEndPhase:end.phase};
    results.push(row);await writeFile(path.join(out,'summary.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(row));await cdp.evaluate('window.__simulationIsolation.dispose()',sid);
   }
  }finally{if(cdp){try{await cdp.send('Browser.close')}catch{}cdp.close()}browser?.kill('SIGTERM')}
 }
}finally{server.kill('SIGINT')}
