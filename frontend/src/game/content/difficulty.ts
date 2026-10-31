// 四档难度在同一规则曲线上叠加倍率，生命/伤害/刷怪量分别计算。

/** 敌人数量整体上调系数（用户要求 +20%）；改这里一处即可全局生效 */
export const ENEMY_COUNT_BUFF = 1.2;

// 难度初始数量与属性增益保持独立，避免调整一项连带改变其他数值。
export const HP_BUFF_ALL = 1.2;        // 全难度血量 +20%
export const HP_BUFF_NIGHTMARE = 1.4;
export const COUNT_BUFF_NIGHTMARE = 1.32;

// 非噩梦档额外使用1.5倍初始刷怪数。
export const NON_NIGHTMARE_COUNT_BUFF = 1.5;

/** 敌人开火频率倍率（第七轮）。用户："弹幕类型的敌人射击频率加快30%（boss不用加）"。
 *  只在噩梦生效；实现处是 entities/enemy.js 的 _shooter()，Boss 走 _boss() 不受影响。 */
export const FIRE_RATE_NIGHTMARE = 1.3;

// 噩梦普通与近战移速分别增益；中期生命成长另乘波次修正。

/** 噩梦全体敌人移速倍率（×1.10） */
export const SPEED_BUFF_NIGHTMARE = 1.10;

// 近战敌人使用专属1.15倍移速，不再叠普通1.10倍。
export const SPEED_BUFF_NIGHTMARE_MELEE = 1.15;

// 敌人移速只有下限，没有绝对上限；后期可超过玩家默认速度。

// 第11波起额外增加20%生命上限，使用0-based索引10为起点。
export const WAVE11_HP_BUFF = 1.20;
/** 第 11 波起血量加成的起始波次（0-based；10 = 第 11 波） */
export const WAVE11_HP_BUFF_FROM = 10;
/** 是否把上面这条血量加成推广到全部难度（用户没说，默认只在噩梦生效） */
export const WAVE11_HP_BUFF_ALL = false;

// 普通远程敌人提高射击频率与弹速，近战生命另有增益；Boss排除。

// 射击频率倍率除到冷却上，不能乘到冷却反向降低攻速。
export const ENEMY_FIRE_RATE_BUFF = 1.44;

/** 远程敌人的弹幕速度 +20%（同样不含 Boss） */
export const ENEMY_BULLET_SPEED_BUFF = 1.2;

// 普通近战基础生命额外增加20%，不包含Boss。
export const ENEMY_MELEE_HP_BUFF = 1.2;

