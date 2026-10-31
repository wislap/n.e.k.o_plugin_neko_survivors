import type { World } from '../world/world.ts';
import type { RuleEffects } from '../world/effects-port.ts';
export interface CometContext { world: World; rng: RNG; speak(text: string): void }
// arcs were unconsumed even in the reference, but their construction shares the
// comet stream with later fire-rain geometry. Retire only with an explicit RNG migration.
export interface CometBolt { x: number; y: number; landY: number; vy: number; r: number; t: number; landed: boolean; seed: number; arcs: { a: number; spin: number; len: number }[]; fuse?: number; second?: boolean }
export interface CometRing { x: number; y: number; rMax: number; t: number; life: number; warm?: boolean; kind?: string; delay?: number }
// 天彗龙每局最多触发一次；阶段按规则时间推进，显示和媒体由外层消费。
// 火雨可二次爆炸；敌我真伤结算不同，玩家生命保底 1。

import { WORLD_SIZE } from '../world/config.ts';
import { RNG } from '../math/random.ts';
import { musicCue, encounterCues } from './cues.ts';


// ---- 阶段时长（秒）----
const T_PENDING = 5.0;
const T_BANNER_IN = 0.3;
const T_BANNER_HOLD = 3.0;
const T_BANNER_OUT = 0.3;
const T_GAP1 = 2.0;
const T_FLY = 1.6;          // 单次横穿
const T_GAP2 = 1.2;
const T_GAP3 = 2.5;
const T_DIVE = 0.5;
const T_BOOM = 0.9;         // 白闪+冲击波总时长
const T_ROAR = 4.0;         // 站姿展示与全场眩晕共用时长
const T_TAKEOFF = 1.6;

// ---- 伤害数值（用户规格）----
const BOLT_PLAYER_PCT = 0.2;    // 炮弹：玩家 20% 当前生命
const BOLT_ENEMY_PCT = 0.2;     // 炮弹：敌人 20% maxHp
const BOLT_ENEMY_FLAT = 500;
const BOOM_PLAYER_PCT = 0.7;    // 大爆炸：玩家 70% 当前生命
const BOOM_ENEMY_PCT = 0.7;     // 大爆炸：敌人 70% maxHp
const BOOM_ENEMY_FLAT = 3000;

/** Wave-entry state; projectile references, FX and browser playback are replay-owned. */
export interface CometSnapshot {
  rngState: number;
  fields: {
    phase: 'idle' | 'pending' | 'banner' | 'gap1' | 'fly1' | 'gap2' | 'fly2' | 'gap3' | 'dive' | 'boom' | 'roar' | 'takeoff' | 'done';
    t: number;
    age: number;
    fired: boolean;
    pending: boolean;
    dir: number;
    cx: number;
    cy: number;
    shake: number;
    flash: number;
    half: number;
    _bgmDelay: number;
  };
}

export class CometDisaster {
  declare effects: RuleEffects | undefined; declare bolts: CometBolt[]; declare rings: CometRing[];
  declare trail: { x: number; y: number; t: number; life: number; r: number }[];
  declare half: number; declare _bgm: ReturnType<typeof musicCue> | null;
  declare rng: RNG;
  declare cues: ReturnType<typeof encounterCues>;
  declare phase: 'idle' | 'pending' | 'banner' | 'gap1' | 'fly1' | 'gap2' | 'fly2' | 'gap3' | 'dive' | 'boom' | 'roar' | 'takeoff' | 'done';
  declare t: number;
  declare age: number;
  declare fired: boolean;
  declare pending: boolean;
  declare dir: number;
  declare cx: number;
  declare cy: number;
  declare shake: number;
  declare flash: number;
  declare _bgmDelay: number;
  declare _boltAcc?: number;
  declare _lastT?: number;
  declare _boltSfxT?: number;
  captureState(): CometSnapshot {
    return { rngState: this.rng.state, fields: {
      phase: this.phase,
      t: this.t,
      age: this.age,
      fired: this.fired,
      pending: this.pending,
      dir: this.dir,
      cx: this.cx,
      cy: this.cy,
      shake: this.shake,
      flash: this.flash,
      half: this.half,
      _bgmDelay: this._bgmDelay,
    } };
  }

