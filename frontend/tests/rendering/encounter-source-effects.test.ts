import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Sprite, Texture, TextureSource } from 'pixi.js';
import type { CometView, EffectView, EncounterView, WeatherView } from '../../src/game';
import type { GameAssets } from '../../src/rendering/assets';
import { drawEncounterEffect } from '../../src/rendering/effects/encounter-shapes';
import { EffectDisplay } from '../../src/rendering/effects/effect-display';
import { RemiliaDisplay } from '../../src/rendering/encounters/remilia-display';
import { CometDisplay } from '../../src/rendering/comet-display';
import { WeatherDisplay } from '../../src/rendering/weather-display';

const camera = { x: 0, y: 0, width: 800, height: 600, zoom: 1 };
function assetHarness() {
  const textures = new Map<string, Texture>();
  const files: string[] = [];
  const assets = { requestFile: async (file: string) => { files.push(file); }, getFile: (file: string) => {
    let texture = textures.get(file);
    if (!texture) { texture = new Texture({ source: new TextureSource({ width: 128, height: 128 }) }); textures.set(file, texture); }
    return texture;
  } } as unknown as GameAssets;
  return { assets, textures, files, dispose() { for (const texture of textures.values()) texture.destroy(true); } };
}
function sprites(container: Container): Sprite[] {
  return container.children.flatMap(child => [...(child instanceof Sprite ? [child] : []), ...sprites(child)]);
}
const comet: CometView = { phase: 'fly1', time: .8, age: 2, center: { x: 0, y: 0 }, direction: 1,
  halfSize: 600, flash: 0, bolts: [{ x: 10, y: 20, landY: 40, radius: 8, vy: 700,
    elapsed: .2, landed: false, exploded: false, seed: .4 }], rings: [], trails: [] };

describe('source encounter paths', () => {
  it('keeps the source charge particle circle and short outward tail', () => {
    const graphic = new Graphics(), circle = vi.spyOn(graphic, 'circle'), line = vi.spyOn(graphic, 'lineTo');
    const view: EffectView = { id: 1, kind: 'sparkle', x: 100, y: 80, radius: 2.3,
      end: { x: 109, y: 77 }, color: '#78ebff', alpha: .75, progress: .5, width: 1 };
    expect(drawEncounterEffect(graphic, view)).toBe(true);
    expect(circle).toHaveBeenCalledWith(0, 0, 2.3); expect(line).toHaveBeenCalledWith(9, -3);
    graphic.destroy();
  });
  it('draws original glass vertices and rotation rather than substituting an ellipse', () => {
    const view: EffectView = { id: 1, kind: 'shard', variant: 'glass', x: 20, y: 30, radius: 0,
      color: '#beebff', alpha: .425, progress: .5, angle: .7,
      points: [{ x: 18, y: 27 }, { x: 25, y: 29 }, { x: 21, y: 36 }] };
    const graphic = new Graphics(), poly = vi.spyOn(graphic, 'poly'), ellipse = vi.spyOn(graphic, 'ellipse');
    expect(drawEncounterEffect(graphic, view)).toBe(true);
    expect(poly).toHaveBeenCalledWith([-2, -3, 5, -1, 1, 6], true); expect(ellipse).not.toHaveBeenCalled();
    const display = new EffectDisplay(); display.sync(view);
    expect(display.rotation).toBe(.7); expect(display.alpha).toBe(.425); expect(display.blendMode).toBe('normal');
    display.destroy(); graphic.destroy();
  });
  it('keeps the original blade-spark lengths, two strokes, and supplied orientation', () => {
    const graphic = new Graphics(), line = vi.spyOn(graphic, 'lineTo'), stroke = vi.spyOn(graphic, 'stroke');
    const view: EffectView = { id: 1, kind: 'spark', variant: 'blade', x: 0, y: 0, radius: 0, color: '#fff', alpha: .5, progress: .5, angle: 1.2 };
    expect(drawEncounterEffect(graphic, view)).toBe(true);
    expect(line.mock.calls).toEqual([[-8.5, 0], [-5.1, 0]]);
    expect(stroke.mock.calls.map(call => call[0])).toEqual([
      { color: 0xffffff, alpha: .9, width: 1.3, cap: 'round' },
      { color: 0x78dcff, alpha: .4, width: 2.6, cap: 'round' },
    ]);
    const display = new EffectDisplay(); display.sync(view); expect(display.rotation).toBe(1.2);
    display.destroy(); graphic.destroy();
  });
  it('reproduces the original mulberry32 crack path, including source seed 42 coordinates', () => {
    const graphic = new Graphics(), poly = vi.spyOn(graphic, 'poly');
    const view: EffectView = { id: 1, kind: 'trail', variant: 'crack', x: 10, y: 20, radius: 0, color: '#1e042c', alpha: .3, seed: 42 };
    expect(drawEncounterEffect(graphic, view)).toBe(true);
    // Captured from baseline dmc-blades.mulberry32 + vergil.renderWorld's five segments.
    expect(poly.mock.calls[0][0]).toEqual([0, 0, -21.504207792808042, -11.672217471661103,
      -40.93529243968699, -12.714297182464323, -65.67357932496247, -17.417553388683952,
      -91.37042567840254, -14.657990040435715, -103.81094362597892, -7.121314564796531]);
    expect(poly.mock.calls[1]).toEqual(poly.mock.calls[0]); graphic.destroy();
  });
  it('draws exactly the projected bats with original 32x20 path scaling and releases retired paths', () => {
    const assets = assetHarness(), display = new RemiliaDisplay();
    const view: EncounterView = { kind: 'remilia', state: 'cards', time: 3, introTime: 0,
      arena: { x: 0, y: -80, halfWidth: 520, halfHeight: 470 }, hp: 0, maxHp: 0,
      boss: { x: 0, y: 0 }, sigil: 1, ending: 0,
      bats: [{ x: 100, y: 120, width: 26, height: 8, alpha: .7 }, { x: -40, y: 20, width: 13, height: 4, alpha: .4 }] };
    display.sync(view, camera, assets.assets);
    const bats = display.ground.children[0]; expect(bats.children).toHaveLength(2);
    const first = bats.children[0]; expect(first.position).toMatchObject({ x: 100, y: 120 });
    expect(first.scale).toMatchObject({ x: 26 / 32, y: 8 / 20 }); expect(first.alpha).toBe(.7);
    const retired = bats.children[1]; display.sync({ ...view, bats: [view.bats[0]] }, camera, assets.assets);
    expect(retired.destroyed).toBe(true); display.dispose(); assets.dispose();
  });
});

