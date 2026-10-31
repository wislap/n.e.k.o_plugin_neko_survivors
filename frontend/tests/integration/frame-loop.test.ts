import { describe, expect, it } from 'vitest';
import { createDisplayLoop, type AnimationDriver } from '../../src/display/loop';
function driver() {
  let next=1;const pending=new Map<number,FrameRequestCallback>();
  return {request(callback){const id=next++;pending.set(id,callback);return id;},cancel(id){pending.delete(id);},
    fire(time:number){const batch=[...pending.values()];pending.clear();for(const cb of batch)cb(time);},
    get pendingCount(){return pending.size;}} satisfies AnimationDriver&{fire(time:number):void;readonly pendingCount:number};
}
describe('independent display clock',()=>{
 it('keeps one RAF and mobile 30fps at 60/120/144Hz',()=>{
  for(const refresh of[60,120,144]){const clock=driver(),renders:number[]=[];let now=0;
   const loop=createDisplayLoop({driver:clock,displayFps:30,render:()=>renders.push(now)});loop.start();
   for(let i=0;i<=refresh;i++){now=i*1000/refresh;clock.fire(now);expect(clock.pendingCount).toBe(1);}
   expect(renders).toHaveLength(31);loop.resetClock();clock.fire(now+1);expect(renders).toHaveLength(32);loop.stop();expect(clock.pendingCount).toBe(0);
  }
 });
 it('renders once after any wall-time gap without a catch-up burst',()=>{
  const clock=driver(),calls:number[]=[];let now=0;const loop=createDisplayLoop({driver:clock,render:()=>calls.push(now)});
  loop.start();loop.start();expect(clock.pendingCount).toBe(1);clock.fire(0);now=10000;clock.fire(now);expect(calls).toEqual([0,10000]);
  loop.stop();loop.start();now=20000;clock.fire(now);expect(calls).toEqual([0,10000,20000]);loop.stop();
 });
 it('stops and reports renderer errors',()=>{
  const clock=driver(),errors:unknown[]=[],failure=new Error('render failed');
  const loop=createDisplayLoop({driver:clock,render(){throw failure;},onError:error=>errors.push(error)});loop.start();clock.fire(0);
  expect(errors).toEqual([failure]);expect(loop.running).toBe(false);expect(clock.pendingCount).toBe(0);
 });
});
