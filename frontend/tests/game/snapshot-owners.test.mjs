import test from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../../src/game/math/random.ts';
import { Player } from '../../src/game/actors/player.ts';
import { Pet } from '../../src/game/actors/pet.ts';
import { WeatherSystem } from '../../src/game/encounters/weather.ts';
import { CometDisaster } from '../../src/game/encounters/comet.ts';
import { ITEMS } from '../../src/game/content/items.ts';
import { WEAPONS } from '../../src/game/content/weapons.ts';
import { UPGRADES } from '../../src/game/content/upgrades.ts';
import { isPetSave } from '../../src/game/save/pet-state.ts';
import { isWaveSystems } from '../../src/game/save/wave-systems.ts';

test('Player owns an isolated growth snapshot and restores it onto a fresh entry actor', () => {
  const source = new Player('yui', new RNG(987));
  source.id = 2; source.materials = 72; source.hp = 11;
  source.addWeapon(WEAPONS[0].id, 3).instanceId = 123;
  source.items.set(ITEMS[0].id, 2); source.upgradesTaken.set(UPGRADES[0].id, 2);
  source.stats.addFlat('damage', 7); source.stats.addCapBonus('damage', 5);
  source._armorWave = 12;
  const snapshot = source.captureState(), expected = structuredClone(snapshot);
  const rngBefore = source.rng.state;
  source.captureState();
  assert.equal(source.rng.state, rngBefore);
  source.items.clear(); source.upgradesTaken.clear(); source.weapons[0].level++;
  source.stats.addFlat('damage', 5); source.charMul.damage = 9;
  assert.deepEqual(snapshot, expected);
  const restored = new Player('yui', new RNG(987));
  restored.restoreState(snapshot);
  assert.deepEqual(restored.captureState(), snapshot);
  restored.weapons[0].level++; restored.stats.addCapBonus('damage', 1);
  assert.deepEqual(snapshot, expected);
});

test('Pet restores cooldowns and its own RNG while discarding replayed entity targets', () => {
  const player = new Player('yui', new RNG(987)), pet = new Pet('kitten', player);
  pet.healCd = 12.4; pet.vacuumCd = 8; pet.line = '存档台词'; pet.rng.next();
  const snapshot = pet.captureState();
  assert.equal(isPetSave(snapshot), true);
  const restored = new Pet('kitten', player);
  restored.target = { dead: false }; restored.fetchTarget = { dead: false };
  restored.restoreState(snapshot);
  assert.deepEqual(restored.captureState(), snapshot);
  assert.equal(restored.target, null); assert.equal(restored.fetchTarget, null);
  assert.equal(restored.rng.next(), pet.rng.next());
  restored.healCd = 1;
  assert.equal(snapshot.fields.healCd, 12.4);
});

test('Weather owns collection copies and binds persistent burns only to the new player roster', () => {
  const rng = new RNG(69), source = new WeatherSystem(rng), comet = new CometDisaster({ rng });
  const oldPlayers = [1, 2, 3, 4].map(id => { const player = new Player('yui', rng); player.id = id; return player; });
  source.meteors.push({ x: 1, y: 2, r: 3, warnT: .8, side: 0 });
  source.burns = oldPlayers.map((player, index) => ({ e: player, isPlayer: true, t: index + .5, acc: .2 }));
  const snapshot = source.captureState(), expected = structuredClone(snapshot);
  assert.equal(isWaveSystems({ weather: snapshot, comet: comet.captureState() }), true);
  source.meteors[0].x = 100; source.burns[0].t = 100;
  assert.deepEqual(snapshot, expected);
  const roster = oldPlayers.slice(0, 3).map(old => { const player = new Player('yui', rng); player.id = old.id; return player; });
  const restored = new WeatherSystem(rng);
  restored.restoreState(snapshot, roster);
  assert.deepEqual(restored.captureState(), { ...snapshot, playerBurns: snapshot.playerBurns.slice(0, 3) });
  assert.deepEqual(restored.burns.map(burn => burn.e), roster);
  restored.meteors[0].x = -100;
  assert.deepEqual(snapshot, expected);
});

test('Comet owns its entry clock and RNG without persisting replay FX or playback objects', () => {
  const source = new CometDisaster({ rng: new RNG(123) });
  source.phase = 'banner'; source.t = .5; source.pending = true; source._bgmDelay = .8;
  source.rng.next();
  const snapshot = source.captureState(), restored = new CometDisaster({ rng: new RNG(123) });
  restored.restoreState(snapshot);
  assert.deepEqual(restored.captureState(), snapshot);
  assert.equal(restored.rng.next(), source.rng.next());
  assert.deepEqual(restored.bolts, []); assert.deepEqual(restored.rings, []);
  assert.equal(restored._bgm, null);
});
