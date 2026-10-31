import test from 'node:test';import assert from 'node:assert/strict';
import {FXSystem} from '../../src/game/world/effects.ts';import {RNG} from '../../src/game/math/random.ts';
test('effect capacity preserves the legacy oldest-age and physical-slot tie order across expiry',()=>{
 const fx=new FXSystem(new RNG(7),17),reference=[];let id=0,state=9;
 const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296};
 for(let step=0;step<1200;step++){
  for(let n=0,count=Math.floor(next()*30);n<count;n++){
   const draft={type:'ring',x:step,y:n,radius:1,color:'#fff',seed:0,t:next()<.1?.03:0,life:.05+next()*.6};
   const value={...draft,id:++id};if(reference.length>=17){let oldest=0;for(let j=1;j<reference.length;j++)if(reference[j].t>reference[oldest].t)oldest=j;reference[oldest]=value;}else reference.push(value);
   fx._push({...draft});assert.deepEqual(fx.items,reference);
  }
  const dt=step%3/120;fx.update(dt);
  for(let i=reference.length-1;i>=0;i--){reference[i].t+=dt;if(reference[i].t>=reference[i].life){reference[i]=reference[reference.length-1];reference.pop();}}
  assert.deepEqual(fx.items,reference);
  if(step%113===0){fx.clear();reference.length=0;}
 }
});
