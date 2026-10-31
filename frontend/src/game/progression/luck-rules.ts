/** Queries take effective luck (including character modifiers), never a panel value. */
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export const STEAL_CHANCE_BASE = 0.20;
export const STEAL_CHANCE_MAX = 0.50;
export const STEAL_LUCK_CAP = 220;
export function luckBenefits(effectiveLuck: number) {
  return {
    dropMultiplier: 1 + effectiveLuck / 100,
    shopQualityBonus: clamp01(effectiveLuck / STEAL_LUCK_CAP),
    mimicRareBonus: Math.min(0.3, effectiveLuck / 400),
  };
}
export function stealChance(effectiveLuck: number) {
  return STEAL_CHANCE_BASE + luckBenefits(effectiveLuck).shopQualityBonus * (STEAL_CHANCE_MAX - STEAL_CHANCE_BASE);
}
