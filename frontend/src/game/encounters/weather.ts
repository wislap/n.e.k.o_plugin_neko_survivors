import type { CombatTarget } from '../combat/types.ts';
import type { World } from '../world/world.ts';
import type { Player } from '../actors/player.ts';
import type { GamePlatform } from '../platform.ts';
import type { WeatherDefinition, WeatherId } from '../content/definitions.ts';
export interface Meteor { x: number; y: number; r: number; warnT: number; side: number }
export interface BurnZone { x: number; y: number; r: number; t: number; max: number; visualOnly?: boolean }
export interface Typhoon { x: number; y: number; r: number; vx: number; vy: number; spin: number; turnT: number; r0?: number }
export interface FogCloud { x: number; y: number; r: number; vx: number; vy: number; turnT: number; seed: number; r0?: number }
export type WeatherBurn = { t: number; acc: number } & ({ isPlayer: true; e: Player } | { isPlayer: false; e: CombatTarget });
import type { RNG } from '../math/random.ts';
// 天气机制使用独立 RNG，装饰由显示层维护。
// 效果通过旗标与乘区生效，结束时撤回，不改单位基础属性。

import { ruleBudget } from '../platform.ts';
import { WEATHER_DEFS, WEATHER_MAP } from '../content/weather.ts';

const ROLL_INTERVAL = 3;     // 每 3 秒一次判定
const ROLL_CHANCE = 0.2;     // 20% 进天气
const DUR_MIN = 15;          // 持续 15-30 秒
const DUR_MAX = 30;
const ANNOUNCE_T = 10;       // 公告横幅挂 10 秒左右
const WEATHER_FADE_T = 2.5;  // 自然结束淡出（forceEnd 走 1.2s 快速散）
const WEATHER_RNG_SALT = 0x57ea7ca1;

/** Stable wave-entry data; enemy burns and render-only fields belong to the replayed world. */
export interface WeatherSnapshot {
  rngState: number;
  visualRngState: number;
  fields: {
    phase: 'idle' | 'active' | 'cooldown' | 'fading';
    id: WeatherId | null;
    t: number;
    dur: number;
    cd: number;
    rollAcc: number;
    announceT: number;
    visT: number;
    justStarted: boolean;
    miss: number;
    playerOut: number;
    enemyOut: number;
    moveMul: number;
    enemyFireMul: number;
    cooldownDiv: number;
    invulnMin: number;
    noKnockback: boolean;
    vacuum: boolean;
    fogRamp: number;
    metAcc: number;
    flash: number;
    dotAcc: number;
    fadeT: number;
    _fadeDur: number;
  };
  arrays: {
    meteors: { x: number; y: number; r: number; warnT: number; side: number }[];
    burnZones: { x: number; y: number; r: number; t: number; max: number }[];
    typhoons: { x: number; y: number; r: number; vx: number; vy: number; spin: number; turnT: number }[];
    fogClouds: { x: number; y: number; r: number; vx: number; vy: number; turnT: number; seed: number }[];
  };
  playerBurns: { playerId: number; t: number; acc: number }[];
}

