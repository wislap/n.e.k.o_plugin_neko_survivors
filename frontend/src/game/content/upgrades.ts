import type { RNG } from '../math/random.ts';
import { isStatKey, type StatModifiers } from '../progression/stats.ts';
import type { UpgradeDefinition, UpgradeId, UpgradeRarity, ScaledUpgrade, RarityId } from './definitions.ts';
export type { UpgradeDefinition, UpgradeId } from './definitions.ts';
// 升级定义包含静态收益与稀有度缩放，抽取由同一规则路径完成。

// 幸运消费使用有效幸运，统一包含全局和角色倍率。
import { effectiveLuckFor } from '../progression/stats.ts';

// 稀有度倍率影响收益；幸运只调整抽取权重，保底另行保证。
export const UPGRADE_RARITIES: UpgradeRarity[] = [
  { id: 'common',    name: '普通', color: '#9aa3bb', mult: 1,    downsideMult: 1,    weight: 70 },
  { id: 'rare',      name: '稀有', color: '#5fd3e8', mult: 1.33, downsideMult: 1.165, weight: 22 },
  { id: 'epic',      name: '史诗', color: '#b794f6', mult: 1.66, downsideMult: 1.33,  weight: 6  },
  { id: 'legendary', name: '传说', color: '#ffa726', mult: 2,    downsideMult: 1.5,   weight: 2  },
];

export const RARITY_MAP = Object.fromEntries(UPGRADE_RARITIES.map((r) => [r.id, r])) as Record<RarityId, UpgradeRarity>;
Object.setPrototypeOf(RARITY_MAP, null);
export const getRarity = (id: unknown) => typeof id === 'string' && Object.hasOwn(RARITY_MAP, id) ? RARITY_MAP[id as RarityId] : UPGRADE_RARITIES[0];

/** 稀有度由低到高的索引，用来做"至少 N 档"的保底 */
const RARITY_ORDER = UPGRADE_RARITIES.map((r) => r.id);

// 每5级提供保底，蓝/紫/橙逐档提高；保底不阻止更高品质。
export function guaranteedRarity(level: number): RarityId | null {
  if (level >= 15 && level % 5 === 0) return 'legendary';
  if (level === 10) return 'epic';
  if (level === 5) return 'rare';
  return null;
}

// 按有效幸运调整品质权重后抽取，保留随机消费顺序。
export function rollRarity(rng: Pick<RNG, 'next'>, luck = 0, luckEffectMul = 1): RarityId {
  // 面板幸运 → 实际生效幸运（第十轮削弱到 80%；
  // 第十六轮再乘角色的 luckEffectMul —— 悠怡萌妹是 1.2）
  const luckBonus = Math.min(1, Math.max(0, effectiveLuckFor(luck, luckEffectMul) / 250));
  const weights = UPGRADE_RARITIES.map((r, i) => {
    // 普通档不因幸运变多，越高档涨得越快
    if (i === 0) return r.weight;
    return r.weight * (1 + luckBonus * (1 + i * 0.9));
  });
  let total = 0;
  for (const w of weights) total += w;
  let roll = rng.next() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return UPGRADE_RARITIES[i].id;
  }
  return 'common';
}

/** 取两个稀有度里更高的那个（用于保底抬升） */
function atLeast(current: RarityId, floor: RarityId) {
  const a = RARITY_ORDER.indexOf(current);
  const b = RARITY_ORDER.indexOf(floor);
  return RARITY_ORDER[Math.max(a, b)];
}

/** 把一条升级的数值按稀有度缩放（正面全额，负面减半增长） */
export function scaleUpgrade(base: UpgradeDefinition, rarityId: RarityId): ScaledUpgrade {
  const r = getRarity(rarityId);
  const scale = (obj: StatModifiers | undefined, isDownsideAware: boolean) => {
    if (!obj) return undefined;
    const out: StatModifiers = {};
    for (const k in obj) {
      if (!isStatKey(k)) continue;
      const v = obj[k];
      if (v === undefined) continue;
      // 负值（代价）用更温和的倍率；0 和正值按全额
      const m = (isDownsideAware && v < 0) ? r.downsideMult : r.mult;
      out[k] = v * m;
    }
    return out;
  };
  return {
    ...base,
    rarity: r.id,
    rarityName: r.name,
    rarityColor: r.color,
    mult: r.mult,
    // 护盾按**档位查表**，不吃 mult（原因见 up_heal_now 的注释）。
    // 放在这里而不是让 player 自己去查表，是为了让"抽到的这条升级"
    // 自带最终数值 —— 存档/UI/测试看到的都是同一个数。
    shieldPct: shieldPctFor(base, r.id),
    mods: scale(base.mods, false),
    pct: scale(base.pct, true),
  };
}

