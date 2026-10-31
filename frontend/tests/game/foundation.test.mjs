import test from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../../src/game/math/random.ts';
import { World } from '../../src/game/world/world.ts';
import { Player } from '../../src/game/actors/player.ts';
import { Pet } from '../../src/game/actors/pet.ts';
import { Shop, ShopOffer } from '../../src/game/progression/shop.ts';
import { CHARACTERS } from '../../src/game/content/characters.ts';
import { WEAPONS, getWeapon, RECIPES } from '../../src/game/content/weapons.ts';
import { DIFFICULTY_ORDER } from '../../src/game/content/difficulty.ts';
import { getWaveDuration } from '../../src/game/content/waves.ts';
import { serializeStatMods, restoreStatMods } from '../../src/game/progression/stats.ts';
import { OverloadGuard } from '../../src/game/combat/overload.ts';
import { Pickup, PICKUP_TYPE } from '../../src/game/actors/pickup.ts';
import { EntityList, SpatialGrid } from '../../src/game/actors/entity.ts';

const input = { moveAxis: () => ({ x: 0, y: 0 }), isDown: () => false };
function setup(character = 'yui', difficulty = 'normal', seed = 1827) {
  const rng = new RNG(seed);
  const effects = [];
  const port = { emit: (event) => effects.push(event) };
  const world = new World(rng, { effects: port });
  const player = new Player(character, rng, port);
  world.player = player;
  world.waves.setDifficulty(difficulty);
  world.waves.begin(0);
  return { rng, world, player, effects };
}
function run({ world, player }, seconds) {
  for (let i = 0; i < seconds * 60; i++) {
    player.update(1 / 60, input, world);
    world.update(1 / 60, player, i / 60);
  }
}

test('all 8 characters and 4 difficulties simulate without browser globals', () => {
  assert.equal(CHARACTERS.length, 8);
  for (const character of CHARACTERS) {
    for (const difficulty of DIFFICULTY_ORDER) {
      const state = setup(character.id, difficulty);
      state.world.pet = new Pet('kitten', state.player);
      run(state, 4);
      assert.ok(Number.isFinite(state.player.hp), `${character.id}/${difficulty}`);
      assert.ok(state.world.waves.read().totalSpawned > 0);
      for (const entity of [...state.world.enemies.items, ...state.world.bullets.items]) {
        assert.ok(Number.isFinite(entity.x) && Number.isFinite(entity.y));
      }
    }
  }
});

test('every weapon behavior executes against real enemies', () => {
  for (const weapon of WEAPONS) {
    const state = setup();
    state.world.noSpawn = true;
    state.player.weapons.length = 0;
    state.player.addWeapon(weapon.id);
    for (let i = 0; i < 5; i++) {
      const enemy = state.world.waves.spawnEnemyById('slime', 25 + i * 20, 0);
      assert.ok(enemy, `enemy setup for ${weapon.id}`);
    }
    run(state, 5);
    assert.ok(Number.isFinite(state.player.damageDealt) && state.player.damageDealt > 0, weapon.id);
  }
});

test('same explicit seed retains spawn, combat, loot and RNG results', () => {
  const a = setup('nana', 'hard', 83);
  const b = setup('nana', 'hard', 83);
  run(a, 8);
  run(b, 8);
  const project = ({ world, player, rng }) => ({
    rng: rng.state, hp: player.hp, kills: player.kills,
    enemies: world.enemies.items.map(e => [e.def?.id ?? 'chest', e.x, e.y, e.hp]),
    pickups: world.pickups.items.map(e => [e.type, e.x, e.y, e.value]),
  });
  assert.deepEqual(project(a), project(b));
});

test('two copies plus recipe materials combine into exact next tier', () => {
  for (const recipe of RECIPES) {
    const { player, rng } = setup();
    player.weapons.length = 0;
    player.addWeapon(recipe.from);
    player.addWeapon(recipe.from);
    player.materials = recipe.cost;
    const shop = new Shop(rng);
    assert.equal(shop.combine(player, recipe.from).ok, true, recipe.from);
    assert.equal(player.materials, 0);
    assert.equal(player.weapons.length, 1);
    assert.equal(player.weapons[0].def.id, recipe.to);
  }
});

