import test from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../../src/game/math/random.ts';
import { World } from '../../src/game/world/world.ts';
import { Player } from '../../src/game/actors/player.ts';
import { createController } from '../../src/game/encounters/controllers.ts';
import { createChallengeSession } from '../../src/game/encounters/challenge-session.ts';

function setup(kind) {
  const rng = new RNG(19), effects = { emit() {} }, world = new World(rng, { effects });
  const player = new Player('yui', rng, effects); world.player = player; player.world = world;
  const controller = createController(kind, { world, player, effects });
  return { controller, player, world, challenge: createChallengeSession(controller, world) };
}

test('Flandre combat observation copies actual beam geometry without exposing mutable spell state', () => {
  const { controller, challenge, player } = setup('flandre');
  controller._spawnFlandre(); controller._beginSpell('laevateinn', 30);
  for (let i = 0; i < 600 && !controller.spell.st.lasers?.length; i++) controller._tickSpell(1 / 60);
  const beam = controller.spell.st.lasers[0];
  beam.width = 41; beam.len = 777;
  const view = challenge.readCombat();
  assert.equal(view.lasers.length, controller.spell.st.lasers.length);
  assert.equal(view.lasers[0].halfWidth, 41 + player.radius);
  assert.equal(view.lasers[0].length, 777);
  assert.ok(view.lasers[0].activeFor > 0);
  view.lasers[0].x = 99999;
  assert.notEqual(beam.x, 99999);
  assert.equal('spell' in challenge, false);
  assert.equal('st' in view, false);
});

test('Halloween observation separates warning, damage and afterglow for AI consumers', () => {
  const { controller, challenge } = setup('halloween');
  controller.pumpkins.push({ x: 1, y: 2, t: .6, boom: 0 }, { x: 3, y: 4, t: 0, boom: .1 }, { x: 5, y: 6, t: 0, boom: 0 });
  controller.waves.push({ x: 0, y: 0, angle: .4, rot: -.9, life: 2.2, t: 2.1 });
  const { crosses, lasers } = challenge.readCombat();
  assert.equal(crosses[0].activeAfter, .6);
  assert.equal(crosses[1].activeAfter, 0);
  assert.equal(crosses[1].activeFor, .1);
  assert.equal(crosses[2].activeFor, 0, 'visual afterglow is not a live hazard');
  assert.equal(crosses[0].halfWidth, 30); assert.equal(crosses[0].radius, 210);
  assert.ok(Math.abs(lasers[0].activeAfter - .6) < 1e-10);
  assert.ok(Math.abs(lasers[0].activeFor - 1.5) < 1e-10);
  assert.equal(lasers[0].halfWidth, 20);
  assert.equal(lasers[0].angularVelocity, -.9);
  assert.equal('t' in crosses[0], false); assert.equal('boom' in crosses[0], false);
});

test('the challenge interface owns timing validation and disposal without clearing a replacement', () => {
  for (const kind of ['flandre', 'vergil', 'remilia', 'halloween']) {
    const { world, challenge } = setup(kind);
    world.challenge = challenge;
    const initial = structuredClone(challenge.readFrame());
    assert.equal(Object.isFrozen(challenge), true);
    for (const dt of [-1, NaN, Infinity]) assert.throws(() => challenge.advance(dt), RangeError);
    challenge.advance(0);
    assert.deepEqual(challenge.readFrame(), initial);
    challenge.advance(1 / 60);
    assert.notDeepEqual(challenge.readFrame(), initial);
    const replacement = setup(kind).challenge;
    world.challenge = replacement;
    challenge.dispose();
    assert.equal(world.challenge, replacement);
    assert.equal(challenge.timeScale, 1);
    const bodyId = challenge.readCombat().bodyId;
    if (bodyId !== null) assert.equal(world.enemies.items.find(enemy => enemy.id === bodyId).dead, true);
    const disposed = structuredClone(challenge.readFrame());
    challenge.advance(1 / 60);
    assert.deepEqual(challenge.readFrame(), disposed);
    challenge.dispose();
    assert.equal(world.challenge, replacement);
  }
});
