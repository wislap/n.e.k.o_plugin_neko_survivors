import test from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../../src/game/math/random.ts';
import { World } from '../../src/game/world/world.ts';
import { Player } from '../../src/game/actors/player.ts';
import { WeatherSystem, CometDisaster } from '../../src/game/encounters/index.ts';
import { isWaveSystems } from '../../src/game/save/wave-systems.ts';
import { createGameSession, EMPTY_INPUT } from '../../src/game/index.ts';
function setup() {
  const rng = new RNG(69), world = new World(rng), player = new Player('yui', rng);
  player.id = 1; world.player = player; world.waves.begin(0); world.noSpawn = true;
  const weather = new WeatherSystem(rng), comet = new CometDisaster({ rng });
  world.weather = weather; world.comet = comet;
  return { rng, world, player, weather, comet };
}

test('wave entry captures independent weather/comet randomness and safe player burn ownership', () => {
  const first = setup();
  first.weather.phase = 'active'; first.weather.id = 'meteor'; first.weather.dur = 30;
  first.weather.rng.next(); first.weather.rng.next(); first.comet.rng.next();
  first.weather.burns.push({ e: first.player, t: 2, acc: 0.3, isPlayer: true });
  const snapshot = { weather: first.weather.captureState(), comet: first.comet.captureState() };
  assert.equal(isWaveSystems(snapshot), true);
  const second = setup();
  second.weather.restoreState(snapshot.weather, [second.player]); second.comet.restoreState(snapshot.comet);
  assert.equal(second.weather.burns[0].e, second.player);
  assert.notEqual(second.weather.burns[0].e, first.player);
  for (let i = 0; i < 200; i++) {
    first.weather.update(1 / 60, first.world, first.player);
    second.weather.update(1 / 60, second.world, second.player);
  }
  assert.deepEqual({ weather: first.weather.captureState(), comet: first.comet.captureState() }, { weather: second.weather.captureState(), comet: second.comet.captureState() });
});

test('public continuation restarts the current wave with its environmental entry streams', () => {
  const original = createGameSession();
  original.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69 } });
  const saved = original.exportSave();
  const fields = saved.run.waveStartRules.systems.weather.fields;
  fields.phase = 'active'; fields.id = 'bloodMoon'; fields.dur = 25; fields.t = 6; fields.visT = 6;
  const first = createGameSession({ save: saved });
  for (let i = 0; i < 180; i++) first.advance(EMPTY_INPUT);
  const continued = createGameSession({ save: first.exportSave() });
  assert.equal(continued.readFrame().weather.id, 'bloodMoon');
  assert.equal(continued.readFrame().weather.elapsed, 6);
  assert.equal(continued.exportSave().run.waveStartRules.systems.weather.rngState, saved.run.waveStartRules.systems.weather.rngState);
  assert.equal(continued.readUi().secondsLeft, 30);
});

test('environment validation rejects unexpected phases and executable-shaped properties', () => {
  const source = setup(); const snapshot = { weather: source.weather.captureState(), comet: source.comet.captureState() };
  snapshot.weather.fields.phase = 'unknown'; assert.equal(isWaveSystems(snapshot), false);
  snapshot.weather.fields.phase = 'idle'; snapshot.comet.fields.update = 'malicious';
  assert.equal(isWaveSystems(snapshot), false);
});

function activeWeather(index) {
  const source = setup();
  const originalInt = source.weather.rng.int.bind(source.weather.rng);
  let first = true;
  source.weather.rng.int = (min, max) => {
    const sampled = originalInt(min, max);
    if (first) { first = false; return index; }
    return sampled;
  };
  source.weather._start(source.player);
  source.weather.rng.int = originalInt;
  for (let step = 0; step < 30; step++) source.weather.update(1 / 60, source.world, source.player);
  return source;
}

test('all ten active weather systems restore their mechanic entities and RNG', () => {
  for (let weatherIndex = 0; weatherIndex < 10; weatherIndex++) {
    const first = activeWeather(weatherIndex), second = setup();
    const snapshot = { weather: first.weather.captureState(), comet: first.comet.captureState() };
    assert.equal(isWaveSystems(snapshot), true);
    second.weather.restoreState(snapshot.weather, [second.player]); second.comet.restoreState(snapshot.comet);
    second.player.x = first.player.x; second.player.y = first.player.y; second.player.hp = first.player.hp;
    for (let step = 0; step < 60; step++) {
      first.weather.update(1 / 60, first.world, first.player);
      second.weather.update(1 / 60, second.world, second.player);
    }
    assert.deepEqual({ weather: second.weather.captureState(), comet: second.comet.captureState() }, { weather: first.weather.captureState(), comet: first.comet.captureState() }, first.weather.id);
  }
});

test('public continue and retry retain typhoon/river-fog mechanics without presentation buffers', () => {
  for (const weatherIndex of [5, 9]) {
    const source = activeWeather(weatherIndex);
    const snapshot = { weather: source.weather.captureState(), comet: source.comet.captureState() };
    const seed = createGameSession();
    seed.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69 } });
    const saved = seed.exportSave();
    saved.run.phase = 'shop'; saved.run.systems = snapshot;
    const continued = createGameSession({ save: saved });
    assert.equal(continued.readUi().phase, 'shop');
    assert.equal(continued.dispatch({ type: 'next-wave' }).ok, true);
    assert.equal(continued.readUi().wave, 2);
    assert.equal(continued.readFrame().weather.id, source.weather.id);
    for (let step = 0; step < 60; step++) continued.advance(EMPTY_INPUT);
    const restoredAgain = createGameSession({ save: continued.exportSave() });
    assert.equal(restoredAgain.readFrame().weather.id, source.weather.id);
    assert.equal(restoredAgain.dispatch({ type: 'retry-wave' }).ok, true);
    for (let step = 0; step < 60; step++) restoredAgain.advance(EMPTY_INPUT);
    assert.equal(restoredAgain.readFrame().weather.id, source.weather.id);
    const final = restoredAgain.exportSave().run.systems.weather.arrays;
    for (const entity of [...final.typhoons, ...final.fogClouds]) {
      for (const key of ['parts', 'streaks', 'blobs']) assert.equal(key in entity, false);
    }
  }
});

test('retired presentation collections are rejected by current environmental schema', () => {
  const source = activeWeather(5);
  const snapshot = { weather: source.weather.captureState(), comet: source.comet.captureState() };
  snapshot.weather.arrays.typhoons[0].parts = 'bad';
  assert.equal(isWaveSystems(snapshot), false);
});


test('current environmental snapshots reject every missing comet field', () => {
  const state = setup(), complete = { weather: state.weather.captureState(), comet: state.comet.captureState() };
  assert.equal(isWaveSystems(complete), true);
  assert.equal(complete.comet.fields._bgmDelay, 0);
  for (const key of Object.keys(complete.comet.fields)) {
    const broken = structuredClone(complete); delete broken.comet.fields[key];
    assert.equal(isWaveSystems(broken), false, key);
  }
});