export const UPGRADES: UpgradeDefinition[] = [
  // ---------- 基础属性 ----------
  {
    id: 'up_maxhp', name: '强健体魄', glyph: '心', icon: 'i-heart', color: '#ff5f6d',
    mods: { maxHp: 6 }, maxLevel: 99, weight: 10,
    desc: '最大生命 +6。',
  },
  {
    id: 'up_damage', name: '锋利', glyph: '伤', icon: 'i-damage', color: '#ff9f68',
    pct: { damage: 8 }, maxLevel: 99, weight: 10,
    desc: '伤害 +8%。',
  },
  {
    id: 'up_attackspeed', name: '敏捷', glyph: '速', icon: 'i-atkspeed', color: '#7dd87d',
    pct: { attackSpeed: 8 }, maxLevel: 99, weight: 10,
    desc: '攻击速度 +8%。',
  },
  {
    id: 'up_movespeed', name: '轻快脚步', glyph: '步', icon: 'i-speed', color: '#5fd3e8',
    pct: { moveSpeed: 6 }, maxLevel: 99, weight: 9,
    desc: '移动速度 +6%。',
  },
  {
    id: 'up_armor', name: '硬化', glyph: '甲', icon: 'i-armor', color: '#8fd9f0',
    // 第十九轮：+2 → +3。护甲减伤阈值同期从 15 翻倍到 30（50% 减伤点），
    // 同样的甲换到的减伤近乎减半 —— 升级还给 +2 就成了没人选的陷阱选项。
    mods: { armor: 3 }, maxLevel: 99, weight: 8,
    desc: '护甲 +3。',
  },
  {
    id: 'up_regen', name: '恢复', glyph: '愈', icon: 'i-plus', color: '#6ee7a8',
    mods: { hpRegen: 0.5 }, maxLevel: 99, weight: 8,
    desc: '每秒回复 +0.5。',
  },
  {
    id: 'up_pickup', name: '扩大拾取', glyph: '拾', icon: 'i-magnet', color: '#8fd9f0',
    mods: { pickupRange: 30 }, maxLevel: 12, weight: 6,
    desc: '拾取范围 +30。',
  },
  {
    id: 'up_harvest', name: '收获', glyph: '收', icon: 'i-gem', color: '#ffc857',
    mods: { harvesting: 2 }, maxLevel: 20, weight: 6,
    desc: '收获 +2（每波结束额外材料）。',
  },

  // ---------- 战斗细节 ----------
  {

    id: 'up_crit', name: '致命一击', glyph: '暴', icon: 'i-crit', color: '#ffc857',
    pct: { critChance: 3 }, maxLevel: 12, weight: 7,
    desc: '暴击率 +3%。',
  },
  {
    id: 'up_critdmg', name: '重击', glyph: '重', icon: 'i-critdmg', color: '#ffb300',
    pct: { critDamage: 15 }, maxLevel: 12, weight: 6,
    desc: '暴击伤害 +15%。',
  },
  {
    id: 'up_lifesteal', name: '汲取', glyph: '吸', icon: 'i-drop', color: '#c62828',
    pct: { lifesteal: 3 }, maxLevel: 10, weight: 6,
    desc: '吸血 +3%。',
  },
  {
    id: 'up_dodge', name: '灵巧', glyph: '闪', icon: 'i-dodge', color: '#e8ecf6',
    pct: { dodge: 4 }, maxLevel: 10, weight: 6,
    desc: '闪避 +4%。',
  },
  {
    id: 'up_luck', name: '好运', glyph: '运', icon: 'i-paw', color: '#ffe08a',
    pct: { luck: 12 }, maxLevel: 15, weight: 6,
    desc: '幸运 +12%。',
  },
  {
    id: 'up_range', name: '远视', glyph: '远', icon: 'i-range', color: '#5fd3e8',
    pct: { range: 8 }, maxLevel: 10, weight: 5,
    // 全射程加成同时覆盖近战、远程和炮台，具体折算由武器规则统一实现。
    desc: '全射程 +8%（近战、远程、炮台都吃）。',
  },

  // ---------- 专精 ----------
  {
    id: 'up_melee', name: '近战专精', glyph: '近', icon: 'i-sword', color: '#c9d6e8',
    pct: { meleeDamage: 12 }, maxLevel: 15, weight: 7,
    desc: '近战伤害 +12%。',
  },
  {
    id: 'up_ranged', name: '远程专精', glyph: '远2', icon: 'i-arrow', color: '#8fd9f0',
    pct: { rangedDamage: 12 }, maxLevel: 15, weight: 7,
    desc: '远程伤害 +12%。',
  },
  {
    id: 'up_elem', name: '元素专精', glyph: '元', icon: 'i-orb', color: '#b794f6',
    pct: { elemDamage: 12 }, maxLevel: 15, weight: 7,
    desc: '元素伤害 +12%。',
  },

  // ---------- 强力但有代价 ----------
  {
    id: 'up_glass', name: '破釜沉舟', glyph: '破', icon: 'i-burst', color: '#ff4d4d',
    pct: { damage: 18, attackSpeed: 10, maxHp: -0.10 }, maxLevel: 5, weight: 4,
    desc: '伤害 +18%，攻速 +10%，最大生命 -10%。',
  },
  {
    id: 'up_fortress', name: '铁壁', glyph: '壁', icon: 'i-armor', color: '#8b93b0',
    mods: { armor: 6 }, pct: { moveSpeed: -6 }, maxLevel: 8, weight: 4,
    desc: '护甲 +6，移速 -6%。',
  },
  {
    id: 'up_greed', name: '贪得无厌', glyph: '贪', icon: 'i-coin', color: '#ffb300',
    mods: { harvesting: 8 }, pct: { damage: -6 }, maxLevel: 5, weight: 4,
    desc: '收获 +8，伤害 -6%。',
  },
  {
    id: 'up_berserk', name: '狂暴', glyph: '狂', icon: 'i-rage', color: '#ff4d4d',
    pct: { attackSpeed: 22, dodge: -6 }, maxLevel: 5, weight: 4,
    desc: '攻速 +22%，闪避 -6%。',
  },

  // 直接回血独立于属性修正，特殊稀有度还可提供护盾。
  {
    id: 'up_heal_now', name: '猫娘的慰藉', glyph: '疗', icon: 'i-plus', color: '#6ee7a8',
    heal: 999, shieldPct: { common: 0, rare: 0.5, epic: 1.0, legendary: 1.5 },
    maxLevel: 99, weight: 5,
    desc: '立即回复全部生命。高品质额外获得护盾。',
  },
];

