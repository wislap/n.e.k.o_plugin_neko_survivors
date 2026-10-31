import type { WeaponOwner } from '../actors/weapon.ts';
import type { CombatTarget } from './types.ts';
import type { ItemId } from '../content/definitions.ts';
import type { EnemyBody } from '../actors/enemy.ts';
import type { Player } from '../actors/player.ts';
import type { EnemyId } from '../content/definitions.ts';
import type { SpecialWaveKind } from '../content/waves.ts';
import type { RNG } from '../math/random.ts';
import type { FXSystem } from '../world/effects.ts';
import { Pickup, PICKUP_TYPE } from '../actors/pickup.ts';
import { ITEMS } from '../content/items.ts';
import { TAU } from '../math/geometry.ts';
import { luckBenefits } from '../progression/luck-rules.ts';
export interface PendingItemReward { id: ItemId; name: string; price: number; rare: boolean; sellValue: number }

export interface DeathContext {
  rng: Pick<RNG, 'next' | 'range' | 'pick'>;
  fx: Pick<FXSystem, 'damageText' | 'sparkle' | 'explosion' | 'nova'>;
  pickups: { items: Pickup[]; add(pickup: Pickup): void };
  pendingRewards(): PendingItemReward[];
  rules(): { wave: number; elapsed: number; durationDamp: number; special: SpecialWaveKind | null | undefined };
  primaryPlayer(): Player;
  spawn(id: EnemyId, x: number, y: number): EnemyBody | null;
  shake(strength: number, duration: number): void;
  notifyKilled(enemy: CombatTarget): void;
  notifyBossKilled(enemy: EnemyBody): void;
  notifyBossSettled(enemy: EnemyBody): void;
}
// 场上医疗包上限30；达到上限时不再生成新包，已拾取立即腾出名额。
const HEAL_PICKUP_MAX = 30;

// 通用宝箱奖励排除专属战利品、诅咒和纯炮台加成，避免无意义或强制负面奖励。
function getRewardItemPool() {
  return ITEMS.filter((it) => {
    // 第八十五轮：芙兰专属（莱万汀）不进宝箱/宝箱怪奖励池 ——
    // 用户："应该只有打败芙兰才能获得。"
    if (it.flandreOnly) return false;
    // 第一百三十四轮：Boss 专属掉落红品（小鱼干等 8 件）同理排除 ——
    // 唯一入口是第 10/20 波 Boss 击杀掉落。
    if (it.bossDropOnly) return false;
    // 纯炮台加成的道具，只在玩家已有炮台时才有意义 → 不放进通用奖励池
    const keys = Object.keys(it.pct || {}).concat(Object.keys(it.mods || {}));
    const turretOnly = keys.length > 0 && keys.every((k) => k.startsWith('turret'));
    if (turretOnly) return false;
    // 有诅咒的道具不白送（白送负面效果体验很差）
    if (it.curse && Object.keys(it.curse).length > 0) return false;
    return true;
  });
}

export class DeathSettlement {
  private killAges: number[] = [];
  private readonly itemPool = getRewardItemPool();
  private readonly context: DeathContext;
  constructor(context: DeathContext) { this.context = context; }
  beginWave() { this.killAges = []; }
  takeKillAges() { const ages = this.killAges; this.killAges = []; return ages; }
  private settleBossRewards() {
    const player = this.context.primaryPlayer();
    if ([9, 19].includes(this.context.rules().wave)) {
      const pool = ITEMS.filter(item => item.bossDropOnly && item.id !== 'yamato' && !player.hasItem(item.id));
      const reward = this.context.rng.pick(pool);
      if (reward) this.context.pendingRewards().push({ id: reward.id, name: reward.name,
        price: reward.price, rare: true, sellValue: Math.max(4, Math.round(reward.price * 0.55)) });
    }
    for (const pickup of this.context.pickups.items) {
      if (pickup.dead) continue;
      if (pickup.type === 'xp') player.gainXp(pickup.value);
      else if (pickup.type === 'material') player.gainMaterials(pickup.value);
      else player.heal(pickup.value);
      pickup.dead = true;
    }
  }
  private resolveTreasure(player: WeaponOwner, entity: CombatTarget) {
    if (entity.isChest) {
      const rw = entity.reward;
      if (rw.kind === 'heal') {
        if (!('get' in player.stats) || !('heal' in player)) throw new TypeError('Treasure owner has no healing API');
        const max = player.stats.get('maxHp');
        const amount = Math.max(8, Math.round(max * (rw.pct ?? 0.35)));
        player.heal(amount);
        this.context.fx.damageText(entity.x, entity.y - 24, `+${amount}`, false, '#6ee7a8');
        this.context.fx.sparkle(entity.x, entity.y, '#6ee7a8', 8);
      } else {
        const reward = this.rollRewardItem(player, rw.rare);
        if (reward) {
          this.context.pendingRewards().push(reward);
          this.context.fx.damageText(entity.x, entity.y - 24, reward.name, false, '#ffc857');
          this.context.fx.sparkle(entity.x, entity.y, '#ffc857', 10);
        }
      }
    } else if (entity.def?.treasure) {
      const reward = this.rollRewardItem(player, entity.def.treasureRare);
      if (reward) {
        this.context.pendingRewards().push(reward);
        this.context.fx.damageText(entity.x, entity.y - 30, reward.name, false, '#ffc857');
        this.context.fx.sparkle(entity.x, entity.y, '#ffc857', 12);
      }
    }
  }

