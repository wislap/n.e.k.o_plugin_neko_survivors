import { describe, expect, it } from 'vitest';
import { RNG } from '../../src/game/math/random.ts';
import { World } from '../../src/game/world/world.ts';
import { Player } from '../../src/game/actors/player.ts';
import { createController } from '../../src/game/encounters/controllers.ts';
import { createChallengeSession } from '../../src/game/encounters/challenge-session.ts';
import { enemyEyePlacement, EYE_ANCHORS } from '../../src/rendering/enemy-eyes';
function encounter(kind) {
  const rng = new RNG(19), effects = { emit() {} }, world = new World(rng, { effects });
  const player = new Player('yui', rng, effects); world.player = player; player.world = world;
  const controller = createController(kind, { rng, world, player, effects });
  const challenge = createChallengeSession(controller, world); world.challenge = challenge;
  return { controller, challenge };
}

describe('live attack geometry projection', () => {
  it('retains the real Flandre laser sweep and makes dangerous emitters visibly solid', () => {
    const { controller: fight, challenge } = encounter('flandre');
    fight.spell = { id: 'laevateinn', t: 0, st: {
      lasers: [{ x: 1, y: 2, angle: .2, sweep: -1, len: 400, width: 24, warn: .4, fade: 1 }],
      vis: [{ x: 30, y: 40, kind: 'blood', r: 20, color: '#aaffff' }],
    } };
    const frame = fight.readFrame();
    expect(frame.telegraphs.find((v) => v.kind === 'cone')).toMatchObject({ radius: 400, spread: 1, angle: -.3 });
    expect(frame.effects.find((v) => v.kind === 'emitter')).toMatchObject({ variant: 'blood', radius: 20, x: 30, y: 40 });
    challenge.dispose();
  });
  it('projects the six real unfired Vergil mirage swords and the guarding state', () => {
    const { controller: fight, challenge } = encounter('vergil'); fight.state = 'wander'; fight.guarding = true;
    expect(fight._tryMirage()).toBe(true);
    const frame = fight.readFrame();
    expect(frame.encounter).toMatchObject({ kind: 'vergil', guarding: true });
    expect(frame.projectiles.filter((v) => String(v.id).startsWith('vergil-orbit'))).toHaveLength(6);
    challenge.dispose();
  });
  it('distinguishes Halloween warnings, firing lasers and cross-shaped pumpkin explosions', () => {
    const { controller: fight, challenge } = encounter('halloween'); fight.t = .5;
    fight.pumpkins.push({ x: 0, y: 0, t: 0, age: .18 });
    fight.waves.push({ x: 0, y: 0, angle: 0, life: 2.2, t: 2.1, who: 'choco' }, { x: 0, y: 0, angle: 1, life: 2.2, t: 1.3, who: 'vanilla' });
    const frame = fight.readFrame();
    expect(frame.encounter?.kind).toBe('halloween');
    expect(frame.encounter.pumpkins[0].exploding).toBe(true);
    expect(frame.encounter.pumpkins[0].progress).toBeCloseTo(.2);
    expect(frame.telegraphs.find((v) => v.id === 'halloween-laser-0')?.width).toBe(5);
    expect(frame.telegraphs.find((v) => v.id === 'halloween-laser-1')?.width).toBeGreaterThan(40);
    expect(frame.encounter.cats.map((cat) => cat.alpha)).toEqual([.5, .5]);
    expect(frame.encounter.cats[0].x).not.toBe(frame.encounter.cats[1].x);
    challenge.dispose();
  });
  it('keeps moving enemy eyes inside every measured face boundary', () => {
    for (const id of Object.keys(EYE_ANCHORS)) for (const radius of [5, 12, 60]) for (let i = 0; i < 32; i++) {
      const p = enemyEyePlacement(id, radius, i * Math.PI / 16);
      for (const eye of p.eyes) {
        expect(eye.x - p.eyeRadius).toBeGreaterThanOrEqual(p.left - .00001);
        expect(eye.x + p.eyeRadius).toBeLessThanOrEqual(p.right + .00001);
      }
    }
  });
});