describe('source environmental primitives', () => {
  it('owns weather drawing and cyclone children in a real Container without Graphics children', () => {
    const assets = assetHarness(), display = new WeatherDisplay(assets.assets);
    const weather: WeatherView = { id: 'riverFog', elapsed: 2, strength: .4, fogStrength: 0, flash: 0,
      meteors: [], burnZones: [], typhoons: [], fogClouds: [{ id: 1, x: 10, y: 20, radius: 70 }] };
    display.sync(weather, camera);
    expect(display.world.constructor).toBe(Container);
    const drawings = display.world.children.filter((child): child is Graphics => child instanceof Graphics);
    expect(drawings).toHaveLength(1); expect(drawings[0].children).toHaveLength(0);
    expect(drawings[0].context.instructions.length).toBeGreaterThan(0); expect(display.world.alpha).toBe(.4);
    display.sync(undefined, camera); expect(drawings[0].context.instructions).toHaveLength(0);
    const context = drawings[0].context; display.dispose(); expect(context.destroyed).toBe(true); assets.dispose();
  });
  it.each(['Mozilla/5.0 (X11; Linux x86_64)', 'Mozilla/5.0 (Linux; Android 14) Mobile'])('keeps reference constant-add lights and normal dark layers under %s', userAgent => {
    vi.stubGlobal('navigator', { userAgent });
    const assets = assetHarness(), display = new CometDisplay();
    const circle = vi.spyOn(Graphics.prototype, 'circle'), fill = vi.spyOn(Graphics.prototype, 'fill');
    try {
      display.sync(comet, camera, [], assets.assets);
      const proximity = 1 - (40 - 20) / 760, radius = 110 * (.55 + .45 * proximity);
      const marker = circle.mock.calls.findIndex(call => call[0] === 10 && call[1] === 40 && call[2] === radius);
      expect(marker).toBeGreaterThanOrEqual(0);
      expect((circle.mock.contexts[marker] as Graphics).blendMode).toBe('add');
      expect(display.ground.blendMode).toBe('normal');
      expect(sprites(display.world).filter(sprite => [...assets.textures].some(([file, texture]) => file.includes('comet-source') && texture === sprite.texture)).every(sprite => sprite.blendMode === 'add')).toBe(true);
      circle.mockClear(); fill.mockClear();
      display.sync({ ...comet, phase: 'boom', time: .1,
        bolts: [{ ...comet.bolts[0], landed: true, exploded: true }],
        rings: [{ x: 50, y: 60, radius: 200, elapsed: .6, duration: 1, delay: .1, kind: 'shock', warm: true },
          { x: -100, y: -120, radius: 280, elapsed: .2, duration: 1, delay: 0, kind: 'ground', warm: false }],
      }, camera, [], assets.assets);
      const edge = circle.mock.calls.findIndex(call => call[0] === 50 && call[1] === 60);
      expect((circle.mock.contexts[edge] as Graphics).blendMode).toBe('add');
      for (const [color, blend] of [[0xff4a18, 'add'], [0x321219, 'normal']] as const) {
        const index = fill.mock.calls.findIndex(call => typeof call[0] === 'object' && call[0] !== null && 'color' in call[0] && call[0].color === color);
        expect(index).toBeGreaterThanOrEqual(0); expect((fill.mock.contexts[index] as Graphics).blendMode).toBe(blend);
      }
      expect(display.ground.blendMode).toBe('normal');
    } finally { circle.mockRestore(); fill.mockRestore(); vi.unstubAllGlobals(); display.dispose(); assets.dispose(); }
  });
  it('uses actual comet radius and velocity in the original head and tail geometry', () => {
    const assets = assetHarness(), display = new CometDisplay();
    display.sync(comet, camera, [], assets.assets);
    const all = sprites(display.world), hot = assets.textures.get('fx/comet-source-hot.png');
    const head = all.find(sprite => sprite.texture === hot && sprite.x === 10 && sprite.y === 20)!;
    expect(head.width).toBeCloseTo(8 * 3.2);
    expect(all.some(sprite => sprite.y === 20 - 140)).toBe(true);
    display.sync({ ...comet, bolts: [{ ...comet.bolts[0], radius: 16, vy: 900 }] }, camera, [], assets.assets);
    expect(head.width).toBeCloseTo(16 * 3.2);
    expect(sprites(display.world).some(sprite => sprite.y === 20 - 170)).toBe(true);
    display.dispose(); assets.dispose();
  });
  it('selects distinct original warm/cool wave art and preserves delayed expansion', () => {
    const assets = assetHarness(), display = new CometDisplay();
    const ring = { x: 50, y: 60, radius: 200, elapsed: .6, duration: 1, delay: .1, kind: 'shock', warm: true };
    display.sync({ ...comet, bolts: [], rings: [ring] }, camera, [], assets.assets);
    const wave = sprites(display.world).find(sprite => sprite.texture === assets.textures.get('fx/comet-source-warm.png'))!;
    expect(wave.width).toBeCloseTo(200 * (1 - .5 ** 2.2) * 2.25); expect(wave.alpha).toBeCloseTo(.45);
    display.sync({ ...comet, bolts: [], rings: [{ ...ring, warm: false }] }, camera, [], assets.assets);
    expect(wave.texture).toBe(assets.textures.get('fx/comet-source-cool.png')); expect(wave.alpha).toBeCloseTo(.35);
    display.dispose(); assets.dispose();
  });
  it('uses the projected typhoon angle for the original five/four/three rotating arm layers', () => {
    const assets = assetHarness(), display = new WeatherDisplay(assets.assets);
    const weather: WeatherView = { id: 'typhoon', elapsed: 2, strength: 1, fogStrength: 0, flash: 0,
      meteors: [], burnZones: [], typhoons: [{ id: 1, x: 40, y: 50, radius: 100, angle: -2 }] };
    display.sync(weather, camera);
    for (const [layer, count, speed, ratio] of [[0, 5, 4, .62], [1, 4, 2.4, .98], [2, 3, 1.3, 1.34]]) {
      const arms = sprites(display.world).filter(sprite => sprite.texture === assets.textures.get(`fx/typhoon-source-arm-${layer}.png`));
      expect(arms).toHaveLength(count);
      expect(arms[0].rotation).toBeCloseTo(-2 * speed + ratio * 5.1);
      expect(arms[0].width).toBeCloseTo(100 * ratio * 2);
    }
    expect(assets.files).not.toContain('fx/typhoon-source-leaf-0.png');
    display.sync(undefined, camera);
    expect(display.world.children.filter(child => !(child instanceof Graphics)).every(child => child.children.length === 0)).toBe(true);
    display.dispose(); assets.dispose();
  });
});
