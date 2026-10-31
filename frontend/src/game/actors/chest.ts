import type { Player } from './player.ts';
import type { World } from '../world/world.ts';
import type { EnemyDamageOptions } from '../combat/types.ts';
export type ChestReward = { kind: 'heal'; pct?: number; value?: number }
  | { kind: 'item'; luck: number; rare: boolean };
export interface ChestOptions { radius?: number; hp?: number; color?: string; accent?: string; tier?: number; rare?: boolean; reward?: ChestReward; rng?: RNG }

import { RNG } from '../math/random.ts';
// 宝箱作为可攻击实体参与索敌，不移动、不造成接触伤害，破坏后统一结算奖励。

import { Entity } from './entity.ts';
import { TAU } from '../math/geometry.ts';
import { effectiveLuckFor } from '../progression/stats.ts';

export class Chest extends Entity<[Player?, World?]> {
  isChest: true;
  isEnemy: true;
  maxHp: number;
  hp: number;
  armor: number;
  armorShred: number;
  stun: number;
  color: string;
  accent: string;
  tier: number;
  rare: boolean;
  reward: ChestReward;
  glowPhase: number;
  hurtFlash: number;
  spawnAnimation: number;
  scale: number;
  bobPhase: number;
  declare boss?: false;
  declare elite?: false;
  declare debuffTakenPct?: number;
  declare curseTimer?: number;
  declare curseDamageMul?: number;
  declare curseSpeedMul?: number;
  declare curseRateMul?: number;

  constructor(x: number, y: number, opts: ChestOptions = {}) {
    super();
    this.isChest = true;
    this.isEnemy = true;      // 让武器/子弹的索敌逻辑能打到它
    this.x = x;
    this.y = y;
    this.radius = opts.radius ?? 17;

    this.maxHp = opts.hp ?? 40;
    this.hp = this.maxHp;
    this.armor = 0;
    this.armorShred = 0;
    this.stun = 0;

    this.color = opts.color ?? '#ffc857';
    this.accent = opts.accent ?? '#ff9f68';
    this.tier = opts.tier ?? 1;          // 1 普通宝箱 / 2 华丽宝箱
    this.rare = !!opts.rare;

    // 奖励在生成时就决定好（这样光效颜色能提前暗示品质）
    this.reward = opts.reward ?? { kind: 'heal', value: 30 };

    const rng = opts.rng ?? new RNG(((x * 73856093) ^ (y * 19349663)) >>> 0);
    // 视觉
    this.glowPhase = rng.next() * TAU;
    this.hurtFlash = 0;
    this.spawnAnimation = 0.3;
    this.scale = 0.2;
    this.bobPhase = rng.next() * TAU;
  }

  get hpPercent() { return Math.max(0, this.hp / this.maxHp); }
  get xpValue() { return 0; }
  get materialValue() { return 0; }

  /** 宝箱也会被打，走和敌人一样的接口 */
  takeDamage(amount: number, opts: EnemyDamageOptions = {}) {
    let dmg = amount;
    if (this.armor > 0 && !opts.pierceArmor) {
      dmg = Math.max(1, dmg * (1 / (1 + this.armor / 20)));
    }
    this.hp -= dmg;
    this.hurtFlash = 0.12;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      return { killed: true, dealt: dmg };
    }
    return { killed: false, dealt: dmg };
  }

  applyKnockback(_fromX?: number, _fromY?: number, _force?: number) { /* 宝箱固定不动，不吃击退 */ }

  /** 宝箱不移动、不攻击，只做视觉计时 */
  update(dt: number, _player?: Player, _world?: World) {
    this.age += dt;
    this.glowPhase += dt * 2.2;
    this.bobPhase += dt * 1.6;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.spawnAnimation > 0) {
      this.spawnAnimation -= dt;
      this.scale = Math.min(1, 0.2 + (1 - this.spawnAnimation / 0.3) * 0.8);
    } else {
      this.scale = 1;
    }
  }
}

// 开箱奖励由类型和稀有度决定；抽取使用传入随机流，实际领取由结算处理。
export function rollChestReward(rng: RNG, luck = 0, forceRare = false, luckEffectMul = 1): ChestReward {
  // 面板幸运 → 实际生效幸运（第十轮削弱到 80%，第十六轮再乘角色倍率）
  const eff = effectiveLuckFor(luck, luckEffectMul);
  const luckBonus = Math.min(1, Math.max(0, eff / 220));

  // 道具 vs 医疗包：基础 55% 道具，幸运和稀有度都会提高道具概率
  let itemChance = 0.55 + luckBonus * 0.25 + (forceRare ? 0.25 : 0);
  itemChance = Math.min(0.92, itemChance);

  if (rng.next() < itemChance) {
    return { kind: 'item', luck, rare: forceRare || rng.next() < luckBonus * 0.5 };
  }
  // 医疗包：按最大生命比例给，越到后期越值
  const pct = forceRare ? 0.5 : 0.35;
  return { kind: 'heal', pct };
}

/** 宝箱的外观按奖励类型区分颜色（玩家远远就能看出值不值得打） */
export function chestColors(reward: ChestReward) {
  if (reward.kind === 'heal') return { color: '#6ee7a8', accent: '#3ddc97' };
  if (reward.rare) return { color: '#ff9f68', accent: '#ff5f6d' };
  return { color: '#ffc857', accent: '#ff9f68' };
}
