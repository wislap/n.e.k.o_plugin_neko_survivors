import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../../src/game/world/world.ts';
import { RNG } from '../../src/game/math/random.ts';
import { Player } from '../../src/game/actors/player.ts';
import { createRetaliation } from '../../src/game/abilities/retaliation.ts';

function setup(armor = 4) {
  const rng = new RNG(19), world = new World(rng), player = new Player('yui', rng);
  world.player = player; player.world = world; world.waves.begin(0);
  player.stats.addFlat('armor', armor);
  const targets = [world.waves.spawnEnemyById('tank', 299, 0), world.waves.spawnEnemyById('tank', 301, 0)];
  for (const target of targets) { assert.ok(target); world.grid.insert(target); }
  const hits = [], rings = [];
  const retaliate = createRetaliation(player, {
    nearby: (x, y, radius) => world.grid.query(x, y, radius, []),
    damage(target, amount) { hits.push({ target: targets.indexOf(target), amount }); world.dealDamage(player, null, target, amount, { thorns: true }); },
    ring: (...args) => rings.push(args),
  });
  return { player, world, targets, hits, rings, retaliate };
}

test('equipped retaliation applies current armour and the exact radius through real combat', () => {
  const state = setup(); state.player.addItem('dr_m_notes');
  const outsideHealth = state.targets[1].hp;
  state.retaliate();
  assert.deepEqual(state.hits, [{ target: 0, amount: 200 }]);
  assert.equal(state.targets[1].hp, outsideHealth);
  assert.ok(state.targets[0].hp < state.targets[0].maxHp);
  assert.deepEqual(state.rings, [[0, 0, 105, '#ffd23a', .4]]);
  state.player.stats.addFlat('armor', 2);
  state.targets[0].dead = false; state.targets[0].hp = state.targets[0].maxHp;
  state.retaliate();
  assert.equal(state.hits.at(-1).amount, 300, 'equipment consumes impact-time armour');
});

test('retaliation neither attacks nor consumes combat RNG when unequipped, dead, or powerless', () => {
  for (const mode of ['unequipped', 'dead', 'no-armour']) {
    const state = setup(mode === 'no-armour' ? 0 : 4);
    if (mode !== 'unequipped') state.player.addItem('dr_m_notes');
    if (mode === 'dead') state.player.dead = true;
    const before = state.world.rng.state;
    state.retaliate();
    assert.deepEqual(state.hits, [], mode); assert.deepEqual(state.rings, [], mode);
    assert.equal(state.world.rng.state, before, mode);
  }
});
