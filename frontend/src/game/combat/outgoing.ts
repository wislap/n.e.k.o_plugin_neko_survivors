import { modifyOutgoingDamage, triggerOffensiveFollowups, PRIMARY_ATTACK, type FollowupEligibility } from '../abilities/offense.ts';
import type { WeaponOwner, WeaponInstance } from '../actors/weapon.ts';
import type { WeaponDefinition } from '../content/definitions.ts';
import type { CombatTarget } from './types.ts';
import type { Player } from '../actors/player.ts';
import type { RNG } from '../math/random.ts';
import type { FXSystem } from '../world/effects.ts';
import type { ChallengeSession } from '../encounters/types.ts';
import type { EnemyDamageResult } from './types.ts';
import type { DeathSettlement } from './death.ts';
export interface DamageOptions { thorns?: boolean; fromTurret?: boolean; fromX?: number; fromY?: number; hitAngle?: number; knockback?: number; noWx?: boolean; pierceArmor?: boolean; projectile?: boolean }
export type DamageWeapon = Pick<WeaponInstance, 'def'> & { kind?: WeaponDefinition['kind'] };
export interface OutgoingContext {
  rng: Pick<RNG, 'next'>; fx: Pick<FXSystem, 'damageText' | 'ring' | 'impact' | 'shards' | 'hit' | 'thrust'>;
  deaths: Pick<DeathSettlement, 'settle'>;
  weather(): { miss: number; playerOut: number; noKnockback: boolean; rng: Pick<RNG, 'next'> } | null | undefined;
  guard(): ChallengeSession['guard'] | undefined;
  primaryPlayer(): Player;
}
export class OutgoingCombat {
  private readonly context: OutgoingContext;
  constructor(context: OutgoingContext) { this.context = context; }
  hit(player: WeaponOwner, weapon: DamageWeapon | null, target: CombatTarget, baseDamage: number, opts: DamageOptions = {}) {
    return this.resolveHit(player, weapon, target, baseDamage, opts, PRIMARY_ATTACK);
  }
  private resolveHit(player: WeaponOwner, weapon: DamageWeapon | null, target: CombatTarget, baseDamage: number,
    opts: DamageOptions, eligibility: Readonly<FollowupEligibility>): number | { dodged: true; dealt: 0; parried?: boolean } {

    if (!target || target.dead) return 0;
    // 挑战先处理远程格挡；近战保留正常伤害事务，不能绕过共同结算顺序。
    if (this.context.guard()?.intercept({ targetId: target.id, melee: weapon?.def?.kind === 'melee',
      x: opts.fromX ?? target.x, y: opts.fromY ?? target.y })) {
      if (!opts.projectile) this.context.fx.damageText(target.x, target.y - target.radius, '格挡', false, '#8fd9f0');
      return { dodged: true, dealt: 0, parried: true };
    }
    const stats = player.stats.values;

    // 暴击
    const critChance = stats.critChance + (weapon?.def?.critBonus ?? 0);
    // 暴击概率封顶100%；溢出的每1%转换为额外2%暴击伤害。
    const critOverflow = Math.max(0, critChance - 100);
    const isCrit = this.context.rng.next() * 100 < Math.min(100, critChance);
    let dmg = baseDamage;
    if (isCrit) {
      dmg *= 1 + (stats.critDamage + critOverflow * 2
        + (weapon?.def?.critDamageBonus ?? 0)) / 100;
    }

    dmg = modifyOutgoingDamage(player, target, dmg, !!opts.fromTurret);

    // 浓雾使用天气独立随机流；noWx使天气自身伤害免于天气倍率，避免循环放大。
    const wx = this.context.weather();
    if (wx && !opts.noWx) {
      if (wx.miss > 0 && wx.rng.next() * 100 < wx.miss) {
        this.context.fx.damageText(target.x, target.y - target.radius, 'MISS', false, '#b8c4e0');
        return { dodged: true, dealt: 0 };
      }
      if (wx.playerOut !== 1) dmg *= wx.playerOut;
    }
    const res: EnemyDamageResult = target.takeDamage(dmg, { pierceArmor: opts.pierceArmor });
    // 第一百四十六轮：近战计量 —— 累计近战伤害达玩家 maxHp 10% 触发幻影剑
    //（dealDamage 顶部已处理格挡分支，能走到这里的都是真伤害）
    this.context.guard()?.onDamage({ targetId: target.id, melee: weapon?.def?.kind === 'melee', dealt: res.dealt ?? 0 });

    if (res.dodged) {
      this.context.fx.damageText(target.x, target.y - target.radius, 'MISS', false, '#9aa3bb');
      return 0;
    }
    // Boss 锁血（登场/转阶段/卡点无敌）：不显示 0 伤害，改成"免疫"提示，
    // 否则玩家会以为是自己伤害不够，而不是机制在挡。
    if (res.blocked) {
      this.context.fx.damageText(target.x, target.y - target.radius, '免疫', false, '#8fd9f0');
      this.context.fx.ring(target.x, target.y, target.radius * 1.15, '#8fd9f0', 0.35, { player: true });
      return 0;
    }

    const dealt = res.dealt;
    player.damageDealt += dealt;

    // 击退
    // 第一百零八轮：台风天全场免疫击退（台风自己的推挤不走这里）
    if (opts.knockback && !target.boss && !(this.context.weather()?.noKnockback)) {
      target.applyKnockback(opts.fromX ?? player.x, opts.fromY ?? player.y, opts.knockback);
    }

    // 过载减伤使用暗灰伤害数字，但仍保留命中声音与火花，明确区分减伤和未命中。
    this.context.fx.damageText(
      target.x, target.y - target.radius * 0.6, dealt, isCrit,
      res.overloaded ? '#8a8f98' : undefined,
    );
    // 卡点命中：换一个颜色 + 一圈冲击环，明确"打到了但被卡住"
    if (res.gated) {
      this.context.fx.ring(target.x, target.y, target.radius * 1.25, '#ffc857', 0.4, { player: true });
      this.context.fx.hit(target.x, target.y, '#ffc857', { player: true });
    } else {
      // 命中特效按武器类型与暴击分级，不参与真实伤害计算。
      const isMelee = (weapon?.def?.kind ?? weapon?.kind) === 'melee';
      const power = isCrit ? 1 : (isMelee ? 0.62 : 0.34);
      if (isMelee) {
        this.context.fx.impact(target.x, target.y, power,
          isCrit ? '#ffc857' : '#ffffff', opts.hitAngle ?? null, { player: true });
        // 第一百三十九轮 E：命中溅射碎火星（用户："周围溅射几个碎火星"）
        // —— 轻击 2 粒小的，暴击 4 粒大的（原暴击碎片保留并档）。
        this.context.fx.shards(target.x, target.y, target.radius * (isCrit ? 1 : 0.55),
          isCrit ? '#ffc857' : '#cfe4ff', isCrit ? 4 : 2, { player: true });
      } else {
        this.context.fx.hit(target.x, target.y, isCrit ? '#ffc857' : '#ffffff', { player: true });
      }
    }

    // 吸血
    const ls = stats.lifesteal + (weapon?.def?.lifesteal ?? 0);
    if (ls > 0) {
      // A clone has no healing API. Preserve the existing failure instead of silently changing ownership.
      if (!('applyLifesteal' in player)) throw new TypeError('Damage owner has no lifesteal handler');
      player.applyLifesteal(ls);
    }

    triggerOffensiveFollowups({ owner: player, weapon, target, baseDamage, finalDamage: dmg,
      critical: isCrit, killed: res.killed }, eligibility, {
      rng: this.context.rng, fx: this.context.fx,
      repeat: (kind, damage) => this.resolveHit(player, weapon, target, damage, { ...opts, knockback: 0 }, {
        criticalRepeat: eligibility.criticalRepeat && kind !== 'critical-repeat',
        lobsterFollowup: eligibility.lobsterFollowup && kind !== 'lobster-followup',
      }),
    });

    if (res.killed) {
      this.context.deaths.settle(player, target);
    }
    return dealt;
  }

  // 宠物伤害使用统一伤害结算与玩家归属，避免绕过Boss门控或奖励规则。
  petHit(target: CombatTarget, baseDamage: number): number | undefined {
    if (!target || target.dead) return 0;
    const res: EnemyDamageResult = target.takeDamage(baseDamage, {});
    if (res.dodged) {
      this.context.fx.damageText(target.x, target.y - target.radius, 'MISS', false, '#9aa3bb');
      return 0;
    }
    const dealt = res.dealt;
    this.context.fx.damageText(target.x, target.y - target.radius * 0.6, dealt, false, '#ffd166');
    this.context.fx.hit(target.x, target.y, '#ffd166', { player: true });
    if (res.killed) {
      // 击杀归属给玩家（掉落照常），但武器传 null
      this.context.deaths.settle(this.context.primaryPlayer(), target);
    }
    return dealt;
  }

}
