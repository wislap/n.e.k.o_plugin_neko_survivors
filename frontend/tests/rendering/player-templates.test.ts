import { afterEach, expect, it, vi } from 'vitest';
import { Container, DOMAdapter, Mesh, Graphics, Texture, TextureSource } from 'pixi.js';
import { RenderStream } from '../../src/game';
import { PlayerBodyPreparation } from '../../src/render-data/player-bodies';
import { PlayerTrailPreparation } from '../../src/game';
import { PlayerProjectiles } from '../../src/rendering/player-projectiles';
import { PlayerBodyTemplates } from '../../src/rendering/player-body-templates';
import type { BakedPart, PlayerArt } from '../../src/rendering/player-art';
import type { GameAssets } from '../../src/rendering/assets';

afterEach(() => vi.restoreAllMocks());
function meshes(root: Container): Mesh[] { return root.children.flatMap(c => c instanceof Mesh ? [c] : meshes(c)); }
function setup() {
  vi.spyOn(DOMAdapter.get(), 'createCanvas').mockReturnValue({ getContext: () => null } as unknown as HTMLCanvasElement);
  const textures = Array.from({ length: 4 }, () => new Texture({ source: new TextureSource({ width: 64, height: 64 }) }));
  const part = (index: number): BakedPart => ({ texture: textures[index], anchorX: .5, anchorY: .5 });
  let generation = 0, glow = false, revision = 0;
  const art = { get: () => part(generation), glow: () => part(3), appearance: (_style: string, radius: number) => {
    const p = part(radius === 5 ? 1 : 2);
    return { body: p, detail: p, core: p, star: p, flame: p, trail: p,
      discs: Array.from({ length: 5 }, () => [p,p,p,p]) };
  } } as unknown as PlayerArt;
  const assets = { get revision() { return revision; }, requestFile: async () => {}, getFile: () => glow ? textures[3] : undefined } as unknown as GameAssets;
  const stream = new RenderStream(), prep = new PlayerBodyPreparation(), trail = new PlayerTrailPreparation();
  function populate(styles: readonly ('shot'|'coin'|'orb'|'tracer')[], radius = 5) {
    stream.reset(); styles.forEach((playerStyle, id) => stream.playerView({ id, x: 10 + id, y: 20, radius, angle: .4, age: 2,
      color: '#ff4d94', hostile: false, playerStyle, trail: [{x:0,y:20,alpha:1},{x:5,y:20,alpha:1}] }));
    return prep.prepare(stream);
  }
  return { art, assets, stream, prep, trail, populate, addGlow() { glow = true; revision++; }, restore() { generation = 3; },
    dispose() { for (const texture of textures) texture.destroy(true); } };
}
it('uploads one base per bullet and retains staging after both transferred arrays are detached', () => {
  const s = setup(), layer = new PlayerProjectiles(), packet = s.populate(['shot','coin','orb','tracer']);
  const trails = s.trail.prepare(s.stream);
  layer.sync([], s.art, s.assets, .25, s.stream, packet, trails);
  expect(layer.diagnostics.baseInstances).toBe(4); expect(layer.diagnostics.instances).toBe(17);
  expect(layer.diagnostics.bodyTemplates?.draws).toBe(4);
  const bodyMeshes = meshes(layer).filter(mesh => mesh.geometry.getAttribute('aBase0'));
  const buffers = bodyMeshes.map(mesh => mesh.geometry.getBuffer('aBase0'));
  const copied = buffers.map(buffer => Array.from(buffer.data));
  structuredClone({ body: packet.data, trail: trails.data }, { transfer: [packet.data.buffer as ArrayBuffer, trails.data.buffer as ArrayBuffer] });
  expect(packet.data.byteLength).toBe(0); expect(trails.data.byteLength).toBe(0);
  buffers.forEach((buffer, i) => expect(Array.from(buffer.data)).toEqual(copied[i]));
  const destroys = buffers.map(buffer => vi.spyOn(buffer, 'destroy'));
  layer.destroy(); destroys.forEach(destroy => expect(destroy).toHaveBeenCalledTimes(1)); s.dispose();
});
it('skips a fully transparent player layer and restores the latest instances when visible again', () => {
  const s = setup(), layer = new PlayerProjectiles();
  layer.sync([], s.art, s.assets, 0, s.stream, s.populate(['shot','orb']), s.trail.prepare(s.stream));
  expect(layer.visible).toBe(false); expect(layer.size).toBe(2);
  const next = s.populate(['coin']);
  layer.sync([], s.art, s.assets, 0, s.stream, next, s.trail.prepare(s.stream));
  layer.sync([], s.art, s.assets, .3, s.stream, next, s.trail.prepare(s.stream), false, false);
  expect(layer.visible).toBe(true); expect(layer.size).toBe(1);
  expect(layer.diagnostics.bodyTemplates?.draws).toBe(1);
  layer.destroy(); s.dispose();
});
it('shares leased instance staging between sharp and balanced light draws, without downsampling the core', () => {
  const s = setup(), layer = new PlayerProjectiles(); s.addGlow();
  const packet = s.populate(['shot','coin','orb','tracer']);
  layer.sync([], s.art, s.assets, 1, s.stream, packet, s.trail.prepare(s.stream));
  const bodyBuffers = new Set(meshes(layer).filter(m=>m.geometry.getAttribute('aBase0')).map(m=>m.geometry.getBuffer('aBase0')));
  layer.setSoftQuality('balanced'); layer.updateViewport({x:200,y:-100,zoom:2,width:1920,height:1080},2);
  const soft = layer.children.find(c=>c.label==='player-soft')!;
  expect(soft.filters).toHaveLength(1); expect(soft.filters?.[0].resolution).toBe(1);
  expect(soft.filters?.[0].blendMode).toBe('add');
  const softBodies=meshes(soft).filter(m=>m.geometry.getAttribute('aBase0'));
  expect(softBodies.length).toBeGreaterThan(0);
  for(const m of softBodies)expect(bodyBuffers.has(m.geometry.getBuffer('aBase0'))).toBe(true);
  const trailMeshes=meshes(layer).filter(m=>m.geometry.getAttribute('aI0'));
  expect(new Set(trailMeshes.map(m=>m.geometry.getBuffer('aI0'))).size*2).toBe(trailMeshes.length);
  expect(layer.diagnostics.meshes).toBe(meshes(layer).length);
  expect(meshes(layer).filter(m=>m.geometry.getAttribute('aBase0')&&!softBodies.includes(m)).every(m=>!m.parent?.filters?.length)).toBe(true);
  const uploads=[...bodyBuffers].map(b=>vi.spyOn(b,'setDataWithSize'));
  layer.sync([],s.art,s.assets,1,s.stream,packet,s.trail.prepare(s.stream));uploads.forEach(u=>expect(u).toHaveBeenCalledTimes(1));
  structuredClone(packet.data,{transfer:[packet.data.buffer as ArrayBuffer]});
  layer.setSoftQuality('native'); layer.updateViewport({x:0,y:0,zoom:1,width:1920,height:1080},2);
  expect(soft.visible).toBe(false); expect(layer.size).toBe(4);
  layer.setSoftQuality('balanced');layer.interpolate(.5);uploads.forEach(u=>expect(u).toHaveBeenCalledTimes(1));
  const destroys=[...bodyBuffers].map(b=>vi.spyOn(b,'destroy'));
  layer.destroy(); destroys.forEach(d=>expect(d).toHaveBeenCalledTimes(1));s.dispose();
});
it('retires detached soft halos across compact, compatibility, empty and compact packets',()=>{
  const s=setup(),layer=new PlayerProjectiles();s.addGlow();layer.setSoftQuality('balanced');
  const view={id:1,x:0,y:0,angle:0,radius:5,color:'#ff4d94',hostile:false,playerStyle:'shot' as const,trail:[]};
  const packet=s.populate(['shot']);layer.sync([],s.art,s.assets,1,s.stream,packet,s.trail.prepare(s.stream));
  const camera={x:0,y:0,zoom:1,width:1920,height:1080};layer.updateViewport(camera,2);
  const soft=layer.children.find(c=>c.label==='player-soft')!;expect(soft.visible).toBe(true);
  layer.sync([view],s.art,s.assets,1);layer.updateViewport(camera,2);expect(soft.visible).toBe(false);
  layer.setSoftQuality('native');layer.setSoftQuality('balanced');layer.updateViewport(camera,2);expect(soft.visible).toBe(false);
  layer.sync([],s.art,s.assets,1);layer.updateViewport(camera,2);expect(soft.visible).toBe(false);
  layer.sync([],s.art,s.assets,1,s.stream,packet,s.trail.prepare(s.stream));layer.updateViewport(camera,2);
  expect(soft.visible).toBe(true);layer.destroy();s.dispose();
});
it('hides historical pages/styles and counts material bytes separately, including a late halo', () => {
  const s = setup(), layer = new PlayerBodyTemplates();
  layer.accept(s.populate(['shot']), s.art, s.assets, 1);
  const old = meshes(layer).filter(mesh => mesh.visible); expect(old).toHaveLength(1);
  layer.accept(s.populate(['coin'], 7), s.art, s.assets, .3);
  expect(old.every(mesh => !mesh.visible && mesh.geometry.instanceCount === 0)).toBe(true);
  expect(layer.diagnostics.draws).toBe(1); expect(layer.diagnostics.bases).toBe(1);
  expect(layer.diagnostics.parts).toBe(4); expect(layer.diagnostics.materialUploadBytes).toBe(1280);
  expect(layer.diagnostics.uploadBytes).toBe(64 + 1280);
  s.addGlow(); layer.accept(s.prep.prepare(s.stream), s.art, s.assets, .3);
  expect(layer.diagnostics.parts).toBe(5); expect(layer.diagnostics.draws).toBe(2);
  layer.accept(s.populate([]), s.art, s.assets, 1);
  expect(layer.diagnostics.draws).toBe(0); expect(layer.diagnostics.uploadBytes).toBe(0);
  layer.destroy(); s.dispose();
});
it('recreates resource bindings on generation change and shares the shader program across owners', () => {
  const s = setup(), layer = new PlayerBodyTemplates(), other = new PlayerBodyTemplates();
  layer.accept(s.populate(['shot']), s.art, s.assets, 1);
  const old = meshes(layer)[0], program = old.shader!.glProgram;
  other.accept(s.prep.prepare(s.stream), s.art, s.assets, 1);
  expect(meshes(other)[0].shader!.glProgram).toBe(program);
  s.restore(); layer.accept(s.prep.prepare(s.stream), s.art, s.assets, 1);
  expect(old.destroyed).toBe(true); expect(meshes(layer)[0].shader!.glProgram).toBe(program);
  layer.destroy(); other.destroy(); s.dispose();
});

