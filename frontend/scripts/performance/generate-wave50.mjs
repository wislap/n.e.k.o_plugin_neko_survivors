/** Generate a real wave-50 entry checkpoint through the public production session API. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createGameSession, isGameSave} from '../../src/game/index.ts';
const output = path.resolve(process.argv.find(a=>a.startsWith('--out='))?.slice(6) || 'test-results/gpu-benchmark-20261029');
const input = {moveX:0,moveY:0,aimX:0,aimY:0,manualAim:false,slow:false,clear:false,ultimate:false,p2MoveX:0,p2MoveY:0,p2Slow:false,p2Clear:false};
async function fingerprint() {
  const hash=createHash('sha256');
  async function visit(dir) {
    for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      const file=path.join(dir,entry.name);
      if(entry.isDirectory())await visit(file);
      else if(file.endsWith('.ts')) hash.update(file).update('\0').update(await readFile(file)).update('\0');
    }
  }
  await visit('src/game');return hash.digest('hex');
}
const hash=await fingerprint(), started=performance.now(), session=createGameSession();
assert.deepEqual(session.dispatch({type:'start-run',options:{characterId:'yui',difficulty:'nightmare',partySize:1,seed:69,pilot:true}}),{ok:true});
const waves=new Set(),phases=new Set();let steps=0;
for(;steps<300000;) {
  session.advance(input);steps++;const ui=session.readUi();waves.add(ui.wave);phases.add(ui.phase);
  if(ui.phase==='endless-prompt')assert.deepEqual(session.dispatch({type:'continue-endless'}),{ok:true});
  if(ui.phase==='shop' && ui.wave===50)break;
  if(steps%10000===0)console.log(JSON.stringify({event:'progress',steps,wave:ui.wave,phase:ui.phase}));
}
assert.equal(session.readUi().phase,'shop');assert.equal(session.readUi().wave,50);
assert.deepEqual([...waves],Array.from({length:50},(_,i)=>i+1));
const save=session.exportSave();assert.ok(isGameSave(save));assert.equal(save.checkpoint.waveIndex,49);assert.equal(save.checkpoint.phase,'playing');
const entry={...save,run:save.checkpoint};assert.ok(isGameSave(entry));
assert.equal(createGameSession({save:entry}).readUi().wave,50);
assert.equal(await fingerprint(),hash,'Game sources changed during generation');
await mkdir(output,{recursive:true});
const result={save,meta:session.getMeta(),steps,seconds:(performance.now()-started)/1000,metadata:{difficulty:'nightmare',partySize:1,seed:69,characterId:'yui',pilot:true,waves:[...waves],phases:[...phases],gameSourceSha256:hash,progression:'Public dispatch/advance only, continue-endless at the real prompt; checkpoint captured by production code at wave-50 entry. No health edit, wave skip or added buffs.'}};
await writeFile(path.join(output,'natural-wave50.json'),JSON.stringify(result));
console.log(JSON.stringify({event:'complete',output,steps,seconds:result.seconds,hash}));
