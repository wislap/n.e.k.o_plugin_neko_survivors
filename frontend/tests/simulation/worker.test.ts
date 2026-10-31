import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_INPUT, createGameSession, isGameSave } from '../../src/game/index.ts';
import type { GameOutput, Reply, Request, WorkerInput, WorkerOutput } from '../../src/simulation/protocol.ts';
import { decodeFrame, frameBuffers, transfers } from '../../src/simulation/frame-packet.ts';
import { SimulationHost } from '../../src/simulation/host.ts';
import { SimulationClock } from '../../src/simulation/clock.ts';
const workers: Worker[] = [];
afterEach(async () => { await Promise.all(workers.splice(0).map(w => w.terminate())); });
function launch(reference = false) {
  const worker = new Worker(new URL('./node-worker.mjs', import.meta.url), { workerData: { reference } });
  workers.push(worker); return worker;
}
function connect(worker: Worker) {
  let id = 0;
  const outputs: GameOutput[] = [], frames: Extract<WorkerOutput,{kind:'frame'}>[] = [];
  const pending = new Map<number, (reply: Reply) => void>();
  worker.on('message', (m: WorkerOutput) => {
    if(m.kind==='fatal')throw Error(m.message);
    if(m.kind==='reply'){if(m.preceding)outputs.push(...m.preceding.outputs);if(m.outputs)outputs.push(...m.outputs);pending.get(m.id)?.(m);pending.delete(m.id);}
    if(m.kind==='update'){outputs.push(...m.outputs);worker.postMessage({kind:'ack',sequence:m.sequence});}
    if(m.kind==='frame')frames.push(m);
  });
  return { outputs,frames,
    request(request:Request){return new Promise<Reply>(resolve=>{const n=++id;pending.set(n,resolve);worker.postMessage({...request,id:n});});},
    send(message:WorkerInput,transfer?:ArrayBuffer[]){worker.postMessage(message,transfer);},
  };
}
const command={type:'start-run',options:{characterId:'yui',difficulty:'nightmare',partySize:1,seed:69,pilot:true}} as const;
const init={kind:'initialize',options:{},width:1920,height:1080,packed:true,profile:true} as const;
describe('real simulation worker',()=>{
  it('matches the synchronous core, including checkpoint-time progress and events',async()=>{
    const ref=launch(true),received=once(ref,'message');ref.postMessage({options:{},command,steps:1024});
    const port=connect(launch());await port.request(init);await port.request({kind:'command',command});
    for(let i=0;i<16;i++)await port.request({kind:'advance',steps:64,input:EMPTY_INPUT});
    const actual=await port.request({kind:'inspect'}),[expected]=await received;
    expect(actual.result).toEqual({ok:true});expect(actual.ui).toEqual(expected.ui);expect(actual.progress).toEqual(expected.progress);
    expect(port.outputs).toEqual(expected.outputs);
    // Detached snapshot path is also exercised through the same worker packet codec.
    port.send({kind:'frame'});await port.request({kind:'inspect'});
    const packed=decodeFrame(port.frames[0].packet);expect(packed.tick).toBe(expected.frame.tick);
    expect(packed.actors).toEqual(expected.frame.actors);
    expect(packed.transients!.playerCount).toBe(expected.frame.projectiles.filter((p: {hostile:boolean})=>!p.hostile).length);
  },20000);
  it('keeps real worker checkpoints usable after fractional-health control handovers', async () => {
    const port = connect(launch()); await port.request(init);
    await port.request({ kind: 'command', command: { type: 'start-run', options: {
      characterId: 'kuro', difficulty: 'nightmare', partySize: 1, seed: 1342502704, pilot: false,
    } } });
    await port.request({ kind: 'command', command: { type: 'set-pilot', enabled: true } });
    for (let i = 0; i < 11; i++) await port.request({ kind: 'advance', steps: 64, input: EMPTY_INPUT });
    const grown = await port.request({ kind: 'advance', steps: 17, input: EMPTY_INPUT });
    expect(grown.ui.players[0].maxHp).toBeCloseTo(19.98);
    await port.request({ kind: 'shortcut', action: 'pause' });
    for (let i = 0; i < 5; i++) for (const enabled of [false, true]) {
      const reply = await port.request({ kind: 'command', command: { type: 'set-pilot', enabled } });
      expect(reply.result.ok).toBe(true); expect(reply.ui.phase).toBe('paused');
      expect(reply.ui.players[0].hp).toBeLessThanOrEqual(reply.ui.players[0].maxHp);
    }
    const saved = await port.request({ kind: 'save' });
    expect(saved.result.ok).toBe(true); expect(isGameSave(saved.progress?.run)).toBe(true);
    await port.request({ kind: 'replace', options: { save: saved.progress!.run } });
    for (let i = 0; i < 40; i++) expect((await port.request({ kind: 'advance', steps: 64, input: EMPTY_INPUT })).result.ok).toBe(true);
    const checkpoints = port.outputs.filter(output => output.event.type === 'checkpoint');
    expect(checkpoints.length).toBeGreaterThan(10);
    for (const output of checkpoints) expect(isGameSave(output.progress?.run)).toBe(true);
    expect((await port.request({ kind: 'inspect' })).ui.wave).toBeGreaterThan(1);
  });
  it('returns invalid command failures without losing the usable session',async()=>{
    const port=connect(launch());await port.request(init);
    const invalid=await port.request({kind:'command',command:{type:'buy-offer',offerId:'missing',revision:0}});expect(invalid.result.ok).toBe(false);
    expect((await port.request({kind:'command',command})).result.ok).toBe(true);
    expect((await port.request({kind:'speed',speed:3})).result.ok).toBe(false);
    expect((await port.request({kind:'inspect'})).ui.phase).toBe('playing');
  });
  it('does not execute duplicate request IDs and resolves shortcut toggles in authoritative order',async()=>{
    const port=connect(launch());await port.request(init);const first=await port.request({kind:'command',command});
    // A repeated receipt must not run even a different mutating command.
    port.send({kind:'command',command:{type:'return-title'},id:2});
    const state=await port.request({kind:'inspect'});expect(state.epoch).toBe(first.epoch);expect(state.ui.phase).toBe('playing');
    const pause=port.request({kind:'shortcut',action:'pause'}),resume=port.request({kind:'shortcut',action:'pause'});
    expect((await pause).ui.phase).toBe('paused');expect((await resume).ui.phase).toBe('playing');
    const a=port.request({kind:'shortcut',action:'toggle-auto-upgrade'}),b=port.request({kind:'shortcut',action:'toggle-auto-upgrade'});
    expect((await a).ui.autoUpgrade).toBe(true);expect((await b).ui.autoUpgrade).toBe(false);
  });
  it('changes the attempt epoch exactly once for a commanded retry',async()=>{
    const port=connect(launch());await port.request(init);const started=await port.request({kind:'command',command});
    await port.request({kind:'advance',steps:64,input:EMPTY_INPUT});
    const retry=await port.request({kind:'command',command:{type:'retry-wave'}});expect(retry.result.ok).toBe(true);expect(retry.epoch).toBe(started.epoch+1);
    await port.request({kind:'advance',steps:1,input:EMPTY_INPUT});expect((await port.request({kind:'inspect'})).epoch).toBe(retry.epoch);
  });
  it('keeps only three transferred slots and restores reader methods after lease return',async()=>{
    const port=connect(launch());await port.request(init);await port.request({kind:'command',command});
    await port.request({kind:'advance',steps:32,input:EMPTY_INPUT});
    for(let i=0;i<4;i++)port.send({kind:'frame'});await port.request({kind:'inspect'});
    expect(port.frames).toHaveLength(3);
    const first=port.frames[0],buffers=frameBuffers(first.packet)!;
    expect(decodeFrame(first.packet).transients!.readPlayer).toBeTypeOf('function');
    expect(transfers(buffers)).toHaveLength(5);
    expect(first.packet.bodies).toBeDefined(); expect(first.packet.trails).toBeDefined();
    port.send({kind:'recycle',slot:first.slot,lease:first.lease,buffers},transfers(buffers));expect(buffers.players.byteLength).toBe(0);
    expect(buffers.bodies!.byteLength).toBe(0); expect(buffers.trails!.byteLength).toBe(0);
    await port.request({kind:'inspect'});expect(port.frames).toHaveLength(4);expect(port.frames[3].slot).toBe(first.slot);expect(port.frames[3].lease).toBe(first.lease+1);
    expect(port.frames[3].packet.bodies!.data.byteLength).toBeGreaterThan(0);
    expect(port.frames[3].packet.trails!.data.byteLength).toBeGreaterThan(0);
    expect((await port.request({kind:'inspect'})).stats.buffersInFlight).toBe(3);
  });
  it('returns only leased arrays when switching prepared display work between threads',async()=>{
    const port=connect(launch());await port.request(init);await port.request({kind:'command',command});
    await port.request({kind:'speed',speed:8});port.send({kind:'frame'});await port.request({kind:'inspect'});
    const fast=port.frames[0],fastBuffers=frameBuffers(fast.packet)!;
    expect(fast.packet.bodies).toBeUndefined();expect(fast.packet.trails).toBeUndefined();expect(transfers(fastBuffers)).toHaveLength(3);
    port.send({kind:'recycle',slot:fast.slot,lease:fast.lease,buffers:fastBuffers},transfers(fastBuffers));
    await port.request({kind:'speed',speed:1});port.send({kind:'frame'});await port.request({kind:'inspect'});
    const normal=port.frames[1],normalBuffers=frameBuffers(normal.packet)!;
    expect(normal.slot).toBe(fast.slot);expect(transfers(normalBuffers)).toHaveLength(5);
    port.send({kind:'recycle',slot:normal.slot,lease:normal.lease,buffers:normalBuffers},transfers(normalBuffers));
    await port.request({kind:'speed',speed:4});port.send({kind:'frame'});await port.request({kind:'inspect'});
    const again=port.frames[2];expect(again.slot).toBe(fast.slot);expect(again.packet.bodies).toBeUndefined();
    expect((await port.request({kind:'inspect'})).result.ok).toBe(true);
  });
  it('captures a checkpoint before later steps change the saved run',async()=>{
    const port=connect(launch());await port.request(init);await port.request({kind:'command',command});
    await port.request({kind:'advance',steps:1,input:EMPTY_INPUT});await port.request({kind:'inspect'});
    const checkpoint=port.outputs.find(o=>o.event.type==='checkpoint')!;const bytes=JSON.stringify(checkpoint.progress);
    await port.request({kind:'advance',steps:64,input:EMPTY_INPUT});const later=await port.request({kind:'save'});
    expect(JSON.stringify(checkpoint.progress)).toBe(bytes);expect(later.progress).not.toEqual(checkpoint.progress);
  });
});
describe('command output seam', () => {
  it('drains committed events without a game step or random-state change', () => {
    const game = createGameSession(); game.drainEvents(); game.dispatch(command);
    const before = game.exportSave(), tick = game.readFrame().tick, events = game.drainEvents();
    expect(events.some(event => event.type === 'checkpoint')).toBe(true);
    expect(game.exportSave()).toEqual(before); expect(game.readFrame().tick).toBe(tick); expect(game.drainEvents()).toEqual([]);
    expect(game.advance(EMPTY_INPUT).events.some(event => event.type === 'sound' && event.name === 'gameStart')).toBe(false);
  });
});