export class WeatherSystem {
  declare id: WeatherId | null;
  declare meteors: Meteor[]; declare burnZones: BurnZone[]; declare typhoons: Typhoon[]; declare fogClouds: FogCloud[]; declare burns: WeatherBurn[]; declare _fadeDur: number;
  declare budget: ReturnType<typeof ruleBudget>;
  declare visualRng: RNG;
  declare rng: RNG;
  declare phase: 'idle' | 'active' | 'cooldown' | 'fading';
  declare t: number;
  declare dur: number;
  declare cd: number;
  declare rollAcc: number;
  declare announceT: number;
  declare visT: number;
  declare justStarted: boolean;
  declare miss: number;
  declare playerOut: number;
  declare enemyOut: number;
  declare moveMul: number;
  declare enemyFireMul: number;
  declare cooldownDiv: number;
  declare invulnMin: number;
  declare noKnockback: boolean;
  declare vacuum: boolean;
  declare fogRamp: number;
  declare metAcc: number;
  declare flash: number;
  declare dotAcc: number;
  declare fadeT: number;
  captureState(): WeatherSnapshot {
    return {
      rngState: this.rng.state, visualRngState: this.visualRng.state,
      fields: {
        phase: this.phase,
        id: this.id,
        t: this.t,
        dur: this.dur,
        cd: this.cd,
        rollAcc: this.rollAcc,
        announceT: this.announceT,
        visT: this.visT,
        justStarted: this.justStarted,
        miss: this.miss,
        playerOut: this.playerOut,
        enemyOut: this.enemyOut,
        moveMul: this.moveMul,
        enemyFireMul: this.enemyFireMul,
        cooldownDiv: this.cooldownDiv,
        invulnMin: this.invulnMin,
        noKnockback: this.noKnockback,
        vacuum: this.vacuum,
        fogRamp: this.fogRamp,
        metAcc: this.metAcc,
        flash: this.flash,
        dotAcc: this.dotAcc,
        fadeT: this.fadeT,
        _fadeDur: this._fadeDur,
      },
      arrays: {
        meteors: this.meteors.map(entity => ({ x: entity.x, y: entity.y, r: entity.r, warnT: entity.warnT, side: entity.side })),
        burnZones: this.burnZones.map(entity => ({ x: entity.x, y: entity.y, r: entity.r, t: entity.t, max: entity.max })),
        typhoons: this.typhoons.map(entity => ({ x: entity.x, y: entity.y, r: entity.r, vx: entity.vx, vy: entity.vy, spin: entity.spin, turnT: entity.turnT })),
        fogClouds: this.fogClouds.map(entity => ({ x: entity.x, y: entity.y, r: entity.r, vx: entity.vx, vy: entity.vy, turnT: entity.turnT, seed: entity.seed })),
      },
      playerBurns: this.burns.flatMap(burn => burn.isPlayer ? [{ playerId: burn.e.id, t: burn.t, acc: burn.acc }] : []),
    };
  }

  /** Restore entry state; only player burns can bind to actors in the restarted world. */
  restoreState(snapshot: WeatherSnapshot, players: readonly Player[]): void {
    this.rng.state = snapshot.rngState;
    this.visualRng.state = snapshot.visualRngState;
    this.phase = snapshot.fields.phase;
    this.id = snapshot.fields.id;
    this.t = snapshot.fields.t;
    this.dur = snapshot.fields.dur;
    this.cd = snapshot.fields.cd;
    this.rollAcc = snapshot.fields.rollAcc;
    this.announceT = snapshot.fields.announceT;
    this.visT = snapshot.fields.visT;
    this.justStarted = snapshot.fields.justStarted;
    this.miss = snapshot.fields.miss;
    this.playerOut = snapshot.fields.playerOut;
    this.enemyOut = snapshot.fields.enemyOut;
    this.moveMul = snapshot.fields.moveMul;
    this.enemyFireMul = snapshot.fields.enemyFireMul;
    this.cooldownDiv = snapshot.fields.cooldownDiv;
    this.invulnMin = snapshot.fields.invulnMin;
    this.noKnockback = snapshot.fields.noKnockback;
    this.vacuum = snapshot.fields.vacuum;
    this.fogRamp = snapshot.fields.fogRamp;
    this.metAcc = snapshot.fields.metAcc;
    this.flash = snapshot.fields.flash;
    this.dotAcc = snapshot.fields.dotAcc;
    this.fadeT = snapshot.fields.fadeT;
    this._fadeDur = snapshot.fields._fadeDur;
    this.meteors = structuredClone(snapshot.arrays.meteors);
    this.burnZones = structuredClone(snapshot.arrays.burnZones);
    this.typhoons = structuredClone(snapshot.arrays.typhoons);
    this.fogClouds = structuredClone(snapshot.arrays.fogClouds);
    this.burns = snapshot.playerBurns.flatMap(burn => {
      const player = players.find(actor => actor.id === burn.playerId);
      return player ? [{ e: player, t: burn.t, acc: burn.acc, isPlayer: true }] : [];
    });
  }

