import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionEngine } from '../../src/game/session-engine.ts';
import { GameFrameBuffer } from '../../src/game/frame-buffer.ts';
import { GameDisplayBuffer } from '../../src/game/display-frame.ts';
import { PhantomClone } from '../../src/game/actors/phantom.ts';
test('compact clone identities survive an earlier clone removal without changing canonical identity or saved rules',()=>{
 const session=new SessionEngine({});session.dispatch({type:'start-run',options:{characterId:'yui',difficulty:'normal',partySize:1,seed:69}});
 const world=session.battle.world,p=world.player;
 for(let i=0;i<3;i++)world.phantoms.push(new PhantomClone(p,world,10+i*20,0));
 const buffer=new GameDisplayBuffer(),saved=JSON.stringify(session.exportSave()),first=session.readDisplay(buffer).scene.actors.filter(a=>a.kind==='phantom');
 assert.equal(JSON.stringify(session.exportSave()),saved);
 world.phantoms.splice(0,1);
 const second=session.readDisplay(buffer).scene.actors.filter(a=>a.kind==='phantom');assert.deepEqual(second.map(a=>a.id),first.slice(1).map(a=>a.id));
 assert.deepEqual(session.readFrame(new GameFrameBuffer({packed:true,stableActorIds:true})).actors.filter(a=>a.kind==='phantom').map(a=>a.id),second.map(a=>a.id));
 assert.deepEqual(session.readFrame().actors.filter(a=>a.kind==='phantom').map(a=>a.id),['phantom-0','phantom-1']);
 world.phantoms.push(new PhantomClone(p,world,70,0));const third=session.readDisplay(buffer).scene.actors.filter(a=>a.kind==='phantom');assert.ok(!first.some(a=>a.id===third[2].id));
});