it('matches previous poses by stable identity across reorder, death and rebirth, including angle wrapping',()=>{
 const s=setup(),layer=new PlayerBodyTemplates(),base=s.populate(['shot','shot']);
 const packet={...base,groups:[base.data,new Float32Array(0),new Float32Array(0),new Float32Array(0)],ids:new Float64Array([1,2])};
 layer.accept(packet,s.art,s.assets,1,true);
 const data=packet.groups[0].slice();data[0]=100;data[2]=6.1;data[16]=20;data[18]=6.1;
 layer.accept({...packet,groups:[data,...packet.groups.slice(1)],ids:new Float64Array([2,1])},s.art,s.assets,1,true);
 const mesh=meshes(layer).find(mesh=>mesh.geometry.instanceCount===2)!;
 const previous=mesh.geometry.getBuffer('aPrevious').data;
 expect(previous[0]).toBe(11);expect(previous[4]).toBe(10);expect(previous[2]).toBeCloseTo(.4+Math.PI*2);
 const retained=Array.from(previous);s.addGlow();layer.accept({...packet,groups:[data,...packet.groups.slice(1)],ids:new Float64Array([2,1])},s.art,s.assets,.4,true,false);expect(Array.from(mesh.geometry.getBuffer('aPrevious').data)).toEqual(retained);
 layer.interpolate(.5);expect(mesh.shader?.resources.styleUniforms.uniforms.uInterpolation).toBe(.5);
 layer.accept({...packet,counts:[0,0,0,0]},s.art,s.assets,1,true);
 layer.accept({...packet,groups:[data,...packet.groups.slice(1)],ids:new Float64Array([2,1])},s.art,s.assets,1,true);
 expect(mesh.geometry.getBuffer('aPrevious').data[0]).toBe(100);
 layer.destroy();s.dispose();
});
it('moves GPU and exceptional trails with their interpolated body, including a same-packet opacity refresh',()=>{
 for(const exceptional of[false,true]){
  const s=setup(),layer=new PlayerProjectiles();
  function packet(x:number){
   s.stream.reset();s.stream.playerView({id:1,x,y:20,radius:5,angle:.4,age:2,color:'#ff4d94',hostile:false,playerStyle:'shot',trail:exceptional?[{x:x-30,y:20,alpha:1},{x:x+20,y:20,alpha:1},{x:x+10,y:20,alpha:1}]:[{x:x-10,y:20,alpha:1},{x:x-5,y:20,alpha:1}]});
   const prepared=s.prep.prepare(s.stream);return{...prepared,groups:[prepared.data.slice(),new Float32Array(0),new Float32Array(0),new Float32Array(0)],ids:new Float64Array([1])};
  }
  layer.sync([],s.art,s.assets,1,s.stream,packet(10),s.trail.prepare(s.stream),true);
  layer.interpolate(.5);const next=packet(20),trails=s.trail.prepare(s.stream);layer.sync([],s.art,s.assets,1,s.stream,next,trails,true);
  if(exceptional){const g=layer.children.find(c=>c instanceof Graphics)!;expect(g.position.x).toBe(15);}
  else{const mesh=meshes(layer).find(m=>m.geometry.getAttribute('aI0')&&m.visible)!;expect(mesh.geometry.getBuffer('aI0').data[5]).toBe(-10);expect(mesh.shader?.resources.opacity.uniforms.uInterpolation).toBe(.5);}
  layer.sync([],s.art,s.assets,.4,s.stream,next,trails,true,false);layer.interpolate(.75);
  if(exceptional)expect(layer.children.find(c=>c instanceof Graphics)!.position.x).toBe(17.5);
  else expect(meshes(layer).find(m=>m.geometry.getAttribute('aI0')&&m.visible)!.geometry.getBuffer('aI0').data[5]).toBe(-10);
  layer.destroy();s.dispose();
 }
});
