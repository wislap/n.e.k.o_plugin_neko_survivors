import { MessageChannel, Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { describe,it,expect } from 'vitest';
import { createGameSession,EMPTY_INPUT,GameFrameBuffer,GameDisplayBuffer,PLAYER_STRIDE,PlayerTrailPreparation } from '../../src/game';
import { PlayerBodyPreparation,BODY_STRIDE } from '../../src/render-data/player-bodies';
import { frameBuffers,transfers } from '../../src/simulation/frame-packet';
import type { WorkerOutput } from '../../src/simulation/protocol';
const command={type:'start-run',options:{characterId:'yui',difficulty:'nightmare',partySize:4,seed:69,pilot:true}} as const;
describe('compact display projection',()=>{
 it('matches canonical GPU bases while retaining only exceptional raw trails and no rule mutation',()=>{
  const game=createGameSession();game.setViewport(1920,1080);game.dispatch(command);
  const compact=new GameDisplayBuffer(),packed=new GameFrameBuffer({packed:true}),prepare=new PlayerBodyPreparation();let seen=0;
  for(let tick=0;tick<1800;tick++){
   game.advance(EMPTY_INPUT);if(tick%23)continue;
   const canonical=game.readFrame(packed),expected=prepare.prepare(canonical.transients!),save=JSON.stringify(game.exportSave());
   const actual=game.readDisplay(compact);expect(JSON.stringify(game.exportSave())).toBe(save);
   expect(actual.bodies.counts).toEqual(expected.counts);expect(actual.bodies.appearances).toEqual(expected.appearances);expect(actual.bodies.bodyParts).toBe(expected.bodyParts);
   let offset=0;for(let style=0;style<4;style++){const count=expected.counts[style];expect(Array.from(actual.bodies.groups[style].subarray(0,count*BODY_STRIDE))).toEqual(Array.from(expected.data.subarray(offset*BODY_STRIDE,(offset+count)*BODY_STRIDE)));offset+=count;seen+=count;}
   const s=canonical.transients!;let trails=0;for(let i=0;i<s.playerCount;i++){const k=i*PLAYER_STRIDE;if((s.players[k+7]===0||s.players[k+7]===3)&&s.players[k+8]>1)trails++;}
   expect(actual.transients.playerCount).toBe(trails);expect(actual.transients.enemyCount).toBe(s.enemyCount);expect(actual.transients.pickupCount).toBe(s.pickupCount);expect(actual.bodies.ids.subarray(0,offset).every(Number.isSafeInteger)).toBe(true);
  }
  expect(seen).toBeGreaterThan(0);
 });
 it('transfers nine owned buffers directly through a real port and reuses returned leases',async()=>{
  const worker=new Worker(new URL('./node-worker.mjs',import.meta.url)),channel=new MessageChannel();let id=0;
  async function request(value:object,transfer:import('node:worker_threads').Transferable[]=[]){const reply=once(worker,'message');worker.postMessage({...value,id:++id},transfer);const[m]=await reply;if(m.kind==='fatal')throw Error(m.message);expect(m.result.ok).toBe(true);return m;}
  try{
   await request({kind:'initialize',options:{},width:1920,height:1080,packed:true,profile:false,renderPort:channel.port1},[channel.port1]);const epoch=once(channel.port2,'message');await request({kind:'command',command});expect((await epoch)[0].kind).toBe('epoch');await request({kind:'advance',steps:64,input:EMPTY_INPUT});
   const frames:Extract<WorkerOutput,{kind:'frame'}>[]=[];
   channel.port2.on('message',m=>{if(m.kind==='frame')frames.push(m);});
   for(let n=0;n<3;n++){const received=once(channel.port2,'message');channel.port2.postMessage({kind:'frame'});await received;}
   expect(frames).toHaveLength(3);expect((await request({kind:'metrics'})).stats.buffersInFlight).toBe(3);
   const first=frames[0],buffers=frameBuffers(first.packet)!;expect(first.packet.compact).toBeDefined();expect(transfers(buffers)).toHaveLength(9);
   channel.port2.postMessage({kind:'frame'});const received=once(channel.port2,'message');channel.port2.postMessage({kind:'recycle',slot:first.slot,lease:first.lease,buffers},transfers(buffers));
   expect(buffers.groups!.every(a=>a.byteLength===0)).toBe(true);expect(buffers.ids!.byteLength).toBe(0);const[next]=await received;
   expect(next.slot).toBe(first.slot);expect(next.lease).toBe(first.lease+1);expect(next.packet.compact.bodies.groups.every((a:Float32Array)=>a.byteLength>0)).toBe(true);
  }finally{channel.port2.close();await worker.terminate();}
 });
});
it('prepares native ring histories directly and retains double rows only for reference geometry',()=>{
 const game=createGameSession();game.setViewport(1920,1080);game.dispatch(command);
 const buffer=new GameDisplayBuffer();buffer.stream.prepareTrails=true;
 const packed=new GameFrameBuffer({packed:true});
 for(let tick=0;tick<1600;tick++){
  game.advance(EMPTY_INPUT);if(tick%31)continue;
  const frame=game.readFrame(packed),s=frame.transients!;
  const trail=new PlayerTrailPreparation().prepare(s),actual=game.readDisplay(buffer),direct=actual.trails!;
  expect(direct.runs).toEqual(trail.runs);
  const count=trail.runs.reduce((n,r)=>n+r.count,0);
  for(let i=0;i<count*28;i++){
   if(i%28===4)expect(actual.transients.colors[direct.data[i]]).toBe(s.colors[trail.data[i]]);
   else expect(direct.data[i]).toBe(trail.data[i]);
  }
  expect(actual.transients.playerIds).toEqual(trail.referenceIndices.map(i=>s.playerIds[i]));
 }
});
it('preserves every leased array when switching the direct port between normal and accelerated projection',async()=>{
 const worker=new Worker(new URL('./node-worker.mjs',import.meta.url)),channel=new MessageChannel();let id=0;
 async function request(value:object,transfer:import('node:worker_threads').Transferable[]=[]){const reply=once(worker,'message');worker.postMessage({...value,id:++id},transfer);const[m]=await reply;expect(m.kind).toBe('reply');expect(m.result.ok).toBe(true);return m;}
 try{
  await request({kind:'initialize',options:{},width:1920,height:1080,packed:true,profile:false,renderPort:channel.port1},[channel.port1]);
  const changed=once(channel.port2,'message');await request({kind:'command',command});await changed;await request({kind:'advance',steps:64,input:EMPTY_INPUT});
  for(const speed of[1,8,1,4,1]){
   await request({kind:'speed',speed});const received=once(channel.port2,'message');channel.port2.postMessage({kind:'frame'});const[frame]=await received;
   const buffers=frameBuffers(frame.packet)!;expect(transfers(buffers)).toHaveLength(speed===1?9:3);expect(!!frame.packet.compact?.trails).toBe(speed===1);
   channel.port2.postMessage({kind:'recycle',slot:frame.slot,lease:frame.lease,buffers},transfers(buffers));await request({kind:'metrics'});
  }
 }finally{channel.port2.close();await worker.terminate();}
});
