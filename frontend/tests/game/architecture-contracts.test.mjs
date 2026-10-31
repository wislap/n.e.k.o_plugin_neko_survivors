import test from 'node:test';
import assert from 'node:assert/strict';
import { Shop, ShopOffer } from '../../src/game/progression/shop.ts';
import { RNG } from '../../src/game/math/random.ts';
import { getItem } from '../../src/game/content/items.ts';
import { getWeapon } from '../../src/game/content/weapons.ts';
import { luckBenefits, stealChance } from '../../src/game/progression/luck-rules.ts';
import { weaponLevelModifiers, WEAPON_GROWTH } from '../../src/game/progression/weapon-growth.ts';
import { expandTerrain, blockedAt, resolveTerrain, findFreeSpot } from '../../src/game/world/terrain.ts';
import { WORLD_SIZE } from '../../src/game/world/config.ts';
import { buildMaze } from '../../src/game/world/maze.ts';
import { SNOW_MAZE } from '../../src/game/content/maze.ts';
import { createGameSession } from '../../src/game/index.ts';
import { convertLegacyProgress, decodeSave, isSupportedSave } from '../../src/game/save/schema.ts';

test('shop owns detached offer, lock and per-buyer refresh snapshots', () => {
  const shop = new Shop(new RNG(69));
  shop.offers = [new ShopOffer('item', getItem('warm_milk'), 42, { source: 'reward' }), new ShopOffer('weapon', getWeapon('cat_paw'), 19)];
  shop.offers[0].pawMark = .25; shop.offers[1].sold = true;
  shop.locked.add(0); shop.rerollCount = 3; shop.mateRerolls.set(2, 7);
  const state = shop.captureState(), restored = new Shop(new RNG(70));
  restored.restoreState(state);
  assert.deepEqual(restored.captureState(), state);
  state.offers[0].meta.source = 'changed'; state.locked.length = 0;
  assert.equal(restored.offers[0].meta.source, 'reward'); assert.deepEqual([...restored.locked], [0]);
  assert.equal('freeRerollUsed' in restored.captureState(), false);
});

test('shared growth and luck rules retain caps, character-effective input and negative luck', () => {
  assert.deepEqual(luckBenefits(220), { dropMultiplier: 3.2, shopQualityBonus: 1, mimicRareBonus: .3 });
  assert.equal(luckBenefits(-40).dropMultiplier, .6); assert.equal(luckBenefits(-40).shopQualityBonus, 0);
  assert.equal(stealChance(-100), .2); assert.equal(stealChance(10000), .5);
  assert.deepEqual(weaponLevelModifiers(1), { damage: 1, cooldown: 1 });
  assert.equal(weaponLevelModifiers(100).cooldown, WEAPON_GROWTH.minimumCooldownMultiplier);
});

test('terrain algorithms consume shared arena dimensions and preserve collision/spawn behavior', () => {
  const terrain = expandTerrain('garden');
  assert.equal(WORLD_SIZE, 2400); assert.ok(terrain.circles.length > 0);
  const circle = terrain.circles[0]; assert.ok(blockedAt(terrain, circle.cx, circle.cy));
  const actor = { x: circle.cx, y: circle.cy, radius: 14 }; assert.ok(resolveTerrain(terrain, actor));
  assert.equal(blockedAt(terrain, actor.x, actor.y, actor.radius - .001), false);
  assert.equal(findFreeSpot(terrain, () => ({ x: circle.cx, y: circle.cy }), 14, 3), null);
  assert.equal(buildMaze(SNOW_MAZE).reachableCells, SNOW_MAZE.n ** 2);
});

test('normal recovery accepts v2 only; explicit legacy conversion removes retired state once', () => {
  const session = createGameSession(); session.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69 } });
  const current = session.exportSave(); assert.equal(current.version, 2);
  const legacy = structuredClone(current); legacy.version = 1;
  legacy.run.shop.freeRerollUsed = true;
  legacy.run.systems.weather.arrays.typhoons = [{ x: 1, y: 2, r: 3, vx: 0, vy: 1, spin: 1, turnT: 2, parts: [] }];
  assert.throws(() => decodeSave(legacy), TypeError);
  const imported = convertLegacyProgress({ run: legacy, meta: null }); assert.ok(imported);
  assert.equal(imported.run.version, 2); assert.equal('freeRerollUsed' in imported.run.run.shop, false);
  assert.equal('parts' in imported.run.run.systems.weather.arrays.typhoons[0], false);
  assert.doesNotThrow(() => createGameSession({ save: imported.run }));
  const broken = structuredClone(legacy); broken.run.player.weapons[0].id = 'unknown';
  assert.equal(convertLegacyProgress({ run: broken, meta: null }), null);
  assert.equal(convertLegacyProgress({ run: current, meta: null }), null);
});


test('current saves reject missing core fields rather than invoking legacy defaults', () => {
  const session = createGameSession(); session.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69 } });
  for (const key of ['rngState', 'mates', 'bossChoices', 'pilot', 'shop', 'systems', 'pet', 'afterUpgrade', 'waveStartRules']) {
    const broken = session.exportSave(); delete broken.run[key];
    assert.equal(isSupportedSave(broken), false, key);
    assert.throws(() => createGameSession({ save: broken }), TypeError, key);
  }
  const original = session.exportSave();
  const raw = { ...original.run.player, seed: original.run.seed, waveIndex: 0, phase: 'play', p1Ai: true, party: 0 };
  const migrated = convertLegacyProgress({ run: raw, meta: null });
  assert.ok(migrated); assert.equal(migrated.run.run.pilot, true); assert.equal(migrated.run.run.phase, 'playing');
  assert.equal('p1Ai' in migrated.run.run, false); assert.equal('characterId' in migrated.run.run, false);
});


