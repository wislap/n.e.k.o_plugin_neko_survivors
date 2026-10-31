import { afterEach, expect, it, vi } from 'vitest';
import { Container, DOMAdapter, Graphics, Mesh, Texture, TextureSource } from 'pixi.js';
import { PlayerProjectiles } from '../../src/rendering/player-projectiles';
import { PlayerArt } from '../../src/rendering/player-art';
import type { PixiRenderer } from '../../src/rendering/create-renderer';
import type { GameAssets } from '../../src/rendering/assets';
import { RenderStream, type ProjectileView } from '../../src/game';

afterEach(() => vi.restoreAllMocks());
function meshes(root: Container): Mesh[] { return root.children.flatMap(c => c instanceof Mesh ? [c] : meshes(c)); }

const base: ProjectileView = { id: 1, x: 20, y: 30, angle: .4, radius: 5, color: '#ff4d94', hostile: false,
  playerStyle: 'shot', age: 1, trail: [{ x: -10, y: 29, alpha: .7 }, { x: 0, y: 30, alpha: 1 }, { x: 10, y: 30, alpha: 1 }] };
function setup() {
  vi.spyOn(DOMAdapter.get(), 'createCanvas').mockReturnValue({ getContext: () => null } as unknown as HTMLCanvasElement);
  const render = vi.fn(), art = new PlayerArt({ render } as unknown as PixiRenderer), layer = new PlayerProjectiles();
  const glow = new Texture({ source: new TextureSource({ width: 64, height: 64 }) });
  const assets = { requestFile: async () => {}, getFile: () => glow } as unknown as GameAssets;
  return { art, layer, render, assets, dispose() { layer.destroy(); art.dispose(); glow.destroy(true); } };
}
it('renders thousands of all four styles with fixed templates, compact instance buffers and no per-bullet nodes', () => {
  const s = setup(), styles = ['shot', 'coin', 'orb', 'tracer'] as const;
  const views = Array.from({ length: 2000 }, (_, id) => ({ ...base, id, playerStyle: styles[id % 4] }));
  s.layer.sync(views, s.art, s.assets, .4);
  expect(s.layer.size).toBe(2000); expect(meshes(s.layer).length).toBeLessThan(10);
  expect(s.layer.diagnostics.gpuTrails).toBe(1000);
  expect(s.layer.diagnostics.uploadBytes).toBeLessThan(1000000);
  const mesh = s.layer.children.find(c => c instanceof Mesh) as Mesh;
  expect(mesh).toBeInstanceOf(Mesh); expect(mesh.blendMode).toBe('add');
  const buffers = mesh.geometry.buffers;
  expect(buffers.every(b => Array.from(b.data).every(Number.isFinite))).toBe(true);
  const firstBakes = s.render.mock.calls.length;
  const oldPositions = Array.from(mesh.geometry.getBuffer('aInstance0').data);
  const staticPositions = mesh.geometry.getBuffer('aPosition').data;
  const staticIndices = mesh.geometry.indexBuffer.data;
  const active = mesh.geometry.instanceCount;
  const arrays = mesh.geometry.buffers.map(b => b.data);

  s.layer.sync(views.slice(0, 1996), s.art, s.assets, .4);
  s.layer.sync(views.slice(0, 1998), s.art, s.assets, .4);
  expect(mesh.geometry.buffers.map(b => b.data).every((data, i) => data === arrays[i])).toBe(true);
  expect(mesh.geometry.instanceCount).toBeGreaterThan(0); expect(mesh.geometry.instanceCount).toBeLessThan(active);
  s.layer.sync(views.map(v => ({ ...v, x: 50, angle: 1.2, age: 3 })), s.art, s.assets, .4);
  expect(s.render).toHaveBeenCalledTimes(firstBakes);
  expect(Array.from(mesh.geometry.getBuffer('aInstance0').data)).not.toEqual(oldPositions);
  expect(mesh.geometry.getBuffer('aPosition').data).toBe(staticPositions); expect(mesh.geometry.indexBuffer.data).toBe(staticIndices);
  expect(mesh.shader!.glProgram!.vertex).toContain('#version 300 es');
  s.layer.sync([], s.art, s.assets, 1); expect(mesh.visible).toBe(false); expect(s.layer.size).toBe(0);
  s.dispose();
});
it('keeps acute reverse trails on reference graphics and removes them when the path disappears', () => {
  const s = setup();
  s.layer.sync([{ ...base, x: 0, y: 0, trail: [{ x: -30, y: 0, alpha: 1 }, { x: 20, y: 0, alpha: 1 }, { x: 10, y: 0, alpha: 1 }] }], s.art, s.assets, .3);
  const fallback = s.layer.children.find(c => c instanceof Graphics) as Graphics;
  expect(fallback).toBeDefined(); expect(fallback.alpha).toBe(.3); expect(fallback.context.instructions.length).toBeGreaterThan(0);
  s.layer.sync([base], s.art, s.assets, 1); expect(fallback.destroyed).toBe(true);
  expect(s.layer.children.some(c => c instanceof Graphics)).toBe(false); s.dispose();
});
it('rebuilds atlas bindings after restoration and releases page textures once', () => {
  const s = setup(); s.layer.sync([base], s.art, s.assets, 1);
  const first = s.layer.children.find(c => c instanceof Mesh) as Mesh, source = first.texture.source;
  const destroy = vi.spyOn(source, 'destroy');
  s.art.dispose(); expect(destroy).toHaveBeenCalledTimes(1);
  s.layer.sync([base], s.art, s.assets, 1);
  expect(first.destroyed).toBe(true); expect((s.layer.children.find(c => c instanceof Mesh) as Mesh).texture.source).not.toBe(source);
  const before = s.render.mock.calls.length;
  s.layer.sync([{ ...base, radius: 9, color: '#5fd3e8' }], s.art, s.assets, 1);
  expect(s.render.mock.calls.length).toBeGreaterThan(before); s.dispose();
});
it('keeps glow dimensions and empty/duplicate histories finite without creating empty atlases', () => {
  const s = setup(); s.layer.sync([], s.art, s.assets, 1);
  expect(s.render).not.toHaveBeenCalled(); expect(meshes(s.layer)).toHaveLength(0);
  const source = new Texture({ source: new TextureSource({ width: 128, height: 128 }) });
  const halo = s.art.glow('#ff4d94', source);
  expect(halo.texture.width).toBe(66); expect(halo.texture.height).toBe(66);
  s.layer.sync([{ ...base, trail: [] }, { ...base, id: 2, trail: Array.from({ length: 6 }, () => ({ x: 20, y: 30, alpha: 1 })) }], s.art, s.assets, .35);
  for (const child of meshes(s.layer)) {
    expect(Array.from(child.geometry.getBuffer('aPosition').data).every(Number.isFinite)).toBe(true);
    const data = child.geometry.getBuffer('aInstance0')?.data;
    if (data) expect(Array.from(data).filter((_, i) => i % 8 === 3).every(a => Number(a) >= 0 && Number(a) <= .35 + 1e-6)).toBe(true);
  }
  source.destroy(true); s.dispose();
});
it('shares straight-trail vertices while preserving all six control points and both layers/caps', () => {
  const s = setup();
  s.layer.sync([{ ...base, x: 60, y: 0, trail: Array.from({ length: 6 }, (_, i) => ({ x: i * 10, y: 0, alpha: .8 })) }], s.art, s.assets, 1);
  const trail = meshes(s.layer).find(m => m.geometry.getAttribute('aI0'))!;
  expect(trail.geometry.positions).toHaveLength(44 * 2);
  const input = trail.geometry.getBuffer('aI0').data;
  expect(input[9]).toBe(7); expect(Array.from(input.slice(12, 26))).toEqual([-60,0,-50,0,-40,0,-30,0,-20,0,-10,0,0,0]);
  expect(s.layer.diagnostics.gpuTrails).toBe(1); s.dispose();
});
it('retains page-before-fallback composition order after atlas/device recreation', () => {
  const s = setup(), acute = { ...base, x: 0, y: 0, trail: [{ x: -30, y: 0, alpha: 1 }, { x: 20, y: 0, alpha: 1 }, { x: 10, y: 0, alpha: 1 }] };
  s.layer.sync([acute], s.art, s.assets, .35);
  const fallback = s.layer.children.find(c => c instanceof Graphics)!;
  s.art.dispose(); s.layer.sync([acute], s.art, s.assets, .35);
  const page = s.layer.children.find(c => c instanceof Mesh)!;
  expect(s.layer.getChildIndex(page)).toBeLessThan(s.layer.getChildIndex(fallback)); s.dispose();
});
it('compiles shared appearance once instead of repeating per-bullet resource lookup', () => {
  const s = setup(), appearance = vi.spyOn(s.art, 'appearance');
  const views = Array.from({ length: 300 }, (_, id) => ({ ...base, id }));
  s.layer.sync(views, s.art, s.assets, 1); s.layer.sync(views, s.art, s.assets, .4);
  expect(appearance).toHaveBeenCalledTimes(1); s.dispose();
});

it('resolves each borrowed palette independently and refreshes a late glow', () => {
  const s = setup(), first = new RenderStream(), other = new RenderStream();
  const blue = { ...base, color: '#5fd3e8' }, red = { ...base, id: 2 };
  first.playerView(blue); first.playerView(red);
  other.playerView(red); other.reset(); other.playerView(blue); other.playerView(red);
  let available = false;
  const getFile = s.assets.getFile.bind(s.assets);
  s.assets.getFile = () => available ? getFile('glow') : undefined;
  s.layer.sync([], s.art, s.assets, 1, first);
  const page = s.layer.children.find(c => c instanceof Mesh) as Mesh;
  const before = Array.from(page.geometry.getBuffer('aInstance0').data.slice(0, page.geometry.instanceCount * 8));
  s.layer.sync([], s.art, s.assets, 1, other);
  expect(Array.from(page.geometry.getBuffer('aInstance0').data.slice(0, page.geometry.instanceCount * 8))).toEqual(before);
  const count = s.layer.diagnostics.instances;
  available = true; s.layer.sync([], s.art, s.assets, 1, other);
  expect(s.layer.diagnostics.instances).toBe(count + 2); s.dispose();
});