test('shop rejects already sold products without double charging and preserves locked stock', () => {
  const { player, rng } = setup();
  const shop = new Shop(rng);
  player.materials = 999;
  shop.currentWave = 0;
  shop.roll(player, 0);
  const locked = shop.offers[1];
  shop.toggleLock(1);
  shop.roll(player, 1);
  assert.equal(shop.offers[1], locked);
  shop.offers[0] = new ShopOffer('weapon', getWeapon('cat_paw'), 10);
  assert.equal(shop.buy(player, 0).ok, true);
  const balance = player.materials;
  assert.equal(shop.buy(player, 0).ok, false);
  assert.equal(player.materials, balance);
});

test('stat save restores curse, final multipliers and character luck modifier', () => {
  const { player } = setup('nana');
  player.stats.addFlat('maxHp', 14);
  player.stats.addCurse('maxHp', 0.2);
  player.stats.addFinalMul('maxHp', 1.6);
  const data = JSON.parse(JSON.stringify(serializeStatMods(player.stats)));
  const restored = setup('nana').player;
  restoreStatMods(restored.stats, data);
  assert.deepEqual(restored.stats.values, player.stats.values);
  assert.equal(restored.stats.luckEffectMul, player.stats.luckEffectMul);
});

test('party rescue has one shared cooldown and revives after the fifth valid strike', () => {
  const { player, effects } = setup();
  player.down();
  assert.equal(player.downed, true);
  assert.deepEqual(effects.at(-1), { type: 'sound', name: 'knockdown' });
  for (let i = 0; i < 5; i++) {
    assert.equal(player.rescueHit(), i === 4);
    if (i < 4) {
      const progress = player.rescueProgress;
      player.rescueHit();
      assert.equal(player.rescueProgress, progress);
      player._rescueGate = 0;
    }
  }
  assert.equal(player.downed, false);
  assert.equal(player.hp, Math.max(1, Math.round(player.maxHp * 0.3)));
});

test('expired experience compensates future pickup and shares gains with partners', () => {
  const state = setup();
  const p2 = new Player('mimi', state.rng);
  state.world.player2 = p2;
  const expired = new Pickup(PICKUP_TYPE.XP, 1000, 1000, 2);
  expired.update(91, state.world, state.player);
  assert.equal(state.player.xpDebt, 1);
  const xp = state.player.xp;
  const mateXp = p2.xp;
  const pickup = new Pickup(PICKUP_TYPE.XP, 0, 0, 2);
  pickup.update(1 / 60, state.world, state.player);
  assert.equal(pickup.dead, true);
  assert.ok(state.player.xp > xp);
  assert.ok(p2.xp > mateXp);
  assert.equal(state.player.xpDebt, 0);
});

test('overload layers expire separately and remain multiplicative', () => {
  const guard = new OverloadGuard(100);
  guard.recordDamage(0.1, 10);
  assert.equal(guard.update(0.5), true);
  guard.recordDamage(0.6, 10);
  assert.equal(guard.update(1), true);
  assert.equal(guard.multiplier, 0.25);
  guard.tick(5.5);
  assert.equal(guard.multiplier, 0.5);
  guard.tick(6);
  assert.equal(guard.multiplier, 1);
});

test('dead entities are swept without skipping and grid excludes dead targets', () => {
  const list = new EntityList();
  const grid = new SpatialGrid();
  for (let i = 0; i < 5; i++) {
    const e = { id: i, x: i, y: 0, radius: 1, dead: i % 2 === 0 };
    list.add(e); grid.insert(e);
  }
  list.sweep();
  assert.equal(list.length, 2);
  assert.equal(grid.query(0, 0, 10).length, 2);
});

test('wave durations retain ordinary, boss and endless distinctions', () => {
  assert.equal(getWaveDuration(0), 30);
  assert.equal(getWaveDuration(9), 90);
  assert.ok(getWaveDuration(30) > getWaveDuration(0));
});