  /**
   * 抽一件道具作为奖励。品质与幸运挂钩。
   */
  private rollRewardItem(player: WeaponOwner, forceRare = false) {
    // 第十六轮：走 stats.luckEff（含角色幸运倍率），理由见 spawnTreasureMimic。
    const luckBonus = luckBenefits('luckEff' in player.stats ? player.stats.luckEff : Number.NaN).shopQualityBonus;
    // 动态 import 会打乱打包/启动顺序，这里直接用顶部已导入的道具表
    const pool = this.itemPool;
    if (pool.length === 0) return null;

    // 按价格分层加权：幸运越高越容易出贵的
    const weights = pool.map((it) => {
      const t = it.price >= 26 ? 3 : it.price >= 18 ? 2 : 1;
      let w = t === 1 ? 10 : t === 2 ? 6 : 3;
      if (t >= 2) w *= 1 + luckBonus * 1.8;
      if (forceRare) w *= t >= 2 ? 3 : 0.6;
      return w;
    });
    let total = 0;
    for (const w of weights) total += w;
    let r = this.context.rng.next() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) { idx = i; break; }
    }
    const def = pool[idx];
    return {
      id: def.id,
      name: def.name,
      price: def.price,
      rare: forceRare || def.price >= 26,
      // 卖出价：大约半价（和武器出售的手感一致）
      sellValue: Math.max(4, Math.round(def.price * 0.55)),
    };
  }

  settle(player: WeaponOwner, enemy: CombatTarget) {
    enemy.dead = true;
    // ---- 宝箱：不走普通击杀流程 ----
    // 宝箱不是"敌人"，不计入击杀数、不掉经验/材料，
    // 只结算它自己预先掷好的奖励（道具或医疗包）。
    if (enemy.isChest) {
      this.context.fx.explosion(enemy.x, enemy.y, 60, enemy.color);
      this.context.fx.sparkle(enemy.x, enemy.y, enemy.color, 10);
      this.context.shake(5, 0.2);
      this.resolveTreasure(player, enemy);
      this.context.notifyKilled(enemy);
      return;
    }

    player.kills++;
    // 动态难度统计：这个敌人活了多久（秒杀检测用）
    if (enemy._bornWaveT != null) this.killAges.push(this.context.rules().elapsed - enemy._bornWaveT);

    // 掉落
    this.dropLoot(player, enemy);

    // 死亡特效
    if (enemy.boss) {
      this.context.fx.explosion(enemy.x, enemy.y, 160, enemy.color);
      this.context.fx.nova(enemy.x, enemy.y, 220, '#ffffff');
      this.context.shake(22, 0.9);
      this.context.notifyBossKilled(enemy);
      this.settleBossRewards();
      this.context.notifyBossSettled(enemy);
    } else if (enemy.elite) {
      this.context.fx.explosion(enemy.x, enemy.y, 80, enemy.color);
      this.context.shake(8, 0.3);
    } else if (enemy.def?.treasure) {
      // 宝箱怪：金色爆开 + 结算道具奖励
      this.context.fx.explosion(enemy.x, enemy.y, 90, '#ffc857');
      this.context.fx.nova(enemy.x, enemy.y, 120, '#ffc857');
      this.context.shake(7, 0.25);
      this.resolveTreasure(player, enemy);
    } else {
      this.context.fx.sparkle(enemy.x, enemy.y, enemy.color, 4);
    }

    // 分裂
    if (enemy.def?.behavior === 'splitter' && !enemy.splitDone) {
      enemy.splitDone = true;
      const n = enemy.def.splitCount ?? 3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const child = this.context.spawn(enemy.def.splitInto ?? 'slime',
          enemy.x + Math.cos(a) * 26, enemy.y + Math.sin(a) * 26);
        if (child) {
          // 分裂体血量减半，避免滚雪球
          child.maxHp *= 0.5;
          child.hp = child.maxHp;
        }
      }
    }

    this.context.notifyKilled(enemy);
  }

  private dropLoot(player: WeaponOwner, enemy: EnemyBody) {
    const { wave, durationDamp, special } = this.context.rules();
    // 掉落倍率最后作用于经验与材料，保留时长抑制和前期收益曲线。
    const lootMul = special === 'egg' ? 2 : 1;
    const xp = enemy.xpValue;
    const xpCount = Math.min(8, Math.max(1, Math.round(xp / 2)));
    const perXp = Math.max(1, Math.round(xp / xpCount)) * lootMul;
    for (let i = 0; i < xpCount; i++) {
      const a = this.context.rng.next() * TAU;
      const d = this.context.rng.range(4, 22);
      this.context.pickups.add(new Pickup(PICKUP_TYPE.XP, enemy.x + Math.cos(a) * d, enemy.y + Math.sin(a) * d, perXp));
    }

    // 材料掉落使用当前倍率和幸运规则，Boss/精英与普通敌人分别结算。
    const luckMul = luckBenefits('luckEff' in player.stats ? player.stats.luckEff : Number.NaN).dropMultiplier;
    const w = wave;
    const earlyBonus = w < 5 ? 1.35 : w < 10 ? 1.15 : 1;
    // 中后期收紧：11-13 波 ×0.65，14 波以后 ×0.38。
    // （第三轮把时长拉长后，中后期收入仍偏高，这里顺势再收紧一档）
    const lateDamp = w < 10 ? 1 : w < 14 ? 0.65 : 0.38;
    const matChance = enemy.boss || enemy.elite
      ? 1
      : Math.min(1, 0.85 * luckMul * earlyBonus * durationDamp);
    if (this.context.rng.next() < matChance) {
      // 第一百五十六轮：鸡蛋波材料掉落也 ×2（lootMul 定义见上方经验段）
      const value = Math.max(1, Math.round(
        enemy.materialValue * lateDamp * durationDamp,
      )) * (special === 'egg' ? 2 : 1);
      // 双份概率：前期有帮助，中后期收回
      const dbl = w < 10 ? 0.4 : 0.2;
      const count = enemy.boss ? 14 : enemy.elite ? 6 : (this.context.rng.next() < dbl ? 2 : 1);
      for (let i = 0; i < count; i++) {
        const a = this.context.rng.next() * TAU;
        const d = this.context.rng.range(4, 30);
        this.context.pickups.add(new Pickup(PICKUP_TYPE.MATERIAL, enemy.x + Math.cos(a) * d, enemy.y + Math.sin(a) * d, value));
      }
    }

    // 医疗包按敌人档位和幸运抽取，生成前遵守场上数量上限。
    const healChance = enemy.mutant ? 1
      : (enemy.boss ? 0.5 : enemy.elite ? 0.25 : 0.015) * luckMul;
    if (this.context.rng.next() < healChance) {
      // 医疗包达到上限后停止生成，拾取后立即释放名额。
      const healAlive = this.context.pickups.items.filter(
        (p) => !p.dead && p.type === PICKUP_TYPE.HEAL,
      ).length;
      if (enemy.mutant || healAlive < HEAL_PICKUP_MAX) {
        // Boss医疗包使用999表示回满；普通和变异体的治疗量分别结算。
        this.context.pickups.add(new Pickup(PICKUP_TYPE.HEAL, enemy.x, enemy.y,
          enemy.boss ? 999 : enemy.mutant ? 6 : 4));
      }
    }
  }

}
