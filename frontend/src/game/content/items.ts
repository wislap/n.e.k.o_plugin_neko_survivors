import type { ItemDefinition, ItemId } from './definitions.ts';
export type { ItemDefinition, ItemId } from './definitions.ts';
// 道具定义区分加法、百分比、诅咒与独立能力标记，效果在对应事务中应用。

// 诅咒下限使用stats的唯一常量；道具描述与实际夹紧须一致。
import { CURSE_FLOOR } from '../progression/stats.ts';
export { CURSE_FLOOR };

export const ITEMS: ItemDefinition[] = [
  // 莱万汀分别使用最终伤害与承伤乘区，独立于普通百分比属性。
  {
    id: 'laevatein', name: '莱万汀', color: '#ff2e4d', glyph: '莱', price: 99,

    finalDamageMul: 1.6, finalTakenMul: 1.3, maxStacks: 1,
    // 莱万汀仅从芙兰结算获得，排除商店随机池和宝箱奖励池。
    flandreOnly: true,
    desc: '芙兰的禁弹魔剑。造成的伤害 +60%（最终乘算），受到的伤害 +30%（最终乘算）。持有期间，每 5 秒有 20% 概率释放【四重存在】：变出至多 3 个分身（继承 25% 属性与同款武器，总输出约为自身的 25%），分身倒下后从你所在的位置重新现形。',
  },
  // 阎魔刀为维吉尔战利品；低血量时触发次元斩与时间减速。
  {
    id: 'yamato', name: '阎魔刀', color: '#ff2e4d', glyph: '阎', price: 88,
    maxStacks: 1, bossDropOnly: true,
    desc: '次元斩的具现。生命低于 50% 时自动释放一次次元斩：时间变慢，所有怪物陷入慢动作，斩击撕裂全场敌人。每回合限一次。',
  },
  // ---------- 生存类 ----------
  {
    id: 'warm_milk', name: '热牛奶', color: '#fff3d6', glyph: '奶', price: 12,
    // 第二十二轮：最大生命 6 → 4（用户："削弱"）
    mods: { maxHp: 4, hpRegen: 0.3 },
    desc: '睡前一杯。最大生命 +4，每秒回复 +0.3。',
  },
  {
    id: 'cat_armor', name: '毛线护甲', color: '#8fd9f0', glyph: '甲', price: 15,
    // 第二十二轮：加强 —— 护甲 3 → 4，新增最大生命 +2（用户："加强"）
    mods: { armor: 4, maxHp: 2 },
    desc: '织得密密实实的毛线衣。护甲 +4，最大生命 +2。',
  },
  {
    id: 'lucky_bell', name: '幸运铃', color: '#ffe08a', glyph: '铃', price: 18,
    // 第二十二轮：闪避 6 → 4、幸运 10 → 8（用户："削弱"）
    pct: { dodge: 4, luck: 8 },
    desc: '叮当作响。闪避 +4%，幸运 +8%。',
  },
  {
    id: 'thick_fur', name: '厚毛皮', color: '#e0c9a6', glyph: '毛', price: 20,
    // 第二十二轮：最大生命 10 → 8（移速 -4% 不变；用户："削弱"）
    mods: { maxHp: 8 },
    pct: { moveSpeed: -4 },
    desc: '蓬松保暖。最大生命 +8，移速 -4%。',
  },
  {
    id: 'healing_herb', name: '治愈猫薄荷', color: '#6ee7a8', glyph: '草', price: 22,

    mods: { hpRegen: 0.8 },
    desc: '闻一闻就舒服。每秒回复 +0.8。',
  },

  // ---------- 输出类 ----------
  {
    id: 'sharp_fang', name: '尖锐獠牙', color: '#ff9f68', glyph: '牙', price: 16,
    pct: { damage: 8 },
    desc: '咬合力惊人。伤害 +8%。',
  },
  {
    id: 'catnip', name: '猫薄荷', color: '#7dd87d', glyph: '薄', price: 18,
    // 射程加成覆盖近战、环绕武器和炮台，实际倍率由武器规则解释。
    pct: { attackSpeed: 10, range: 5 },
    desc: '兴奋起来手速变快。攻速 +10%，攻击范围 +5%。',
  },
  {
    id: 'scope_lens', name: '瞄准镜片', color: '#5fd3e8', glyph: '镜', price: 16,
    // 第二十二轮：远程伤害 12 → 8（射程 +10% 不变；用户："削弱"）
    pct: { rangedDamage: 8, range: 10 },
    desc: '看得更远也更准。远程伤害 +8%，射程 +10%。',
  },
  {
    id: 'iron_knuckle', name: '铁指套', color: '#c9d6e8', glyph: '拳', price: 16,
    pct: { meleeDamage: 12 },
    desc: '近身格斗必备。近战伤害 +12%。',
  },
  {
    id: 'magic_gem', name: '魔力宝石', color: '#b794f6', glyph: '宝', price: 20,
    pct: { elemDamage: 14 },
    desc: '蕴含元素之力。元素伤害 +14%。',
  },
  {
    id: 'crit_eye', name: '猫瞳', color: '#ffc857', glyph: '瞳', price: 24,
    // 第二十二轮：暴击率 8 → 5、暴击伤害 20 → 15（用户："削弱"）
    pct: { critChance: 5, critDamage: 15 },
    desc: '在黑暗中也能看清要害。暴击率 +5%，暴击伤害 +15%。',
  },
  {
    id: 'glass_cannon', name: '玻璃炮', color: '#ff5f6d', glyph: '玻', price: 28,
    pct: { damage: 25 },
    curse: { maxHp: 0.15 },
    desc: '威力巨大但很脆。伤害 +25%，最大生命 -15%（乘算，可叠加但有下限）。',
  },

  // ---------- 炮台流派 ----------
  {
    id: 'gear_oil', name: '齿轮机油', color: '#d9b382', glyph: '油', price: 16,
    // 第二十二轮：炮台攻速 18 → 12（用户："削弱"）
    pct: { turretRate: 12 },
    desc: '让炮台转得更快。炮台攻速 +12%。',
  },
  {
    id: 'radar_chip', name: '雷达芯片', color: '#5fd3e8', glyph: '雷', price: 18,
    pct: { turretRange: 20, turretDamage: 8 },
    desc: '索敌更远也更准。炮台射程 +20%，炮台伤害 +8%。',
  },
  {
    id: 'turret_blueprint', name: '炮台图纸', color: '#6ee7a8', glyph: '图', price: 26,
    // 第二十二轮：炮台伤害 22 → 16（炮台上限 +1 不变；用户："削弱"）
    pct: { turretDamage: 16 },
    mods: { turretMax: 1 },
    desc: '更精密的炮台设计。炮台伤害 +16%，可同时多放 1 座炮台。',
  },
  {
    id: 'steel_plate', name: '钢制装甲板', color: '#a9b4c9', glyph: '钢', price: 22,
    // 第二十二轮：炮台伤害 10 → 7（护甲 +5 / 移速 -3% 不变；用户："削弱"）
    mods: { armor: 5 },
    pct: { turretDamage: 7, moveSpeed: -3 },
    desc: '又厚又重。护甲 +5，炮台伤害 +7%，移速 -3%。',
  },

  // ---------- 经济 / 功能类 ----------
  {
    id: 'shiny_coin', name: '闪亮硬币', color: '#ffc857', glyph: '金', price: 14,
    mods: { harvesting: 3 },
    desc: '每波结束多捡一些。收获 +3。',
  },
  {
    id: 'magnet_paw', name: '磁力猫爪', color: '#8fd9f0', glyph: '磁', price: 12,
    mods: { pickupRange: 45 },
    desc: '材料会自动飞过来。拾取范围 +45。',
  },
  {
    id: 'four_leaf', name: '四叶草', color: '#6ee7a8', glyph: '叶', price: 20,
    // 第二十二轮：幸运 25 → 16（用户："削弱"）
    pct: { luck: 16 },
    desc: '幸运 +16%。商店里更容易出好东西。',
  },
  {
    id: 'lucky_cat', name: '招财猫', color: '#ffd166', glyph: '招', price: 26,
    mods: { harvesting: 6 },
    pct: { luck: 15 },
    desc: '举手招财。收获 +6，幸运 +15%。',
  },
  {
    id: 'running_shoes', name: '跑鞋', color: '#5fd3e8', glyph: '鞋', price: 14,
    pct: { moveSpeed: 12 },
    desc: '跑得飞快。移速 +12%。',
  },
  {
    id: 'feather', name: '轻盈羽毛', color: '#e8ecf6', glyph: '羽', price: 18,
    // 第二十二轮：移速 8 → 6、闪避 5 → 4（用户："削弱"）
    pct: { moveSpeed: 6, dodge: 4 },
    desc: '脚步轻得像风。移速 +6%，闪避 +4%。',
  },

  // ---------- 高风险高回报 ----------
  {
    // 穿甲弹只追加远程/元素/炮台穿透；追加部分每穿一敌伤害乘0.6，叠加上限5。
    id: 'ap_round', name: '穿甲弹', color: '#b794f6', glyph: '穿', price: 30,
    apPierce: 1, maxStacks: 5,
    desc: '远程/元素/炮台攻击可穿透 1 个敌人，穿透后的伤害 -40%。再次购买穿透 +1（上限 5）。',
  },
  {
    id: 'cursed_collar', name: '诅咒项圈', color: '#8b93b0', glyph: '咒', price: 24,
    pct: { damage: 20, attackSpeed: 15, dodge: -5 },
    curse: { maxHp: 0.20 },
    desc: '力量有代价。伤害 +20%，攻速 +15%，闪避 -5%，最大生命 -20%（乘算，可叠加但有下限）。',
  },
  {
    id: 'blood_pact', name: '血之契约', color: '#c62828', glyph: '血', price: 30,
    pct: { damage: 18, lifesteal: 5 },
    curse: { maxHp: 0.12 },
    desc: '以血换力。伤害 +18%，吸血 +5%，最大生命 -12%（乘算）。',
    maxStacks: 3,
  },
  {
    id: 'greed_idol', name: '贪婪神像', color: '#ffb300', glyph: '贪', price: 25,
    mods: { harvesting: 10 },
    pct: { damage: -8 },
    desc: '钱比命重要。收获 +10，伤害 -8%。',
  },
  {
    id: 'berserk_pill', name: '狂暴药丸', color: '#ff4d4d', glyph: '狂', price: 26,
    pct: { attackSpeed: 30 },
    // 狂暴药丸使用固定护甲代价，避免重复百分比削减摧毁护甲成长。
    curse: { armor: 0.3 },
    desc: '停不下来。攻速 +30%，护甲 ×0.7（乘算，可叠加）。',
  },

  // Boss专属红品不进入普通商店或宝箱池，由对应击杀奖励发放。
  {
    id: 'dried_fish', name: '小鱼干', color: '#ff6d6d', glyph: '鱼', price: 38,
    bossDropOnly: true, maxStacks: 1,
    levelUpAllStats: 1,
    desc: '很普通的小鱼干，但这是那个人买给人家的，看到它人家就充满了力量。每升一级，所有属性 +1。',
  },
  {
    id: 'lobster_pillow', name: '龙虾抱枕', color: '#ff5252', glyph: '虾', price: 40,
    bossDropOnly: true, maxStacks: 1,
    lifestealHealBonus: 1, lifestealDamageMul: true,
    desc: '应该不会有人不喜欢吃龙虾吧~龙虾人家最喜欢了。吸血回复翻倍，每有 1% 的吸血，伤害增加 1%（最终乘算）。',
  },
  {
    id: 'smart_wand', name: '智慧型魔棒', color: '#e64a8f', glyph: '棒', price: 40,
    bossDropOnly: true, maxStacks: 1,
    forceHoming: true, rangeFinalMul: 1.3,
    desc: '对的，对的，魔法也是法，枪法也是法。所有远程攻击和炮台攻击都会追踪敌人，且远程攻击射程 +30%（最终乘算）。',
  },
  {
    id: 'dr_m_notes', name: 'M博士心得', color: '#d32f2f', glyph: '博', price: 42,
    bossDropOnly: true, maxStacks: 1,
    finalTakenMul: 0.8, thornsRadius: 300, thornsArmorMul: 50,
    desc: '上面密密麻麻的写满了什么时候什么地点挨打更舒服，看着吓人。受到的伤害 -20%（最终乘算），每次受到伤害时触发一次 300 范围的 AOE 攻击，伤害为护甲数值的 50 倍。',
  },
  {
    id: 'lucky_cat_paw', name: '幸运猫脚', color: '#ff7043', glyph: '脚', price: 40,
    bossDropOnly: true, maxStacks: 1,
    critAgainChance: 0.2, hurtMissChance: 15,
    desc: '谁说只有兔子的脚丫才能带来好运，人家的也可以，要踩踩你吗？暴击时有 20% 概率再暴击一次，受伤时有 15% 概率变成 miss。',
  },
  {
    id: 'black_cape', name: '黑色披风', color: '#8e24aa', glyph: '披', price: 38,
    bossDropOnly: true, maxStacks: 1,
    pct: { dodge: 20 }, statCapBonus: { dodge: 10 },
    desc: '这是人家的衣服，谁和你说是披风的？闪避 +20%，闪避上限变成 90%。',
  },
  {
    id: 'cat_taffy', name: '猫娘奶糖', color: '#ef5350', glyph: '糖', price: 38,
    bossDropOnly: true, maxStacks: 1,
    mods: { hpRegen: 2 }, healDoubleBelowHalf: true,
    desc: '哇，这个超级甜呢。感觉体力恢复了好多！生命回复 +2，生命低于 50% 时，受到的所有治疗效果翻倍。',
  },
  {
    id: 'overload_chip', name: '超载芯片', color: '#f44336', glyph: '芯', price: 45,
    bossDropOnly: true, maxStacks: 1,
    hitDebuff: { perHit: 1, max: 30 },
    desc: '这个东西怎么越来越红了？不会爆炸吧喵？攻击命中敌人会让其获得受到的伤害 +1% 的效果，最多叠加 30%。',
  },
];

export const ITEM_MAP = Object.fromEntries(ITEMS.map((i) => [i.id, i])) as Record<ItemId, ItemDefinition>;
Object.setPrototypeOf(ITEM_MAP, null);
export const getItem = (id: unknown) => typeof id === 'string' && Object.hasOwn(ITEM_MAP, id) ? ITEM_MAP[id as ItemId] : undefined;

/** 道具稀有度：按价格粗分，用于商店权重 */
export function itemTier(item: ItemDefinition) {
  if (item.price >= 28) return 3;
  if (item.price >= 20) return 2;
  return 1;
}

export const ITEM_TIER_COLORS: Record<1 | 2 | 3, string> = { 1: '#9aa3bb', 2: '#5fd3e8', 3: '#b794f6' };
