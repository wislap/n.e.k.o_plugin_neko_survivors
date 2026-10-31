import { afterEach, describe, expect, it, vi } from 'vitest';
import { Graphics, Sprite, Texture, TextureSource } from 'pixi.js';
import type { ActorView } from '../../src/game';
import { ActorDisplay } from '../../src/rendering/actor-display';
import type { GameAssets } from '../../src/rendering/assets';
import { EYE_ANCHORS, enemyEyePlacement } from '../../src/rendering/enemy-eyes';

const actor: ActorView = { id: 1, kind: 'enemy', definitionId: 'bat', x: 10, y: -20, radius: 14, angle: 0, color: '#ffffff' };
function setup() {
  const texture = new Texture({ source: new TextureSource({ width: 100, height: 100 }) });
  let available = true;
  const assets = { request: async () => {}, get: () => available ? texture : undefined } as unknown as GameAssets;
  const display = new ActorDisplay(), eyes = display.children[5] as Graphics, image = display.children[2] as Sprite;
  return { display, eyes, image, assets, available(value: boolean) { available = value; }, dispose() { display.destroy(); texture.destroy(true); } };
}
afterEach(() => vi.restoreAllMocks());

describe('retained enemy eye geometry', () => {
  it('keeps original eye and highlight coordinates for every mapped enemy at different radii and facings', () => {
    const s = setup();
    for (const definitionId of Object.keys(EYE_ANCHORS)) for (const radius of [3, 14, 60]) for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6, time = i * .13;
      s.display.sync({ ...actor, definitionId, radius, angle }, time, s.assets);
      const expected = enemyEyePlacement(definitionId, radius, angle)!;
      expect(s.eyes.visible).toBe(true); expect(s.eyes.context.instructions).toHaveLength(4);
      const actual = s.eyes.context.instructions.map(instruction => {
        if (instruction.action !== 'fill') throw new Error('Eyes must remain filled circles');
        const circle = instruction.data.path.instructions.find(command => command.action === 'circle');
        if (!circle) throw new Error('Missing eye circle');
        const [x, y, r] = circle.data as [number, number, number];
        return { x: x + s.eyes.x, y: y + s.eyes.y, radius: r };
      });
      expected.eyes.forEach((eye, index) => {
        expect(actual[index * 2].x).toBeCloseTo(eye.x); expect(actual[index * 2].y).toBeCloseTo(eye.y + s.image.y); expect(actual[index * 2].radius).toBeCloseTo(expected.eyeRadius);
        expect(actual[index * 2 + 1].x).toBeCloseTo(eye.x - expected.eyeRadius * .25); expect(actual[index * 2 + 1].y).toBeCloseTo(eye.y - expected.eyeRadius * .3 + s.image.y);
        expect(actual[index * 2 + 1].radius).toBeCloseTo(expected.eyeRadius * .25);
      });
    }
    s.dispose();
  });
  it('does not redraw circles when only movement, facing and sprite bob change', () => {
    const s = setup(); s.display.sync(actor, 0, s.assets); const clear = vi.spyOn(s.eyes, 'clear'), circle = vi.spyOn(s.eyes, 'circle');
    for (let i = 0; i < 120; i++) s.display.sync({ ...actor, x: i, y: -i, angle: i * .1 }, i * .1, s.assets);
    expect(clear.mock.calls.length).toBe(0); expect(circle.mock.calls.length).toBe(0);
    s.display.sync({ ...actor, radius: 20 }, 20, s.assets); expect(clear.mock.calls.length).toBe(1); expect(circle.mock.calls.length).toBe(4);
    s.dispose();
  });
  it('hides eyes for absent sprites, noEyes and bottle bosses, and restores them when the sprite returns', () => {
    const s = setup(); s.display.sync(actor, 0, s.assets);
    s.available(false); s.display.sync(actor, 0, s.assets); expect(s.eyes.visible).toBe(false);
    s.available(true); s.display.sync(actor, 0, s.assets); expect(s.eyes.visible).toBe(true); expect(s.eyes.context.instructions).toHaveLength(4);
    s.display.sync({ ...actor, noEyes: true }, 0, s.assets); expect(s.eyes.visible).toBe(false);
    s.display.sync({ ...actor, definitionId: 'boss_apple_cider', spriteId: null, silhouette: 'bottle', noEyes: true }, 0, s.assets); expect(s.eyes.visible).toBe(false);
    s.display.sync({ ...actor, definitionId: 'slime' }, 0, s.assets); expect(s.eyes.visible).toBe(true); expect(s.eyes.context.instructions).toHaveLength(4);
    s.dispose();
  });
});
