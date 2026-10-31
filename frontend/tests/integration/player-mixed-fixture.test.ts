import { expect, it } from 'vitest';
import { SessionEngine } from '../../src/game/session-engine';
import { populatePlayerMix, movePlayerMix, playerStyles, mixedPresets } from '../e2e/player-mixed-fixture';

function build() {
  const engine = new SessionEngine({});
  engine.dispatch({type:'start-run',options:{characterId:'yui',difficulty:'nightmare',partySize:1,seed:69,pilot:false}});
  let state=0x123456;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)|0;return(state>>>0)/4294967296;};
  const items=populatePlayerMix(engine.battle!.world,engine.battle!.player,40,random);
  return {engine,items};
}
it('projects all four real player-bullet styles and six-point trails without running combat',()=>{
  const {engine,items}=build();
  const frame=engine.readFrame();
  for(const style of playerStyles) expect(frame.projectiles.filter(p=>p.playerStyle===style)).toHaveLength(10);
  expect(frame.projectiles.every(p=>p.trail?.length===6&&p.trail.every(t=>t.alpha>0))).toBe(true);
  expect(items.every(p=>p.bullet.ownerPlayer===engine.battle!.player)).toBe(true);
  expect(engine.battle!.world.enemies.items).toHaveLength(0);
  expect(mixedPresets.mixed.enemies).toBe(600);
});
it('keeps deterministic poses and updates existing history objects, leaving populations alive',()=>{
  const a=build(),b=build(),points=a.items.map(x=>[...x.bullet.trail]);
  movePlayerMix(a.items,2);movePlayerMix(b.items,2);
  const pose=(x:typeof a)=>x.engine.readFrame().projectiles.map(p=>[p.playerStyle,p.x,p.y,p.angle,p.age,p.trail]);
  expect(pose(a)).toEqual(pose(b));
  const before=pose(a);movePlayerMix(a.items,3);
  expect(pose(a)).not.toEqual(before);
  expect(a.items.every((x,i)=>x.bullet.trail.every((p,j)=>p===points[i][j])&&!x.bullet.dead)).toBe(true);
});