  constructor(rng: RNG, { platform = 'desktop' }: { platform?: GamePlatform } = {}) {
    this.budget = ruleBudget(platform);
    this.visualRng = rng.fork(0x57584658);
    this.rng = rng.fork(WEATHER_RNG_SALT);   // 独立流（铁律 1）
    this.phase = 'idle';       // idle → active → cooldown → idle
    this.id = null;
    this.t = 0;                // 当前天气已持续
    this.dur = 0;
    this.cd = 0;               // 冷却剩余（= 刚结束的天气时长）
    this.rollAcc = 0;          // 判定计时
    this.announceT = 0;        // 横幅剩余
    this.visT = 0;             // 视觉已持续（ramp 用）
    this.justStarted = false;  // 第一百一十四轮：开播旗标（main 消费 → 猫娘口播）

    // ---- 每帧刷新的效果旗标（hook 们只读这些）----
    this.miss = 0;             // 浓雾：双方额外 miss %
    this.playerOut = 1;        // 雾雨：玩家输出最终乘算
    this.enemyOut = 1;         // 雾雨：敌人输出最终乘算
    this.moveMul = 1;          // 晴岚：双方移速乘算
    this.enemyFireMul = 1;     // 血月：敌人攻速（fireRate 乘算）
    this.cooldownDiv = 1;      // 血月：玩家攻速（武器冷却除数）
    this.invulnMin = 0;        // 台风：玩家无敌帧下限（秒）
    this.noKnockback = false;  // 台风：所有人免疫击退
    this.vacuum = false;       // 快晴：吸收所有掉落物
    this.fogRamp = 0;          // 浓雾：视野雾 0→1（3 秒）

    // ---- 天气自己的实体 ----
    this.meteors = [];         // {x,y,r,warnT,side}
    this.metAcc = 0;
    this.burnZones = [];       // 第一百一十二轮：砸地后的持续燃烧区（纯视觉）
    this.flash = 0;            // 砸地白闪剩余（秒，屏幕层画）
    this.typhoons = [];        // {x,y,r,vx,vy,spin}
    this.fogClouds = [];       // 川雾：{x,y,r,vx,vy,turnT}
    this.burns = [];           // 流星余烬：{e,t,acc}
    this.dotAcc = 0;           // 烈日/无风 每秒跳
    this.fadeT = 0;            // fading 剩余（秒）
    this._fadeDur = WEATHER_FADE_T;
  }

  get def() { return this.id === null ? undefined : WEATHER_MAP[this.id]; }
  get active() { return this.phase === 'active'; }
  /** 渲染淡出系数：active 1 → fading 线性 →0（cooldown/idle 0） */
  get visualAlpha() {
    if (this.phase === 'active') return 1;
    if (this.phase === 'fading') return Math.max(0, this.fadeT / this._fadeDur);
    return 0;
  }

  /** 普通 Boss 波和声明禁止天气的挑战共享同一个能力判定。 */
  static blocked(world: World) {
    const cfg = world.waves.read().current?.config;
    return !!(world.challenge?.rules.blocksWeather
      || cfg?.isBoss || cfg?.boss || (cfg?.bosses?.length ?? 0) > 0);
  }

  update(dt: number, world: World, player: Player) {
    // 横幅倒计时任何状态都走（挂在boss开始后也要自然淡出）
    if (this.announceT > 0) this.announceT = Math.max(0, this.announceT - dt);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);

    // ---- 铁律：Boss 波 / 芙兰战绝不出现天气 ----
    if (WeatherSystem.blocked(world)) {
      if (this.active) this.forceEnd();
      // 禁止新天气时仍推进淡出，避免旧雾残留到挑战。
      if (this.phase === 'fading') this._tickFade(dt, world);
      this._applyFlags();
      return;
    }

