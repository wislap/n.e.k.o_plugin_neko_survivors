import type { Player } from './player.ts';
import type { World } from '../world/world.ts';
import type { EnemyBody } from './enemy.ts';
import type { CharacterId, CharacterSkillDefinition } from '../content/definitions.ts';

// 角色运行时集中技能计时、叠层与触发；属性倍率在其实际消费点应用。

import { getCharSkill } from '../content/char-skills.ts';

// Player只持有一个角色技能运行时；临时状态不写回内容定义。
export class CharRuntime {
  player: Player;
  id: CharacterId;
  def: CharacterSkillDefinition | null;
  params: CharacterSkillDefinition['params'];
  lethalUsedThisRound: number;
  lethalSpeedTimer: number;
  mdStacks: number;
  mdTimer: number;
  shieldLockout: number;
  curseTimers: Map<number, number>;
  turretStacks: Map<number, { stacks: number; timer: number }>;

  constructor(player: Player) {
    this.player = player;
    this.id = player.characterId;
    this.def = getCharSkill(this.id);
    this.params = this.def?.params || {};

    // ---- 悠怡：猫的步伐 ----
    this.lethalUsedThisRound = 0;   // 本回合已触发次数
    this.lethalSpeedTimer = 0;      // 加速剩余秒数

    // ---- 开发猫猫：M博士来了 ----
    this.mdStacks = 0;              // 层数（无限叠加）
    this.mdTimer = 0;               // 剩余时间；归零即清零

    // ---- 悠怡洛丽塔：伤不到我喵 ----
    this.shieldLockout = 0;         // 碎盾后的封锁剩余秒数

    // ---- 库洛：毒舌猫娘 ----
    // 每只敌人一个计时器，key 是 enemy.id。
    // 不用挂在敌人身上，是因为那是"库洛施加的"状态：
    // 库洛死了/换角色之后它就该消失，挂在自己身上天然满足。
    this.curseTimers = new Map();

    // ---- Neon（原"neon宴会"）：火力即正义 ----
    // 同上，key 是 enemy.id，value 是 { stacks, timer }
    this.turretStacks = new Map();

  }

  /** Kuro's range rule belongs to the character, including its default multiplier. */
  modifyMeleeRange(multiplier: number) {
    return this.id === 'kuro' ? multiplier * (this.params.meleeRangeMul ?? 1.2) : multiplier;
  }

  // 每帧
  update(dt: number, world: World | null) {
    if (!this.def) return;
    const p = this.player;

    // ---- 悠怡：锁血后的加速 ----
    if (this.lethalSpeedTimer > 0) {
      this.lethalSpeedTimer -= dt;
      if (this.lethalSpeedTimer <= 0) {
        this.lethalSpeedTimer = 0;
        p.speedBonusMul = 1;
      }
    }

    // ---- 开发猫猫：5 秒没受伤就清零 ----
    if (this.mdStacks > 0) {
      this.mdTimer -= dt;
      if (this.mdTimer <= 0) {
        this.mdTimer = 0;
        this.mdStacks = 0;
        p.mdStacks = 0;
      }
    }

    // ---- 悠怡洛丽塔：碎盾封锁 ----
    if (this.shieldLockout > 0) {
      this.shieldLockout -= dt;
      if (this.shieldLockout <= 0) this.shieldLockout = 0;
    }

    // ---- 库洛：毒舌判定 ----
    if (this.id === 'kuro' && world) this._updateKuroCurse(world);

    // ---- Neon（原"neon宴会"）：炮台叠层过期 ----
    // 不要求 world：叠层纯粹是"玩家自己的记账"，没有世界也要能倒计时
    // （测试里就是 `rt.update(dt, null)` 直接跑的）。
    if (this.id === 'neon_party') this._updateTurretStacks(dt);
  }

