import { describe, expect, it } from 'vitest';
import type { ActorView, CometView } from '../../src/game';
import { CometDisplay } from '../../src/rendering/comet-display';
import { GameAssets } from '../../src/rendering/assets';
import { Sprite } from 'pixi.js';
const camera = { x: 0, y: 0, width: 800, height: 600, zoom: 1 };
const actor: ActorView = { id: 1, x: 0, y: 0, kind: 'player', definitionId: 'mimi', radius: 12, angle: 0, color: '#fff' };
const comet: CometView = { phase: 'fly1', time: .8, age: 2, center: { x: 0, y: 0 }, direction: 1, halfSize: 600, flash: 0,
  bolts: [{ x: 10, y: -20, landY: 40, radius: 8, vy: 700, elapsed: .2, landed: false, exploded: false, seed: .4 }],
  rings: [{ x: 0, y: 0, radius: 200, elapsed: .5, duration: 1, delay: .1, kind: 'ground', warm: false }],
  trails: [{ x: 0, y: -80, radius: 10, alpha: .5 }] };

describe('comet cinematic', () => {
  it('presents original fly/roar artwork throughout every phase and releases all visual containers', () => {
    const paths: string[] = [];
    const assets = { requestFile: async (file: string) => { paths.push(file); }, getFile: () => undefined } as unknown as GameAssets;
    const display = new CometDisplay();
    const before = JSON.stringify(comet);
    for (const phase of ['banner', 'gap1', 'fly1', 'gap2', 'fly2', 'gap3', 'dive', 'boom', 'roar', 'takeoff']) {
      display.sync({ ...comet, phase }, camera, [actor], assets);
      expect(display.world.visible).toBe(true); expect(display.screen.visible).toBe(true);
    }
    expect(paths).toContain('comet/fly.png'); expect(paths).toContain('comet/roar.png');
    expect(JSON.stringify(comet)).toBe(before);
    display.sync(undefined, camera, [actor], assets);
    expect(display.world.visible).toBe(false); expect(display.screen.visible).toBe(false);
    display.dispose();
    expect(display.world.destroyed).toBe(true); expect(display.screen.destroyed).toBe(true);
  });
  it('keeps ascent oriented upward rather than inverting the reference dragon art', () => {
    const assets = { requestFile: async () => {}, getFile: () => undefined } as unknown as GameAssets;
    const display = new CometDisplay();
    display.sync({ ...comet, phase: 'takeoff', time: 0 }, camera, [], assets);
    const dragon = display.world.children.find(child => child instanceof Sprite)!;
    expect(dragon.rotation).toBeCloseTo(0);
    display.dispose();
  });
});