  restoreState(snapshot: CometSnapshot): void {
    this.rng.state = snapshot.rngState;
    this.phase = snapshot.fields.phase;
    this.t = snapshot.fields.t;
    this.age = snapshot.fields.age;
    this.fired = snapshot.fields.fired;
    this.pending = snapshot.fields.pending;
    this.dir = snapshot.fields.dir;
    this.cx = snapshot.fields.cx;
    this.cy = snapshot.fields.cy;
    this.shake = snapshot.fields.shake;
    this.flash = snapshot.fields.flash;
    this.half = snapshot.fields.half;
    this._bgmDelay = snapshot.fields._bgmDelay;
  }

  constructor({ rng = new RNG(0x434f4d), effects }: { rng?: RNG; effects?: RuleEffects } = {}) {
    this.rng = rng.fork(0x434f4d);
    this.effects = effects;
    this.cues = encounterCues(effects);
    this.phase = 'idle';       // idle/pending/banner/gap1/fly1/gap2/fly2/gap3/dive/boom/roar/takeoff/done
    this.t = 0;                // 当前阶段计时
    this.age = 0;              // 事件总时长（演出用）
    this.fired = false;        // 全局限一次（一局游戏）
    this.pending = false;      // 本回合摇中了，等 5s 前摇
    this.dir = 1;              // 飞影方向：1 = 从左往右
    this.cx = 0;               // 地图中心（boom 落点）
    this.cy = 0;
    this.shake = 0;            // 屏幕震动强度（px），renderer 每帧衰减
    this.flash = 0;            // 全屏白闪 alpha
    this.bolts = [];           // 火雨粒子 {x,y,vy,r,t,life,landed}
    this.rings = [];           // 冲击波/声波环 {x,y,rMax,t,life,warm}
    this.trail = [];           // 飞影彗尾 {x,y,t,life,r}
    this.half = WORLD_SIZE / 2;
    this._bgm = null;          // 天彗龙 BGM 独立元素（不进 audio 的场景通道）
    this._bgmDelay = 0;
  }

  // 触发判定
  // 波次入口只判定一次；第 6 波起概率每波递增 5%，每局最多一次。
  roll(wave: number, rng: RNG | null, force = false) {
    if (this.fired || this.pending || this.phase !== 'idle') return false;
    const p = Math.min(1, 0.05 * (wave - 4));
    const hit = force || (rng?.next?.() ?? this.rng.next()) < p;
    if (hit) {
      this.pending = true;
      this.t = 0;

    }
    return hit;
  }

  /** 暂停菜单测试按钮：下一个 5s 前摇后必出 */
  forceTrigger(wave: number) {
    return this.roll(wave, null, true);
  }

  /** 回合结束（main._endWave）：停 BGM、复位到可摇状态 */
  onWaveEnd() {
    this.pending = false;
    this._bgmDelay = 0;
    this.stopBgm();
    if (this.phase !== 'idle' && this.phase !== 'done') this.phase = 'done';
  }

  // BGM（独立元素：不劫持 audio 的场景通道，回合结束显式停）
  _ensureBgm() {
    if (this._bgm) return this._bgm;
    this._bgm = musicCue(this.effects, 'comet_bgm', 0.6);
    return this._bgm;
  }

