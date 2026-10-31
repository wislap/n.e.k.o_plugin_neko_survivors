import { describe, expect, it } from 'vitest';
import { Graphics, Sprite, Texture, TextureSource } from 'pixi.js';
import { ActorDisplay } from '../../src/rendering/actor-display';
import { WeaponDisplay } from '../../src/rendering/weapon-display';
import { PickupDisplay, ProjectileDisplay, ProjectileTextures } from '../../src/rendering/battle-displays';
import { createGameSession, EMPTY_INPUT, type ActorView, type WeaponView, type PickupView, type ProjectileView } from '../../src/game';
import { getWeapon } from '../../src/game/content/weapons';
import primitiveManifest from '../../public/assets/ordinary/manifest.json';
import type { GameAssets } from '../../src/rendering/assets';
import type { PixiRenderer } from '../../src/rendering/create-renderer';
const fingerprint = (graphics: Graphics) => JSON.stringify(graphics.context.instructions.map(instruction =>
  instruction.action === 'fill' || instruction.action === 'stroke'
    ? { action: instruction.action, path: instruction.data.path.instructions, color: instruction.data.style.color, alpha: instruction.data.style.alpha }
    : { action: instruction.action }));
const actor: ActorView = { id: 1, kind: 'player', definitionId: 'yui', x: 0, y: 0, radius: 16, angle: 0, facing: 0, color: '#ff7bac', accent: '#ffd6e6', blinkPhase: 0, age: 1 };
function assets(available = true) {
  const texture = new Texture({ source: new TextureSource({ width: 100, height: 100 }) }), requested: string[] = [], files: string[] = [];
  return { texture, requested, files, port: { request: async (_kind: string, id: string) => { requested.push(id); }, get: () => available ? texture : undefined, requestFile: async (file: string) => { files.push(file); }, getFile: () => available ? texture : undefined } as unknown as GameAssets };
}
describe('ordinary presentation consumes rule facts', () => {
  it('rotates the shrimp sprite toward its target while leaving the ground shadow unrotated', () => {
    const a = assets(), display = new ActorDisplay();
    display.sync({ ...actor, kind: 'enemy', definitionId: 'boss_acid_cat', facePlayer: true, faceRotate: true, facing: .3 }, 0, a.port);
    expect((display.children[2] as Sprite).rotation).toBeCloseTo(.3 + Math.PI / 2);
    expect(display.children[0].rotation).toBe(0);
    display.destroy(); a.texture.destroy(true);
  });
  it('animates fallback eyelids from blinkPhase and keeps the character accent', () => {
    const a = assets(false), display = new ActorDisplay();
    display.sync(actor, 0, a.port); const fallback = display.children[4] as Graphics;
    expect(fallback.y).toBeCloseTo(Math.sin(actor.age! * 2) * 1.2);
    const open = fingerprint(fallback);
    display.sync({ ...actor, blinkPhase: -.01 }, 0, a.port); expect(fingerprint(fallback)).toBe(open);
    display.sync({ ...actor, blinkPhase: .06 }, 0, a.port);
    expect(fingerprint(fallback)).not.toBe(open);
    const closed = fingerprint(fallback);
    display.sync({ ...actor, blinkPhase: .06, accent: '#00ffaa' }, 0, a.port);
    expect(fingerprint(fallback)).not.toBe(closed);
    display.destroy(); a.texture.destroy(true);
  });
  it('uses turret spawn progress, barrel direction and recoil without displaying its inventory icon', () => {
    const a = assets(), display = new ActorDisplay(), turret = { ...actor, kind: 'turret' as const, recoil: 0, spawnProgress: 0, angle: .7 };
    display.sync(turret, 0, a.port); const fallback = display.children[4] as Graphics;
    expect((display.children[2] as Sprite).visible).toBe(false);
    const shadow = display.children[0] as Graphics;
    expect(shadow.y).toBeCloseTo(actor.radius * .55); expect(shadow.scale.x).toBeCloseTo(actor.radius * 1.05);
    expect(shadow.scale.y * .36).toBeCloseTo(actor.radius * .5); expect(shadow.alpha * .32).toBeCloseTo(.28);
    expect((display.children[8] as Sprite).alpha).toBe(.55);
    const initial = fallback.getLocalBounds().width;
    display.sync({ ...turret, spawnProgress: 1 }, 0, a.port); expect(fallback.getLocalBounds().width).toBeGreaterThan(initial);
    const idle = fingerprint(fallback);
    display.sync({ ...turret, spawnProgress: 1, recoil: .16 }, 0, a.port); expect(fingerprint(fallback)).not.toBe(idle);
    display.destroy(); a.texture.destroy(true);
  });
  it('keeps the turret highlight inside the barrel as the rotated two-pixel source rectangle', () => {
    const a = assets(), display = new ActorDisplay();
    const turret: ActorView = { ...actor, kind: 'turret', recoil: .08, spawnProgress: 1, angle: .7 };
    display.sync(turret, 0, a.port);
    const graphics = display.children[4] as Graphics;
    const highlight = graphics.context.instructions.find(instruction => instruction.action === 'fill'
      && instruction.data.style.color === 0xffffff && instruction.data.style.alpha === .16);
    expect(highlight?.action).toBe('fill');
    if (!highlight || highlight.action !== 'fill') throw new Error('Missing actual highlight fill');
    const path = highlight.data.path.instructions;
    const polygon = path.find(command => command.action === 'poly');
    expect(polygon).toBeDefined();
    if (!polygon || polygon.action !== 'poly') throw new Error('Highlight must be a filled rectangle polygon');
    const radius = turret.radius, left = radius * .2, right = left + radius * 1.5 - .5 * 4;
    const rotate = (x: number, y: number) => [x * Math.cos(.7) - y * Math.sin(.7), x * Math.sin(.7) + y * Math.cos(.7)];
    expect(polygon.data[0]).toEqual([...rotate(left, -4.2), ...rotate(right, -4.2), ...rotate(right, -2.2), ...rotate(left, -2.2)]);
    display.destroy(); a.texture.destroy(true);
  });
  it('carries a real Neon session turret color through its frame to a shipped glow asset', () => {
    const game = createGameSession();
    expect(game.dispatch({ type: 'start-run', options: { characterId: 'neon_party', difficulty: 'normal', partySize: 1, seed: 69, pilot: false } }).ok).toBe(true);
    for (let tick = 0; tick < 100; tick++) game.advance(EMPTY_INPUT);
    const frame = game.readFrame(), turret = frame.actors.find(actor => actor.kind === 'turret');
    expect(turret).toBeDefined();
    if (!turret) throw new Error('Neon must naturally deploy a real turret');
    const weapon = getWeapon(turret.definitionId);
    expect(weapon).not.toBeNull();
    if (!weapon) throw new Error('A real turret needs its weapon definition');
    expect(turret.color).toBe(weapon.color);
    const a = assets(), display = new ActorDisplay(); display.sync(turret, frame.time, a.port);
    const glow = `glow_${weapon.color.slice(1).toLowerCase()}.png`;
    expect(a.files).toContain(`ordinary/${glow}`); expect(a.files).not.toContain('ordinary/glow_ffffff.png');
    expect(primitiveManifest.files.some(file => file.name === glow)).toBe(true);
    display.destroy(); a.texture.destroy(true);
  });
  it('uses the actual pickup variant and phase, independently of identity or render time', () => {
    const a = assets(), display = new PickupDisplay();
    const pickup: PickupView = { id: 2, kind: 'material', x: 10, y: 20, variant: 1, bobPhase: Math.PI / 2 };
    display.sync(pickup, a.port); expect(a.requested).toEqual(['coin_1']); expect(display.y).toBeCloseTo(22);
    display.sync(pickup, a.port); expect(display.y).toBeCloseTo(22);
    display.destroy(); a.texture.destroy(true);
  });
  it('renders projected projectile history even when stable appearance is cached', () => {
    const a = assets(), display = new ProjectileDisplay(false), textures = new ProjectileTextures({ generateTexture: () => new Texture({ source: new TextureSource({ width: 32, height: 32 }) }) } as unknown as PixiRenderer);
    const bullet: ProjectileView = { id: 1, x: 10, y: 0, radius: 4, angle: 0, color: '#ff7bac', hostile: false, playerStyle: 'shot', trail: [{ x: 0, y: 0, alpha: .8 }, { x: 5, y: 0, alpha: .9 }] };
    display.sync(bullet, textures, a.port); const trail = display.children[4] as Graphics;
    expect(trail).toBeInstanceOf(Graphics); expect(trail.context.instructions.length).toBeGreaterThan(0);
    const before = fingerprint(trail);
    display.sync({ ...bullet, x: 20, trail: [{ x: 0, y: 5, alpha: .8 }, { x: 15, y: 5, alpha: .9 }] }, textures, a.port);
    expect(fingerprint(trail)).not.toBe(before);
    display.destroy(); textures.dispose(); a.texture.destroy(true);
  });
  it('does not invent orbit history from display sampling', () => {
    const a = assets(), display = new WeaponDisplay(false);
    const ball: WeaponView = { id: 'ball', ownerId: 1, definitionId: 'mouse_toy', x: 10, y: 0, angle: 0, radius: 9, color: '#ffd23a', orbitRadius: 80, ballIndex: 0, trail: [{ x: 0, y: 0 }, { x: 5, y: 0 }] };
    display.sync(ball, undefined, 1); const trail = display.children[1] as Graphics, before = fingerprint(trail);
    display.sync(ball, undefined, 2); expect(fingerprint(trail)).toBe(before);
    display.destroy(); a.texture.destroy(true);
  });
});

it('uses the injected desktop/mobile blend policy for the actual attack primitives', () => {
  for (const mobile of [false, true]) {
    const projectile = new ProjectileDisplay(mobile), orbit = new WeaponDisplay(mobile), blend = mobile ? 'normal' : 'add';
    expect(projectile.children[4].blendMode).toBe(blend); expect(projectile.children[5].blendMode).toBe(blend);
    expect(orbit.children[0].blendMode).toBe(blend); expect(orbit.children[2].blendMode).toBe(blend);
    expect(orbit.children[1].blendMode).toBe('normal'); expect(orbit.children[3].blendMode).toBe('normal');
    projectile.destroy(); orbit.destroy();
  }
});
