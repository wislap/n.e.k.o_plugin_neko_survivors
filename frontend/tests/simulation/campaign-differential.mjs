/** Extended differential through real worker messages; not an FPS benchmark. */
import{Worker}from'node:worker_threads';import{once}from'node:events';import{createHash}from'node:crypto';import{mkdir,writeFile}from'node:fs/promises';import assert from'node:assert/strict';
import{EMPTY_INPUT}from'../../src/game/index.ts';import{canonicalFrame}from'./canonical-frame.mjs';import{frameBuffers,transfers}from'../../src/simulation/frame-packet.ts';
const results=[];
for(const difficulty of['normal','nightmare'])for(const partySize of[1,4]){
 const command={type:'start-run',options:{characterId:'yui',difficulty,partySize,seed:69,pilot:true}},start=performance.now();
 const ref=new Worker(new URL('./campaign-reference.mjs',import.meta.url),{workerData:{command}});const expectedPromise=once(ref,'message');
 const worker=new Worker(new URL('./node-worker.mjs',import.meta.url));const events=createHash('sha256'),frames=createHash('sha256'),uis=createHash('sha256'),saves=createHash('sha256');let eventCount=0,id=0;const pending=new Map(),frameWait=[];
 worker.on('error',e=>{for(const{reject}of pending.values())reject(e)});
 const outputs=values=>{for(const v of values){events.update(JSON.stringify(v));eventCount++;}};
 worker.on('message',m=>{if(m.kind==='fatal'){for(const{reject}of pending.values())reject(Error(m.message));return;}if(m.kind==='reply'){outputs(m.preceding?.outputs??[]);outputs(m.outputs??[]);pending.get(m.id)?.resolve(m);pending.delete(m.id);}else if(m.kind==='update'){outputs(m.outputs);worker.postMessage({kind:'ack',sequence:m.sequence});}else if(m.kind==='frame')frameWait.shift()?.(m);});
 const request=m=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});worker.postMessage({...m,id:n});});
 try{
  const[expected]=await expectedPromise;await request({kind:'initialize',options:{},width:1920,height:1080,packed:true,profile:false});await request({kind:'command',command});
  let step=0;for(;step<expected.steps;){const n=Math.min(64,60-step%60,expected.steps-step);const reply=await request({kind:'advance',steps:n,input:EMPTY_INPUT});assert.equal(reply.result.ok,true);step+=n;
   if(step%60===0){const received=new Promise(resolve=>frameWait.push(resolve));worker.postMessage({kind:'frame'});const frame=await received;frames.update(JSON.stringify(canonicalFrame(frame.packet)));uis.update(JSON.stringify(reply.ui));const buffers=frameBuffers(frame.packet);worker.postMessage({kind:'recycle',slot:frame.slot,lease:frame.lease,buffers},transfers(buffers));}
   if(step%600===0)saves.update(JSON.stringify(reply.progress));
  }
  const final=await request({kind:'inspect'});const actual={steps:step,eventCount,events:events.digest('hex'),frames:frames.digest('hex'),uis:uis.digest('hex'),saves:saves.digest('hex'),ui:final.ui,progress:final.progress};assert.deepEqual(actual,expected);
  const row={difficulty,partySize,steps:step,eventCount,events:actual.events,frames:actual.frames,uis:actual.uis,saves:actual.saves,elapsedMs:performance.now()-start,phase:actual.ui.phase};results.push(row);console.log(JSON.stringify(row));
 }finally{await ref.terminate();await worker.terminate();}
}
const output=process.env.NEKO_CAMPAIGN_OUTPUT??'test-results/worker-20261031/campaign-differential.json';await mkdir(new URL('.',new URL(output,'file://'+process.cwd()+'/')),{recursive:true});await writeFile(output,JSON.stringify(results,null,2));