// 护盾比例按该升级与本次稀有度确定，不从最终描述反解析。
export function shieldPctFor(base: Pick<UpgradeDefinition, 'shieldPct'> | null | undefined, rarityId: RarityId) {
  const table = base?.shieldPct;
  if (!table) return 0;
  return table[rarityId] ?? 0;
}

export const UPGRADE_MAP = Object.fromEntries(UPGRADES.map((u) => [u.id, u])) as Record<UpgradeId, UpgradeDefinition>;
Object.setPrototypeOf(UPGRADE_MAP, null);
export const getUpgrade = (id: unknown) => typeof id === 'string' && Object.hasOwn(UPGRADE_MAP, id) ? UPGRADE_MAP[id as UpgradeId] : undefined;

// 同次升级抽取不重复选项；保底只影响品质，不改变合法候选集合。
export function rollUpgrades(rng: Pick<RNG, 'next'>, taken: ReadonlyMap<string, number>, count = 3, opts: { level?: number; luck?: number; luckEffectMul?: number } = {}) {
  const pool = UPGRADES.filter((u) => (taken.get(u.id) || 0) < (u.maxLevel ?? 99));
  if (pool.length === 0) return [];

  const picks = [];
  const available = pool.slice();
  const n = Math.min(count, available.length);
  for (let i = 0; i < n; i++) {
    // 按 weight 加权抽
    let total = 0;
    for (const u of available) total += (u.weight ?? 1);
    let r = rng.next() * total;
    let idx = available.length - 1;
    for (let j = 0; j < available.length; j++) {
      r -= (available[j].weight ?? 1);
      if (r <= 0) { idx = j; break; }
    }
    picks.push(available[idx]);
    available.splice(idx, 1);
  }

  // 每个选项抽稀有度
  const luck = opts.luck ?? 0;
  const luckEffectMul = opts.luckEffectMul ?? 1;
  const rarities = picks.map(() => rollRarity(rng, luck, luckEffectMul));

  // 保底：这一级该出的最低稀有度，至少落在其中一个选项上
  const floor = guaranteedRarity(opts.level ?? 0);
  if (floor) {
    // 抬升到保底：优先抬"当前最低"的那个，让保底尽量显眼
    let worst = 0;
    for (let i = 1; i < rarities.length; i++) {
      if (RARITY_ORDER.indexOf(rarities[i]) < RARITY_ORDER.indexOf(rarities[worst])) worst = i;
    }
    rarities[worst] = atLeast(rarities[worst], floor);
  }

  return picks.map((u, i) => scaleUpgrade(u, rarities[i]));
}

/** 升级所需经验：随等级递增 */
export function xpForLevel(level: number) {
  // 1->2 需要 5，之后逐渐变多
  return Math.floor(4 + level * 2.2 + Math.pow(level, 1.5) * 0.8);
}