  _startBgm() {
    const el = this._ensureBgm();
    if (!el) return;
    try {
      el.currentTime = 0;
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* 自动播放拦/文件缺 */ });
    } catch { /* 忽略 */ }
  }

  stopBgm() {
    try {
      if (this._bgm) { this._bgm.pause(); }
    } catch { /* 忽略 */ }
  }

  // roar 期间返回 true，由 Battle 冻结世界和波次计时。
  update(dt: number, main: CometContext) {
    if (this.phase === 'idle' && !this.pending) return false;
    this.t += dt;
    this.age += dt;
    if (this._bgmDelay > 0) {
      this._bgmDelay -= dt;
      if (this._bgmDelay <= 0) this._startBgm();
    }
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash = Math.max(0, this.flash - dt * 2);

    // 粒子推进（任何阶段都跑，让火雨余烬自然落完）
    for (const b of this.bolts) {
      b.t += dt;
      if (!b.landed) {
        b.y += b.vy * dt;
        b.vy += 900 * dt;          // 重力加速下坠
        if (b.y >= b.landY) {
          b.landed = true;
          b.t = 0;
          b.fuse = 0.5;            // 第一百八十二轮：0.5 秒后二次大爆
          this._boltImpact(main, b);
        }
      } else if (!b.second) {
        // 引信倒计时 → 二次大爆（伤害与弹幕本身相同——"轮流爆炸"）
        b.fuse! -= dt;
        if (b.fuse! <= 0) {
          b.second = true;
          b.t = 0;
          this._boltBlast(main, b);
        }
      }
    }
    // 二次爆炸保留 2.4 秒粒子寿命，避免烟和碎屑突然截断。
    this.bolts = this.bolts.filter((b) => (b.second ? b.t < 2.4 : (b.landed ? true : b.t < 12)));
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < r.life);
    for (const s of this.trail) s.t += dt;
    this.trail = this.trail.filter((s) => s.t < s.life);

    switch (this.phase) {
      case 'idle': // pending 前摇（回合开始后 5s）
        if (this.t >= T_PENDING) {
          this.pending = false;
          this.fired = true;
          this.phase = 'banner';
          this.t = 0;
          this.cx = 0; this.cy = 0;   // 地图中心（世界原点）
          this.dir = (main?.rng?.next?.() ?? this.rng.next()) < 0.5 ? 1 : -1;
          // 袭击警报（合成）+ 小小猫娘语音台词（气泡 + 官方 TTS 通道）
          this.cues.play('comet_' + 'alarm');
          try { main?.speak?.('天上好像有什么东西来了？！'); } catch { /* */ }
        }
        return false;

      case 'banner':
        if (this.t >= T_BANNER_IN + T_BANNER_HOLD + T_BANNER_OUT) {
          this.phase = 'gap1'; this.t = 0;
        }
        return false;

      case 'gap1':
        if (this.t >= T_GAP1) { this.phase = 'fly1'; this.t = 0; this._beginFly(main, false); }
        return false;

      case 'fly1':
        this._tickFly(false);
        if (this.t >= T_FLY) { this.phase = 'gap2'; this.t = 0; }
        return false;

      case 'gap2':
        if (this.t >= T_GAP2) { this.phase = 'fly2'; this.t = 0; this._beginFly(main, true); }
        return false;

      case 'fly2':
        this._tickFly(true);
        if (this.t >= T_FLY) { this.phase = 'gap3'; this.t = 0; }
        return false;

      case 'gap3':
        if (this.t >= T_GAP3) { this.phase = 'dive'; this.t = 0; }
        return false;

      case 'dive':
        if (this.t >= T_DIVE) {
          this.phase = 'boom'; this.t = 0;
          this.shake = 18;
          this.flash = 1;
          // 主冲击波与错时连环爆炸共享落地事件。
          this.rings.push({ x: this.cx, y: this.cy, rMax: this.half * 0.7, t: 0, life: T_BOOM, warm: true, kind: 'shock' });
          this.rings.push({ x: this.cx, y: this.cy, rMax: this.half * 0.7, t: 0, life: T_BOOM, warm: true, kind: 'shock', delay: 0.16 });
          this.rings.push({ x: this.cx, y: this.cy, rMax: this.half * 0.55, t: 0, life: T_BOOM, warm: true, kind: 'shock', delay: 0.32 });
          this.rings.push({ x: this.cx, y: this.cy, rMax: this.half * 0.72, t: 0, life: 1.5, kind: 'ground' });
          this.rings.push({ x: this.cx, y: this.cy, rMax: this.half * 0.6, t: 0, life: 1.3, kind: 'ground', delay: 0.4 });
          // 耳鸣先"刺穿"（立即、音量 0.5），BGM 延 0.55s 再进
          try { this.cues.play('cometTinnitus'); } catch { /* */ }
          this._bgmDelay = 0.55;
          this._dealBoom(main);
        }
        return false;

      case 'boom':
        if (this.t >= T_BOOM) {
          this.phase = 'roar'; this.t = 0;
          this.rings.push({ x: this.cx, y: this.cy - 90, rMax: 420, t: 0, life: 0.8, warm: false });
          this.shake = Math.max(this.shake, 12);   // 185 轮：每圈龙吼声波配一次震屏
          try { this.cues.play('cometRoarVoice'); } catch { /* */ }
        }
        return true;   // boom 期间世界也别动（白闪里什么都看不清）

      case 'roar':
        // 吼叫声波环：每 0.9s 一圈
        if (this.rings.length < 3 && this.t > (this.rings.length + 1) * 0.9) {
          this.rings.push({ x: this.cx, y: this.cy - 90, rMax: 420, t: 0, life: 0.8, warm: false });
          this.shake = Math.max(this.shake, 10);
        }
        if (this.t >= T_ROAR) {
          this.phase = 'takeoff'; this.t = 0;
          try { this.cues.play('cometTakeoff'); } catch { /* */ }
        }
        return true;   // 眩晕：不刷怪、敌人静止、波次计时暂停（用户防秒杀规格）

      case 'takeoff':
        if (this.t >= T_TAKEOFF) { this.phase = 'done'; this.t = 0; }
        return false;   // 龙已起飞，世界恢复（BGM 保留到回合结束）

      default:
        return false;
    }
  }

  // 飞影与火雨
  _beginFly(main: CometContext, second: boolean) {
    this.dir = second ? -this.dir : ((main?.rng?.next?.() ?? this.rng.next()) < 0.5 ? 1 : -1);
    this._boltAcc = 0;
    this._lastT = this.t;
    this._boltSfxT = 0;
    // 超音速呼啸（合成）
    this.cues.play('comet_' + 'whoosh');
  }

  _tickFly(second: boolean) {
    // 彗尾粒子（本体的红色拖尾）——渲染时按 dir 定头向
    if (this.rng.next() < 0.9) {
      const k = this.t / T_FLY;
      const margin = this.half + 260;
      const x = this.dir > 0 ? -margin + k * margin * 2 : margin - k * margin * 2;
      const y = -this.half * 0.45 + Math.sin(this.age * 2.2) * 60;   // 高空近似直线微摆
      this.trail.push({ x, y, t: 0, life: 0.5, r: 26 });
    }
    // 火雨：第一遍每 0.12s 一颗，第二遍密度翻倍
    const interval = second ? 0.06 : 0.12;
    this._boltAcc = (this._boltAcc ?? 0) + dt2(this);
    while (this._boltAcc >= interval) {
      this._boltAcc -= interval;
      const sx = (this.rng.next() * 2 - 1) * this.half * 0.85;
      this.bolts.push({
        x: sx + (this.rng.next() * 2 - 1) * 120,
        y: -this.half * 0.5,
        landY: (this.rng.next() * 2 - 1) * this.half * 0.9,
        vy: 620 + this.rng.next() * 380,
        r: 16 + this.rng.next() * 10,
        t: 0,
        landed: false,
        seed: this.rng.next() * 1000,   // 185 轮：视觉随机种子（爆炸形状稳定不闪烁；不碰游戏 RNG）
        // 电弧粒子：每颗火球挂 2~3 段随机旋转短线（渲染时展开）
        arcs: Array.from({ length: 2 + (this.rng.next() * 2 | 0) }, () => ({
          a: this.rng.next() * Math.PI * 2,
          spin: (this.rng.next() * 2 - 1) * 7,
          len: 10 + this.rng.next() * 14,
        })),
      });
      // 火弹嘶鸣（合成，节流 0.28s 防密集吵耳）
      this._boltSfxT = (this._boltSfxT ?? 0) + interval;
      if (this._boltSfxT >= 0.28) {
        this._boltSfxT = 0;
        this.cues.play('comet_' + 'bolt');
      }
    }
  }

  /** 火球落地：小火爆 + 引信点亮（0.5s 后二次大爆） */
  _boltImpact(main: CometContext, b: CometBolt) {
    this.rings.push({ x: b.x, y: b.landY, rMax: 110, t: 0, life: 0.4, warm: true, kind: 'bolt' });
    this._boltDamage(main, b.x, b.landY, 110);
  }

  // 落地 0.5 秒后二次爆炸，伤害与第一次相同。
  _boltBlast(main: CometContext, b: CometBolt) {
    this.rings.push({ x: b.x, y: b.landY, rMax: 220, t: 0, life: 0.5, warm: true, kind: 'bolt' });
    this._boltDamage(main, b.x, b.landY, 220);
    this.shake = Math.max(this.shake, 6);   // 连爆的细碎震感
    try { this.cues.play('comet_' + 'blast'); } catch { /* */ }
  }

  /** 火弹伤害结算（敌我不分真伤；R=爆圈半径，血量下限 1） */
  _boltDamage(main: CometContext, x: number, y: number, R: number) {
    const world = main?.world;
    if (!world) return;
    // 玩家：20% 当前生命真伤，血量最少剩 1（绝不直接炸死）
    for (const p of (world.players?.() ?? [])) {
      if (!p || p.dead) continue;
      if (Math.hypot(p.x - x, p.y - y) <= R + p.radius) {
        const dmg = Math.max(1, Math.round(p.hp * BOLT_PLAYER_PCT));
        p.hp = Math.max(1, p.hp - dmg);
        p.invuln = Math.max(p.invuln ?? 0, 0.4);
        try {
          world.fx?.damageText?.(p.x, p.y - p.radius - 12, `-${dmg}`, true, '#ff8866');
        } catch { /* */ }
      }
    }
    // 敌人：20% maxHp + 500 真伤
    for (const e of world.enemies?.items ?? []) {
      if (!e || e.dead) continue;
      if (Math.hypot(e.x - x, e.y - y) <= R + e.radius) {
        const dmg = Math.round(e.maxHp * BOLT_ENEMY_PCT) + BOLT_ENEMY_FLAT;
        try { e.takeDamage(dmg, { pierceArmor: true }); } catch { /* */ }
      }
    }
  }

  /** 中心大爆炸：70% 当前/最大生命真伤（用户规格） */
  _dealBoom(main: CometContext) {
    const world = main?.world;
    if (!world) return;
    const R = this.half * 0.7;
    for (const p of (world.players?.() ?? [])) {
      if (!p || p.dead) continue;
      if (Math.hypot(p.x - this.cx, p.y - this.cy) <= R + p.radius) {
        const dmg = Math.max(1, Math.round(p.hp * BOOM_PLAYER_PCT));
        p.hp = Math.max(1, p.hp - dmg);
        p.invuln = Math.max(p.invuln ?? 0, 0.6);
        try { world.fx?.damageText?.(p.x, p.y - p.radius - 12, `-${dmg}`, true, '#ff5544'); } catch { /* */ }
      }
    }
    for (const e of world.enemies?.items ?? []) {
      if (!e || e.dead) continue;
      if (Math.hypot(e.x - this.cx, e.y - this.cy) <= R + e.radius) {
        const dmg = Math.round(e.maxHp * BOOM_ENEMY_PCT) + BOOM_ENEMY_FLAT;
        try { e.takeDamage(dmg, { pierceArmor: true }); } catch { /* */ }
      }
    }
  }

}

// Local elapsed-time sample for the original fire-rain emission cadence.
function dt2(self: CometDisaster) {
  const elapsed = self._lastT === undefined ? 0 : self.t - self._lastT;
  self._lastT = self.t;
  return Math.max(0, elapsed);
}
