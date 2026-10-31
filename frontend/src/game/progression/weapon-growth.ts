/** Weapon level progression used by combat and the explanatory presentation. */
export const WEAPON_GROWTH = Object.freeze({ damagePerLevel: 0.12, cooldownPerLevel: 0.04, minimumCooldownMultiplier: 0.6 });
export function weaponLevelModifiers(level: number) {
  return { damage: 1 + (level - 1) * WEAPON_GROWTH.damagePerLevel,
    cooldown: Math.max(WEAPON_GROWTH.minimumCooldownMultiplier, 1 - (level - 1) * WEAPON_GROWTH.cooldownPerLevel) };
}