  // 悠怡：猫的步伐（受到致死伤害时锁血）
  // 拦截致死伤害后锁血并触发后空翻；返回值决定受击事务是否继续。
  tryLethalSave(fromX?: number, fromY?: number) {
    if (this.id !== 'yui') return false;
    const pa = this.params;
    if (this.lethalUsedThisRound >= (pa.lethalPerRound ?? 1)) return false;

    this.lethalUsedThisRound++;

    const p = this.player;
    // 能力接受致死拦截后由Health提交锁血；总无敌包含0.5秒后空翻与3秒保护。
    p.invuln = Math.max(p.invuln, 0.5 + (pa.lethalInvuln ?? 3));
    p.speedBonusMul = pa.lethalSpeedMul ?? 1.4;
    this.lethalSpeedTimer = (pa.lethalSpeedTime ?? 3) + 0.5;
    // 视觉反馈：一圈金环 + 屏幕轻震，让玩家明确知道"刚才那下本该死了"

    // ---- 后空翻：往受击完全相反的方向跳 0.5s / 200px ----
    // fromX/fromY 缺省（真伤/环境伤害没来源）就背对移动方向随便翻，
    // 朝地图外不行 —— 兜底用"远离场心"方向，保证总有地方去。
    const sx = typeof fromX === 'number' && Number.isFinite(fromX) ? fromX : p.x * 2;
    const sy = typeof fromY === 'number' && Number.isFinite(fromY) ? fromY : p.y * 2;
    let dx = p.x - sx, dy = p.y - sy;
    const d = Math.hypot(dx, dy);
    if (d < 1) { dx = 1; dy = 0; }             // 来源正好在脚下：翻向 +x
    else { dx /= d; dy /= d; }
    // ≈400px/s × 0.5s = 200px（用户口径"大概0.5秒移动200px"）
    p._backflip = { t: 0.5, vx: dx * 400, vy: dy * 400 };
    p.effects.emit({ type: 'sound', name: 'catStep' });                     // 猫的步伐.ogg
    return true;
  }

  /** 每回合开始重置次数（main.js 在 startWave 时调） */
  onRoundStart() {
    this.lethalUsedThisRound = 0;
    this.curseTimers.clear();
    this.turretStacks.clear();
    const p = this.player;
    p.mdStacks = 0;
    this.mdStacks = 0;
    this.mdTimer = 0;
  }

  // 悠怡：回合结束 +2 收获
  onRoundEnd() {
    if (this.id !== 'yui') return 0;
    const n = this.params.harvestPerRound ?? 0;
    if (n > 0) this.player.gainMaterials(n);
    return n;
  }

  // 悠怡：经验 +20%
  xpMul() {
    if (this.id !== 'yui') return 1;
    return this.params.xpMul ?? 1;
  }

  // 悠怡萌妹：每 10 点幸运 +1 收获
  // 幸运额外收获只在关卡结算时计算，避免每帧或每次拾取重复发放。
  luckHarvest() {
    if (this.id !== 'nana') return 0;
    const per = this.params.luckPerHarvest ?? 10;
    if (per <= 0) return 0;
    // 变量名带 eff 前缀是**故意的**：
    // test/luck-effect.mjs 会全仓扫描"裸 luck 参与除法"的表达式，
    // 用来防止有人绕过 effectiveLuck() 直接拿面板值去算。
    // 它靠的是正则匹配变量名，所以这里叫 `luck` 会被误报成漏网之鱼。
    // 叫 `effLuck` 既躲开误报，也把"这已经是换算过的值"写在名字里。
    const effLuck = this.player.stats.luckEff;
    if (!(effLuck > 0)) return 0;
    return Math.floor(effLuck / per);
  }

  // 悠怡萌妹：本喵最欧
  // 技能幸运概率按有效幸运换算为百分点，封顶30%。
  luckyChance() {
    if (this.id !== 'nana') return 0;
    const pa = this.params;
    const base = pa.luckyHitChance ?? 0;
    const per = pa.luckyChancePerLuck ?? 0;
    const max = pa.luckyChanceMax ?? 100;
    const luck = this.player.stats.luckEff;
    return Math.min(max, base + Math.max(0, luck) * per);
  }

