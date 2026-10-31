import type { ItemId, ItemDefinition } from '../content/definitions.ts';
import { getItem } from '../content/items.ts';
import type { RNG } from '../math/random.ts';
import type { BulletConfig } from '../actors/bullet.ts';
import { isStatKey, STAT_DEFS, type StatSheet } from '../progression/stats.ts';

export interface ItemInventory { hasItem(id: ItemId): boolean }
function equipped(inventory: ItemInventory, id: ItemId): ItemDefinition | null {
  if (!inventory.hasItem(id)) return null;
  const definition = getItem(id);
  if (!definition) throw new TypeError(`Unknown equipped item: ${id}`);
  return definition;
}
const UPGRADE_STAT_KEYS = Object.keys(STAT_DEFS).filter(isStatKey).filter(key => key !== 'turretMax');

/** Equipment participates in these explicit combat stages; item IDs stay here. */
export const defenseEquipment = Object.freeze({
  evades(inventory: ItemInventory, random: Pick<RNG, 'next'>) {
    const item = equipped(inventory, 'lucky_cat_paw');
    return !!item && random.next() * 100 < (item.hurtMissChance ?? 0);
  },
  healing(inventory: ItemInventory, amount: number, hp: number, maxHp: number) {
    return equipped(inventory, 'cat_taffy')?.healDoubleBelowHalf && hp < maxHp / 2 ? amount * 2 : amount;
  },
  lifesteal(inventory: ItemInventory) { return 1 + (equipped(inventory, 'lobster_pillow')?.lifestealHealBonus ?? 0); },
});
export const weaponEquipment = Object.freeze({
  damage(inventory: ItemInventory, damage: number, lifesteal: number) {
    return equipped(inventory, 'lobster_pillow')?.lifestealDamageMul && lifesteal > 0 ? damage * (1 + lifesteal / 100) : damage;
  },
  range(inventory: ItemInventory, range: number, melee: boolean) {
    return !melee ? range * (equipped(inventory, 'smart_wand')?.rangeFinalMul ?? 1) : range;
  },
});
export function applyEquipmentUpgrade(inventory: ItemInventory, stats: Pick<StatSheet, 'addFlat'>) {
  const amount = equipped(inventory, 'dried_fish')?.levelUpAllStats ?? 0;
  if (amount) for (const key of UPGRADE_STAT_KEYS) stats.addFlat(key, amount);
}
export function luckyCatPawFollows(inventory: ItemInventory, random: Pick<RNG, 'next'>, critical: boolean, eligible: boolean) {
  if (!critical || !eligible) return false;
  const item = equipped(inventory, 'lucky_cat_paw');
  return !!item && random.next() * 100 < (item.critAgainChance ?? 0) * 100;
}
export function stackOverloadOnHit(inventory: ItemInventory, target: { isEnemy: boolean; debuffTakenPct?: number }, killed: boolean | undefined) {
  if (killed) return;
  const debuff = equipped(inventory, 'overload_chip')?.hitDebuff;
  if (debuff && target.isEnemy) target.debuffTakenPct = Math.min(debuff.max, (target.debuffTakenPct ?? 0) + debuff.perHit);
}
export function guidedProjectile(inventory: ItemInventory, config: BulletConfig): BulletConfig {
  if (equipped(inventory, 'smart_wand')?.forceHoming && config.behavior && config.behavior !== 'homing'
      && config.behavior !== 'orbit' && config.behavior !== 'spin') {
    return { ...config, behavior: 'homing', homing: Math.max(config.homing ?? 0, 3) };
  }
  return config;
}
