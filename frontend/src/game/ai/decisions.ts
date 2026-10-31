// Upgrade weights retained from v0.4.18.
import type { Player } from '../actors/player.ts';
import type { Shop } from '../progression/shop.ts';
import type { ScaledUpgrade, ItemDefinition, WeaponDefinition } from '../content/definitions.ts';
import { isStatKey, type StatModifiers } from '../progression/stats.ts';
export type ShopIntent = { type: 'combine'; weaponId: string } | { type: 'buy' | 'reroll'; slot: number };
const STAT_SCORE: StatModifiers = {
  damage: 10, attackSpeed: 8, maxHp: 10, critChance: 6, moveSpeed: 7,
  armor: 8, critDamage: 4, hpRegen: 8, lifesteal: 4, luck: 4,
  harvesting: 3, pickupRange: 2, dodge: 5,
};

export function chooseUpgrade(options: readonly ScaledUpgrade[], player: Player, waveIndex: number) {
    const ent = player;
    // entity 模式（P2）不走选卡 UI：升级在 tick 里自动应用
    const opts: readonly ScaledUpgrade[] = Array.isArray(options) ? options : [];
    if (opts.length === 0) return;
    const early = waveIndex < 4;   // 前四波优先补血；生命回复不足1/s、护甲不足10时提高对应升级权重。
    const regenGap = (ent.stats?.get?.('hpRegen') ?? 0) < 1;
    const armorGap = (ent.stats?.get?.('armor') ?? 0) < 10;
    let bestI = 0, bestS = -Infinity;
    opts.forEach((o, i) => {
      let s = 0;
      for (const [k, v] of Object.entries(o?.mods || {})) {
        s += ((isStatKey(k) ? STAT_SCORE[k] : undefined) ?? 2) * Math.abs(Number(v) || 1) * 0.2;
      }
      for (const [k, v] of Object.entries(o?.pct || {})) {
        let w = (isStatKey(k) ? STAT_SCORE[k] : undefined) ?? 2;
        if (k === 'maxHp' && early) w *= 1.8;
        if (k === 'hpRegen' && regenGap) w *= 3;
        if (k === 'armor' && armorGap) w *= 2.5;
        s += w * (Number(v) || 0);
      }
      // mods 同样吃缺口加权（有的升级包把回复/护甲放 flat 里）
      if (regenGap && Number(o?.mods?.hpRegen) > 0) s += 30;
      if (armorGap && Number(o?.mods?.armor) > 0) s += 25;
      // 血量选项绝对优先：maxHp 是加法（+6），前期一条命的价值远超输出
      if (early && Number(o?.mods?.maxHp) > 0) s += 100;
      // 负面升级按等效生命值评估：EHP超过50时参与正常评分，血薄时仍拒绝。
      const maxHpU = ent.stats?.get?.('maxHp') ?? ent.maxHp ?? 0;
      const ehpU = maxHpU * (1 + Math.min(1, (ent.stats?.get?.('armor') ?? 0) / 30));

      if (o?.pct && Object.values(o.pct).some((v) => Number(v) < 0) && ehpU <= 50) s -= 1000;
      if (s > bestS) { bestS = s; bestI = i; }
    });
    return bestI;
  }

const ESSENTIAL_ITEMS = new Set([
  'warm_milk', 'healing_herb', 'cat_taffy', 'wool_armor', 'steel_plate', 'running_shoes', 'feather',
]);
function toleratesDownside(player: Player) {
  const health = player.stats.get('maxHp');
  return health * (1 + Math.min(1, player.stats.get('armor') / 30)) > 50;
}
function hasDownside(definition: ItemDefinition | WeaponDefinition) {
  return Object.keys(('curse' in definition ? definition.curse : undefined) ?? {}).length > 0
    || Object.values(('pct' in definition ? definition.pct : undefined) ?? {}).some(value => Number(value) < 0);
}

/**
 * Runs the baseline shopping policy against observations. The caller executes every
 * intent through the same validated path used by the human UI. This function never
 * invokes Shop.buy/combine/reroll or mutates inventory and materials itself.
 * execute returns {ok:boolean}. Its synchronous success updates observations before
 * the next decision, so auto-restock, max stacks and each party shelf remain real.
 */
export function runShopDecisions({ shop, player, waveIndex, slotIndex = 0 }: { shop: Shop; player: Player; waveIndex: number; slotIndex?: number }, execute: (action: ShopIntent) => { ok: boolean }) {
  const actions: { action: ShopIntent; ok: boolean }[] = [];
  const perform = (action: ShopIntent) => {
    const result = execute(action);
    actions.push({ action, ok: result.ok });
    return result.ok;
  };
  if (slotIndex === 0) {
    const ids = new Set(player.weapons.map(weapon => weapon.def.id));
    for (const weaponId of ids) {
      if (shop.canCombine(player, weaponId)?.ok) perform({ type: 'combine', weaponId });
    }
  }
  const weaponCount = player.weapons.length;
  const rushWeapons = weaponCount < 6 && waveIndex < 5;
  const materialBudget = waveIndex < 10 ? 30 : 100;
  const slotBase = slotIndex * 4;
  const slotEnd = Math.min(shop.offers.length, slotBase + 4);
  let bought = 0;
  for (let round = 0; round < 5 && bought < 4; round++) {
    if (round > 0) {
      if (player.materials < materialBudget + 40) break;
      if (!perform({ type: 'reroll', slot: slotBase })) break;
    }
    for (let slot = slotBase; slot < slotEnd && bought < 4; slot++) {
      const offer = shop.offers[slot];
      if (!offer || offer.sold || player.materials < offer.price) continue;
      const { data: definition, kind } = offer;
      const weapon = kind === 'weapon';
      const ranged = weapon && definition.kind !== 'melee';
      if (hasDownside(definition) && !toleratesDownside(player)) continue;
      if (weapon && player.findWeapons(definition.id).length >= 2) continue;
      const essential = ESSENTIAL_ITEMS.has(definition.id);
      const rich = player.materials > 150;
      const wanted = rushWeapons
        ? weapon || essential || rich
        : ranged || (weapon && weaponCount < 6) || essential
          || (!weapon && (bought < 2 || rich) && (offer.price >= 10 || rich));
      if (wanted && perform({ type: 'buy', slot })) bought++;
    }
  }
  // Baseline fallback used an out-of-scope ehpOk; evaluate it for each live balance.
  for (let guard = 0; guard < 6 && player.materials > materialBudget; guard++) {
    let pick = -1, price = 0;
    for (let slot = slotBase; slot < slotEnd; slot++) {
      const offer = shop.offers[slot];
      if (!offer || offer.sold || offer.price > player.materials) continue;
      if (hasDownside(offer.data) && !toleratesDownside(player)) continue;
      if (offer.price > price) { price = offer.price; pick = slot; }
    }
    if (pick < 0 || !perform({ type: 'buy', slot: pick })) break;
    bought++;
  }
  return { actions, bought };
}
