import { DESKTOP_PRESENTATION } from '../../src/presentation/profile';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, DOMAdapter, Graphics, type Filter } from 'pixi.js';
import { createGameSession } from '../../src/game';
import { IdleBackground } from '../../src/rendering/idle-background';
import { GameScene } from '../../src/rendering/scene';
import { GameRenderer } from '../../src/rendering/game-renderer';
import { GameAssets } from '../../src/rendering/assets';
import type { PixiRenderer } from '../../src/rendering/create-renderer';

beforeEach(() => {
  // Native program construction only asks for a WebGL precision probe here.
  // CPU-side geometry tests do not claim a GPU driver or shader compilation.
  vi.spyOn(DOMAdapter.get(), 'createCanvas').mockReturnValue({ getContext: (kind: string) => {
    expect(kind).toBe('webgl'); return null;
  } } as unknown as HTMLCanvasElement);
});
afterEach(() => vi.restoreAllMocks());
function layers(idle: IdleBackground) {
  return { sky: idle.children[0] as Graphics, stars: idle.children[1] as Container,
    dust: idle.children[2] as Container, vignette: idle.children[3] as Graphics };
}
function coordinates(container: Container) { return container.children.map(child => [child.x, child.y, child.alpha]); }

describe('reference GPU idle background', () => {
  it('retains exact desktop/mobile particle counts, circle sizes and reference samples at a fixed clock', () => {
    const desktop = new IdleBackground(DESKTOP_PRESENTATION), mobile = new IdleBackground({ mobile: true, resolution: 1, displayFps: 30 });
    desktop.sync(800, 600, 1000); mobile.sync(800, 600, 1000);
    const d = layers(desktop), m = layers(mobile);
    expect([d.stars.children.length, d.dust.children.length]).toEqual([46, 40]);
    expect([m.stars.children.length, m.dust.children.length]).toEqual([23, 20]);
    const samples = [[0, 0, 0, .1989489796284805], [7, 410.3220999999994, 163.26069999999982, .07727490113052461], [45, 9.213499999994383, 278.10449999999764, .22881513070087314]];
    for (const [i, x, y, alpha] of samples) {
      expect(d.stars.children[i].x).toBeCloseTo(x); expect(d.stars.children[i].y).toBeCloseTo(y); expect(d.stars.children[i].alpha).toBeCloseTo(alpha);
    }
    for (const [i, x, y] of [[0, -15.598292086871083, 636], [7, 153.4368019709009, 43.457200000000284], [39, 460.3929632679792, 440.4044000000031]]) {
      expect(d.dust.children[i].x).toBeCloseTo(x); expect(d.dust.children[i].y).toBeCloseTo(y);
    }
    const star = d.stars.children[0] as Graphics, particle = d.dust.children[0] as Graphics;
    expect(star.getLocalBounds().width).toBeCloseTo(1.4);
    expect(particle.getLocalBounds().width).toBeCloseTo(1.1 * 3.2 * 2);
    expect(particle.context.instructions).toHaveLength(2);
    desktop.destroy(); mobile.destroy();
  });
  it('propagates the shared mobile profile through the scene rather than browser identity', () => {
    vi.stubGlobal('navigator', { userAgent: 'Desktop browser' });
    const scene = new GameScene({ mobile: true, resolution: 1, displayFps: 30 });
    const idle = scene.stage.getChildByLabel('idle-background') as IdleBackground;
    expect(layers(idle).stars.children).toHaveLength(23); expect(layers(idle).dust.children).toHaveLength(20);
    scene.dispose(); vi.unstubAllGlobals();
  });
  it('uses only the supplied display time, retains particle/filter identities, and releases its own filters', () => {
    const idle = new IdleBackground(DESKTOP_PRESENTATION), random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Idle must not consume RNG'); });
    idle.sync(800, 600, 1000); const l = layers(idle), stars = [...l.stars.children], dust = [...l.dust.children];
    const first = { stars: coordinates(l.stars), dust: coordinates(l.dust) }, sky = l.sky.filters![0] as Filter, vignette = l.vignette.filters![0] as Filter;
    idle.sync(800, 600, 1000); expect({ stars: coordinates(l.stars), dust: coordinates(l.dust) }).toEqual(first);
    idle.sync(800, 600, 2000); expect(coordinates(l.stars)).not.toEqual(first.stars); expect(coordinates(l.dust)).not.toEqual(first.dust);
    expect(l.stars.children).toEqual(stars); expect(l.dust.children).toEqual(dust);
    idle.sync(1024, 768, 2000); expect(l.sky.filters![0]).toBe(sky); expect(l.vignette.filters![0]).toBe(vignette);
    expect(l.sky.filterArea).toMatchObject({ width: 1024, height: 768 });
    expect(sky.glProgram).toBeTruthy();
    expect(random).not.toHaveBeenCalled();
    const releaseSky = vi.spyOn(sky, 'destroy'), releaseVignette = vi.spyOn(vignette, 'destroy');
    idle.destroy(); idle.destroy(); expect(releaseSky).toHaveBeenCalledTimes(1); expect(releaseVignette).toHaveBeenCalledTimes(1);
  });
  it('switches title → playing → title without drawing a battle background, grid, shade or stale world in title', () => {
    const game = createGameSession(), scene = new GameScene(DESKTOP_PRESENTATION), assets = new GameAssets('./assets');
    const request = vi.spyOn(assets, 'request').mockResolvedValue();
    const camera = { x: 0, y: 0, zoom: 1, width: 800, height: 600 };
    scene.world.addChild(new Graphics().circle(10, 10, 20).fill(0xff0000));
    const idle = scene.stage.children[0];
    scene.sync(game.readFrame(), camera, assets, 1000);
    expect(idle.visible).toBe(true); expect(scene.content.visible).toBe(false); expect(scene.world.visible).toBe(false); expect(request).not.toHaveBeenCalled();
    for (const label of ['battle-background', 'battle-shade', 'battle-grid']) expect(scene.content.getChildByLabel(label)?.visible).toBe(false);
    game.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69 } });
    scene.sync(game.readFrame(), camera, assets, 2000); expect(idle.visible).toBe(false); expect(scene.content.visible).toBe(true); expect(scene.world.visible).toBe(true);
    expect(scene.content.getChildByLabel('battle-grid')?.visible).toBe(true); expect(request).toHaveBeenCalledTimes(1);
    // A title can retain the old frame's background ID; it must still choose the idle scene.
    scene.sync({ ...game.readFrame(), phase: 'title' }, camera, assets, 1000);
    expect(idle.visible).toBe(true); expect(scene.content.visible).toBe(false); expect(scene.world.visible).toBe(false); expect(request).toHaveBeenCalledTimes(1);
    scene.dispose(); assets.dispose();
  });
  it('hides all renderer-owned screen overlays in title and restores ordinary drawing on the next game frame', () => {
    const render = vi.fn(), canvas = Object.assign(new EventTarget(), { width: 800, height: 600, remove: vi.fn() }) as unknown as HTMLCanvasElement;
    const native = { screen: { width: 800, height: 600 }, render, runners: { contextChange: { remove() {} } }, destroy: vi.fn() } as unknown as PixiRenderer;
    const request = vi.spyOn(GameAssets.prototype, 'request').mockResolvedValue();
    const renderer = new GameRenderer({ renderer: native, canvas }, { presentation: DESKTOP_PRESENTATION, container: { appendChild() {} } as unknown as HTMLElement });
    const game = createGameSession(); renderer.render(game.readFrame(), 1000);
    const stage = render.mock.calls[0][0] as Container;
    expect(stage.children.slice(2).every(child => !child.visible)).toBe(true);
    expect(request).not.toHaveBeenCalled();
    game.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69 } });
    renderer.render(game.readFrame(), 2000); expect(stage.getChildByLabel('atmosphere-content')?.visible).toBe(true); expect(stage.getChildByLabel('world-information')?.visible).toBe(true);
    renderer.render({ ...game.readFrame(), phase: 'title' }, 1000);
    expect(stage.children.slice(2).every(child => !child.visible)).toBe(true); expect(stage.getChildByLabel('atmosphere-content')?.visible).toBe(false);
    expect(render).toHaveBeenCalledTimes(3); renderer.dispose();
  });
});