    if (this.phase === 'active') {
      this.t += dt;
      this.visT += dt;
      this._tickWeather(dt, world, player);
      if (this.t >= this.dur) this._end();
    } else if (this.phase === 'fading') {
      // 天气结束后玩法旗标立即归零；淡出阶段只收缩现有视觉实体。
      this._tickFade(dt, world);
    } else if (this.phase === 'cooldown') {
      this.cd -= dt;
      if (this.cd <= 0) { this.phase = 'idle'; this.rollAcc = 0; }
    } else {
      this.rollAcc += dt;
      if (this.rollAcc >= ROLL_INTERVAL) {
        this.rollAcc -= ROLL_INTERVAL;
        if (this.rng.next() < ROLL_CHANCE) this._start(player);
      }
    }

    this._applyFlags();
  }

  _start(player: Player) {
    // 均匀挑一种（不与上一种重复）
    const pool = WEATHER_DEFS.filter((d) => d.id !== this.id);
    const def = pool[this.rng.int(0, pool.length - 1)];
    this.id = def.id;
    this.phase = 'active';
    this.t = 0;
    this.visT = 0;
    this.dur = this.rng.range(DUR_MIN, DUR_MAX);
    this.announceT = ANNOUNCE_T;
    this.justStarted = true;   // 第一百一十四轮：main 消费 → 猫娘口播 say
    this.meteors.length = 0;
    this.metAcc = 0;
    this.burnZones.length = 0;
    this.flash = 0;
    this.typhoons.length = 0;
    this.fogClouds.length = 0;
    this.burns.length = 0;
    this.dotAcc = 0;
    // 设备预算决定真实龙卷与雾团实体数量；装饰密度由显示层处理。
    if (def.id === 'typhoon') {
      const n = this.budget.typhoons;
      for (let i = 0; i < n; i++) this._spawnTyphoon(player);
    }
    if (def.id === 'riverFog') {
      for (let i = 0; i < this.budget.fogClouds; i++) this._spawnFogCloud(player);
    }
  }

  _end(fast = false) {
    // 快速结束保留实体与天气身份用于淡出，玩法hook立即停用。
    this.cd = this.dur;          // 天气结束后对应时长内不再进入
    // 185 轮：流星雨结束时，尚未起飞的预警圈（warnT > 0.55）取消；已起飞的火球留着继续落地（见 _fadeMeteors）
    if (this.id === 'meteor') this.meteors = this.meteors.filter((m) => m.warnT <= 0.55);
    this.phase = 'fading';
    this._fadeDur = fast ? 1.2 : WEATHER_FADE_T;
    this.fadeT = this._fadeDur;
    for (const c of this.fogClouds) c.r0 = c.r;   // 淡出收缩基准
    for (const tp of this.typhoons) tp.r0 = tp.r;
    this._applyFlags();
  }

  /** Boss 波开始等场合：立刻散（冷却照算，出门不回头）。1.2s 快速淡出 */
  forceEnd() {
    if (!this.active) return;
    const dur = this.dur;
    this._end(true);
    this.cd = dur;
  }

  /** 淡出段推进（第一百八十三轮抽出 —— 正常路径与 boss 波 blocked 路径共用） */
  _tickFade(dt: number, world: World | null = null) {
    this.fadeT -= dt;
    const k = this.visualAlpha;
    // 淡出仍推进已起飞流星，防止火球与燃烧区冻结。
    if (this.id === 'meteor') this._fadeMeteors(dt, world);
    for (const c of this.fogClouds) {
      if (c.r0 == null) c.r0 = c.r;
      c.r = c.r0 * k;
    }
    for (const tp of this.typhoons) {
      if (tp.r0 == null) tp.r0 = tp.r;
      tp.r = tp.r0 * k;
    }
    if (this.fadeT <= 0) {
      this.phase = 'cooldown';
      this._clearEntities();
      this.id = null;
    }
  }

  /**
   * 流星雨淡出段（纯视觉，无伤害、不上灼烧）：
   *  · 已经起飞的火球（warnT ≤ 起飞阈值）继续落地，落地只放视觉；
   *  · 燃烧区继续计时，剩余寿命封顶为淡出剩余 —— 所有特效在淡出结束的同一刻落幕，最后 0.8s 由渲染端渐隐。
   * 还没起飞的预警圈已在 _end 里取消（它们只是预警，天气已结束）。
   */
  _fadeMeteors(dt: number, world: World | null) {
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.warnT -= dt;
      if (m.warnT > 0) continue;
      this.meteors.splice(i, 1);
      if (world) this._impactVisual(world, m);
    }
    const cap = Math.max(0.01, this.fadeT);
    for (let i = this.burnZones.length - 1; i >= 0; i--) {
      const z = this.burnZones[i];
      z.t = Math.min(z.t - dt, cap);
      if (z.t <= 0) this.burnZones.splice(i, 1);
    }
  }

  /** 淡出段落地的纯视觉版 _impact：震屏减半、不扣血、不上灼烧；燃烧区寿命 ≤ 淡出剩余 */
  _impactVisual(world: World, m: Meteor) {
    world.camera?.shake?.(4 + m.r / 80, 0.22);
    this.flash = Math.max(this.flash, 0.1);
    world.fx?.shockwave?.(m.x, m.y, m.r * 1.15, '#ffd9a0', 0.38);
    world.fx?.shockwave?.(m.x, m.y, m.r * 0.9, '#ff7a3a', 0.52);
    const shardN = Math.max(6, Math.min(24, Math.round(m.r / 10)));
    world.fx?.shards?.(m.x, m.y, Math.round(m.r * 0.4), '#ffb066', shardN);
    if (this.fadeT > 0.3) this.burnZones.push({ x: m.x, y: m.y, r: m.r, t: Math.min(3, this.fadeT), max: 3, visualOnly: true });
  }

  _clearEntities() {
    this.meteors.length = 0;
    this.burnZones.length = 0;
    this.flash = 0;
    this.typhoons.length = 0;
    this.fogClouds.length = 0;
    this.burns.length = 0;
  }

  /** 把当前天气翻译成 hook 旗标（inactive 全部归零/归一） */
  _applyFlags() {
    const d = this.def;
    this.miss = 0; this.playerOut = 1; this.enemyOut = 1; this.moveMul = 1;
    this.enemyFireMul = 1; this.cooldownDiv = 1; this.invulnMin = 0;
    this.noKnockback = false; this.vacuum = false;
    if (!this.active || !d) {
      this.fogRamp = 0;
      // 淡出段：浓雾的视野灰幕跟随 visualAlpha 渐弱（玩法旗标保持归零）
      if (this.phase === 'fading' && d?.id === 'fog') {
        this.fogRamp = Math.min(1, this.visT / (d.rampS || 1)) * this.visualAlpha;
      }
      return;
    }
    const ramp = Math.min(1, this.visT / (d.rampS || 1));
    if (d.miss) this.miss = d.miss;
    if (d.outMul) { this.playerOut = d.outMul; this.enemyOut = d.outMul; }
    if (d.moveMul) this.moveMul = d.moveMul;
    if (d.id === 'bloodMoon') {
      const bonus = d.atkBase + d.atkStep * Math.floor(this.t / d.atkStepS);
      this.enemyFireMul = 1 + bonus;
      this.cooldownDiv = 1 / (1 + bonus);
    }
    if (d.invulnMin) this.invulnMin = d.invulnMin;
    if (d.noKnockback) this.noKnockback = true;
    if (d.vacuum) this.vacuum = true;
    this.fogRamp = d.id === 'fog' ? ramp : 0;
  }

  // 各天气的逐帧机制
  _tickWeather(dt: number, world: World, player: Player) {
    const d = this.def;
    if (!d) return;

    // 烈日 / 无风：全场每秒跳 1 次
    if (d.dotPct || d.regenPct) {
      this.dotAcc += dt;
      if (this.dotAcc >= 1) {
        this.dotAcc -= 1;
        this._tickGlobalHp(world, player, d);
      }
    }

    // 流星雨
    if (d.id === 'meteor') this._tickMeteors(dt, world, player);

    // 台风：漂移 + 推挤
    if (d.id === 'typhoon') this._tickTyphoons(dt, world, player);

    // 川雾：漂移 + 推挤
    if (d.id === 'riverFog') this._tickFogClouds(dt, world, player);

    // 流星余烬烧灼（流星雨专属持续掉血）
    if (d.id === 'meteor') this._tickBurns(dt);
  }

  /** Weather effects target each living team member once; the passed player is
   * only a compatibility fallback and the unchanged weather spawning anchor. */
  _activePlayers(world: World, player: Player): Player[] {
    const candidates = world.players?.() ?? [player];
    return [...new Set(candidates)].filter(unit => unit && !unit.dead && !unit.downed);
  }

  _tickGlobalHp(world: World, player: Player, d: WeatherDefinition) {
    // 烈日：扣 2% 最大生命，血量不足则扣到 1，**不会消灭目标**；
    // 无风：回 5% 最大生命。直接改 hp（不走 takeDamage，不吃护甲/闪避）。
    if (d.dotPct) {
      for (const e of world.enemies.items) {
        if (e.dead) continue;
        e.hp = Math.max(1, e.hp - e.maxHp * d.dotPct);
      }
      for (const member of this._activePlayers(world, player)) member.hp = Math.max(1, member.hp - member.maxHp * d.dotPct);
    }
    if (d.regenPct) {
      for (const e of world.enemies.items) {
        if (e.dead) continue;
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * d.regenPct);
      }
      for (const member of this._activePlayers(world, player)) member.hp = Math.min(member.maxHp, member.hp + member.maxHp * d.regenPct);
    }
  }

  _tickMeteors(dt: number, world: World, player: Player) {
    // 每 1.5 秒在玩家周围 300-600px 圆环上刷 1-2 个警告圈
    this.metAcc += dt;
    if (this.metAcc >= 1.5 && this.meteors.length < 24) {
      this.metAcc -= 1.5;
      const n = this.rng.int(1, 2);
      for (let i = 0; i < n; i++) {
        if (this.meteors.length >= 24) break;
        const a = this.rng.next() * Math.PI * 2;
        const r = this.rng.range(300, 600);
        // 流星半径分四档；半径同时决定预警与伤害范围，因此使用机制 RNG。
        const roll = this.rng.next();
        let mr;
        if (roll < 0.55) mr = this.rng.range(34, 54);
        else if (roll < 0.85) mr = this.rng.range(60, 90);
        else if (roll < 0.97) mr = this.rng.range(120, 240);
        else mr = this.rng.range(320, 640);
        this.meteors.push({
          x: player.x + Math.cos(a) * r,
          y: player.y + Math.sin(a) * r,
          r: mr, warnT: 1,
          // 火球入场方向使用 visualRng，不改变落点随机流。
          side: this.visualRng.next() < 0.5 ? -1 : 1,
        });
      }
    }
    // 警告 1 秒后砸下：60px 内所有单位吃 20% 最大生命真实伤害 + 烧 3 秒
    for (let i = this.meteors.length - 1; i >= 0; i--) {
      const m = this.meteors[i];
      m.warnT -= dt;
      if (m.warnT > 0) continue;
      this._impact(world, player, m);
      this.meteors.splice(i, 1);
    }
    for (let i = this.burnZones.length - 1; i >= 0; i--) {
      const z = this.burnZones[i];
      z.t -= dt;
      if (z.t <= 0) this.burnZones.splice(i, 1);
    }
  }

  _impact(world: World, player: Player, m: Meteor) {
    world.camera?.shake?.(9 + m.r / 40, 0.3);
    this.flash = 0.16;
    // 冲击波视觉与流星伤害半径同比例放大。
    world.fx?.shockwave?.(m.x, m.y, m.r * 1.15, '#ffd9a0', 0.38);
    world.fx?.shockwave?.(m.x, m.y, m.r * 0.9, '#ff7a3a', 0.52);
    const shardN = Math.max(8, Math.min(30, Math.round(m.r / 8)));
    world.fx?.shards?.(m.x, m.y, Math.round(m.r * 0.45), '#ffb066', shardN);
    world.fx?.shards?.(m.x, m.y, Math.round(m.r * 0.32), '#e8542a', Math.max(5, Math.round(shardN / 2)));
    // 燃烧区的显示寿命与伤害持续时间一致。
    this.burnZones.push({ x: m.x, y: m.y, r: m.r, t: 3, max: 3 });
    const players = this._activePlayers(world, player);
    const playerSet = new Set<Player | CombatTarget>(players);
    const hit = (unit: Player | CombatTarget) => {
      const dmg = unit.maxHp * 0.2;
      let dealt = 0;
      if (!unit.isEnemy) {
        dealt = unit.takeDamage(dmg, m.x, m.y, { pierceArmor: true, noMiss: true });
      } else {
        const res = unit.takeDamage(dmg, { pierceArmor: true });
        dealt = res?.dealt ?? 0;
      }
      // 无敌帧/miss 吃掉的砸击不上余烬
      if (dealt > 0) {
        if (unit.isEnemy) this.burns.push({ e: unit, t: 3, acc: 0, isPlayer: false });
        else this.burns.push({ e: unit, t: 3, acc: 0, isPlayer: true });
      }
    };
    // 网格查询（世界空间格，判定半径 = 流星半径）
    const R = m.r;
    const near = world.grid ? world.grid.query(m.x, m.y, R, []) : [];
    for (const e of near) {
      // The grid is enemy-only today. Explicit filtering also prevents a future
      // mixed grid from passing Player through EnemyBody.takeDamage or hitting twice.
      if (!e.isEnemy || e.dead || playerSet.has(e)) continue;
      const dx = e.x - m.x, dy = e.y - m.y;
      if (dx * dx + dy * dy <= R * R) hit(e);
    }
    for (const member of players) {
      const dx = member.x - m.x, dy = member.y - m.y;
      if (dx * dx + dy * dy <= R * R) hit(member);
    }
  }

  _tickBurns(dt: number) {
    // 每秒 2% 最大生命，持续 3 秒（走 takeDamage，能打死，但吃不到护甲）
    for (let i = this.burns.length - 1; i >= 0; i--) {
      const b = this.burns[i];
      b.t -= dt;
      b.acc += dt;
      if (!b.e || b.e.dead || b.isPlayer && b.e.downed) { this.burns.splice(i, 1); continue; }
      while (b.acc >= 1) {
        b.acc -= 1;
        const dmg = b.e.maxHp * 0.02;
        if (b.isPlayer) b.e.takeDamage(dmg, b.e.x, b.e.y, { pierceArmor: true, noMiss: true });
        else b.e.takeDamage(dmg, { pierceArmor: true });
      }
      if (b.t <= 0) this.burns.splice(i, 1);
    }
  }

  _spawnTyphoon(player: Player) {
    const a = this.rng.next() * Math.PI * 2;
    const r = this.rng.range(150, 450);
    const dir = this.rng.next() * Math.PI * 2;
    const spd = this.rng.range(50, 90);
    this.typhoons.push({
      x: player.x + Math.cos(a) * r, y: player.y + Math.sin(a) * r,
      r: this.rng.range(90, 140),
      vx: Math.cos(dir) * spd, vy: Math.sin(dir) * spd,
      spin: this.rng.next() < 0.5 ? 1 : -1,
      turnT: this.rng.range(1.5, 3),
    });
  }

  _tickTyphoons(dt: number, world: World, player: Player) {
    const half = world.halfSize;
    for (const t of this.typhoons) {
      t.turnT -= dt;
      if (t.turnT <= 0) {
        t.turnT = this.rng.range(1.5, 3);
        const a = this.rng.next() * Math.PI * 2;
        const spd = Math.hypot(t.vx, t.vy);
        t.vx = Math.cos(a) * spd; t.vy = Math.sin(a) * spd;
      }
      t.x += t.vx * dt; t.y += t.vy * dt;
      t.x = Math.max(-half, Math.min(half, t.x));
      t.y = Math.max(-half, Math.min(half, t.y));

      // 挤开所有单位（沿台风漂移方向推，不算击退所以台风天免击退也照推）
      const push = (u: { x: number; y: number }) => {
        const dx = u.x - t.x, dy = u.y - t.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > t.r * t.r) return;
        const d = Math.sqrt(d2) || 1;
        const falloff = 1 - d / t.r;            // 越靠中心推得越狠
        const mag = 260 * (0.35 + 0.65 * falloff);
        u.x += ((dx / d) * 0.6 + (t.vx / 100)) * mag * dt;
        u.y += ((dy / d) * 0.6 + (t.vy / 100)) * mag * dt;
        // 径向外推叠加切向旋转和轻微向心，维持台风内的绕行。
        const tx = (-dy / d) * t.spin, ty = (dx / d) * t.spin;
        const sw = mag * 0.5 * (0.3 + 0.7 * falloff);
        u.x += tx * sw * dt - (dx / d) * mag * 0.22 * falloff * dt;
        u.y += ty * sw * dt - (dy / d) * mag * 0.22 * falloff * dt;
      };
      for (const member of this._activePlayers(world, player)) push(member);
      for (const e of world.enemies.items) {
        if (!e.dead) push(e);
      }
    }
  }

  _spawnFogCloud(player: Player) {
    const a = this.rng.next() * Math.PI * 2;
    const r = this.rng.range(0, 500);
    const dir = this.rng.next() * Math.PI * 2;
    const spd = this.rng.range(35, 70);
    this.fogClouds.push({
      x: player.x + Math.cos(a) * r, y: player.y + Math.sin(a) * r,
      r: this.rng.range(110 * Math.SQRT2, 170 * Math.SQRT2),
      vx: Math.cos(dir) * spd, vy: Math.sin(dir) * spd,
      turnT: this.rng.range(2, 4),
      seed: this.rng.next() * 100, // Retained v2 entry data and RNG order; not a renderer input.
    });
  }

  _tickFogClouds(dt: number, world: World, player: Player) {
    const half = world.halfSize;
    for (const c of this.fogClouds) {
      c.turnT -= dt;
      if (c.turnT <= 0) {
        c.turnT = this.rng.range(2, 4);
        const a = this.rng.next() * Math.PI * 2;
        const spd = Math.hypot(c.vx, c.vy);
        c.vx = Math.cos(a) * spd; c.vy = Math.sin(a) * spd;
      }
      c.x += c.vx * dt; c.y += c.vy * dt;
      // 出界就绕回玩家附近（雾跟着战团走）
      if (Math.abs(c.x - player.x) > half || Math.abs(c.y - player.y) > half
        || Math.abs(c.x) > half || Math.abs(c.y) > half) {
        const a = this.rng.next() * Math.PI * 2;
        const r = this.rng.range(200, 500);
        c.x = player.x + Math.cos(a) * r;
        c.y = player.y + Math.sin(a) * r;
      }
      // 雾内单位随雾团漂移方向推移。
      const push = (u: { x: number; y: number }) => {
        const dx = u.x - c.x, dy = u.y - c.y;
        if (dx * dx + dy * dy > c.r * c.r) return;
        u.x += c.vx * 1.1 * dt;
        u.y += c.vy * 1.1 * dt;
      };
      for (const member of this._activePlayers(world, player)) push(member);
      for (const e of world.enemies.items) {
        if (!e.dead) push(e);
      }
    }
  }
}
