import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../../src/game/world/world.ts';
import { Player } from '../../src/game/actors/player.ts';
import { RNG } from '../../src/game/math/random.ts';

function setup(seed = 69) {
  const rng = new RNG(seed), world = new World(rng), player = new Player('yui', rng);
  player.id = 1; player.world = world; world.player = player;
  return { rng, world, player, waves: world.waves };
}

test('wave entry owns validated initialization and binds summoned bodies to the same live world', () => {
  const { rng, world, waves } = setup();
  const before = rng.state;
  assert.throws(() => waves.requireCurrent(), /initialized/);
  assert.equal(rng.state, before);
  waves.setDifficulty('nightmare');
  const wave = waves.begin(12);
  waves.advanceClock(2.5, 2.5);
  const enemy = waves.spawnEnemyById('slime', 80, 90);
  assert.ok(enemy); assert.equal(enemy.world, world);
  assert.equal(world.enemies.items[0], enemy);
  assert.equal(enemy._bornWaveT, 2.5);
  assert.equal(waves.read().totalSpawned, 1);
  assert.equal(wave, waves.requireCurrent());
  assert.equal(waves.read().bossTimeRatio, 1 - 2.5 / wave.duration);
});

test('world progress restoration reapplies wave adaptation and boss choices without sharing snapshots', () => {
  const { world, waves } = setup();
  const saved = { bossChoices: { boss_cat_king: 'boss_acid_cat' }, diffHp: 1.3, diffDmg: .9,
    pendingItemRewards: [{ id: 'warm_milk', name: 'milk', price: 20, rare: false, sellValue: 11 }] };
  world.restoreProgress(saved);
  saved.diffHp = 1; saved.bossChoices.boss_cat_king = 'boss_cat_king'; saved.pendingItemRewards.length = 0;
  assert.equal(waves.resolveBoss('boss_cat_king'), 'boss_acid_cat');
  assert.equal(world.pendingItemRewards.length, 1);
  assert.equal(waves.captureProgress().diffHp, 1.3);
  const snapshot = world.captureProgress(); snapshot.diffDmg = 1; snapshot.pendingItemRewards.length = 0;
  assert.equal(waves.captureProgress().diffDmg, .9); assert.equal(world.pendingItemRewards.length, 1);
  const normal = setup(); normal.waves.begin(3); waves.begin(3);
  const actual = waves.spawnEnemyById('slime', 0, 0), base = normal.waves.spawnEnemyById('slime', 0, 0);
  assert.equal(actual.maxHp / base.maxHp, 1.3);
  assert.ok(Math.abs(actual.damage / base.damage - .9) < 1e-12);
});

test('paused spawning preserves arrival warnings while the established treasure schedule still advances', () => {
  const { rng, world, player, waves } = setup();
  rng.next = () => .99;
  waves.begin(0);
  waves.advanceSpawning(.5, player, .5);
  assert.ok(waves.read().warnings.length > 0);
  const warning = structuredClone(waves.read().warnings);
  waves.advanceSpawning(10, player, 10.5, true);
  assert.deepEqual(waves.read().warnings, warning);
  assert.ok(world.enemies.items.some(enemy => enemy.isChest));
  assert.ok(world.enemies.items.some(enemy => enemy.def?.behavior === 'flee'));
  waves.advanceSpawning(1, player, 11.5);
  assert.ok(world.enemies.items.some(enemy => !enemy.isChest && enemy.def?.behavior !== 'flee'));
});

test('special-wave replay restores both cooldown decisions and the seeded next spawn schedule', () => {
  let state = setup();
  let { waves, rng, player, world } = state;
  waves.restoreRules({ lastSpecialWave: -999, specialCache: [[10, 'charge']] });
  const entryRules = waves.captureRules(), entryEntropy = rng.state;
  const play = () => {
    waves.begin(10);
    for (let tick = 1; tick <= 180; tick++) waves.advanceSpawning(1 / 60, player, tick / 60);
    return { entropy: rng.state, rules: waves.captureRules(), warnings: structuredClone(waves.read().warnings),
      actors: world.enemies.items.map(enemy => [enemy.def.id, enemy.x, enemy.y, enemy.hp, enemy.mutant]) };
  };
  const first = play();
  state = setup(); ({ waves, rng, player, world } = state);
  waves.restoreRules(entryRules); rng.state = entryEntropy;
  assert.deepEqual(play(), first);
  entryRules.specialCache[0][1] = 'egg';
  assert.equal(waves.read().current.special, 'charge');
  assert.equal(waves.captureRules().specialCache[0][1], 'charge');
});
