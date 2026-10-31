import { afterEach, expect, it, vi } from 'vitest';
import { Container, DOMAdapter, Mesh, Text, Texture, TextureSource } from 'pixi.js';
import type { EffectView, ProjectileView } from '../../src/game';
import { GameFrameBuffer } from '../../src/game';
import { SessionEngine } from '../../src/game/session-engine';
import { ProjectileTextures } from '../../src/rendering/battle-displays';
import { InstanceMesh, InstanceRuns } from '../../src/rendering/instance-mesh';
import { EnemyProjectiles, OrderedTransients, PickupBatch } from '../../src/rendering/transient-batches';
import { EffectBatch } from '../../src/rendering/effects/effect-batch';
import type { PixiRenderer } from '../../src/rendering/create-renderer';
import type { GameAssets } from '../../src/rendering/assets';
const meshes = (c: Container): Mesh[] => c.children.flatMap(v => v instanceof Mesh ? [v] : meshes(v));
afterEach(() => vi.restoreAllMocks());
function setup() {
  vi.spyOn(DOMAdapter.get(), 'createCanvas').mockReturnValue({ getContext: () => null } as unknown as HTMLCanvasElement);
  const generated = new Texture({ source: new TextureSource({ width: 32, height: 32 }) });
  const textures = new ProjectileTextures({ render() {}, generateTexture: () => new Texture({ source: new TextureSource({ width: 32, height: 32 }) }) } as unknown as PixiRenderer);
  const assets = { request: async () => {}, get: () => generated } as unknown as GameAssets;
  return { textures, assets, dispose() { textures.dispose(); generated.destroy(true); } };
}
it('retains insertion order across swaps, removes dead IDs and rejects duplicate identities', () => {
  const order = new OrderedTransients<ProjectileView>();
  order.sync([1, 2, 3], 3, []); order.sync([3, 1], 2, []);
  expect([...order.entries]).toEqual([[1, 1], [3, 0]]);
  order.sync([3, 4, 1], 3, []); expect([...order.entries.keys()]).toEqual([1, 3, 4]);
  expect(() => order.sync([1, 1], 2, [])).toThrow('Duplicate'); order.clear(); expect(order.entries.size).toBe(0);
});
it('uses real GL2/GLSL3 instance attributes and stable index/material buffers after warm-up', () => {
  const s = setup(), part = s.textures.player.get('shot', 6, '#fff'), run = new InstanceRuns();
  for (let frame = 0; frame < 5; frame++) {
    run.begin(); for (let i = 0; i < 800 - frame; i++) run.quad(part, i % 2 ? 'add' : 'normal', i, 4, frame, 1, 1, .35); run.finish();
  }
  const m = meshes(run)[0] as InstanceMesh, data = m.geometry.getBuffer('aInstance0').data;
  expect(m.geometry.instanceCount).toBe(796); expect(m.geometry.positions).toHaveLength(8); expect(m.geometry.indices).toHaveLength(6);
  expect(m.geometry.getAttribute('aInstance0').instance).toBe(true); expect(m.shader!.glProgram!.fragment!.startsWith('#version 300 es')).toBe(true);
  const materials = m.shader!.resources.uMaterials.resource;
  run.begin(); for (let i = 0; i < 798; i++) run.quad(part, 'normal', i, 0); run.finish();
  expect(m.geometry.getBuffer('aInstance0').data).toBe(data); expect(m.shader!.resources.uMaterials.resource).toBe(materials);
  expect(m.blendMode).toBe('normal'); expect(Number(data[3])).toBe(1);
  run.begin(); run.finish(); expect(run.diagnostics.instances).toBe(0); run.destroy(); s.dispose();
});
it('keeps hostile halo/body/core order in one mesh and handles empty, jade, head anchors and restoration', () => {
  const s = setup(), batch = new EnemyProjectiles(), base: ProjectileView = { id: 1, x: 4, y: 5, radius: 7, color: '#ff4d94', angle: 0, alpha: .4, shape: 'jade', hitRadius: 3, anchor: 'head', hostile: true };
  batch.sync([base], undefined, s.textures, false);
  expect(batch.size).toBe(1); expect(batch.diagnostics).toMatchObject({ meshes: 1, instances: 4 });
  const first = meshes(batch)[0], data = first.geometry.getBuffer('aInstance0').data;
  expect(Number(data[3])).toBeCloseTo(-.4 * .14); expect(Number(data[11])).toBeCloseTo(.4); expect(Number(data[19])).toBeCloseTo(.36);
  expect(Number(data[0])).toBeCloseTo(4 - 14 * 2.6 / 2); expect(Number(data[8])).toBeCloseTo(4 - 7);
  s.textures.dispose(); batch.sync([base], undefined, s.textures, false); expect(first.destroyed).toBe(true);
  batch.sync([], undefined, s.textures, false); expect(batch.size).toBe(0); expect(batch.diagnostics.instances).toBe(0); batch.destroy(); s.dispose();
});
it('consumes compact native entities without constructing per-entity displays', () => {
  const s = setup(), engine = new SessionEngine({});
  engine.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'nightmare', partySize: 1, seed: 69, pilot: true } });
  const world = engine.battle!.world;
  for (let i = 0; i < 400; i++) world.spawnEnemyBullet({ x: i, y: 0, angle: 0, speed: 10, damage: 1, radius: 4 });
  const frame = engine.readFrame(new GameFrameBuffer({ packed: true })), batch = new EnemyProjectiles(), drops = new PickupBatch();
  batch.sync(frame.projectiles, frame.transients, s.textures, false); drops.sync(frame.pickups, frame.transients, s.textures, s.assets);
  expect(batch.size).toBe(400); expect(meshes(batch)).toHaveLength(1); expect(batch.diagnostics.instances).toBe(1200);
  batch.destroy(); drops.destroy(); s.dispose();
});
it('batches high-frequency FX without accumulating material descriptors and keeps text/curves in order', () => {
  const s = setup(), layer = new EffectBatch();
  const base: EffectView = { id: 1, kind: 'hit', x: 3, y: 5, radius: 15, color: '#f00', alpha: .6, progress: .3, playerOwned: true };
  const views = [base, { ...base, id: 2, kind: 'shard' as const }];
  layer.sync(views, 1, s.textures.player, .4);
  expect(layer.diagnostics).toMatchObject({ effects: 2, primitives: 8, fallback: 0, meshes: 1 });
  const material = meshes(layer)[0].geometry.getBuffer('aFx0').data;
  for (let i = 0; i < 120; i++) layer.sync(views.map(v => ({ ...v, progress: i / 120 })), i, s.textures.player, .4);
  expect(meshes(layer)[0].geometry.getBuffer('aFx0').data).toBe(material);
  const complex = { ...base, id: 3, kind: 'slash' as const }, text = { ...base, id: 4, kind: 'text' as const, text: '42' };
  layer.sync([], 2, s.textures.player, 1);
  layer.sync([base, complex, views[1], text], 2, s.textures.player, .4);
  expect(layer.diagnostics).toMatchObject({ effects: 4, fallback: 2 });
  expect(layer.children).toHaveLength(4); expect(layer.children[3].children.some(c => c instanceof Text)).toBe(true);
  layer.sync([], 3, s.textures.player, 1); expect(layer.children).toHaveLength(0); layer.destroy(); s.dispose();
});
it('keeps logical FX identities while skipping invisible draws and restores reused fallbacks', () => {
  const s=setup(),layer=new EffectBatch();
  const base:EffectView={id:1,kind:'hit',x:0,y:0,radius:10,color:'#f00',alpha:1,progress:.2,playerOwned:true};
  const views=[base,{...base,id:2,playerOwned:false},{...base,id:3,kind:'slash' as const}];
  layer.sync(views,0,s.textures.player,1);layer.sync(views,0,s.textures.player,0);
  expect(layer.size).toBe(3);expect(layer.diagnostics.primitives).toBe(7);
  expect(layer.children.filter(c=>c.visible)).toHaveLength(1);
  layer.sync(views,0,s.textures.player,1);expect(layer.diagnostics.primitives).toBe(14);
  expect(layer.children.filter(c=>c.visible)).toHaveLength(2);
  layer.destroy();s.dispose();
});
it('keeps friendly projectile identities while omitting zero-contribution GPU parts',()=>{
  const s=setup(),layer=new EnemyProjectiles();
  const v:ProjectileView={id:1,x:0,y:0,angle:0,radius:5,color:'#f00',shape:'orb',alpha:1,hostile:true};
  layer.sync([v,{...v,id:2,hostile:false}],undefined,s.textures,false,0);
  expect(layer.size).toBe(2);expect(layer.diagnostics.instances).toBe(3);
  layer.sync([v,{...v,id:2,hostile:false}],undefined,s.textures,false,1);
  expect(layer.diagnostics.instances).toBe(5);layer.destroy();s.dispose();
});
it('packs original-size pickup images in one native-resolution atlas without one mesh per drop', () => {
  const s = setup(), layer = new PickupBatch();
  const images = Object.fromEntries([['xp',563,529],['coin_1',999,987],['coin_2',1041,708],['heal',64,64]].map(([id,width,height]) => [id,new Texture({ source:new TextureSource({width:Number(width),height:Number(height)}) })]));
  const assets = { request:async()=>{},get:(_kind:string,id:string)=>images[id] } as unknown as GameAssets;
  // Other projectile silhouettes occupy the atlas first, as in real rendering.
  const silhouettes = Array.from({ length: 16 }, (_, i) => new Texture({ source: new TextureSource({ width: 32 + i, height: 36, resolution: 2 }) }));
  for (const source of silhouettes) { const part = s.textures.player.image(source); expect(part.texture.width * part.scale!).toBeCloseTo(source.width + 2 / source.source.resolution); expect(part.texture.height * part.scale!).toBeCloseTo(source.height + 2 / source.source.resolution); }
  const views = Array.from({length:600},(_,i)=>({id:i,x:i,y:0,kind:(['xp','material','heal'] as const)[i%3],variant:(i%2?1:2) as 1|2,bobPhase:i}));
  layer.sync(views,undefined,s.textures,s.assets); // Existing mock assets are the small-image path.
  layer.sync(views,undefined,s.textures,assets);
  expect(layer.size).toBe(600);expect(layer.diagnostics.meshes).toBe(1);expect(layer.diagnostics.instances).toBe(600);
  const atlas = meshes(layer)[0].texture.source;expect(atlas.resolution).toBe(1);expect(atlas.autoGarbageCollect).toBe(false);expect(atlas.pixelWidth).toBe(2048);expect(atlas.pixelHeight).toBe(2048);
  for(const source of Object.values(images)){const p=s.textures.player.image(source);expect(p.texture.source).toBe(atlas);expect(p.scale).toBe(1);}
  layer.destroy();s.dispose();for(const source of [...Object.values(images), ...silhouettes])source.destroy(true);
});
