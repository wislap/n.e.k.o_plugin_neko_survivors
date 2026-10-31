import { DESKTOP_PRESENTATION } from '../../src/presentation/profile';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Filter, FilterSystem, RendererType, TexturePoolClass, WebGLRenderer, ViewSystem, TexturePool, Texture, CanvasSource, Rectangle } from 'pixi.js';
import { GameRenderer } from '../../src/rendering/game-renderer';
import { releaseRendererFilterBindings } from '../../src/rendering/filter-bindings';

afterEach(() => vi.restoreAllMocks());

function filteredScreen() {
  // Real Pixi CPU-side ownership; only the driver draw boundary is omitted.
  const renderer = { type: RendererType.WEBGL, renderPipes: {}, encoder: { draw: vi.fn() }, renderTarget: { finishRenderPass: vi.fn() } };
  const system = new FilterSystem(renderer as unknown as WebGLRenderer);
  const filter = new Filter({});
  // This pool is local to the test: do not clear another renderer's global cache.
  const pool = new TexturePoolClass();
  pool.setScreenSize(73, 913, 517);
  const input = pool.getOptimalTexture({ width: 913, height: 517 });
  Reflect.get(system, '_setupBindGroupsAndRender').call(system, filter, input, renderer);
  expect(renderer.encoder.draw).toHaveBeenCalledTimes(1);
  expect(filter.groups[0].getResource(1)).toBe(input.source);
  expect(filter.groups[0].getResource(2)).toBe(input.source.style);
  pool.returnTexture(input);
  return { system, filter, pool, input };
}

describe('native Pixi filter binding ownership at renderer disposal', () => {
  it('releases renderer-local input bindings before screen-sized render targets are pruned', () => {
    const s = filteredScreen();
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Existing GameRenderer cleanup destroys the atmosphere, then native systems.
      // Native ViewSystem.destroy removes its screen, pruning these idle textures.
      releaseRendererFilterBindings({ filter: s.system });
      releaseRendererFilterBindings({ filter: s.system });
      s.filter.destroy(); s.system.destroy(); s.pool.removeScreen(73);
      expect(s.input.destroyed).toBe(true);
      const messages = warnings.mock.calls.flat().map(String).filter(message => message.includes('[BindGroup]'));
      expect(messages).toEqual([]);
    } finally { releaseRendererFilterBindings({ filter: s.system }); s.filter.destroy(); s.pool.clear(); }
  });
  it('does not warn for an unused filter system without a rendered input', () => {
    const system = new FilterSystem({} as WebGLRenderer), pool = new TexturePoolClass();
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pool.setScreenSize(74, 913, 517); const input = pool.getOptimalTexture({ width: 913, height: 517 }); pool.returnTexture(input);
    system.destroy(); pool.removeScreen(74);
    expect(input.destroyed).toBe(true);
    expect(warnings.mock.calls.flat().map(String).some(message => message.includes('[BindGroup]'))).toBe(false);
    Reflect.get(system, '_globalFilterBindGroup').destroy(); pool.clear();
  });
});


it('actual GameRenderer.dispose detaches its native filter bindings and preserves another screen resource', () => {
  // Boot only real CPU-side systems. No adapter/context/render success is claimed.
  const native = new WebGLRenderer<HTMLCanvasElement>();
  Reflect.get(native, '_addSystem').call(native, ViewSystem, 'view');
  Reflect.get(native, '_addSystem').call(native, FilterSystem, 'filter');
  const canvas = Object.assign(new EventTarget(), { parentNode: null, width: 913, height: 517, remove: vi.fn() }) as unknown as HTMLCanvasElement;
  native.view.screen = new Rectangle(0, 0, 913, 517); native.view.canvas = canvas;
  native.view.texture = new Texture({ source: new CanvasSource({ resource: canvas, width: 913, height: 517 }) });
  Reflect.set(native, 'encoder', { draw: vi.fn() }); Reflect.set(native, 'renderTarget', { finishRenderPass: vi.fn() });
  const game = new GameRenderer({ renderer: native, canvas }, { presentation: DESKTOP_PRESENTATION, container: { appendChild() {} } as unknown as HTMLElement });
  const filter = new Filter({});
  TexturePool.setScreenSize(native.uid, 913, 517);
  const input = TexturePool.getOptimalTexture({ width: 913, height: 517 });
  Reflect.get(native.filter, '_setupBindGroupsAndRender').call(native.filter, filter, input, native);
  TexturePool.returnTexture(input);
  const otherPool = new TexturePoolClass(); otherPool.setScreenSize(999_113, 701, 401);
  const otherInput = otherPool.getOptimalTexture({ width: 701, height: 401 });
  const otherNative = { type: RendererType.WEBGL, renderPipes: {}, encoder: { draw() {} }, renderTarget: { finishRenderPass() {} } };
  const otherSystem = new FilterSystem(otherNative as unknown as WebGLRenderer), otherFilter = new Filter({});
  Reflect.get(otherSystem, '_setupBindGroupsAndRender').call(otherSystem, otherFilter, otherInput, otherNative);
  const otherGroup = otherFilter.groups[0]; otherPool.returnTexture(otherInput);
  // An idle texture in the actual global pool must survive this renderer's teardown.
  const sharedIdle = TexturePool.getOptimalTexture({ width: 32, height: 32 }); TexturePool.returnTexture(sharedIdle);
  const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    game.dispose(); game.dispose();
    expect(input.destroyed).toBe(true); expect(sharedIdle.destroyed).toBe(false);
    expect(otherInput.destroyed).toBe(false); expect(otherGroup.getResource(1)).toBe(otherInput.source);
    expect(warnings.mock.calls.flat().map(String).filter(message => message.includes('[BindGroup]'))).toEqual([]);
  } finally {
    releaseRendererFilterBindings(native); filter.destroy(); otherGroup.destroy(); otherFilter.destroy(); otherSystem.destroy(); otherPool.clear();
    if (!input.destroyed) input.destroy(true);
  }
});
