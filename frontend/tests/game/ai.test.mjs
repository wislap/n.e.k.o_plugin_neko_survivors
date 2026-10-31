import test from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../../src/game/math/random.ts';
import { World } from '../../src/game/world/world.ts';
import { Player } from '../../src/game/actors/player.ts';
import { Shop } from '../../src/game/progression/shop.ts';
import { MovementPilot } from '../../src/game/ai/movement.ts';
import { chooseUpgrade, runShopDecisions } from '../../src/game/ai/decisions.ts';
import { applyAiWaveGrowth, applyTeammateLevel } from '../../src/game/ai/assistance.ts';
import { rollSkill } from '../../src/game/ai/skills.ts';

function context() {
  const rng = new RNG(1927);
  const world = new World(rng);
  const player = new Player('yui', rng);
  world.player = player;
  world.waves.begin(0);
  return { rng, world, player, phase: 'playing', party: false };
}

test('all AI skills produce movement intent without modifying entities', () => {
  for (const skill of ['pro', 'normal', 'rookie']) {
    const c = context();
    c.world.waves.spawnEnemyById('slime', 75, 0);
    const ai = new MovementPilot(c.rng.fork(123), { skill });
    const before = [c.player.x, c.player.y, c.player.agentMoveTarget];
    for (let i = 0; i < 20; i++) {
      const result = ai.decide(c);
      assert.ok(result.target == null || (Number.isFinite(result.target.x) && Number.isFinite(result.target.y)));
    }
    assert.deepEqual([c.player.x, c.player.y, c.player.agentMoveTarget], before);
  }
});

test('AI rescue returns target identity without healing or modifying rescue progress', () => {
  const c = context();
  const teammate = new Player('mimi', c.rng);
  c.world.player2 = teammate;
  teammate.x = 20;
  teammate.down();
  c.party = true;
  const ai = new MovementPilot(c.rng);
  const result = ai.decide(c);
  assert.equal(result.rescueTargetId, teammate.id);
  assert.equal(teammate.rescueProgress, 5);
  assert.equal(teammate.downed, true);
});

test('upgrade policy favors early health and rejects fragile downside upgrades', () => {
  const c = context();
  const index = chooseUpgrade([
    { mods: { damage: 5 } },
    { mods: { maxHp: 6 } },
    { pct: { damage: 18, maxHp: -10 } },
  ], c.player, 0);
  assert.equal(index, 1);
});

test('shopping policy requests legal actions and keeps party shelf separate', () => {
  const c = context();
  const p2 = new Player('mimi', c.rng);
  p2.materials = 200;
  const shop = new Shop(c.rng);
  shop.currentWave = 0;
  shop.roll(c.player, 0);
  const p1Shelf = shop.offers.slice();
  const mateShop = new Shop(c.rng);
  mateShop.roll(p2, 0);
  shop.offers.push(...mateShop.offers);
  const { actions } = runShopDecisions({ shop, player: p2, waveIndex: 0, slotIndex: 1 }, action => {
    if (action.type === 'buy') return shop.buy(p2, action.slot);
    if (action.type === 'reroll') return shop.reroll(p2, action.slot);
    throw new Error('Teammate should not combine P1 goods');
  });
  assert.ok(actions.length > 0);
  for (const { action } of actions) assert.ok(action.slot >= 4 && action.slot < 8);
  assert.deepEqual(shop.offers.slice(0, 4), p1Shelf);
});

test('AI hidden wave growth is idempotent and level package fills actual stat gaps', () => {
  const { player } = context();
  const initial = player.stats.get('armor');
  applyAiWaveGrowth(player, 0);
  applyAiWaveGrowth(player, 0);
  assert.equal(player.stats.get('armor'), initial + 10);
  applyAiWaveGrowth(player, 1);
  assert.equal(player.stats.get('armor'), initial + 12);
  player.pendingLevelUps = 2;
  const regen = player.stats.get('hpRegen');
  applyTeammateLevel(player);
  assert.equal(player.stats.get('hpRegen'), regen + 0.5);
  assert.equal(player.pendingLevelUps, 1);
});

test('skill choice uses only injected entropy', () => {
  assert.equal(rollSkill(() => 0), 'pro');
  assert.equal(rollSkill(() => 0.5), 'normal');
  assert.equal(rollSkill(() => 0.99), 'rookie');
});