  /** 造成伤害时调用：返回伤害倍率（1 = 不变，1.5 = 幸运一击） */
  rollLuckyHit() {
    if (this.id !== 'nana') return 1;
    const chance = this.luckyChance();
    if (chance <= 0) return 1;
    if (this.player.rng.next() * 100 >= chance) return 1;
    return this.params.luckyHitMul ?? 1.5;
  }

  /** 受到伤害时调用：返回减伤后的倍率（1 = 不减，0.5 = 减半） */
  rollLuckyGuard() {
    if (this.id !== 'nana') return 1;
    const chance = this.luckyChance();
    if (chance <= 0) return 1;
    if (this.player.rng.next() * 100 >= chance) return 1;
    return 1 - (this.params.luckyGuardReduction ?? 0);
  }

  // 开发猫猫：M博士来了
  /** 受伤时叠一层 */
  onHurt() {
    if (this.id !== 'shiro') return;
    const pa = this.params;
    this.mdStacks++;
    this.mdTimer = pa.stackDuration ?? 5;
    this.player.mdStacks = this.mdStacks;
    // 挨打获得材料是永久收入，不能随5秒临时叠层一起清零。
    if (pa.stackGold) this.player.gainMaterials(pa.stackGold);
  }

  /** 当前叠层带来的伤害加成（百分点） */
  get mdDamageBonus() {
    if (this.id !== 'shiro') return 0;
    return this.mdStacks * (this.params.stackDamage ?? 0);
  }

  /** 当前叠层带来的移速加成（百分点） */
  get mdMoveBonus() {
    if (this.id !== 'shiro') return 0;
    return this.mdStacks * (this.params.stackMove ?? 0);
  }

  // 悠怡洛丽塔：伤不到我喵（满血溢出转护盾）
  // 特定角色将溢出治疗转为护盾，护盾限制和治疗效果分开结算。
  healToShield(overflow: number) {
    if (this.id !== 'youyi') return 0;
    if (!(overflow > 0)) return 0;
    if (this.shieldLockout > 0) return 0;

    const p = this.player;
    const cap = p.stats.get('maxHp') * (this.params.shieldMaxPct ?? 0.3);
    if (!(cap > 0)) return 0;
    if (p.shield >= cap) return 0;

    const add = Math.min(overflow, cap - p.shield);
    if (!(add > 0)) return 0;
    // replace=false：这是"一点点攒起来的盾"，不是"换一面更厚的盾"。
    // 和升级给的护盾（replace=true 取较大值）语义不同。
    p.addShield(add, false);
    // 这个盾是"溢出转化"来的，必须打上标记：
    // 只有它才有"护盾存在时不受生命伤害"的特权，
    // 升级给的普通护盾仍然按老规则（可溢出到血量）。
    p.shieldFullBlock = true;
    return add;
  }

  /** 碎盾回调：进入 5 秒封锁 */
  onShieldBreak() {
    if (this.id !== 'youyi') return;
    this.shieldLockout = this.params.breakLockout ?? 5;
    this.player.shieldFullBlock = false;
  }

  // 库洛：毒舌猫娘
  // 诅咒范围使用实际拾取范围，包含该属性的成长修正。
  get curseRadius() {
    if (this.id !== 'kuro') return 0;
    return this.player.stats.get('pickupRange');
  }

  /** 当前的判定概率（0~1）。每 10% 攻速 +1%。 */
  get curseChance() {
    if (this.id !== 'kuro') return 0;
    const pa = this.params;
    const as = this.player.stats.values.attackSpeed;
    return (pa.curseChance ?? 0) + Math.max(0, as) * (pa.curseChancePerAS ?? 0);
  }

