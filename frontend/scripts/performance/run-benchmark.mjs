/** Authorized isolated-browser benchmark runner. Scores are RAF cadence, never claimed scanout FPS. */
import{spawn}from'node:child_process';import{writeFile,mkdir}from'node:fs/promises';import path from'node:path';import{Cdp}from'./cdp.mjs';import{analyzeCapture}from'./analyze.ts';
const flags=new Map(process.argv.slice(2).map(x=>{const[k,...v]=x.split('=');return[k,v.join('=')||true]}));
const port=Number(flags.get('--port')),seconds=Number(flags.get('--seconds')||90),warmup=Number(flags.get('--warmup')||10),repeats=Number(flags.get('--repeats')||5);
if(!Number.isInteger(port)||port<1||!Number.isFinite(seconds)||seconds<1||seconds>90||!Number.isInteger(repeats)||repeats<1||repeats>10||!Number.isFinite(warmup)||warmup<0||warmup>60)throw Error('Use --port=PORT [--seconds=90 --warmup=10 --repeats=5]');
const gpus=String(flags.get('--gpu')||'discrete,integrated').split(','),modes=flags.get('--mode')==='normal'?[false]:flags.get('--mode')==='unlimited'?[true]:[false,true],backends=String(flags.get('--backend')||'canvas2d,webgl2').split(','),scenarios=String(flags.get('--scenario')||'horde,boss,native').split(',');
if(gpus.some(g=>!['discrete','integrated'].includes(g))||backends.some(b=>!['canvas2d','webgl2'].includes(b))||scenarios.some(s=>!['horde','boss','drops','native','mixed','mixed-heavy'].includes(s))||flags.has('--mode')&&!['normal','unlimited','both'].includes(flags.get('--mode'))||flags.has('--platform')&&!['x11','wayland'].includes(flags.get('--platform')))throw Error('Unknown GPU, backend, scenario, mode or platform');
const softQuality=String(flags.get('--soft-quality')??'native');
if(!['native','balanced'].includes(softQuality)||softQuality==='balanced'&&backends.some(b=>b!=='webgl2'))throw Error('--soft-quality requires native|balanced and balanced requires webgl2');
const cpuProfiling=flags.has('--cpu-profile'), tracing=flags.has('--trace');
let traceActive=false;
async function startTrace(cdp){await cdp.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline.frame,blink.user_timing,v8,cc,gpu,viz,renderer.scheduler,toplevel',transferMode:'ReturnAsStream'});traceActive=true;}
async function stopTrace(cdp,file){await cdp.send('Tracing.end');traceActive=false;let complete;for(let i=0;i<400&&!complete;i++){complete=cdp.events.findLast(e=>e.method==='Tracing.tracingComplete');if(!complete)await delay(50);}if(!complete?.params.stream)throw Error('No trace stream');const parts=[];let size=0;try{for(;;){const r=await cdp.send('IO.read',{handle:complete.params.stream,size:1048576});const b=Buffer.from(r.data,r.base64Encoded?'base64':'utf8');size+=b.length;if(size>268435456)throw Error('Trace exceeds 256 MiB limit');parts.push(b);if(r.eof)break;}}finally{await cdp.send('IO.close',{handle:complete.params.stream})}await writeFile(file,Buffer.concat(parts));}
const speed=Number(flags.get('--speed')||1);
if(![1,2,4,8].includes(speed))throw Error('--speed must be 1, 2, 4 or 8');
if(speed!==1&&backends.some(b=>b!=='webgl2'))throw Error('--speed requires the community worker build');
if(speed!==1&&scenarios.some(s=>s!=='native'))throw Error('--speed applies only to the real native simulation');
const workerProfileSessions=[];
async function startProfilers(cdp,sid){
 await cdp.send('Profiler.start',{},sid);
 const targets=(await cdp.send('Target.getTargets')).targetInfos.filter(t=>t.type==='worker'&&t.url.startsWith(base+'/community/'));
 for(const target of targets){
  const attached=cdp.events.find(e=>e.method==='Target.attachedToTarget'&&e.params.targetInfo.targetId===target.targetId);
  const{sessionId}=attached?.params??await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  const name=target.title==='neko-render'?'render':'worker';
  await cdp.send('Runtime.enable',{},sessionId);await cdp.send('Profiler.enable',{},sessionId);await cdp.send('Profiler.setSamplingInterval',{interval:1000},sessionId);await cdp.send('Profiler.start',{},sessionId);workerProfileSessions.push({sessionId,name});
 }
}
async function stopProfilers(cdp,id,failure=false){
 for(const{sessionId,name}of workerProfileSessions.splice(0)){
  try{const{profile}=await cdp.send('Profiler.stop',{},sessionId);await writeFile(path.join(out,id+'.'+name+(failure?'-failure':'')+'.cpuprofile'),JSON.stringify(profile));await cdp.send('Profiler.disable',{},sessionId);}catch(error){if(!failure)throw error;}
 }
}
const base=`http://127.0.0.1:${port}`,out=path.resolve(String(flags.get('--out')||'test-results/gpu-benchmark-20261029/runs'));await mkdir(out,{recursive:true});let summaries=[];
await writeFile(path.join(out,'run-manifest.json'),JSON.stringify({startedAt:new Date().toISOString(),config:{seconds,warmup,repeats,gpus,backends,scenarios,modes:modes.map(m=>m?'unlimited':'normal'),platform:flags.get('--platform')??'default',nativeWarmup:Math.min(warmup,2),cpuProfiling,tracing,speed,softQuality},origin:base},null,2));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(cdp,sid,expr,timeout=60000){
 const end=Date.now()+timeout;
 while(Date.now()<end){try{const x=await cdp.evaluate(expr,sid);if(x)return x}catch(error){if(!/Execution context was destroyed|Cannot find context/.test(String(error)))throw error}await delay(100)}
 throw Error('Page readiness deadline: '+expr.slice(0,100));
}
async function navigate(cdp,sid,url){
 await cdp.send('Page.navigate',{url},sid);
 await wait(cdp,sid,`location.href===${JSON.stringify(url)}&&document.readyState==='complete'`);
}
async function launch(gpu,uncapped){
 const child=spawn(process.execPath,['scripts/performance/launch-browser.mjs',`--gpu=${gpu}`,`--url=${base}/results/probe.html`,...(uncapped?['--uncapped']:[]),...(flags.has('--platform')?[`--platform=${flags.get('--platform')}`]:[])],{stdio:['ignore','pipe','pipe']});let text='',diagnostics='',cdp;child.stderr.on('data',b=>diagnostics+=b);
 try{
 const ready=await new Promise((resolve,reject)=>{child.stdout.on('data',b=>{text+=b;if(text.includes('\n'))resolve(JSON.parse(text.split('\n')[0]))});child.once('exit',c=>reject(Error('Browser launch failed '+c+' '+diagnostics.slice(-1000))))});
 cdp=new Cdp(ready.browserWebSocket);const targets=await cdp.send('Target.getTargets');const target=targets.targetInfos.find(t=>t.type==='page');const{sessionId:sid}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
 await cdp.send('Target.setDiscoverTargets',{discover:true});await cdp.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true},sid);await cdp.send('Log.enable',{},sid);await cdp.send('Page.enable',{},sid);await cdp.send('Runtime.enable',{},sid);await cdp.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:2,mobile:false},sid);await cdp.send('Page.bringToFront',{},sid);
 ready.browserVersion=await cdp.send('Browser.getVersion');
 const system=await cdp.send('SystemInfo.getInfo');const gl=system.gpu.auxAttributes.glRenderer||'';if(!(gpu==='integrated'?/Intel/i:/AMD/i).test(gl)){await cdp.send('Browser.close');cdp.close();child.kill('SIGTERM');throw Error('Wrong GPU: '+gl)}
 await wait(cdp,sid,`location.href===${JSON.stringify(base+'/results/probe.html')}&&document.readyState==='complete'`);
 const blankRafProbe=await cdp.evaluate(`new Promise(resolve=>{const stamps=[];function tick(t){stamps.push(t);if(stamps.length<121)requestAnimationFrame(tick);else resolve({frames:120,elapsedMs:t-stamps[0],averageRafFps:120000/(t-stamps[0]),visibility:document.visibilityState,screen:{width:screen.width,height:screen.height,dpr:devicePixelRatio}})}requestAnimationFrame(tick)})`,sid);
 ready.blankRafProbe=blankRafProbe;
 return{child,cdp,sid,ready,system};
 }catch(error){if(cdp){try{await cdp.send('Browser.close')}catch{}cdp.close()}child.kill('SIGTERM');throw error}
}
async function nativeRun(cdp,sid,backend,metadata){
 const old=backend==='canvas2d';
 await navigate(cdp,sid,old?`${base}/original/index.html?party=1`:`${base}/community/index.html?profile=1&backend=${backend}`);
 if(old){
  // Original fresh-page Continue lacks CometDisaster initialization. Its own supported
  // party=1 startup initializes it through startRun. That clears the save, so restore
  // only this isolated profile's fixture, then call the real Continue handler.
  await wait(cdp,sid,`!!window.__game?.comet&&!!window.__game?.player`);
  await cdp.evaluate(`fetch('/results/entry-v1.json').then(r=>r.json()).then(save=>{localStorage.setItem('neko_miao_save_v1',JSON.stringify(save));window.__game.loadGame()})`,sid);
  await wait(cdp,sid,`window.__game.waveIndex===49&&window.__game.state==='playing'`);
  await cdp.evaluate(`window.NekoAgent.pilot.adopt(window.__game)`,sid);
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyM',key:'m',windowsVirtualKeyCode:77},sid);
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyM',key:'m',windowsVirtualKeyCode:77},sid);
  await cdp.evaluate(`import('/tools/benchmark-tools.js').then(m=>{window.__benchmarkControl=m.attachOriginal(window.__game,${JSON.stringify(metadata)})})`,sid);
 }else{
  await wait(cdp,sid,`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='继续游戏')`);
  if(softQuality!=='native')await cdp.evaluate(`(()=>{const s=document.querySelector('[aria-label="柔光质量"]');if(!s)throw Error('Build has no soft-quality control');s.value='${softQuality}';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,sid);
  await cdp.evaluate(`(()=>{const buttons=[...document.querySelectorAll('button')];buttons.find(b=>b.textContent.trim()==='🔊 音效开')?.click();buttons.find(b=>b.textContent.trim()==='继续游戏').click()})()`,sid);
 }
 if(!old)await wait(cdp,sid,`Number(document.querySelector('#hud-wave-num')?.textContent)===50`);
 await cdp.send('Page.bringToFront',{},sid);
 await wait(cdp,sid,`document.visibilityState==='visible'`);
 await delay(Math.min(warmup,2)*1000);
 if(!old){const fatal=await cdp.evaluate(`document.querySelector('.notification.bad')?.textContent||''`,sid);if(/运行已暂停|模拟已停止/.test(fatal))throw Error(fatal)}
 if(!old&&speed!==1){await cdp.evaluate(`(()=>{const s=document.querySelector('[aria-label="模拟倍速"]');if(!s)throw Error('Build has no simulation-speed control');s.value='${speed}';s.dispatchEvent(new Event('change',{bubbles:true}))})()`,sid);await wait(cdp,sid,`document.querySelector('[aria-label="模拟倍速"]')?.value==='${speed}'&&!document.querySelector('[aria-label="模拟倍速"]').disabled`);}
 if(tracing)await startTrace(cdp);
 if(cpuProfiling)await startProfilers(cdp,sid);
 if(old)await cdp.evaluate(`window.__benchmarkControl.start()`,sid);else await cdp.evaluate(`(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='开始采集').click();document.querySelector('[aria-label="性能采集"]').style.display='none'})()`,sid);
 if(!old)await wait(cdp,sid,`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='停止并准备导出'&&!b.disabled)`);
 const start=Date.now();let reason='duration';
 while(Date.now()-start<seconds*1000){const state=await cdp.evaluate(old?`({wave:window.__game.waveIndex+1,shop:window.__game.state==='shop'})`:`({wave:Number(document.querySelector('#hud-wave-num')?.textContent),shop:!!document.querySelector('.shop-screen'),fatal:document.querySelector('.notification.bad')?.textContent||''})`,sid);if(/运行已暂停|模拟已停止/.test(state.fatal??''))throw Error(state.fatal);if(state.wave!==50||state.shop){reason='wave-completed-or-left';break}await delay(250)}
 if(old){const raw=await cdp.evaluate(`window.__benchmarkControl.stop()`,sid);raw.context.endReason=reason;return raw}
 await cdp.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='停止并准备导出').click()`,sid);
 await wait(cdp,sid,`document.querySelector('[aria-label="采集 JSON（可复制）"]')?.value`);
 const raw=JSON.parse(await cdp.evaluate(`document.querySelector('[aria-label="采集 JSON（可复制）"]').value`,sid));raw.context.endReason=reason;return raw;
}
for(let repeat=0;repeat<repeats;repeat++)for(const uncapped of modes)for(const gpu of(repeat%2?gpus.slice().reverse():gpus)){
 let browser;try{
  browser=await launch(gpu,uncapped);const{cdp,sid}=browser;
  for(const scenario of scenarios)for(const backend of(repeat%2?backends.slice().reverse():backends)){
   const id=`${gpu}-${uncapped?'unlimited':'normal'}-${scenario}-${backend}${speed===1?'':'-speed'+speed}${softQuality==='native'?'':'-balanced'}-r${repeat+1}`,file=path.join(out,id+'.json');
   console.log(JSON.stringify({event:'start',id,time:new Date().toISOString()}));
   try{
    const metadata={cpuProfiling,tracing,cpuScope:'Main, Simulation Worker and Render Worker profiled separately; never add cross-thread CPU spans',speed,gpu,uncapped,repeat:repeat+1,scenario,requestedBackend:backend,systemGpu:browser.system.gpu,launcher:browser.ready,seconds,warmup,softQuality};let raw;
    await cdp.send('Page.bringToFront',{},sid);cdp.events.length=0;
    if(cpuProfiling){await cdp.send('Profiler.enable',{},sid);await cdp.send('Profiler.setSamplingInterval',{interval:1000},sid)}
    if(scenario==='native')raw=await nativeRun(cdp,sid,backend,metadata);
    else{
     await navigate(cdp,sid,`${base}/bench/tests/e2e/stress-benchmark.html?backend=${backend}&scenario=${scenario}&seconds=${seconds}&warmup=${warmup}&softQuality=${softQuality}${flags.has('--pose')?'&pose='+encodeURIComponent(String(flags.get('--pose'))):''}`);
     await wait(cdp,sid,`window.__benchState?.phase==='failed'?(()=>{throw Error(JSON.stringify(window.__benchState))})():window.__benchState?.phase==='ready'`);
     await cdp.evaluate(`document.getElementById('start').click()`,sid);
     if(tracing){await wait(cdp,sid,`window.__benchState?.phase==='measuring'`);await startTrace(cdp);}
     if(cpuProfiling){await wait(cdp,sid,`window.__benchState?.phase==='measuring'`);await cdp.send('Profiler.start',{},sid)}
     await wait(cdp,sid,`window.__benchState?.phase==='failed'?(()=>{throw Error(JSON.stringify(window.__benchState))})():window.__benchState?.phase==='done'`,(seconds+warmup+60)*1000);
     raw=await cdp.evaluate(`window.__benchResult`,sid);
    }
    if(cpuProfiling){await stopProfilers(cdp,id);const {profile}=await cdp.send('Profiler.stop',{},sid);await writeFile(path.join(out,id+'.cpuprofile'),JSON.stringify(profile));await cdp.send('Profiler.disable',{},sid)}
    if(tracing)await stopTrace(cdp,path.join(out,id+'.trace.json'));
    if(backend==='webgl2'&&((raw.context.renderer?.playerSoftQuality??'native')!==softQuality))throw Error('Captured quality does not match requested quality');
    raw.context.benchmark=metadata;
    const exceptions=cdp.events.filter(e=>e.method==='Runtime.exceptionThrown');
    raw.context.browserExceptions=exceptions;
    const renderingErrors=cdp.events.filter(e=>e.method==='Runtime.consoleAPICalled'&&e.params.type==='error'||e.method==='Log.entryAdded'&&e.params.entry.source==='rendering'&&/INVALID_|error|failed/i.test(e.params.entry.text));
    raw.context.renderingErrors=renderingErrors;
    await writeFile(file,JSON.stringify(raw));
    if(exceptions.length||renderingErrors.length)throw Error('Browser rendering failed: '+JSON.stringify([...exceptions,...renderingErrors]).slice(0,4000));
    if(raw.frames.length<2)throw Error('No usable rendered frames: '+JSON.stringify(exceptions).slice(-4000));
    const canvas=raw.context.canvas??raw.context.viewport;if((canvas.canvasWidth??canvas.width)!==3840||(canvas.canvasHeight??canvas.height)!==2160)throw Error('Not 4K: '+JSON.stringify(canvas));
    const actualBackend=raw.context.backend??raw.context.renderer?.backend;if(actualBackend!==backend)throw Error('Unexpected backend '+actualBackend);
    if(raw.context.renderer?.assets?.failed?.length)throw Error('Assets failed: '+JSON.stringify(raw.context.renderer.assets.failed));
    if(raw.context.renderer?.contextLost)throw Error('Renderer context lost');
    if(raw.context.renderer?.device?.vendor&&!(gpu==='integrated'?/intel/i:/amd/i).test(raw.context.renderer.device.vendor))throw Error('Actual WebGL2 device differs from requested GPU');
    await writeFile(file,JSON.stringify(raw));const report=analyzeCapture(raw,true,scenario==='native'?50:undefined);
    const completion=raw.context.completion;const summary={id,gpu,uncapped,repeat:repeat+1,scenario,backend,recordedFrames:raw.frames.length,validIntervals:report.validIntervals,sampleSeconds:report.sampledIntervalSeconds,averageRafFps:report.averageRafFps,onePercentLowRafFps:report.onePercentLowRafFps,p99Ms:report.intervalMs.p99,maxMs:report.intervalMs.max,truncated:raw.truncated,droppedSeconds:report.droppedSimulationSeconds,peakProjectiles:Math.max(0,...raw.frames.map(r=>r[9])),peakActors:Math.max(0,...raw.frames.map(r=>r[8])),peakPickups:Math.max(0,...raw.frames.map(r=>r[11])),gpuDrainMs:completion?.drainMs??null,completedThroughputFps:completion?.allSubmittedPrefix?raw.frames.length*1000/(completion.endMs-raw.startedMs):null,file};
    if(report.worker)summary.worker=report.worker;summary.speed=speed;
    summaries.push(summary);await writeFile(path.join(out,'summary.json'),JSON.stringify(summaries,null,2));
    try{const png=flags.has('--pose');const shot=await cdp.send('Page.captureScreenshot',png?{format:'png'}:{format:'jpeg',quality:75},sid);await writeFile(path.join(out,id+(png?'.png':'.jpg')),Buffer.from(shot.data,'base64'))}catch(error){await writeFile(path.join(out,id+'.screenshot-error.json'),JSON.stringify({error:String(error)}))}
    console.log(JSON.stringify({event:'result',...summary}));
   }catch(error){if(traceActive){try{await stopTrace(cdp,path.join(out,id+'.failure.trace.json'));}catch{traceActive=false;}}await stopProfilers(cdp,id,true);if(cpuProfiling){try{const {profile}=await cdp.send('Profiler.stop',{},sid);await writeFile(path.join(out,id+'.failure.cpuprofile'),JSON.stringify(profile))}catch{}await cdp.send('Profiler.disable',{},sid)}
    const fixtureFailure=await cdp.evaluate(`window.__benchFailure??null`,sid).catch(()=>null);
    const page=await cdp.evaluate(`({text:document.body.innerText.slice(0,3000),visibility:document.visibilityState})`,sid).catch(()=>null);
    const failure={id,gpu,backend,scenario,uncapped,repeat:repeat+1,error:String(error),page,fixtureFailure};
    await writeFile(path.join(out,id+'.failure.json'),JSON.stringify({failure,events:cdp.events},null,2));
    try{const shot=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:75},sid);await writeFile(path.join(out,id+'.failure.jpg'),Buffer.from(shot.data,'base64'))}catch{}summaries.push(failure);await writeFile(path.join(out,'summary.json'),JSON.stringify(summaries,null,2));console.log(JSON.stringify({event:'failure',...failure}));}
  }
 }finally{if(browser){try{await browser.cdp.send('Browser.close')}catch{}browser.cdp.close();browser.child.kill('SIGTERM')}}
}
console.log(JSON.stringify({event:'complete',cases:summaries.length,success:summaries.filter(r=>!r.error).length,out}));