import type { DifficultyDefinition, DifficultyId } from './definitions.ts';
export type { DifficultyDefinition, DifficultyId } from './definitions.ts';
export const DIFFICULTY: Record<DifficultyId, DifficultyDefinition> = {
  easy: {
    id: 'easy',
    name: '简单',
    tag: '轻松',
    color: '#6ee7a8',
    desc: '敌人更少、更软、更慢。适合熟悉玩法，或者只想和猫娘聊天。',
    enemyHp: 0.72 * HP_BUFF_ALL,
    enemyDamage: 0.6,
    enemyCount: 0.7 * ENEMY_COUNT_BUFF * NON_NIGHTMARE_COUNT_BUFF,   // 1.26
    enemySpeed: 0.9,
    enemyFireRate: 1,
    bulletCount: 0.6,
    bulletSpeed: 0.85,
    materialMul: 1.25,
    xpMul: 1.15,
  },
  normal: {
    id: 'normal',
    name: '中等',
    tag: '标准',
    color: '#5fd3e8',
    // 第一百一十七轮：描述按用户口吻重写 —— "普通改成：生存20波，
    // 难度较低，适合休闲。"
    desc: '生存20波，难度较低，适合休闲。',
    enemyHp: 1 * HP_BUFF_ALL,
    enemyDamage: 1,
    enemyCount: 1 * ENEMY_COUNT_BUFF * NON_NIGHTMARE_COUNT_BUFF,     // 1.8
    enemySpeed: 1,
    enemyFireRate: 1,
    bulletCount: 1,
    bulletSpeed: 1,
    materialMul: 1,
    xpMul: 1,
  },
  hard: {
    id: 'hard',
    name: '困难',
    tag: '硬核',
    color: '#ffc857',
    // 第一百一十七轮："困难改成：敌人属性上升，数量变多了，略有挑战
    // 性的难度~"
    desc: '敌人属性上升，数量变多了，略有挑战性的难度~',
    enemyHp: 1.45 * HP_BUFF_ALL,
    enemyDamage: 1.5,
    enemyCount: 1.35 * ENEMY_COUNT_BUFF * NON_NIGHTMARE_COUNT_BUFF,  // 2.43
    enemySpeed: 1.05,
    enemyFireRate: 1,
    bulletCount: 1.3,
    bulletSpeed: 1.1,
    materialMul: 1.15,
    xpMul: 1.1,
  },
  nightmare: {
    id: 'nightmare',
    name: '噩梦',
    tag: '弹幕',
    color: '#ff5f6d',

    desc: '游戏会变成弹幕游戏喵~还有特别的家伙等着你哦~',
    // 用户把噩梦单独拎出来说了 +40%，所以这里用 HP_BUFF_NIGHTMARE
    // 而**不是**再叠一层 HP_BUFF_ALL（那样会变成 +68%，超出预期）
    enemyHp: 2.0 * HP_BUFF_NIGHTMARE,
    enemyDamage: 2.1,
    enemyCount: 1.75 * ENEMY_COUNT_BUFF * COUNT_BUFF_NIGHTMARE,
    enemySpeed: 1.22 * SPEED_BUFF_NIGHTMARE,
    // 近战敌人吃更高一档（见 SPEED_BUFF_NIGHTMARE_MELEE 的说明）。
    // 其他难度不设这个字段 —— world 里没配就退回 enemySpeed，
    // 所以简单/中等/困难的敌人移速**完全没变**。
    enemySpeedMelee: 1.22 * SPEED_BUFF_NIGHTMARE_MELEE,
    // 非Boss敌人移速按成长叠加且不封顶；噩梦普通弹幕怪另有开火频率倍率。
    enemyFireRate: FIRE_RATE_NIGHTMARE,
    bulletCount: 1.9,
    bulletSpeed: 1.28,
    materialMul: 1.4,
    xpMul: 1.25,
  },
};

/** 展示顺序 */
export const DIFFICULTY_ORDER: DifficultyId[] = ['easy', 'normal', 'hard', 'nightmare'];

// 第6波起附加按波次成长的真实伤害，普通/精英/Boss使用不同档位。

/** 真伤从第 6 波（1-based）开始 */
export const TRUE_DMG_FROM_WAVE = 6;

/**
 * 计算某波次、某档位敌人附加的真实伤害。
 */
export function trueDamageBonus(wave: number, tier: number) {
  if (wave < TRUE_DMG_FROM_WAVE) return 0;
  // 阶段基值：6-10 波小怪 +1、11-15 +2、16-20 +3（精英 ×2、Boss ×3）
  const base = wave >= 16 ? 3 : wave >= 11 ? 2 : 1;
  const endless = wave > 20 ? wave - 20 : 0;   // 无尽每回合再 +1
  return base * tier + endless;
}

export const DEFAULT_DIFFICULTY = 'normal';

export function getDifficulty(id: unknown) {
  return typeof id === 'string' && Object.hasOwn(DIFFICULTY, id) ? DIFFICULTY[id as DifficultyId] : DIFFICULTY[DEFAULT_DIFFICULTY];
}

/** 给 UI 用的列表 */
export function difficultyList() {
  return DIFFICULTY_ORDER.map((id) => DIFFICULTY[id]);
}
