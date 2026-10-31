import { describe, expect, it, vi } from 'vitest';
import { Texture, TextureSource } from 'pixi.js';
import { ProjectileTextures } from '../../src/rendering/battle-displays';
import type { PixiRenderer } from '../../src/rendering/create-renderer';
describe('GPU-generated content after context restoration', () => {
  it('invalidates dead render-target content and regenerates every requested silhouette lazily', () => {
    const generateTexture = vi.fn(() => new Texture({ source: new TextureSource({ width: 32, height: 32 }) }));
    const textures = new ProjectileTextures({ generateTexture } as unknown as PixiRenderer);
    const first = textures.get('rice'), halo = textures.get('halo');
    expect(textures.get('rice')).toBe(first); expect(generateTexture).toHaveBeenCalledTimes(2);
    expect(textures.statistics).toEqual({ cached: 2, generated: 2, released: 0 });
    textures.dispose(); expect(first.destroyed).toBe(true); expect(halo.destroyed).toBe(true);
    const restored = textures.get('rice');
    expect(restored).not.toBe(first); expect(restored.destroyed).toBe(false); expect(generateTexture).toHaveBeenCalledTimes(3);
    expect(textures.statistics).toEqual({ cached: 1, generated: 3, released: 2 });
    textures.dispose(); expect(restored.destroyed).toBe(true);
  });
});

it('owns one texture per real silhouette across aliases, disposes it once, and restores a new shared identity', () => {
  const generateTexture = vi.fn(() => new Texture({ source: new TextureSource({ width: 32, height: 32 }) }));
  const textures = new ProjectileTextures({ generateTexture } as unknown as PixiRenderer);
  const circle = textures.get('circle');
  for (const alias of [undefined, 'orb', 'jade', 'bead'] as const) expect(textures.get(alias)).toBe(circle);
  expect(generateTexture).toHaveBeenCalledTimes(1);
  const needle = textures.get('needle'); expect(textures.get('shard')).toBe(needle); expect(needle).not.toBe(circle);
  const halo = textures.get('halo'); expect(halo).not.toBe(circle);
  expect(generateTexture).toHaveBeenCalledTimes(3);
  const circleDestroy = vi.spyOn(circle, 'destroy'), needleDestroy = vi.spyOn(needle, 'destroy'), haloDestroy = vi.spyOn(halo, 'destroy');
  textures.dispose(); textures.dispose();
  for (const destroy of [circleDestroy, needleDestroy, haloDestroy]) { expect(destroy).toHaveBeenCalledTimes(1); expect(destroy).toHaveBeenCalledWith(true); }
  expect(textures.statistics).toEqual({ cached: 0, generated: 3, released: 3 });
  const restored = textures.get('jade'); expect(restored).not.toBe(circle); expect(restored.destroyed).toBe(false);
  for (const alias of [undefined, 'circle', 'orb', 'bead'] as const) expect(textures.get(alias)).toBe(restored);
  expect(generateTexture).toHaveBeenCalledTimes(4); expect(textures.statistics.cached).toBe(1);
  const restoredNeedle = textures.get('shard'); expect(restoredNeedle).not.toBe(needle); expect(textures.get('needle')).toBe(restoredNeedle);
  expect(generateTexture).toHaveBeenCalledTimes(5); textures.dispose();
});
