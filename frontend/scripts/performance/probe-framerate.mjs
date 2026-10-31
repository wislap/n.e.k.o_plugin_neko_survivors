/** Warmed blank-page probe. This verifies RAF scheduling, not game or presentation FPS. */
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Cdp} from './cdp.mjs';
const port=Number(process.argv.find(a=>a.startsWith('--port='))?.slice(7));
const platform=process.argv.find(a=>a.startsWith('--platform='))?.slice(11);
if(platform&&!['x11','wayland'].includes(platform))throw Error('--platform must be x11 or wayland');
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Use --port=local-benchmark-port');
const output=path.resolve('test-results/gpu-benchmark-20261029/framerate-probes'+(platform?'-'+platform:''));await mkdir(output,{recursive:true});
const results=[];
for(const gpu of ['discrete','integrated'])for(const uncapped of [false,true]) {
  const child=spawn(process.execPath,['scripts/performance/launch-browser.mjs',`--gpu=${gpu}`,`--url=http://127.0.0.1:${port}/results/probe.html`,...(uncapped?['--uncapped']:[]),...(platform?[`--platform=${platform}`]:[])],{stdio:['ignore','pipe','pipe']});
  let cdp;
  try {
    let text='';const ready=await new Promise((resolve,reject)=>{child.stdout.on('data',b=>{text+=b;if(text.includes('\n'))resolve(JSON.parse(text.split('\n')[0]))});child.once('exit',code=>reject(Error('Browser exited '+code)))});
    cdp=new Cdp(ready.browserWebSocket);
    const {targetInfos}=await cdp.send('Target.getTargets');const targetId=targetInfos.find(t=>t.type==='page').targetId;
    const {sessionId:sid}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
    await cdp.send('Page.enable',{},sid);await cdp.send('Runtime.enable',{},sid);
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:2,mobile:false},sid);
    await cdp.send('Page.bringToFront',{},sid);
    // A fresh Chrome may still be navigating the initial blank page.
    for(let i=0;i<100;i++){
      try{if(await cdp.evaluate(`location.pathname==='/results/probe.html'&&document.readyState==='complete'`,sid))break}catch{}
      await new Promise(r=>setTimeout(r,100));
    }
    const sample=await cdp.evaluate(`new Promise(resolve=>{
      const warmUntil=performance.now()+2000,stamps=[];let first=-1;
      function tick(t){if(performance.now()<warmUntil){requestAnimationFrame(tick);return}if(first<0)first=t;stamps.push(t);
        if(t-first<2000){requestAnimationFrame(tick);return}resolve({stamps,frames:stamps.length-1,elapsedMs:t-first,averageRafFps:(stamps.length-1)*1000/(t-first),visibility:document.visibilityState,screen:{width:screen.width,height:screen.height,dpr:devicePixelRatio}})}requestAnimationFrame(tick)
    })`,sid);
    const system=await cdp.send('SystemInfo.getInfo');const window=await cdp.send('Browser.getWindowForTarget',{targetId});
    const result={gpu,uncapped,ready,system,window,sample};results.push(result);
    await writeFile(path.join(output,`${gpu}-${uncapped?'flags':'normal'}.json`),JSON.stringify(result));
    console.log(JSON.stringify({gpu,uncapped,fps:sample.averageRafFps,screen:sample.screen,window}));
  } finally {if(cdp){try{await cdp.send('Browser.close')}catch{}cdp.close()}child.kill('SIGTERM')}
}
await writeFile(path.join(output,'summary.json'),JSON.stringify(results,null,2));
