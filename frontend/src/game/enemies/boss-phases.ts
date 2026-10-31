export type BossPhase = 1 | 2 | 3;
// 普通Boss阶段由血线与时间共同推进；共享锁血池防止同一阈值重复触发。

/** 阶段阈值：血量比例与时间比例都用这组 */
const PHASE_THRESHOLDS = [
  { phase: 3, at: 0.33 },
  { phase: 2, at: 0.66 },
] as const;

// ---- 锁血参数（第九轮用户要求，见 BossPhaseState 里的说明）----

/** 登场无敌时长（秒） */
const BOSS_SPAWN_INVULN = 5;
/** 每次转阶段的无敌时长（秒） */
const BOSS_PHASE_INVULN = 5;
/** 撞到 33%/66% 卡点后的无敌时长（秒） */
const BOSS_GATE_LOCK = 5;
// 每阶段拥有独立战斗倍率，只在阶段切换后由行为读取。
const PHASE_MODS = {
  1: {
    name: '第一阶段',
    fireRate: 1.0,      // 攻击冷却倍率（越小越快）
    bulletMul: 1.0,     // 弹幕条数倍率
    bulletSpeed: 1.0,
    summonRate: 1.0,
    moveSpeed: 1.0,
    charge: false,
    shake: 0,
    color: null,
  },
  2: {
    name: '第二阶段',
    fireRate: 0.78,     // 攻速 +28%
    bulletMul: 1.35,
    bulletSpeed: 1.12,
    summonRate: 0.78,
    moveSpeed: 1.10,
    charge: true,       // 开始冲锋
    shake: 5,
    color: '#ffb74d',
  },
  3: {
    name: '第三阶段 · 狂暴',
    fireRate: 0.58,     // 攻速 +72%
    bulletMul: 1.85,    // 弹幕几乎翻倍 → 压迫感来源
    bulletSpeed: 1.28,
    summonRate: 0.6,
    moveSpeed: 1.22,
    charge: true,
    shake: 13,          // 持续震屏
    color: '#ff3d6e',
  },
};

// 血量和剩余时间共同决定目标阶段，返回更高阶段；阶段不会倒退。
function computeBossPhase({ hpRatio, timeRatio, prevPhase = 1 }: { hpRatio: number; timeRatio: number; prevPhase?: BossPhase }) {
  // 两个信号里"更吃紧"的那个（越小越接近结束）
  const worst = Math.min(clamp01(hpRatio), clamp01(timeRatio));

  let phase: BossPhase = 1;
  // 从高到低判断，保证跨过 66% 时直接落在正确的档位
  for (const t of PHASE_THRESHOLDS) {
    if (worst <= t.at) { phase = t.phase; break; }
  }
  // 阶段只增不减：避免血量被治疗或时间延长时掉回低阶段
  return phase > prevPhase ? phase : prevPhase;
}

/**
 * 普通 Boss 阶段状态机：由普通行为与受击 gate 共同消费，躯体不暴露此状态。
 * 只负责"判断该不该换阶段 + 换的时候播一次演出"，具体倍率由 mods getter 提供。
 */
export class BossPhaseState {
  phase: BossPhase = 1; changeFx = 0; invulnTimer = 0; gatesUsed: { 2: boolean; 3: boolean } = { 2: false, 3: false }; gateLockTimer = 0; lastBlocked = 0;
  constructor() {
    this.phase = 1;
    this.changeFx = 0;          // 切换演出剩余时间

    // 登场与转阶段共享无敌预算；新触发只补充预算，避免每段重新获得完整护盾。
    this.invulnTimer = BOSS_SPAWN_INVULN;
    this.gatesUsed = { 2: false, 3: false };   // 每卡点的共享护盾（先到先用）
    this.gateLockTimer = 0;                    // 卡血时的无敌剩余时间
    this.lastBlocked = 0;                      // 本帧是否被无敌/卡血挡下（给 renderer 用）
  }

  /** 当前阶段的参数倍率 */
  get mods() { return PHASE_MODS[this.phase]; }

  /** 现在是否处于"打不动"的状态（登场无敌 / 转阶段无敌 / 卡血无敌） */
  get invulnerable() { return this.invulnTimer > 0 || this.gateLockTimer > 0; }

  /** 剩余无敌时间（给 UI / 特效用） */
  get invulnLeft() { return Math.max(this.invulnTimer, this.gateLockTimer); }

  // 伤害在跨阈值前先门控，截断到卡点后推进阶段与共享锁血。
  applyDamageLock(hp: number, maxHp: number, dmg: number) {
    // 1) 无敌中：完全免伤
    if (this.invulnerable) {
      return { blocked: true, dmg: 0, reason: 'invuln', gated: 0 };
    }
    if (maxHp <= 0) return { blocked: false, dmg, reason: '', gated: 0 };

    // 同击跨多条血线时先卡最高阈值；按升序遍历会跳过中间阶段，必须反向检查。
    const byDesc = [...PHASE_THRESHOLDS].sort((a, b) => b.at - a.at);
    for (const t of byDesc) {
      if (this.gatesUsed[t.phase]) continue;
      const gateHp = maxHp * t.at;
      if (hp > gateHp && hp - dmg < gateHp) {
        this.gatesUsed[t.phase] = true;
        this.gateLockTimer = BOSS_GATE_LOCK;
        // 只打到卡点为止（保底 1 点，避免出现 0 伤害的观感问题）
        const allowed = Math.max(1, hp - gateHp);
        return { blocked: false, dmg: allowed, reason: 'gate', gated: t.phase };
      }
    }
    return { blocked: false, dmg, reason: '', gated: 0 };
  }

  /**
   * 每帧更新。
   */
  update(hpRatio: number, timeRatio: number) {
    const next = computeBossPhase({ hpRatio, timeRatio, prevPhase: this.phase });
    if (next > this.phase) {
      this.phase = next;

      this.changeFx = 1.6;            // 阶段与锁血共用一次性护盾；已有无敌时间取与完整转阶段无敌时间的较大值。
      if (next !== 1 && !this.gatesUsed[next]) {
        this.gatesUsed[next] = true;
        this.invulnTimer = Math.max(this.invulnTimer, BOSS_PHASE_INVULN);
      }
      return next;
    }
    return 0;
  }

  tick(dt: number) {
    if (this.changeFx > 0) this.changeFx -= dt;
    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    if (this.gateLockTimer > 0) this.gateLockTimer = Math.max(0, this.gateLockTimer - dt);
    if (this.lastBlocked > 0) this.lastBlocked = Math.max(0, this.lastBlocked - dt);
  }
}

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
