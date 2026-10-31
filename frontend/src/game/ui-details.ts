import type { CharacterDefinition, ItemDefinition, ScaledUpgrade } from './content/definitions.ts';
import type { Player } from './actors/player.ts';
import type { WeaponInstance } from './actors/weapon.ts';
import type { Shop, Offer } from './progression/shop.ts';
import type { DisplayStatRow } from './views.ts';
import { statEntries, type StatKey, type StatModifiers } from './progression/stats.ts';
import { WEAPON_GROWTH } from './progression/weapon-growth.ts';
import { STAT_DEFS } from './progression/stats.ts';
import { getCharSkill } from './content/char-skills.ts';
import { getWeapon, RECIPE_MAP, TIER_COLORS, TIER_NAMES } from './content/weapons.ts';
import { itemTier, ITEM_TIER_COLORS } from './content/items.ts';
import { BEHAVIOR_LABEL } from './actors/weapon.ts';

// Reference UI presentation is projected here; React never computes rule values.
const number = (value: number) => Math.round(value * 100) / 100;
/** Units follow the modifier operation and stat definition; magnitude never guesses a unit. */
function modifierValue(statId: StatKey, value: number, proportional = false) {
  const percent = proportional || STAT_DEFS[statId].kind === 'percent';
  const displayed = proportional && STAT_DEFS[statId].kind !== 'percent' ? value * 100 : value;
  return `${displayed >= 0 ? '+' : ''}${number(displayed)}${percent ? '%' : ''}`;
}
function modifierLines(mods: StatModifiers = {}, proportional = false) {
  return statEntries(mods).filter(([, value]) => value !== 0)
    .map(([statId, value]) => `${modifierValue(statId, value, proportional)} ${STAT_DEFS[statId].name}`);
}
export function characterTip(character: CharacterDefinition) {
  const skill = getCharSkill(character.id);
  const name = character.name;
  return skill ? `${name}\n能力【${skill.ability.name}】${skill.ability.text}\n技能【${skill.skill.name}】${skill.skill.text}` : name;
}
export function itemTooltip(definition: ItemDefinition, count: number) {
  const lines = [definition.desc];
  if (count > 0) {
    lines.push(`── 当前累计（已持有 ${count} 个）──`);
    for (const [key, value] of statEntries(definition.mods)) lines.push(`${STAT_DEFS[key].name} ${modifierValue(key, value * count)}`);
    for (const [key, value] of statEntries(definition.pct)) lines.push(`${STAT_DEFS[key].name} ${modifierValue(key, value * count, true)}`);
    for (const [key, value] of statEntries(definition.curse)) lines.push(`${STAT_DEFS[key].name} -${Math.round(value * 100)}%（乘算 ×${count} → 剩余 ${Math.round((1 - value) ** count * 1000) / 10}%）`);
  }
  return lines.join('\n');
}
export function weaponTooltip(weapon: WeaponInstance, player: Player) {
  const def = weapon.def, kind = { melee: '近战', ranged: '远程', element: '元素', turret: '炮台' }[def.kind];
  const lines = [`${def.name}　${TIER_NAMES[def.tier]}品质 · ${kind} · ${BEHAVIOR_LABEL[def.behavior]}`,
    weapon.level > 1 ? `等级 Lv.${weapon.level}（伤害 ×${weapon.levelDamageMul.toFixed(2)}）` : '等级 Lv.1'];
  const damage = weapon.computeDamage(player), cooldown = weapon.computeCooldown(player), range = weapon.computeRange(player);
  lines.push(`伤害 ${damage.toFixed(1)}　冷却 ${cooldown.toFixed(2)}s　射程 ${Math.round(range)}`);
  if (cooldown > 0) lines.push(`单把 DPS ≈ ${(damage / cooldown).toFixed(1)}`);
  if (def.desc) lines.push(def.desc);
  return lines.join('\n');
}
export function weaponDetails(weapon: WeaponInstance, player: Player, shop: Shop) {
  const def = weapon.def, combination = shop.canCombine(player, def.id), recipe = RECIPE_MAP[def.id];
  const target = recipe ? getWeapon(recipe.to) : null;
  return { color: def.color, glyph: def.glyph, kind: def.kind, tierName: TIER_NAMES[def.tier], tierColor: TIER_COLORS[def.tier],
    tooltip: weaponTooltip(weapon, player), sellValue: shop.sellValue(weapon),
    recipe: combination && target && recipe ? { targetName: target.name, targetColor: target.color, targetDescription: target.desc,
      cost: recipe.cost, canCombine: !!combination.ok, needMaterials: combination.needMaterials ?? 0 } : undefined };
}
export function offerDetails(offer: Offer, player: Player) {
  const { data: def, kind } = offer;
  const weapon = kind === 'weapon';
  const tier = weapon ? def.tier : itemTier(def);
  const ownedCount = weapon ? player.findWeapons(def.id).length : player.items.get(def.id) ?? 0;
  const rows: DisplayStatRow[] = [];
  const row = (label: string, value: string | number, tone?: DisplayStatRow['tone']) => rows.push({ label, value, ...(tone ? { tone } : {}) });
  if (weapon) {
    row('基础伤害', `${def.damage}`); row('攻击间隔', `${def.kind === 'turret' ? def.turretCooldown : def.cooldown}s`);
    if (def.range != null) row('射程', def.range);
    for (const [key, label, suffix] of [['arc', '横扫角度', '°'], ['thrusts', '多段戳刺', ' 段'], ['chains', '连锁跳数', ' 跳'], ['shots', '连发', ' 发']] as const) if (def[key]) row(label, `${def[key]}${suffix}`);
    if (def.pierce != null) row('贯穿', def.pierce >= 99 ? '无限' : `${def.pierce} 个`);
    if (def.lifesteal) row('吸血概率', `+${def.lifesteal}%`);
    if (def.knockback) row('击退', def.knockback);
    if (def.critBonus) row('暴击率', `+${def.critBonus}%`);
    if (def.critDamageBonus) row('暴击伤害', `+${def.critDamageBonus}%`);
    if (def.explosionRadius) row('爆炸半径', def.explosionRadius);
    if (def.stun) row('僵直', `${def.stun}s`);
    if (def.kind === 'turret') row('同时上限', `${def.turretMax} 座`);
    row('每升一级', `伤害 +${WEAPON_GROWTH.damagePerLevel * 100}% · 冷却 -${WEAPON_GROWTH.cooldownPerLevel * 100}%`, 'up-tip');
  } else {
    for (const [key, value] of statEntries(def.mods)) row(STAT_DEFS[key].name, modifierValue(key, value), value >= 0 ? 'up' : 'down');
    for (const [key, value] of statEntries(def.pct)) row(STAT_DEFS[key].name, modifierValue(key, value, true), value >= 0 ? 'up' : 'down');
    for (const [key, value] of statEntries(def.curse)) row(STAT_DEFS[key].name, `-${Math.round(value * 100)}%（乘算）`, 'down');
  }
  return { glyph: def.glyph, color: def.color, tierName: weapon ? TIER_NAMES[def.tier] : ['', '普通', '精良', '稀有'][tier],
    tierColor: weapon ? TIER_COLORS[def.tier] : ITEM_TIER_COLORS[itemTier(def)], behaviorLabel: weapon ? BEHAVIOR_LABEL[def.behavior] : '',
    // Reference shelf weapon cards have no extra tooltip; owned weapon slots do.
    ownedCount, pawMark: !!offer.pawMark, tooltip: weapon ? '' : itemTooltip(def, ownedCount), statRows: rows };
}
export function upgradeDetails(option: ScaledUpgrade) {
  const lines = [...modifierLines(option.mods), ...modifierLines(option.pct, true)];
  // Heal/shield retain their separate typed fields; UpgradeScreen appends them once.
  return { glyph: option.glyph, icon: option.icon, color: option.color, rarityColor: option.rarityColor,
    rarityName: option.rarityName, mult: option.mult, effectLines: lines };
}
