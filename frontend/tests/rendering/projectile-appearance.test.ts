import { afterEach, describe, expect, it, vi } from 'vitest';
import { Color, Container, Graphics, Sprite, Texture, TextureSource } from 'pixi.js';
import type { ProjectileView } from '../../src/game';
import { ProjectileDisplay, ProjectileTextures } from '../../src/rendering/battle-displays';
import { GameAssets } from '../../src/rendering/assets';
import type { PixiRenderer } from '../../src/rendering/create-renderer';

const view: ProjectileView = { id: 1, x: 3, y: 5, radius: 4, angle: .3, alpha: .8, hostile: true, color: '#ff4d94', shape: 'rice' };
function setup() {
  const textures = new ProjectileTextures({ generateTexture: () => new Texture({ source: new TextureSource({ width: 32, height: 32 }) }) } as unknown as PixiRenderer);
  const display = new ProjectileDisplay(false), assets = new GameAssets();
  const [halo, body, core] = display.children as Sprite[];
  const hit = display.children[3] as Graphics;
  return { display, textures, assets, halo, body, core, hit, dispose() { display.destroy(); textures.dispose(); assets.dispose(); } };
}
afterEach(() => vi.restoreAllMocks());

describe('projectile appearance lifetime', () => {
  it('moves and fades every frame without invoking Pixi tint/color parsing again', () => {
    const s = setup(); s.display.sync(view, s.textures, s.assets);
    const tint = vi.spyOn(Container.prototype, 'tint', 'set');
    const color = vi.spyOn(Color.shared, 'setValue');
    for (let i = 0; i < 120; i++) s.display.sync({ ...view, x: i, y: -i, angle: i / 10, alpha: i / 120 }, s.textures, s.assets);
    expect(tint.mock.calls.length).toBe(0); expect(color.mock.calls.length).toBe(0);
    expect(s.display.position).toMatchObject({ x: 119, y: -119 }); expect(s.display.rotation).toBe(11.9); expect(s.display.alpha).toBe(119 / 120);
    s.dispose();
  });
  it('refreshes colors, every shape/dimension/anchor, hostile halo and hit geometry without changing identities', () => {
    const s = setup(); s.display.sync(view, s.textures, s.assets); const children = [...s.display.children];
    s.display.sync({ ...view, color: 'cyan' }, s.textures, s.assets); expect(s.body.tint).toBe(0x9cffff); expect(s.halo.tint).toBe(0x9cffff);
    s.display.sync({ ...view, shape: 'laser', length: 300, width: 9, anchor: 'head', hostile: false }, s.textures, s.assets);
    expect(s.body.width).toBeCloseTo(300); expect(s.body.height).toBeCloseTo(9); expect(s.halo.visible).toBe(false);
    for (const sprite of [s.halo, s.body, s.core]) expect(sprite.anchor.x).toBe(1);
    s.display.sync({ ...view, radius: 9, length: 80, width: 5, anchor: 'center' }, s.textures, s.assets);
    expect(s.body.width).toBeCloseTo(80); expect(s.body.height).toBeCloseTo(5); expect(s.body.anchor.x).toBe(.5); expect(s.halo.visible).toBe(true);
    s.display.sync({ ...view, shape: 'circle', radius: 9 }, s.textures, s.assets); expect(s.body.width).toBeCloseTo(18); expect(s.body.height).toBeCloseTo(18);
    s.display.sync({ ...view, shape: 'ring' }, s.textures, s.assets); expect(s.core.visible).toBe(false);
    s.display.sync({ ...view, shape: 'jade', hitRadius: 6 }, s.textures, s.assets); expect(s.core.visible).toBe(true); expect(s.core.tint).toBe(0x8d6a1b);
    const before = s.hit.getLocalBounds().width;
    s.display.sync({ ...view, shape: 'jade', hitRadius: 13 }, s.textures, s.assets); expect(s.hit.getLocalBounds().width).toBeGreaterThan(before);
    s.display.sync({ ...view, shape: 'jade' }, s.textures, s.assets); expect(s.hit.context.instructions).toHaveLength(0);
    expect(s.display.children).toEqual(children); s.dispose();
  });
  it('invalidates each independent appearance field while retaining the same projectile identity', () => {
    const s = setup();
    const changes: [Partial<ProjectileView>, (state: ReturnType<typeof setup>) => void][] = [
      [{ radius: 8 }, state => expect(state.body.width).toBeCloseTo(25.6)],
      [{ length: 83 }, state => expect(state.body.width).toBeCloseTo(83)],
      [{ width: 11 }, state => expect(state.body.height).toBeCloseTo(11)],
      [{ anchor: 'head' }, state => expect(state.body.anchor.x).toBe(1)],
      [{ hostile: false }, state => expect(state.halo.visible).toBe(false)],
      [{ color: 'gold' }, state => expect(state.body.tint).toBe(0xffe05a)],
      [{ shape: 'jade' }, state => expect(state.core.tint).toBe(0x8d6a1b)],
    ];
    for (const [change, check] of changes) { s.display.sync(view, s.textures, s.assets); s.display.sync({ ...view, ...change }, s.textures, s.assets); check(s); }
    s.dispose();
  });
  it('shares the white-circle texture while preserving jade-specific hit geometry and core tint', () => {
    const s = setup(), jade: ProjectileView = { ...view, shape: 'jade', hitRadius: 6 };
    const before = JSON.stringify(jade); s.display.sync(jade, s.textures, s.assets);
    const shared = s.body.texture;
    expect(s.hit.context.instructions.length).toBeGreaterThan(0); expect(s.core.tint).toBe(0x8d6a1b);
    s.display.sync({ ...view, shape: 'orb' }, s.textures, s.assets);
    expect(s.body.texture).toBe(shared); expect(s.hit.context.instructions).toHaveLength(0); expect(s.core.tint).toBe(0xffffff);
    s.display.sync(jade, s.textures, s.assets);
    expect(s.body.texture).toBe(shared); expect(s.hit.context.instructions.length).toBeGreaterThan(0);
    expect(s.core.tint).toBe(0x8d6a1b); expect(JSON.stringify(jade)).toBe(before);
    s.dispose();
  });
  it('rebinds regenerated textures after context loss even when all appearance fields stay equal', () => {
    const s = setup(); s.display.sync(view, s.textures, s.assets); const body = s.body.texture, halo = s.halo.texture;
    s.textures.dispose(); s.display.sync(view, s.textures, s.assets);
    expect(s.body.texture).not.toBe(body); expect(s.halo.texture).not.toBe(halo); expect(s.core.texture).toBe(s.body.texture);
    expect(s.body.texture.destroyed).toBe(false); expect(s.body.width).toBeCloseTo(view.radius * 3.2); expect(s.body.height).toBeCloseTo(view.radius * 1.3);
    expect(s.body.tint).toBe(0xff4d94); s.dispose();
  });
});