describe('worker scheduling and pressure',()=>{
  it('retains rule-step size, reports capacity limiting and resets debt when speed changes',()=>{
    const c=new SimulationClock();c.setSpeed(8);c.update(0);c.update(100);let steps=0;while(c.due){c.consume();steps++;}
    expect(steps).toBe(48);c.update(2100);expect(c.backlog).toBe(8);expect(c.unserved).toBeCloseTo(8);c.setSpeed(2);expect(c.backlog).toBe(0);
  });
  it('runs independently of display, bounds unacknowledged outputs and stops after suspend receipt',()=>{
    let now=0;const timers=new Map<number,()=>void>();let timer=0;const messages:WorkerOutput[]=[];
    const host=new SimulationHost(m=>messages.push(structuredClone(m)),{now:()=>now,schedule:cb=>{timers.set(++timer,cb);return timer;},cancel:id=>{timers.delete(id as unknown as number);}});
    host.receive({...init,id:1});host.receive({kind:'command',command,id:2});host.receive({kind:'start',id:3});
    for(let i=0;i<200;i++){now+=8;const callbacks=[...timers.values()];timers.clear();for(const cb of callbacks)cb();}
    expect(host.stats.steps).toBeGreaterThan(0);expect(host.stats.packets).toBe(0);expect(host.stats.updatesInFlight).toBe(1);
    expect(host.stats.bufferedEvents).toBeLessThan(600);
    host.receive({kind:'suspend',suspended:true,id:4});const steps=host.stats.steps;
    now+=1000;for(const cb of timers.values())cb();expect(host.stats.steps).toBe(steps);host.dispose();
  });
});
