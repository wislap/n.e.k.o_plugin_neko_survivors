import { DESKTOP_PRESENTATION } from '../../src/presentation/profile';
import { describe, expect, it, vi } from 'vitest';
import { Texture, TextureSource, Sprite, Graphics, DOMAdapter } from 'pixi.js';
import { ActorDisplay } from '../../src/rendering/actor-display';
import { GameAssets, spriteUrl } from '../../src/rendering/assets';
import { screenToWorld } from '../../src/rendering/camera';
import type { ActorView } from '../../src/game';
import { createGameSession } from '../../src/game';
import { GameScene } from '../../src/rendering/scene';

describe('reference material mapping', () => {
  it('draws the intentionally untextured bottle boss without requesting a nonexistent image', () => {
    const assets = new GameAssets('./assets');
    const request = vi.spyOn(assets, 'request').mockResolvedValue();
    const display = new ActorDisplay();
    const actor: ActorView = { id: 1, kind: 'enemy', definitionId: 'boss_apple_cider', spriteId: null,
      silhouette: 'bottle', noEyes: true, x: 0, y: 0, radius: 52, angle: 0, color: '#c8862f', boss: true };
    display.sync(actor, 0, assets);
    expect(request).not.toHaveBeenCalled();
    const body = display.getChildByLabel('actor-fallback');
    expect(body?.visible).toBe(true);
    if (!(body instanceof Graphics)) throw new Error('Procedural actor body must use GPU graphics');
    const bounds = body.getLocalBounds();
    expect(bounds.height / bounds.width).toBeGreaterThan(1.4);
    expect(bounds.minY).toBeLessThan(-52 * 1.4);
    display.destroy(); assets.dispose();
  });
  it('uses the procedural initial title without requesting a nonexistent plaza image', () => {
    const game = createGameSession();
    const assets = new GameAssets('./assets');
    const request = vi.spyOn(assets, 'request').mockResolvedValue();
    // Only Pixi's optional WebGL shader precision probe is stubbed; no Canvas2D gradient is permitted.
    const probe = vi.spyOn(DOMAdapter.get(), 'createCanvas').mockReturnValue({ getContext: () => null } as unknown as HTMLCanvasElement);
    const scene = new GameScene(DESKTOP_PRESENTATION);
    const camera = { x: 0, y: 0, zoom: 1, width: 800, height: 600 };
    scene.sync(game.readFrame(), camera, assets);
    expect(request).not.toHaveBeenCalled();
    game.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69 } });
    scene.sync(game.readFrame(), camera, assets);
    expect(request).toHaveBeenCalledExactlyOnceWith('background', game.readFrame().backgroundId);
    scene.dispose(); assets.dispose(); probe.mockRestore();
  });
  it('preserves sprite categories, item aliases and Chinese filenames', () => {
    expect(spriteUrl('./assets', 'character', 'mimi')).toBe('./assets/characters/char_mimi.png');
    expect(spriteUrl('./assets/', 'item', 'ap_round')).toBe('./assets/items/item_armor_piercer.png');
    expect(decodeURIComponent(spriteUrl('./assets', 'item', 'dried_fish'))).toBe('./assets/items/小鱼干.png');
    expect(() => spriteUrl('./assets', 'enemy', '../escape')).toThrow('Invalid sprite id');
  });
  it('keeps the full-body player sprite foot anchored and facing left', () => {
    const texture = new Texture({ source: new TextureSource({ width: 100, height: 200 }) });
    const assets = { request: async () => {}, get: () => texture } as unknown as GameAssets;
    const actor: ActorView = { id: 1, kind: 'player', definitionId: 'mimi', x: 5, y: 6, radius: 20, angle: Math.PI, color: '#fff' };
    const display = new ActorDisplay(); display.sync(actor, 0, assets);
    const image = display.children.find(child => child instanceof Sprite) as Sprite;
    expect(image.height).toBeCloseTo(72);
    expect(image.width).toBeCloseTo(36);
    expect(image.anchor.x).toBe(.5); expect(image.anchor.y).toBe(1);
    expect(image.y).toBeCloseTo(17); expect(image.scale.x).toBeLessThan(0);
    display.sync({ ...actor, angle: 0 }, 0, assets);
    expect(image.scale.x).toBeGreaterThan(0);
    display.destroy(); expect(texture.destroyed).toBe(false);
    texture.destroy(true);
  });
  it('converts canvas-local input with the same zoom and camera center as rendering', () => {
    expect(screenToWorld({ x: 300, y: -100, zoom: 2, width: 800, height: 600 }, 400, 300)).toEqual({ x: 300, y: -100 });
    expect(screenToWorld({ x: 300, y: -100, zoom: 2, width: 800, height: 600 }, 600, 200)).toEqual({ x: 400, y: -150 });
  });
});
