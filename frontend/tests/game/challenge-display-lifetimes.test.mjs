import test from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../../src/game/math/random.ts';
import { World } from '../../src/game/world/world.ts';
import { Player } from '../../src/game/actors/player.ts';
import { createController } from '../../src/game/encounters/controllers.ts';
import { createChallengeSession } from '../../src/game/encounters/challenge-session.ts';
import { WeatherSystem } from '../../src/game/encounters/weather.ts';
import { CometDisaster } from '../../src/game/encounters/comet.ts';
import { projectWeather, projectComet } from '../../src/game/encounters/projection.ts';

function setup(kind, seed = 19) {
  const rng = new RNG(seed), events = [];
  const effects = { emit: event => events.push(event) };
  const world = new World(rng, { effects });
  const player = new Player('yui', rng, effects);
  world.player = player; player.world = world;
  // The established encounter harness isolates effect lifetimes from defeat.
  player.takeDamage = () => ({ blocked: true, dmg: 0 });
  const controller = createController(kind, { rng, world, player, effects });
  const challenge = createChallengeSession(controller, world);
  world.challenge = challenge;
  let tick = 0;
  function advance(seconds) {
    for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) {
      challenge.advance(1 / 60);
      world.update(controller.timeScale / 60, player, tick++ / 60);
    }
  }
  return { rng, events, effects, world, player, controller, challenge, advance };
}

test('real Vergil ultimates advance and retire blade sparks instead of accumulating stationary effects', () => {
  const state = setup('vergil'); state.advance(10);
  for (let round = 0; round < 3; round++) {
    state.controller._startUlt();
    state.advance(.6);
    assert.ok(state.controller.bladeSparks.length > 0);
    const spark = state.controller.bladeSparks[0], before = { x: spark.x, y: spark.y, t: spark.t };
    const projected = state.challenge.readFrame().effects.find(effect => effect.variant === 'blade');
    assert.ok(projected, 'the actual blade shape and angle reach the display');
    state.advance(1 / 60);
    assert.ok(spark.t > before.t);
    assert.ok(spark.x !== before.x || spark.y !== before.y);
    state.advance(3);
    assert.equal(state.controller.bladeSparks.length, 0);
    assert.equal(state.challenge.readFrame().effects.filter(effect => effect.variant === 'blade').length, 0);
  }
  assert.equal(state.events.filter(event => event.type === 'sound' && event.name === 'vergil_ult').length, 3);
});

test('Remilia projects the same orbiting bats that its controller initializes and advances', () => {
  const state = setup('remilia'); state.advance(4);
  const rngBefore = state.controller.rng.state;
  const frame = state.challenge.readFrame(), view = frame.encounter;
  assert.equal(view.kind, 'remilia');
  assert.equal(view.bats.length, state.controller.bats.length);
  const bat = state.controller.bats[0], expectedRadius = 560 * bat.r;
  assert.equal(view.bats[0].x, state.controller.arena.cx + Math.cos(bat.a) * expectedRadius);
  assert.equal(view.bats[0].y, state.controller.arena.cy + Math.sin(bat.a) * expectedRadius * .55);
  assert.equal(view.bats[0].width, 26 * bat.s);
  assert.equal(view.bats[0].height, 26 * bat.s * .62 * (.55 + .45 * Math.sin(state.controller.t * 13 + bat.ph)));
  assert.equal(view.bats[0].alpha, .55 + .35 * Math.sin(state.controller.t * 2 + bat.ph));
  assert.equal(state.controller.rng.state, rngBefore, 'projection never consumes gameplay randomness');
  const first = view.bats[0]; state.advance(1 / 60);
  assert.notDeepEqual(state.challenge.readFrame().encounter.bats[0], first);
});

test('actual Vergil charge cracks, mirage embers and glass shard geometry reach the frame', () => {
  const state = setup('vergil'); state.advance(10);
  state.controller._tryMirage(); state.advance(.4);
  assert.ok(state.controller.mirageEmbers.length > 0);
  assert.ok(state.challenge.readFrame().effects.some(effect => String(effect.id).startsWith('vergil-mirage-ember-')));
  state.controller._enterPhase(3); state.advance(2);
  assert.ok(state.controller.chargeCracks.length > 0);
  assert.ok(state.challenge.readFrame().effects.some(effect => effect.variant === 'crack'));
  state.controller._shatterBig(0, 0);
  const shard = state.controller.shards[0], rngBefore = state.controller.rng.state;
  const projected = state.challenge.readFrame().effects.find(effect => effect.variant === 'glass');
  assert.equal(projected.points.length, shard.verts.length);
  assert.equal(projected.angle, shard.rot);
  assert.deepEqual(projected.points[0], { x: shard.x + shard.verts[0][0], y: shard.y + shard.verts[0][1] });
  assert.equal(state.controller.rng.state, rngBefore);
});

test('environment projection preserves fog ramp, comet velocity and original warm ring distinction', () => {
  const state = setup('remilia');
  const weather = new WeatherSystem(state.rng);
  weather.id = 'fog'; weather.phase = 'active'; weather.visT = 1;
  weather._applyFlags();
  assert.equal(projectWeather(weather).fogStrength, weather.fogRamp);
  assert.ok(weather.fogRamp > 0 && weather.fogRamp < 1);
  const comet = new CometDisaster({ rng: state.rng, effects: state.effects });
  comet.forceTrigger(1);
  let observedBolt = false, observedWarm = false, observedCool = false;
  for (let tick = 0; tick < 1800; tick++) {
    comet.update(1 / 60, { world: state.world, rng: state.rng, speak() {} });
    const view = projectComet(comet);
    if (view?.bolts.length) {
      observedBolt = true;
      assert.equal(view.bolts[0].radius, comet.bolts[0].r);
      assert.equal(view.bolts[0].vy, comet.bolts[0].vy);
    }
    if (view?.rings.length) {
      assert.ok(comet.rings.every(ring => !Object.hasOwn(ring, 'r')), 'no unused constant ring radius state');
      observedWarm ||= view.rings.some(ring => ring.warm);
      observedCool ||= view.rings.some(ring => !ring.warm && ring.kind !== 'ground');
    }
  }
  assert.ok(observedBolt && observedWarm && observedCool);
});