  _updateKuroCurse(world: World) {
    const pa = this.params;
    const radius = this.curseRadius;
    if (!(radius > 0)) return;

    const p = this.player;
    const now = p.timeAlive;

    // 范围内的敌人
    const near = world.grid.query(p.x, p.y, radius, []);
    const chance = this.curseChance;
    const dur = pa.curseDuration ?? 5;

    for (const e of near) {
      if (!e.isEnemy || e.dead) continue;
      const last = this.curseTimers.get(e.id) ?? -99;
      if (now - last < (pa.curseInterval ?? 3)) continue;
      this.curseTimers.set(e.id, now);

      if (p.rng.next() >= chance) continue;

      // 中招：不可叠加 → 直接覆盖计时器，不累加倍率。
      // 这就是"不可叠加"的实现方式：debuff 是**一组固定的乘数 + 一个计时器**，
      // 再中一次只是把计时器续到 5 秒，不会变成 ×0.8²。
      e.curseTimer = dur;
      e.curseDamageMul = pa.curseDamageMul ?? 0.8;
      e.curseSpeedMul = pa.curseSpeedMul ?? 0.8;
      e.curseRateMul = pa.curseRateMul ?? 0.8;
      world.fx?.damageText?.(e.x, e.y - e.radius, '毒舌', false, '#c9a0ff');
    }

    // 清理：只清"已经过期"的 id，避免 Map 无限增长
    if (this.curseTimers.size > 256) {
      for (const [id, t] of this.curseTimers) {
        if (now - t > 8) this.curseTimers.delete(id);
      }
    }
  }

  // Neon（原"neon宴会"）：火力即正义
  /** 炮台命中某个敌人时叠一层，返回当前叠层加成（0.01 = +1%） */
  onTurretHit(enemy: Pick<EnemyBody, 'id'> | null) {
    if (this.id !== 'neon_party' || !enemy) return 0;
    const pa = this.params;
    const rec = this.turretStacks.get(enemy.id) || { stacks: 0, timer: 0 };
    rec.stacks++;
    rec.timer = pa.stackDuration ?? 5;
    this.turretStacks.set(enemy.id, rec);
    return Math.min(pa.stackMax ?? 0.3, rec.stacks * (pa.stackPerHit ?? 0.01));
  }

  // 每个敌人独立保存炮台叠层；过期后加成为零。
  turretBonusFor(enemy: Pick<EnemyBody, 'id'> | null) {
    if (this.id !== 'neon_party' || !enemy) return 0;
    const rec = this.turretStacks.get(enemy.id);
    if (!rec) return 0;
    return Math.min(this.params.stackMax ?? 0.3, rec.stacks * (this.params.stackPerHit ?? 0.01));
  }

  _updateTurretStacks(dt: number) {
    if (this.turretStacks.size === 0) return;
    const dead = [];
    for (const [id, rec] of this.turretStacks) {
      rec.timer -= dt;
      if (rec.timer <= 0) dead.push(id);
    }
    for (const id of dead) this.turretStacks.delete(id);
  }

  // neon：保持安全距离喵
  // 距离倍率在命中时读取玩家和目标的位置，不缓存发射距离。
  distanceMul(dist: number) {
    if (this.id !== 'luna') return 1;
    const pa = this.params;
    const full = pa.distanceFull ?? 640;
    if (!(full > 0)) return 1;
    const t = Math.min(1, Math.max(0, dist / full));
    return 1 + (pa.distanceBonusMax ?? 0.4) * t;
  }

  // 小八：龙虾突击
  /**
   * 近战命中后掷一次骰子。
   */
  rollLobster(weaponKind: string) {
    if (this.id !== 'mimi') return false;
    if (weaponKind !== 'melee') return false;
    if (this.player.rng.next() >= (this.params.lobsterChance ?? 0.2)) return false;
    return true;
  }

  /** 龙虾追击的伤害倍率（相对触发的武器本次伤害） */
  get lobsterMul() {
    return this.params.lobsterMul ?? 2;
  }
}

/** 给一个 Player 建运行时（Player 构造末尾调） */
export function attachCharRuntime(player: Player) {
  const rt = new CharRuntime(player);
  player.charRt = rt;
  return rt;
}
