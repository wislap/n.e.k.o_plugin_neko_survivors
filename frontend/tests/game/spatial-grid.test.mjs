import test from 'node:test';import assert from 'node:assert/strict';import{SpatialGrid}from'../../src/game/actors/entity.ts';
// Reference is the previous hash-bucket traversal. In particular membership is
// captured at insertion while positions and death remain live during queries.
class Reference {
 constructor(cs){this.cellSize=cs;this.cells=new Map();} key(x,y){return x*73856093^y*19349663;}
 insert(e){const k=this.key(Math.floor(e.x/this.cellSize),Math.floor(e.y/this.cellSize));const b=this.cells.get(k)??[];b.push(e);this.cells.set(k,b);}
 query(x,y,r){const out=[];for(let a=Math.floor((x-r)/this.cellSize);a<=Math.floor((x+r)/this.cellSize);a++)for(let b=Math.floor((y-r)/this.cellSize);b<=Math.floor((y+r)/this.cellSize);b++)for(const e of this.cells.get(this.key(a,b))??[]){const dx=e.x-x,dy=e.y-y;if(!e.dead&&dx*dx+dy*dy<=(r+e.radius)**2)out.push(e);}return out;}
 nearest(x,y,r,filter){let best=null,d=r*r;const c=Math.ceil(r/this.cellSize),xx=Math.floor(x/this.cellSize),yy=Math.floor(y/this.cellSize);for(let a=xx-c;a<=xx+c;a++)for(let b=yy-c;b<=yy+c;b++)for(const e of this.cells.get(this.key(a,b))??[]){if(e.dead||filter&&!filter(e))continue;const z=(e.x-x)**2+(e.y-y)**2;if(z<d){best=e;d=z;}}return best;}
}
test('numeric spatial lookup preserves hashed cells, candidate/tie order and live moved bodies',()=>{
 let s=3;const random=()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);
 for(const size of[1,64,72,133]){const grid=new SpatialGrid(size),old=new Reference(size);for(let turn=0;turn<9;turn++){
  grid.clear();old.cells.clear();const entities=Array.from({length:350},(_,id)=>({id,x:(random()-.5)*3000,y:(random()-.5)*3000,radius:random()*30,dead:false}));
  entities.push({id:999,x:-1,y:0,radius:1,dead:false},{id:1000,x:1,y:0,radius:1,dead:false});
  for(const e of entities){grid.insert(e);old.insert(e);}for(const e of entities){e.x+=random()*80-40;e.dead=random()<.04;}
  grid.sealPositions(()=>true);let seed;
  for(let q=0;q<60;q++){const x=(random()-.5)*2500,y=(random()-.5)*2500,r=size===1?5+random()*6:10+random()*300,filter=e=>e.id%3!==0;
   assert.deepEqual(grid.query(x,y,r).map(e=>e.id),old.query(x,y,r).map(e=>e.id));assert.equal(grid.nearest(x,y,r,filter)?.id,old.nearest(x,y,r,filter)?.id);seed=grid.nearest(x,y,r,filter,undefined,seed);assert.equal(seed?.id,old.nearest(x,y,r,filter)?.id);
  }
 }}
});
