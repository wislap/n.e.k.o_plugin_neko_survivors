import test from 'node:test';
import assert from 'node:assert/strict';
import { OutgoingCombat } from '../../src/game/combat/outgoing.ts';
import { DeathSettlement } from '../../src/game/combat/death.ts';
import { RNG } from '../../src/game/math/random.ts';
import { FXSystem } from '../../src/game/world/effects.ts';
import { Player } from '../../src/game/actors/player.ts';
import { createEnemy } from '../../src/game/enemies/create-enemy.ts';
import { Chest } from '../../src/game/actors/chest.ts';
import { Pickup } from '../../src/game/actors/pickup.ts';
import { WeaponInstance } from '../../src/game/actors/weapon.ts';
import { getEnemy } from '../../src/game/content/enemies.ts';
import { getWeapon } from '../../src/game/content/weapons.ts';

function combat({ character = 'yui', seed = 69, wave = 0 } = {}) {
  const rng = new RNG(seed), fx = new FXSystem(rng.fork(0x6678));
  const player = new Player(character, rng), pickups = { items: [], add(pickup) { this.items.push(pickup); } };
  const rewards = [], spawned = [], notifications = [];
  const deaths = new DeathSettlement({ rng, fx, pickups, pendingRewards: () => rewards,
    rules: () => ({ wave, elapsed: 4, durationDamp: 1, special: null }), primaryPlayer: () => player,
    spawn: (id, x, y) => { const enemy = target(id, x, y); spawned.push(enemy); return enemy; },
    shake() {}, notifyKilled: enemy => notifications.push(['killed', enemy.def?.id ?? 'chest']),
    notifyBossKilled: () => notifications.push(['boss-killed', rewards.length, pickups.items.some(pickup => !pickup.dead)]),
    notifyBossSettled: () => notifications.push(['boss-settled', rewards.length, pickups.items.some(pickup => !pickup.dead)]),
  });
  const environment = { weather: null, guard: null };
  const outgoing = new OutgoingCombat({ rng, fx, deaths, primaryPlayer: () => player,
    weather: () => environment.weather, guard: () => environment.guard });
  return { rng, fx, player, pickups, rewards, spawned, notifications, deaths, outgoing, environment };
}
function target(id = 'slime', x = 80, y = 0) {
  return createEnemy(getEnemy(id), x, y, { hp: 1, damage: 1, speed: 1, xp: 1, materials: 1 }, new RNG(1));
}
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`); }

test('critical repeats and lobster followups consume independent lineage eligibility and retain real hit accounting', () => {
  const state = combat({ character: 'mimi' }), enemy = target();
  enemy.maxHp = enemy.hp = 100000;
  state.player.addItem('lucky_cat_paw'); state.player.stats.addFlat('critChance', 100); state.player.hp = 3;
  const weapon = new WeaponInstance(getWeapon('cat_paw'));
  state.rng.next = () => .05;
  const multiplier = 1 + (state.player.stats.values.critDamage
    + Math.max(0, state.player.stats.values.critChance - 100) * 2) / 100;
  const receipt = state.outgoing.hit(state.player, weapon, enemy, 10, { pierceArmor: true });
  // Root, repeat, repeat's lobster, root's lobster, and that lobster's repeat.
  const total = 10 * multiplier * 2 + 10 * multiplier * multiplier * 2 * 3;
  close(receipt, 10 * multiplier); close(100000 - enemy.hp, total);
  close(state.player.damageDealt, total);
  assert.equal(state.player.hp, 13);

});

test('challenge interception precedes RNG and weather misses precede target mutation and hit statistics', () => {
  const state = combat(), enemy = target(), weapon = new WeaponInstance(getWeapon('cat_paw'));
  let draws = 0;
  state.rng.next = () => { draws++; return .99; };
  state.environment.guard = { intercept: () => true, onDamage() { assert.fail('intercepted hit must not be observed as damage'); } };
  assert.deepEqual(state.outgoing.hit(state.player, weapon, enemy, 10), { dodged: true, dealt: 0, parried: true });
  assert.equal(draws, 0);
  state.environment.guard = null;
  state.environment.weather = { miss: 100, playerOut: 1.25, noKnockback: false, rng: { next: () => 0 } };
  const hp = enemy.hp;
  assert.deepEqual(state.outgoing.hit(state.player, weapon, enemy, 10), { dodged: true, dealt: 0 });
  assert.equal(draws, 1); assert.equal(enemy.hp, hp);
  assert.equal(state.player.damageDealt, 0);

});

test('pet kills grant primary ownership and normal loot; chests preserve their separate reward transaction', () => {
  const state = combat(), enemy = target();
  state.outgoing.petHit(enemy, 1000);
  assert.equal(state.player.kills, 1);
  assert.equal(state.player.damageDealt, 0, 'pet damage is excluded from player damage statistics');
  assert.ok(state.pickups.items.some(pickup => pickup.type === 'xp'));
  const before = state.pickups.items.length;
  const chest = new Chest(20, 20, { reward: { kind: 'item', rare: true, luck: 0 } });
  state.outgoing.petHit(chest, 1000); state.outgoing.petHit(chest, 1000);
  assert.equal(state.player.kills, 1);
  assert.equal(state.pickups.items.length, before);
  assert.equal(state.rewards.length, 1);
  assert.deepEqual(state.notifications.map(event => event[0]), ['killed', 'killed']);
});

test('boss death owns reward and collection between presentation and progression notifications', () => {
  const state = combat({ wave: 9 });
  state.pickups.add(new Pickup('material', 0, 0, 7)); state.player.hp = 1;
  state.deaths.settle(state.player, target('boss_cat_king'));
  assert.equal(state.player.kills, 1);
  assert.equal(state.rewards.length, 1); assert.equal(state.rewards[0].rare, true);
  assert.ok(state.pickups.items.every(pickup => pickup.dead));
  assert.ok(state.player.materials >= 7); assert.ok(state.player.xp > 0);
  assert.deepEqual(state.notifications, [
    ['boss-killed', 0, true], ['boss-settled', 1, false], ['killed', 'boss_cat_king'],
  ]);
});

test('splitter death spawns configured half-health children and retains lifetime kills across waves', () => {
  const state = combat(), enemy = target('splitter');
  state.outgoing.petHit(enemy, 1000);
  assert.equal(state.spawned.length, enemy.def.splitCount ?? 3);
  for (const child of state.spawned) {
    const full = target(child.def.id);
    close(child.hp, full.maxHp * .5); close(child.maxHp, child.hp);
  }
  assert.deepEqual(state.deaths.takeKillAges(), []);
  state.deaths.beginWave();
});