test('v2 player snapshots require real state while legacy defaults are filled once and modifier maps stay sparse', () => {
  const session = createGameSession(); session.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69 } });
  const original = session.exportSave();
  for (const key of ['id', 'x', 'y', 'xpNeeded', 'materials', 'shield', 'maxShield', 'shieldFullBlock', 'apPierce',
    'kills', 'damageDealt', 'damageTaken', 'timeAlive', 'charMul', 'dealtFinalMul', 'takenFinalMul', 'xpDebt', 'materialDebt', 'pendingLevelUps']) {
    const broken = structuredClone(original); delete broken.run.player[key];
    assert.equal(isSupportedSave(broken), false, key);
    assert.throws(() => createGameSession({ save: broken }), TypeError, key);
  }
  const sparse = structuredClone(original);
  sparse.run.player.stats.flat = {}; sparse.run.player.stats.pct = {}; sparse.run.player.stats.curse = {};
  sparse.run.player.stats.finalMul = {}; sparse.run.player.stats.capBonus = {};
  assert.ok(isSupportedSave(sparse)); assert.doesNotThrow(() => createGameSession({ save: sparse }));
  const legacy = structuredClone(original); legacy.version = 1;
  for (const key of ['materials', 'x', 'y', 'dealtFinalMul', 'takenFinalMul', 'apPierce']) delete legacy.run.player[key];
  const imported = convertLegacyProgress({ run: legacy, meta: null }); assert.ok(imported);
  assert.equal(imported.run.run.player.materials, 0); assert.equal(imported.run.run.player.dealtFinalMul, 1);
});

test('only explicit legacy import extracts visual opacity into settings, keeping growth metadata clean', () => {
  const migrated = convertLegacyProgress({ run: null, meta: { bestWave: 7, fxAlpha: 75 } });
  assert.ok(migrated); assert.equal(migrated.meta.bestWave, 7);
  assert.equal('fxAlpha' in migrated.meta, false); assert.deepEqual(migrated.settings, { playerEffectOpacity: .75 });
  assert.deepEqual(convertLegacyProgress({ run: null, meta: { fxAlpha: 50 } }),
    { run: null, meta: null, settings: { playerEffectOpacity: .5 } });
  assert.equal(convertLegacyProgress({ run: null, meta: { fxAlpha: 101 } }), null);
});

test('current pet state is complete and cooldowns survive continuation; partial old pets migrate once', () => {
  const session = createGameSession(); session.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69 } });
  const saved = session.exportSave(); saved.run.phase = 'shop';
  saved.run.pet.fields.healCd = 12.25; saved.run.pet.fields.vacuumCd = 8.75;
  const continued = createGameSession({ save: saved }).exportSave();
  assert.equal(continued.run.pet.fields.healCd, 12.25); assert.equal(continued.run.pet.fields.vacuumCd, 8.75);
  for (const key of Object.keys(saved.run.pet.fields)) {
    const broken = structuredClone(saved); delete broken.run.pet.fields[key];
    assert.equal(isSupportedSave(broken), false, key);
    assert.throws(() => createGameSession({ save: broken }), TypeError, key);
  }
  const missingStream = structuredClone(saved); delete missingStream.run.pet.rngState;
  assert.equal(isSupportedSave(missingStream), false);
  const old = structuredClone(saved); old.version = 1; delete old.run.pet.fields.healCd; delete old.run.pet.rngState;
  const imported = convertLegacyProgress({ run: old, meta: null }); assert.ok(imported);
  assert.equal(imported.run.run.pet.fields.healCd, 0); assert.equal(imported.run.run.pet.fields.vacuumCd, 8.75);
  assert.ok(Number.isSafeInteger(imported.run.run.pet.rngState));
  assert.doesNotThrow(() => createGameSession({ save: imported.run }));
});

test('current metadata cannot use partial-profile recovery; explicit legacy import owns all missing-field defaults', () => {
  const session = createGameSession(); session.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69 } });
  const original = session.exportSave();
  for (const key of Object.keys(original.meta)) {
    const incomplete = structuredClone(original.meta); delete incomplete[key];
    assert.throws(() => createGameSession({ meta: incomplete }), TypeError, key);
    const damagedSave = structuredClone(original); damagedSave.meta = incomplete;
    assert.equal(isSupportedSave(damagedSave), false, key);
  }
  const old = structuredClone(original); old.version = 1; old.meta = { wins: 4 };
  const imported = convertLegacyProgress({ run: old, meta: { bestWave: 12, flandreUnlocked: true } });
  assert.ok(imported); assert.equal(imported.meta.bestWave, 12); assert.equal(imported.meta.wins, 0);
  assert.equal(imported.meta.flandreUnlocked, true); assert.equal(imported.run.meta.wins, 4);
  assert.equal(imported.run.meta.bestWave, 0); assert.doesNotThrow(() => createGameSession({ save: imported.run, meta: imported.meta }));
  assert.equal(convertLegacyProgress({ run: null, meta: { wins: NaN } }), null);
});
