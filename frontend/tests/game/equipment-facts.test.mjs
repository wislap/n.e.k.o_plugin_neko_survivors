import test from 'node:test';
import assert from 'node:assert/strict';
import { getItem } from '../../src/game/content/items.ts';
import { getEnemy } from '../../src/game/content/enemies.ts';
import { getWaveConfig } from '../../src/game/content/waves.ts';
import { defenseEquipment, weaponEquipment, applyEquipmentUpgrade, luckyCatPawFollows, stackOverloadOnHit } from '../../src/game/abilities/equipment.ts';
import { createRetaliation } from '../../src/game/abilities/retaliation.ts';
function withFields(definition, patch, run) {
  const before = { ...definition }; Object.assign(definition, patch);
  try { run(); } finally { for (const key of Object.keys(definition)) delete definition[key]; Object.assign(definition, before); }
}
const inventory = id => ({ hasItem: candidate => candidate === id });
test('special equipment consumes its content values rather than a second numeric table', () => {
  withFields(getItem('smart_wand'), { rangeFinalMul: 1.7 }, () => assert.equal(weaponEquipment.range(inventory('smart_wand'), 100, false), 170));
  withFields(getItem('dried_fish'), { levelUpAllStats: 2 }, () => applyEquipmentUpgrade(inventory('dried_fish'), { addFlat: (_key, amount) => assert.equal(amount, 2) }));
  withFields(getItem('lucky_cat_paw'), { critAgainChance: .7, hurtMissChance: 80 }, () => {
    assert.equal(luckyCatPawFollows(inventory('lucky_cat_paw'), { next: () => .5 }, true, true), true);
    assert.equal(defenseEquipment.evades(inventory('lucky_cat_paw'), { next: () => .5 }), true);
  });
  withFields(getItem('overload_chip'), { hitDebuff: { perHit: 4, max: 7 } }, () => {
    const target = { isEnemy: true, debuffTakenPct: 5 }; stackOverloadOnHit(inventory('overload_chip'), target, false); assert.equal(target.debuffTakenPct, 7);
  });
  withFields(getItem('lobster_pillow'), { lifestealHealBonus: 3, lifestealDamageMul: false }, () => {
    assert.equal(defenseEquipment.lifesteal(inventory('lobster_pillow')), 4);
    assert.equal(weaponEquipment.damage(inventory('lobster_pillow'), 100, 20), 100);
  });
  withFields(getItem('cat_taffy'), { healDoubleBelowHalf: false }, () => assert.equal(defenseEquipment.healing(inventory('cat_taffy'), 5, 1, 10), 5));
});
test('retaliation consumes the configured radius and armor multiplier', () => {
  withFields(getItem('dr_m_notes'), { thornsRadius: 350, thornsArmorMul: 20 }, () => {
    const target = { x: 340, y: 0, dead: false, isEnemy: true }, hits = [];
    createRetaliation({ ...inventory('dr_m_notes'), x: 0, y: 0, dead: false, stats: { get: () => 3 } }, {
      nearby: (_x, _y, radius) => { assert.equal(radius, 350); return [target]; }, damage: (_target, amount) => hits.push(amount), ring() {},
    })(); assert.deepEqual(hits, [60]);
  });
});
test('healer inclusion reads its declared spawn threshold without stale global wave cache', () => {
  withFields(getEnemy('healer_bunny'), { spawnFromWave: 20 }, () => assert.equal(getWaveConfig(10).spawns.some(spawn => spawn.id === 'healer_bunny'), false));
  assert.equal(getWaveConfig(10).spawns.some(spawn => spawn.id === 'healer_bunny'), true);
});
