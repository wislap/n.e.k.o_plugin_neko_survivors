import { describe, expect, it } from 'vitest';
import type { EncounterView, WeatherView } from '../../src/game';
import { EncounterDisplay } from '../../src/rendering/encounters/encounter-display';
import { WeatherDisplay } from '../../src/rendering/weather-display';
import { GameAssets } from '../../src/rendering/assets';
import { Graphics, Container, type GraphicsContext } from 'pixi.js';

const camera = { x: 0, y: 0, width: 800, height: 600, zoom: 1 };
const base = { time: 1, introTime: 1, state: 'active', arena: { x: 0, y: -80, halfWidth: 560, halfHeight: 500 }, hp: 1000, maxHp: 2000, boss: { x: 0, y: -100 } };
const encounters: EncounterView[] = [
  { ...base, kind: 'flandre', cardId: 'laevateinn', cardName: '禁忌「莱瓦汀」', declaration: .7, purgeCooldown: 2 },
  { ...base, kind: 'vergil', chairVisible: true, chairFacing: 1, charge: 1, veil: .3, slashes: [{ id: 1, x: 0, y: 0, radius: 40, alpha: .5, angle: 1 }], rifts: [{ id: 2, x: 30, y: 0, radius: 30, alpha: 1 }], blades: [{ id: 3, x1: 0, y1: 0, x2: 200, y2: 100, alpha: 1, seed: 42 }] },
  { ...base, kind: 'remilia', sigil: 1, ending: 0, bats: [] },
  { ...base, kind: 'halloween', moonPhase: .3, veil: 0, cats: [{ id: 'choco', x: -150, y: -100, alpha: 1 }, { id: 'vanilla', x: 150, y: -100, alpha: 1 }], pumpkins: [{ id: 1, x: 0, y: 0, radius: 25, alpha: 1 }], candies: [{ id: 2, x: 40, y: 0, color: '#ffaaff' }] },
];

describe('advanced GPU scene lifecycle', () => {
  it('transitions through all four dedicated visual implementations without mutating rule snapshots', () => {
    const requested: string[] = [];
    const assets = { requestFile: async (path: string) => { requested.push(path); }, getFile: () => undefined } as unknown as GameAssets;
    const display = new EncounterDisplay();
    const before = JSON.stringify(encounters);
    let previous: { destroyed: boolean } | undefined;
    let previousContexts: GraphicsContext[] = [];
    const contexts = (container: Container): GraphicsContext[] => container.children.flatMap(child => [
      ...(child instanceof Graphics ? [child.context] : []), ...contexts(child),
    ]);
    for (const encounter of encounters) {
      display.sync(encounter, camera, assets);
      if (previous) expect(previous.destroyed).toBe(true);
      for (const context of previousContexts) expect(context.destroyed).toBe(true);
      previous = display.background.children[0];
      previousContexts = [display.background, display.ground, display.actors, display.foreground].flatMap(contexts);
      expect(display.background.children).toHaveLength(1);
      expect(display.actors.children).toHaveLength(1);
    }
    expect(requested.some(path => path.includes('vergil_chair'))).toBe(true);
    expect(requested.some(path => path.includes('remilia_'))).toBe(true);
    expect(requested.some(path => path.includes('choco_h_'))).toBe(true);
    expect(JSON.stringify(encounters)).toBe(before);
    display.sync(undefined, camera, assets);
    expect(display.background.children).toHaveLength(0);
    for (const context of previousContexts) expect(context.destroyed).toBe(true);
    display.dispose();
  });
  it('generates all weather branches from snapshots and clears weather on exit', () => {
    const assets = { requestFile: async () => {}, getFile: () => undefined } as unknown as GameAssets;
    const display = new WeatherDisplay(assets);
    for (const id of ['fog', 'bloodMoon', 'meteor', 'rain', 'breeze', 'typhoon', 'clear', 'scorch', 'calm', 'riverFog']) {
      const weather: WeatherView = { id, elapsed: 1, strength: 1, fogStrength: .3, flash: .1,
        meteors: [{ id: 1, x: 10, y: 10, radius: 30, progress: .7 }],
        burnZones: [{ id: 2, x: 20, y: 20, radius: 40, alpha: .6 }],
        typhoons: [{ id: 3, x: 30, y: 30, radius: 30, angle: 1 }], fogClouds: [{ id: 4, x: -50, y: 50, radius: 70 }] };
      const before = JSON.stringify(weather);
      display.sync(weather, camera); expect(display.screen.visible).toBe(true);
      expect(JSON.stringify(weather)).toBe(before);
    }
    display.sync(undefined, camera);
    expect(display.screen.visible).toBe(false); expect(display.world.visible).toBe(false);
    display.dispose();
  });
});
