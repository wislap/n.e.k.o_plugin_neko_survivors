import { RunControl } from '../../src/game/control.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameSession, EMPTY_INPUT } from '../../src/game/index.ts';
import { createController } from '../../src/game/encounters/controllers.ts';
import { createChallengeSession } from '../../src/game/encounters/challenge-session.ts';
import { SessionEngine } from '../../src/game/session-engine.ts';
import { ENEMIES } from '../../src/game/content/enemies.ts';
import { WEATHER_DEFS } from '../../src/game/content/weather.ts';
import { Battle } from '../../src/game/battle/battle.ts';
import { RNG } from '../../src/game/math/random.ts';

const options = { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69 };
function engine(platform) {
  const result = new SessionEngine({ platform });
  assert.equal(result.dispatch({ type: 'start-run', options }).ok, true);
  result.battle.world.noSpawn = true;
  return result;
}
/** Concrete budget assertions use the same internal construction seam as production. */
function controlledFlandre(platform) {
  const state = engine(platform);
  const controller = createController('flandre', { world: state.battle.world, player: state.battle.player,
    rng: state.rng, effects: state.effects, platform });
  const challenge = createChallengeSession(controller, state.battle.world);
  state.battle.world.challenge = challenge;
  return { state, controller, challenge };
}
test('mobile ordinary spawn and effect budgets reach real world systems, without limiting bosses', () => {
  const mobile = engine('mobile'), desktop = engine('desktop');
  mobile.battle.world.enemies.clear(); desktop.battle.world.enemies.clear();
  for (let i = 0; i < 55; i++) {
    mobile.battle.world.waves.spawnEnemyById('slime', i * 40, 0);
    desktop.battle.world.waves.spawnEnemyById('slime', i * 40, 0);
  }
  assert.equal(mobile.battle.world.enemies.items.length, 50);
  assert.equal(desktop.battle.world.enemies.items.length, 55);
  assert.ok(mobile.battle.world.waves.spawnEnemyById(ENEMIES.find(enemy => enemy.boss).id, 0, 100));
  assert.equal(mobile.battle.world.fx.maxItems, 80); assert.equal(desktop.battle.world.fx.maxItems, 240);
  for (let i = 0; i < 250; i++) {
    mobile.battle.world.fx._push({ type: 'ring', x: 0, y: 0, radius: 1, color: '#ffffff', seed: 0, t: 0, life: 1 }); desktop.battle.world.fx._push({ type: 'ring', x: 0, y: 0, radius: 1, color: '#ffffff', seed: 0, t: 0, life: 1 });
  }
  assert.equal(mobile.battle.world.fx.items.length, 80); assert.equal(desktop.battle.world.fx.items.length, 240);
});
test('weather creates the legacy mobile counts while desktop keeps its existing budget', () => {
  for (const platform of ['mobile', 'desktop']) for (const id of ['typhoon', 'riverFog', 'rain']) {
    const state = engine(platform), weather = state.battle.weather;
    weather.rng.int = () => WEATHER_DEFS.findIndex(definition => definition.id === id);
    weather._start(state.battle.player);
    assert.equal(weather.id, id);
    if (id === 'rain') { assert.equal('drops' in weather, false); continue; }
    const actual = id === 'typhoon' ? weather.typhoons.length : weather.fogClouds.length;
    assert.equal(actual, (platform === 'mobile' ? { typhoon: 2, riverFog: 5 } : { typhoon: 4, riverFog: 8 })[id]);
  }
});
test('public mobile Flandre entry, continuation and retry retain mobile limits', () => {
  let session = createGameSession({ platform: 'mobile' });
  assert.equal(session.dispatch({ type: 'start-challenge', challenge: 'flandre', options }).ok, true);
  for (let pass = 0; pass < 2; pass++) {
    for (let tick = 0; tick < 1200; tick++) {
      session.advance(EMPTY_INPUT);
      assert.ok(session.readFrame().projectiles.length <= 750);
    }
    const save = session.exportSave();
    session = createGameSession({ platform: 'mobile', save });
    assert.equal(session.readUi().challengeId, 'flandre');
    assert.equal(session.dispatch({ type: 'retry-wave' }).ok, true);
  }
  for (const platform of ['mobile', 'desktop']) {
    const { controller: fight } = controlledFlandre(platform);
    const cap = platform === 'mobile' ? 750 : 1200, minimum = platform === 'mobile' ? 500 : 800;
    assert.equal(fight._capNow, cap);
    for (let step = 0; step < 400; step++) fight._adaptCap(.05);
    assert.equal(fight._capNow, minimum);
    for (let step = 0; step < 800; step++) fight._adaptCap(platform === 'mobile' ? 1 / 30 : 1 / 60);
    assert.equal(fight._capNow, cap);
  }
});
test('default desktop remains identical to explicit desktop, and platform is validated', () => {
  const a = createGameSession(), b = createGameSession({ platform: 'desktop' });
  for (const session of [a, b]) session.dispatch({ type: 'start-run', options });
  for (let step = 0; step < 240; step++) { a.advance(EMPTY_INPUT); b.advance(EMPTY_INPUT); }
  assert.deepEqual(a.exportSave(), b.exportSave());
  assert.throws(() => createGameSession({ platform: 'unknown' }), /platform/);
});
test('Flandre budget samples explicit display observations and ignores ordinary simulation steps', () => {
  const { controller: fight, challenge } = controlledFlandre('mobile');
  for (let step = 0; step < 300; step++) challenge.displayTiming.sample(1 / 30);
  assert.equal(fight._capNow, 750);
  for (let step = 0; step < 500; step++) challenge.displayTiming.sample(.05);
  assert.equal(fight._capNow, 500);
  const before = fight._capNow;
  for (let step = 0; step < 60; step++) challenge.advance(1 / 60);
  assert.equal(fight._capNow, before);
  for (let step = 0; step < 800; step++) challenge.displayTiming.sample(1 / 30);
  assert.equal(fight._capNow, 750);
  for (const seconds of [NaN, Infinity, -.5, 0, 10]) challenge.displayTiming.sample(seconds);
  assert.equal(fight._capNow, 750);
});

test('real Battle display input changes natural Flandre projectile limits without a controller replacement', () => {
  const peaks = [];
  for (const displaySeconds of [1 / 30, .05]) {
    const control = new RunControl(); control.begin(true);
    const battle = new Battle({ rng: new RNG(69), options: { ...options, difficulty: 'nightmare' }, platform: 'mobile',
      effects: { emit() {} }, control });
    battle.prepareBossRoster(); battle.bindPilots(); battle.enterWave(0, false);
    battle.enterChallenge('flandre', false);
    // A surviving fixture observes the real first cards without shortening the fight with bonus weapons.
    battle.player.stats.addFlat('maxHp', 1000000); battle.player.hp = battle.player.maxHp;
    let peak = 0;
    for (let tick = 0; tick < 4000; tick++) {
      const step = battle.advance({ ...EMPTY_INPUT, displaySeconds });
      assert.equal(step.kind, 'challenge'); assert.equal(step.result, null);
      peak = Math.max(peak, battle.world.enemyBullets.items.length);
    }
    peaks.push(peak);
  }
  assert.ok(peaks[0] > 500 && peaks[0] <= 750);
  assert.equal(peaks[1], 500);
});
