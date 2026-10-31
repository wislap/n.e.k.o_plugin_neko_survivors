import type { ChallengeController, ChallengeFrame, ChallengeObservation, ChallengeSession } from './types.ts';
import type { EncounterView } from '../views.ts';
import { challengeDisplay, displayAlpha } from './display-values.ts';
import { ChallengePlayerPolicy } from './player-policy.ts';
import type { EnemySpawnDefinition } from '../actors/enemy.ts';
import type { Timed, AngledTrail, MovingSpark, SeededFlash, Mirage, VergilSkill, VergilAoe, SkillName } from './vergil-types.ts';
import type { Shard } from './geometry.ts';
import type { AttackInterception, DamageObservation } from './types.ts';
import type { ControllerContext, ControllerOptions, ChallengeOutcome, Arena } from './types.ts';
import type { RNG } from '../math/random.ts';
import { VERGIL_ARENA as ARENA } from './arenas.ts';
// 三阶段维吉尔战；控制器推进真实时间，Battle 用 timeScale 推进世界。
// 目标躯体仅参与索敌和伤害门；显示由挑战投影提供。

import { EnemyBody } from '../actors/enemy.ts';
import { TAU } from '../math/geometry.ts';
import { encounterCues, musicCue } from './cues.ts';
import { distToSegment, spawnShatter, updateShards } from './geometry.ts';

// ---- 数值 ----
export const VERGIL_MAX_HP = 66666;   // 第一百五十四轮再改：正式 Boss 血量 66666
// 每累计承伤 2000，按阶段叠加无敌时长，保留单帧多段累加。
const LOCK_DMG_STEP = 2000;           // 每累计受到 2000 伤害触发一次
const LOCK_INVULN = 0.5;              // P1/P2 无敌 0.5 秒
const P3_LOCK_INVULN = 0.8;           // P3 无敌 0.8 秒
export const HIT_FRAC = 0.05;        // 每击 5% 玩家最大生命的固定真伤
export const HIT_CD = 0.2;           // 受击内置 CD（防一帧多刀秒杀）
export const ULT_CD = 10;            // P3 大招冷却（真实秒，收刀起算）
export const FIGHT_TIME = 90;        // 限时：90 秒内没打死什么都不给
const BGM_START_AT = 120;            // P3 大招："直接从2分钟开始播放"
// 入场演出（将近 10 秒）：0-3s 黑屏 → 3-6s 场地+背对图淡入（BGM 从 0 秒起）
// → 6-9s 静止（BGM 前奏）→ 9s 背对消失、椅子在原像素点出现、开战
const INTRO_BLACK_END = 3;
const INTRO_END = 9;

const SKILL_ORDER: SkillName[] = ['triple', 'dash', 'aoe', 'sphere', 'mirage'];

// 幻影剑（Mirage Edge）参数（第一百四十六轮）
const MIRAGE_COUNT = 6;          // 环绕剑数（5-6 把）
const MIRAGE_SUMMON = 3.0;       // 环绕旋转时长
const MIRAGE_GAP = 0.22;         // 依次发射间隔
const MIRAGE_SPEED = 560;        // 飞行速度
const MIRAGE_ORBIT = 92;         // 环绕半径
const MIRAGE_AUTO_CD = 20;       // 自动触发冷却（用户补充：防止纯远程看不到）
const MIRAGE_MELEE_FRAC = 0.1;   // 累计近战伤害达玩家 maxHp 的 10% 触发

export class VergilFight implements ChallengeController {
  readonly rules = Object.freeze({ blocksWeather: true, disablesPetAttack: false, suppressesTrueDamage: false, disablesPhantoms: true });
  readonly capabilities: Pick<ChallengeSession, 'guard' | 'purge' | 'displayTiming'> = Object.freeze({
    guard: Object.freeze({ intercept: (hit: AttackInterception) => this.interceptAttack(hit), onDamage: (hit: DamageObservation) => this.observeDamage(hit) }),
    purge: null,
    displayTiming: null,
  });
  readClock() { return { overridden: true, timer: this.getDisplayTimer() }; }
  advance(dt: number) { this.update(dt); this.advanceBladeSparks(dt); }
  dispose() { this.over = true; if (this.boss) this.boss.dead = true; this.timeScale = 1; }
  readCombat(): ChallengeObservation {
    const boss = this.boss;
    return { bodyId: boss?.id ?? null, target: boss ? { id: boss.id, x: boss.x, y: boss.y, dead: boss.dead } : null,
      guarding: this.guarding, movement: 'duel',
      purgeReady: false, lasers: [], crosses: [] };
  }
  readFrame(): ChallengeFrame {
    const fight = this, kind = this.kind, arena = this.arena;
    const { actors, projectiles, effects, telegraphs, effect, line } = challengeDisplay(kind);
    const base = { state: String(fight.phase), time: fight.t, introTime: fight.introT,
      arena: { x: arena.cx, y: arena.cy, halfWidth: arena.hw, halfHeight: arena.hh },
      hp: fight.boss?.hp ?? 0, maxHp: fight.boss?.maxHp ?? 0, boss: { x: fight.boss?.x ?? fight.bx, y: fight.boss?.y ?? fight.by }, flash: fight.whiteFlash, fade: 0 };
    const slashes = fight.waves.map((wave, id) => ({ id: `vergil-wave-${id}`, x: wave.x, y: wave.y, angle: wave.angle, radius: wave.r, alpha: displayAlpha(wave.t, wave.life) }));
    const rifts = fight.rifts.map((rift, id) => ({ id: `vergil-rift-${id}`, x: rift.x, y: rift.y, radius: 60 - 26 * Math.min(1, rift.st / rift.dur), alpha: .5 + .5 * Math.min(1, rift.st / rift.dur) }));
    const blades = fight.ultBlades.map((blade, id) => ({ id: `vergil-ult-${id}`, x1: blade.x1, y1: blade.y1, x2: blade.x2, y2: blade.y2, alpha: displayAlpha(blade.t, blade.life), seed: blade.seed }));
    const encounter: EncounterView = { ...base, kind, state: fight.state, chairVisible: fight.chairVisible, chairFacing: fight.chairFacing,
      charge: fight.chargeT, veil: fight.veil, guarding: fight.guarding, guardShatter: fight.guardShatterT, slashes, rifts, blades, title: '大…大排档椅子？！？！' };
    for (const [i, blade] of fight.slashBars.entries()) line(`bar-${i}`, blade.x - blade.halfW, blade.y, blade.x + blade.halfW, blade.y, 52, '#d7fbff', displayAlpha(blade.t, blade.life));
    for (const [i, blade] of fight.radials.entries()) line(`radial-${i}`, blade.cx, blade.cy, blade.cx + Math.cos(blade.a) * blade.len, blade.cy + Math.sin(blade.a) * blade.len, 26, '#a9f1ff', displayAlpha(blade.t, blade.life));
    if (fight.aoe) telegraphs.push({ id: 'vergil-aoe', kind: 'circle', x: fight.aoe.x, y: fight.aoe.y, radius: fight.aoe.r, color: '#64dfff', alpha: 0.45 });
    for (const [i, blade] of fight.aoeBlades.entries()) effect(`aoe-blade-${i}`, blade, 'slash', '#9defff', 30);
    for (const [i, trail] of fight.trails.entries()) effect(`trail-${i}`, trail, 'slash', '#9defff', 30);
    for (const [i, sword] of (fight.mirage?.flying ?? []).entries()) projectiles.push({ id: `vergil-mirage-${i}`, x: sword.x, y: sword.y, angle: sword.angle, radius: 6, length: 42, width: 8, hostile: true, shape: 'needle', color: '#a9f1ff', alpha: 1 });
    for (const [i, dash] of fight.dashes.entries()) line(`dash-${i}`, dash.x1, dash.y1, dash.x2, dash.y2, 2 + 10 * displayAlpha(dash.t, dash.life), '#a0f0ff', displayAlpha(dash.t, dash.life) * .4);
    if (fight.mirage) {
      const m = fight.mirage;
      for (let i = m.fired; i < m.swords.length; i++) {
        const sword = m.swords[i], a = sword.a + m.orbitA;
        projectiles.push({ id: `vergil-orbit-${i}`, x: fight.bx + Math.cos(a) * 92, y: fight.by + Math.sin(a) * 92,
          angle: a + Math.PI / 2, radius: 6, length: 42, width: 8, hostile: true, shape: 'needle', color: '#a9f1ff', alpha: Math.min(1, m.st / .6) });
      }
      for (const [i, sword] of m.flying.entries()) for (let j = 1; j < sword.trail.length; j++) {
        const first = sword.trail[j - 1], last = sword.trail[j];
        line(`mirage-trail-${i}-${j}`, first.x, first.y, last.x, last.y, 9 * j / sword.trail.length, '#4696ff', .28 * j / sword.trail.length);
      }
    }
    for (const [i, slash] of fight.parryFx.entries()) effect(`parry-slash-${i}`, slash, 'slash', '#d9ffff', 70);
    for (const [i, spark] of fight.parrySparks.entries()) effect(`parry-spark-${i}`, spark, 'spark', '#ffffff', 3);
    for (const [i, ripple] of fight.parryRipples.entries()) effect(`parry-ripple-${i}`, { ...ripple, x: fight.bx, y: fight.by, r: ripple.t / ripple.life * 150 }, 'ring', '#a0eaff');
    for (const [i, part] of (fight.chargeT > 0 ? fight.chargeParts : []).entries()) {
      const e = part.k * part.k;
      const x = part.sx + (fight.bx - part.sx) * e, y = part.sy + (fight.by - part.sy) * e;
      effects.push({ id: `vergil-charge-part-${i}`, kind: 'sparkle', x, y,
        end: { x: x + (part.sx - fight.bx) * .03, y: y + (part.sy - fight.by) * .03 },
        width: 1, radius: 1.4 + 1.8 * part.k, alpha: .5 + .5 * part.k,
        progress: part.k, color: part.hue === 'c' ? '#78ebff' : '#be78ff' });
    }
    for (const [i, crack] of (fight.chargeT > 0 ? fight.chargeCracks : []).entries()) effects.push({
      id: `vergil-charge-crack-${i}`, kind: 'trail', variant: 'crack', x: crack.x, y: crack.y,
      radius: 0, color: '#1e042c', seed: crack.seed,
      alpha: (.35 + .65 * Math.abs(Math.sin(crack.t * 42))) * displayAlpha(crack.t, crack.life),
    });
    for (const [i, ember] of (fight.mirage ? fight.mirageEmbers : []).entries()) {
      const fade = displayAlpha(ember.t, ember.life);
      effects.push({ id: `vergil-mirage-ember-${i}`, kind: 'sparkle', x: ember.x, y: ember.y,
        radius: 1.3 * fade + .3, color: '#82dcff', alpha: .7 * fade });
    }
    for (const [i, shard] of fight.shards.entries()) effects.push({
      id: `vergil-shard-${i}`, kind: 'shard', variant: 'glass', x: shard.x, y: shard.y,
      points: shard.verts.map(([x, y]) => ({ x: shard.x + x, y: shard.y + y })),
      radius: 0, angle: shard.rot, color: '#beebff', alpha: displayAlpha(shard.t, shard.life) * .85,
      progress: shard.t / shard.life,
    });
    for (const [i, spark] of fight.bladeSparks.entries()) effects.push({
      id: `vergil-spark-${i}`, kind: 'spark', variant: 'blade', x: spark.x, y: spark.y,
      radius: 0, angle: spark.ang, color: '#ffffff', alpha: displayAlpha(spark.t, spark.life),
      progress: spark.t / spark.life,
    });

    return { encounter, actors, projectiles, effects, telegraphs };
  }

  declare boss: EnemyBody;
  private invulnLeft = 999;
  private blockedFlash = 0;
  declare waves: (Timed & { x: number; y: number; angle: number; speed: number; r: number })[];
  declare trails: AngledTrail[];
  declare aoeBlades: AngledTrail[];
  declare dashes: (Timed & { x1: number; y1: number; x2: number; y2: number })[];
  declare slashBars: (Timed & { x: number; y: number; halfW: number; armed: boolean })[];
  declare aoe: VergilAoe | null;
  declare rifts: { x: number; y: number; st: number; dur: number; fired: boolean }[];
  declare radials: (Timed & { cx: number; cy: number; a: number; len: number; seed: number })[];
  declare ultBlades: (Timed & { x1: number; y1: number; x2: number; y2: number; seed: number })[];
  declare shards: Shard[];
  declare mirage: Mirage | null;
  declare mirageAutoCd: number;
  declare mirageEmbers: MovingSpark[];
  declare parryFx: SeededFlash[];
  declare parrySparks: MovingSpark[];
  declare parryRipples: Timed[];
  declare chargeParts: { sx: number; sy: number; k: number; sp: number; hue: 'c' | 'v' }[];
  declare chargeCracks: SeededFlash[];
  declare bladeSparks: (MovingSpark & { ang: number })[];
  declare _bgm: ReturnType<typeof musicCue>;
  declare skill?: VergilSkill | null;
  declare playerPolicy: ChallengePlayerPolicy;
  declare context: ControllerContext;
  declare kind: 'vergil';
  declare arena: Arena;
  declare cues: ReturnType<typeof encounterCues>;
  declare rng: RNG;
  declare onDone: ControllerOptions["onDone"];
  declare over: boolean;
  declare t: number;
  declare timeScale: number;

  declare phase: number;
  declare _hpLast: number;
  declare _dmgAccum: number;
  declare spdMul: number;
  declare state: 'intro' | 'wander' | 'cast' | 'ult' | 'pause' | 'win';
  declare stateT: number;
  declare introT: number;
  declare timeLeft: number;
  declare pauseDur: number;
  declare bgmFade: number;
  declare ultBgmLocked: boolean;
  declare castGap: number;
  declare ultCd: number;
  declare bx: number;
  declare by: number;
  declare chairFacing: number;
  declare veil: number;
  declare whiteFlash: number;
  declare hitCd: number;
  declare meleeMeter: number;
  declare guarding: boolean;
  declare guardT: number;
  declare guardShatterT: number;
  declare _parryCount: number;
  declare _parryWindow: number;
  declare _parrySfxT: number;
  declare chargeT: number;
  declare chairVisible: boolean;
  declare _bgmStarted: boolean;
  declare _talkChair?: boolean;
  declare _talkAwake?: boolean;
  declare _p3Pending?: boolean;
  declare _parryBurstN?: number;
  declare _parryFxT?: number;
  declare _ultWaveN?: number;
  declare _ultWaveT?: number;
  constructor(main: ControllerContext, { onDone }: ControllerOptions) {
    this.context = main;
    this.playerPolicy = new ChallengePlayerPolicy({ primary: main.player, blocksPrimaryAttack: true });
    this.kind = 'vergil'; this.arena = ARENA;
    this.cues = encounterCues(main.effects);
    this.rng = main.rng.fork(0x564552);
    this.onDone = onDone;
    this.over = false;
    this.t = 0;                      // 真实秒表（AI 节奏全用它）
    this.timeScale = 1;              // 大招时 0.05（全场慢动作）

    // Boss 实体（隐身，位置每帧同步，武器正常打它）
    const def: EnemySpawnDefinition = {
      id: 'vergil_chair', name: '大…大排档椅子？！？！',
      bossName: '大…大排档椅子？！？！',   // 哥特血条读 def.bossName
      hp: VERGIL_MAX_HP, radius: 52, speed: 0, damage: 0,
      xp: 0, materials: 0, boss: true,
    };
    const w = main.world;
    this.boss = new EnemyBody(def, 0, -200,
      { hp: 1, bossHp: 1, damage: 1, speed: 1, xp: 1, materials: 1, bulletRange: 1 },
      main.world.rng, { damageGate: {
        filter: (_body, amount) => {
          if (this.invulnLeft <= 0) return { blocked: false, amount };
          this.blockedFlash = 0.1;
          return { blocked: true, amount: 0, reason: 'invuln' };
        },
        // Preserve the world-time tick at the former body update position,
        // separately from the controller's real-time tick below.
        advance: dt => {
          this.invulnLeft = Math.max(0, this.invulnLeft - dt);
          this.blockedFlash = Math.max(0, this.blockedFlash - dt);
        },
        read: () => ({ phase: 1, color: null, changeFx: 0, invulnerable: this.invulnLeft > 0,
          blocked: this.blockedFlash, invulnLeft: this.invulnLeft }),
      } });
    this.boss.flandreHidden = true; // The encounter renderer draws the chair.
    w.enemies.add(this.boss);

    // AI 状态
    this.phase = 1;
    this._hpLast = this.boss.hp;
    this._dmgAccum = 0;
    this.spdMul = 1;                 // 技能频率/速度倍率：P2 1.1、P3 1.3
    this.state = 'intro';            // intro(入场演出) | wander(站桩) | cast | ult | pause | win
    this.stateT = 0;
    this.introT = 0;                 // 入场演出计时（0→9s）
    this.timeLeft = FIGHT_TIME;      // 90 秒限时
    this.pauseDur = 1.0;             // pause 状态时长（收刀 1s / P3 转阶段 5s）
    this.bgmFade = 0;                // >0 时 BGM 音量线性淡出（P3 转阶段 5s）
    this.ultBgmLocked = false;       // P3 大招后 BGM 完全交给演出（大招不再碰）
    this.castGap = 1.0;              // 不攻击空档 ≤1s（随时在砍人）
    this.ultCd = 0;                  // P3 大招冷却（只在 P3 倒数）
    this.bx = 0; this.by = -260;     // 椅子锚点（世界坐标）
    this.chairFacing = Math.PI / 2;  // 朝向：平时不转，只有冲刺斩/大招转向
    // 站桩待机；技能位移和收刀回中央拥有实际坐标。

    // 演出对象
    this.waves = [];                 // 三连齐射直线月牙（141 轮改：不追踪直冲）
    this.trails = [];                // 冲刺斩路径刀痕（月牙残影，可带滑出速度）
    this.aoeBlades = [];             // AOE 拉回圈内的随机半月刀波（可命中）
    this.dashes = [];                // 冲刺斩残影线 {x1,y1,x2,y2,t,life}
    this.slashBars = [];             // 冲刺斩横贯刀光 {y,t,life}
    this.aoe = null;                 // {r,mode,st}
    this.rifts = [];                 // 球形裂缝 telegraph {x,y,st,dur,fired}
    this.radials = [];               // 裂缝爆射的放射折线 {cx,cy,a,len,t,life,seed}
    this.ultBlades = [];             // 满屏折线刀光
    this.veil = 0;                   // 大招暗幕强度
    this.shards = [];                // 玻璃碎片
    this.whiteFlash = 0;
    this.hitCd = 0;                  // 玩家受击内置 CD

    this.mirage = null;              // 技能态 {st, fired, swords:[{a,seed}], flying:[{x,y,angle,speed,t,life,seed,trail}]}
    this.mirageAutoCd = MIRAGE_AUTO_CD;  // 自动触发冷却（20s，intro 后起算）
    this.meleeMeter = 0;             // 累计近战伤害（达玩家 maxHp 10% 触发）
    this.mirageEmbers = [];          // 环绕剑火星粒子

    this.guarding = false;           // 每帧重算：phase<=2 && state==='wander'
    this.guardT = 0;                 // 本次格挡已持续（破碎特效只在真格挡过时放）
    this.guardShatterT = 0;          // >0 时画"格挡光圈闪烁破碎"
    this.parryFx = [];               // 斩击线 {x,y,seed,t,life}
    this.parrySparks = [];           // 火花 {x,y,vx,vy,t,life}
    this.parryRipples = [];          // 涟漪 {t, life}
    this._parryCount = 0;            // 0.3s 窗口内格挡数（≥6 触发涟漪）
    this._parryWindow = 0;
    this._parrySfxT = 0;             // 音效节流

    // P3 转阶段蓄力由真实时间推进，世界以 0.2 倍慢放。
    this.chargeT = 0;                // >0 = 蓄力中，倒计时 5→0（拔刀）
    this.chargeParts = [];           // 反向汇聚粒子 {sx,sy,k,sp,hue}
    this.chargeCracks = [];          // 空间裂缝折线 {x,y,seed,t,life}
    this.bladeSparks = [];           // 第一百四十九轮：刀锋火花 {x,y,vx,vy,ang,t,life}
    this.chairVisible = false;       // 入场演出期间椅子隐藏（9s 时在原像素点出现）
    this._bgm = musicCue(main.effects, 'bury_the_light');
    this._bgmStarted = false;
  }

  _se(name: string, volume = 0.5) { this.cues.play(name, { volume }); }
  _seParry() {
    if (this._parrySfxT > 0) return;
    this._parrySfxT = 0.08;
    this.cues.play('vergil_atk', { volume: 0.3, playbackRate: 3.2, duration: 0.07 });
  }

  spd() { return this.spdMul; }

  // HUD 显示独立的 90 秒挑战计时，不用被冻结的波次计时。
  getDisplayTimer() {
    return { label: '', left: Math.max(0, this.timeLeft), total: FIGHT_TIME };
  }

  /** 结算入口（胜利 / 失败都走这里，幂等） */
  finish(outcome: ChallengeOutcome) {
    if (this.over) return;
    this.over = true;
    // 结算复位时间缩放，避免慢动作泄漏到普通波次。
    this.timeScale = 1;
    this.chargeT = 0;
    try { this._bgm?.pause(); } catch { /* */ }
    this.onDone?.(outcome);
  }

  // 每帧更新（真实秒 dtReal；世界/玩家由 main 用 timeScale 慢放）
  update(dtReal: number) {
    if (this.over) return;
    this.t += dtReal;
    updateShards(this.shards, dtReal);
    const p = this.context.player;
    this.hitCd = Math.max(0, this.hitCd - dtReal);
    this.whiteFlash = Math.max(0, this.whiteFlash - dtReal * 2.6);
    // Challenge-owned lock: controller time advances before the world-time body tick.
    if (this.invulnLeft > 0) {
      this.invulnLeft = Math.max(0, this.invulnLeft - dtReal);
    }

    // ---- 入场演出（将近 10 秒）----
    if (this.state === 'intro') {
      this.introT += dtReal;
      // 3s：新场景淡入的同时，Bury the Light 从 0 秒开始正常播
      if (this.introT >= INTRO_BLACK_END && !this._bgmStarted) {
        try {
          if (this._bgm) { this._bgm.currentTime = 0; this._bgm.play().catch(() => {}); }
          this._bgmStarted = true;
        } catch { /* */ }
      }
      // 入场第 3 秒和第 9 秒各播一次台词，间隔 6 秒。
      if (this.introT >= INTRO_BLACK_END && !this._talkChair) {
        this._talkChair = true;
        this.context.speak('嗯？这个椅子它说它需要"帕瓦"，"帕瓦"是什么呀？');
      }
      // 9s：背对剪影消失 → 椅子在同一像素点出现 → 开战
      if (this.introT >= INTRO_END) {
        this.state = 'wander';
        this.stateT = 0;
        this.chairVisible = true;
        this.playerPolicy.allowPrimaryAttack();              // 演出结束恢复攻击
        // hitbox 与血条此刻开启（用户反馈 2）
        this.invulnLeft = 0;
        if (!this._talkAwake) {
          this._talkAwake = true;
          this.context.speak('哇！它动起来了喵！！');
        }
      }
      return;                            // 演出期间不跑 AI/技能
    }

    // 技能位移后仍钳制在竞技场内，避免后撤累积使目标离场。
    this.bx = Math.max(ARENA.cx - ARENA.hw + 90, Math.min(ARENA.cx + ARENA.hw - 90, this.bx));
    this.by = Math.max(ARENA.cy - ARENA.hh + 90, Math.min(ARENA.cy + ARENA.hh - 90, this.by));
    this.boss.x = this.bx;
    this.boss.y = this.by;

    // ---- 90 秒限时：没打死就收刀离场，什么都不给 ----
    //（win 状态停表 —— 胜利演出 1.4 秒内别让 timeout 抢先结算）
    if (this.state !== 'win') {
      this.timeLeft -= dtReal;
      if (this.timeLeft <= 0) { this.finish('timeout'); return; }
    }

    // P3 转阶段蓄力由真实时间推进，世界以 0.2 倍慢放。
    if (this.chargeT > 0) {
      this.chargeT = Math.max(0, 5 - this.stateT);
      this.timeScale = 0.2;                        // 全场极慢速（boss 走 dtReal）
      // 反向粒子：全屏随机生成、加速向椅子汇聚（第 0.5~4.2 秒持续）
      if (this.chargeT > 0.8 && this.chargeT < 4.6) {
        const n = 2 + ((this.rng.next() * 2) | 0);
        for (let i = 0; i < n; i++) {
          const a = this.rng.next() * TAU;
          const d = 260 + this.rng.next() * 340;
          this.chargeParts.push({
            sx: this.bx + Math.cos(a) * d, sy: this.by + Math.sin(a) * d,
            k: 0, sp: 0.55 + this.rng.next() * 0.5,
            hue: this.rng.next() < 0.6 ? 'c' : 'v',   // 青色 / 紫色
          });
        }
      }
      // 空间裂缝：暗紫折线随机闪烁（第 2~4.5 秒）
      if (this.chargeT < 3.6 && this.chargeT > 0.5 && this.rng.next() < 0.22) {
        this.chargeCracks.push({
          x: this.bx + (this.rng.next() - 0.5) * 380,
          y: this.by + (this.rng.next() - 0.5) * 300,
          seed: (this.rng.next() * 1e9) | 0, t: 0, life: 0.35 + this.rng.next() * 0.25,
        });
      }
      // 第 5 秒：全部停止并消失 → 绝对黑屏 0.2s（BGM 淡出恰好归零）
      if (this.chargeT <= 0.2) {
        this.chargeParts.length = 0;
        this.chargeCracks.length = 0;
      }
      // 粒子推进：k 递增（先慢后快 = 加速吸感），到心即灭
      for (let i = this.chargeParts.length - 1; i >= 0; i--) {
        const q = this.chargeParts[i];
        q.k += (0.35 + 0.65 * q.k) * q.sp * dtReal * 1.4;
        if (q.k >= 1) this.chargeParts.splice(i, 1);
      }
      for (let i = this.chargeCracks.length - 1; i >= 0; i--) {
        const c = this.chargeCracks[i];
        c.t += dtReal;
        if (c.t >= c.life) this.chargeCracks.splice(i, 1);
      }
    }

    // P3 锁血和音乐淡出全部结束后放大招。
    // 不依赖 pause 阶段，避免浮点边界使音乐永远停在零。
    if (this.bgmFade > 0) {
      this.bgmFade = Math.max(0, this.bgmFade - dtReal);
      try { if (this._bgm) this._bgm.volume = 0.85 * (this.bgmFade / 5); } catch { /* */ }
    }
    if (this.phase === 3 && this._p3Pending
        && this.invulnLeft <= 0 && this.bgmFade <= 0) {
      // 锁血（5 秒）结束的那一刻：音量瞬间恢复 100%、直接从 2 分钟开始播
      this._p3Pending = false;
      this.ultBgmLocked = true;          // 之后大招不再碰 BGM 任何设置
      try {
        if (this._bgm) {
          this._bgm.volume = 0.85;
          // 先确保在播再 seek —— 未加载的媒体元素 currentTime 赋值会被静默忽略
          if (this._bgm.paused) this._bgm.play().catch(() => { /* */ });
          this._bgm.currentTime = BGM_START_AT;
        }
      } catch { /* */ }
      // 拔刀清场并白闪，恢复正常时间。
      this.chargeT = 0;
      this.chargeParts.length = 0;
      this.chargeCracks.length = 0;
      this.whiteFlash = 1;
      this._startUlt();
    }

    // ---- 阶段切换（血量门槛，切阶段清屏 + 短缓冲）----
    if (this.phase === 1 && this.boss.hp <= VERGIL_MAX_HP * 0.66) this._enterPhase(2);
    else if (this.phase === 2 && this.boss.hp <= VERGIL_MAX_HP * 0.33) this._enterPhase(3);

    // 每累计承伤 2000，按阶段叠加无敌时长，保留单帧多段累加。
    {
      const drop = this._hpLast - this.boss.hp;
      // 转阶段演出窗口（_p3Pending：5s 大招锁血）期间冻结常驻锁 ——
      // 演出锁本身全挡伤害（真实战斗 drop=0），这里防的是任何直接改血
      // 的路径把大招演出拖长。
      if (drop > 0 && !this._p3Pending) {
        this._dmgAccum += drop;
        while (this._dmgAccum >= LOCK_DMG_STEP) {
          this._dmgAccum -= LOCK_DMG_STEP;
          this.invulnLeft += this.phase >= 3 ? P3_LOCK_INVULN : LOCK_INVULN;
        }
      }
      this._hpLast = this.boss.hp;
    }

    // 全队死亡或倒地才结束挑战，单个队友倒地不触发失败。
    {
      const team = this.context.world?.players?.() ?? [p];
      if (team.every((pl) => !pl || pl.dead || pl.downed)) { this.finish('death'); return; }
    }
    // 胜利演出只进入一次，随后状态机负责延迟结算。
    if (this.state !== 'win' && (this.boss.dead || this.boss.hp <= 0)) { this._win(); return; }

    // ---- AI 状态机 ----
    this.stateT += dtReal;
    if (this.state === 'wander') {
      this._idle();
      if (this.stateT >= this.castGap / this.spd() && !this.over) {
        this._pickSkill();
      }
    } else if (this.state === 'cast') {
      this._idle();
      this._tickCast(dtReal);
    } else if (this.state === 'ult') {
      this._tickUlt(dtReal);
    } else if (this.state === 'pause') {
      // 收刀停顿（默认 1s）/ P3 转阶段（5s，配合 BGM 淡出与锁血）
      if (this.stateT >= this.pauseDur) { this.state = 'wander'; this.stateT = 0; }
    } else if (this.state === 'win') {
      if (this.stateT >= 1.4) this.finish('beat');
    }

    // P1/P2 待机时拦截远程攻击；近战直接进入伤害结算。
    const wasGuard = this.guarding;
    this.guarding = this.phase <= 2 && this.state === 'wander' && !p.dead;
    // 每次进入待机格挡时重置该轮特效次数。
    if (this.guarding && !wasGuard) this._parryBurstN = 0;
    if (this.guarding) this.guardT += dtReal;
    if (wasGuard && !this.guarding && this.guardT > 0.4) {
      this.guardShatterT = 0.35;       // 出招了 —— 光圈闪烁破碎
      this.guardT = 0;
    } else if (!this.guarding) {
      this.guardT = 0;
    }
    this.guardShatterT = Math.max(0, this.guardShatterT - dtReal);

    // ---- 格挡特效推进 + 涟漪窗口 ----
    this._parrySfxT = Math.max(0, this._parrySfxT - dtReal);
    this._parryFxT = Math.max(0, (this._parryFxT ?? 0) - dtReal);
    this._parryWindow -= dtReal;
    if (this._parryWindow <= 0) {
      this._parryWindow = 0.3;
      if (this._parryCount >= 6) this.parryRipples.push({ t: 0, life: 0.4 });
      this._parryCount = 0;
    }
    for (let i = this.parryFx.length - 1; i >= 0; i--) {
      const s = this.parryFx[i];
      s.t += dtReal;
      if (s.t >= s.life) this.parryFx.splice(i, 1);
    }
    for (let i = this.parrySparks.length - 1; i >= 0; i--) {
      const s = this.parrySparks[i];
      s.t += dtReal;
      s.x += s.vx * dtReal;
      s.y += s.vy * dtReal;
      s.vx *= 0.92; s.vy *= 0.92;
      if (s.t >= s.life) this.parrySparks.splice(i, 1);
    }
    for (let i = this.parryRipples.length - 1; i >= 0; i--) {
      const r = this.parryRipples[i];
      r.t += dtReal;
      if (r.t >= r.life) this.parryRipples.splice(i, 1);
    }

    // ---- 幻影剑：自动触发计时 + 近战计量在 dealDamage 里喂 ----
      this.mirageAutoCd -= dtReal;
      if (this.mirageAutoCd <= 0) {
        this.mirageAutoCd = MIRAGE_AUTO_CD;
        this._tryMirage();               // 20 秒一次（用户补充的保底通道）
      }


    // ---- 幻影剑技能推进 ----
    if (this.mirage) this._tickMirage(dtReal);

    // ---- 幻影剑火星（环绕时随机飘散）----
    if (this.mirage && this.rng.next() < 0.5) {
      const sw = this.mirage.swords[(this.rng.next() * this.mirage.swords.length) | 0];
      const a = sw.a + this.mirage.orbitA;
      this.mirageEmbers.push({
        x: this.bx + Math.cos(a) * MIRAGE_ORBIT,
        y: this.by + Math.sin(a) * MIRAGE_ORBIT,
        vx: (this.rng.next() - 0.5) * 30, vy: -30 - this.rng.next() * 40,
        t: 0, life: 0.5 + this.rng.next() * 0.4,
      });
    }
    for (let i = this.mirageEmbers.length - 1; i >= 0; i--) {
      const e = this.mirageEmbers[i];
      e.t += dtReal;
      e.x += e.vx * dtReal;
      e.y += e.vy * dtReal;
      if (e.t >= e.life) this.mirageEmbers.splice(i, 1);
    }

    // ---- 直线月牙推进（141 轮改：速度翻倍、不追踪、直直冲出去）----
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const wv = this.waves[i];
      wv.t += dtReal;
      if (wv.t >= wv.life) { this.waves.splice(i, 1); continue; }
      wv.x += Math.cos(wv.angle) * wv.speed * dtReal;
      wv.y += Math.sin(wv.angle) * wv.speed * dtReal;
      if (!p.dead && Math.hypot(p.x - wv.x, p.y - wv.y) < wv.r * 0.55) {
        if (this._hitPlayer()) wv.t = wv.life;
      }
    }

    // ---- 冲刺路径刀痕（月牙残影，可带滑出速度）----
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const tr = this.trails[i];
      tr.t += dtReal;
      tr.x += (tr.vx ?? 0) * dtReal;
      tr.y += (tr.vy ?? 0) * dtReal;
      if (tr.t >= tr.life) this.trails.splice(i, 1);
    }

    // ---- AOE 拉回圈内的随机半月刀波（碰到玩家算一次伤害）----
    if (this.aoe && this.aoe.mode === 'hold') {
      this.aoe.spawnT = (this.aoe.spawnT ?? 0) + dtReal;
      if (this.aoe.spawnT >= 0.075) {          // 141 轮再改：数量翻倍
        this.aoe.spawnT = 0;
        const a = this.rng.next() * TAU;
        const rr = this.aoe.r * (0.15 + this.rng.next() * 0.75);
        this.aoeBlades.push({
          x: this.aoe.x + Math.cos(a) * rr,
          y: this.aoe.y + Math.sin(a) * rr,
          angle: this.rng.next() * TAU,
          t: 0, life: 0.55,
        });
      }
    }
    for (let i = this.aoeBlades.length - 1; i >= 0; i--) {
      const ab = this.aoeBlades[i];
      ab.t += dtReal;
      if (ab.t >= ab.life) { this.aoeBlades.splice(i, 1); continue; }
      if (!p.dead && Math.hypot(p.x - ab.x, p.y - ab.y) < 20) {
        this._hitPlayer();
      }
    }

    // ---- 冲刺斩条带判定 ----
    for (let i = this.slashBars.length - 1; i >= 0; i--) {
      const b = this.slashBars[i];
      b.t += dtReal;
      if (b.t >= b.life) { this.slashBars.splice(i, 1); continue; }
      if (!p.dead && b.armed && Math.abs(p.y - b.y) < 26) this._hitPlayer();
    }
    for (let i = this.dashes.length - 1; i >= 0; i--) {
      const d = this.dashes[i];
      d.t += dtReal;
      if (d.t >= d.life) this.dashes.splice(i, 1);
    }

    // ---- AOE 拉回 ----
    if (this.aoe) {
      const a = this.aoe;
      a.st += dtReal;
      if (a.mode === 'grow') {
        a.r = a.maxR * Math.min(1, a.st / 0.35) ** 0.6;
        if (a.st >= 0.35) { a.mode = 'hold'; a.st = 0; }
      } else if (a.mode === 'hold') {
        if (a.st >= 0.5) { a.mode = 'collapse'; a.st = 0; }
      } else if (a.mode === 'collapse') {
        a.r = a.maxR * Math.max(0, 1 - a.st / 0.12);
        if (a.st >= 0.12) {
          // 收缩瞬间：还在圈里的玩家被吸住挨一刀
          if (!p.dead && Math.hypot(p.x - a.x, p.y - a.y) < a.maxR * 0.85) {
            this._hitPlayer();
          }
          a.done = true;
        }
      }
      if (a.done) this.aoe = null;
    }

    // ---- 球形次元斩 ----
    for (let i = this.rifts.length - 1; i >= 0; i--) {
      const rf = this.rifts[i];
      rf.st += dtReal;
      if (!rf.fired && rf.st >= rf.dur) {
        rf.fired = true;
        this._se('vergil_atk', 0.6);
        for (let k = 0; k < 10; k++) {
          this.radials.push({
            cx: rf.x, cy: rf.y,
            a: (k / 10) * TAU + this.rng.next() * 0.5,
            len: 500 + this.rng.next() * 80,
            t: 0, life: 0.32, seed: (this.rng.next() * 1e9) | 0,
          });
        }
        this.whiteFlash = Math.max(this.whiteFlash, 0.35);
      }
      if (rf.st >= rf.dur + 0.15) this.rifts.splice(i, 1);
    }
    for (let i = this.radials.length - 1; i >= 0; i--) {
      const rb = this.radials[i];
      rb.t += dtReal;
      if (rb.t >= rb.life) { this.radials.splice(i, 1); continue; }
      // 射线从裂缝向外推进的当前头端
      const prog = Math.min(1, rb.t / 0.2);
      const x2 = rb.cx + Math.cos(rb.a) * rb.len * prog;
      const y2 = rb.cy + Math.sin(rb.a) * rb.len * prog;
      if (!p.dead && distToSegment(p.x, p.y, rb.cx, rb.cy, x2, y2) < 13) {
        this._hitPlayer();
      }
    }

    // ---- 满屏刀光（大招期间，真实秒表）----
    for (let i = this.ultBlades.length - 1; i >= 0; i--) {
      const b = this.ultBlades[i];
      b.t += dtReal;
      if (b.t >= b.life) { this.ultBlades.splice(i, 1); continue; }
      if (!p.dead && distToSegment(p.x, p.y, b.x1, b.y1, b.x2, b.y2) < 13) {
        this._hitPlayer();
      }
    }
  }

  private advanceBladeSparks(dtReal: number) {
    // The reference advanced these after update, including the first win frame.
    // The rule clock owns this lifetime; drawing never changes effect state.
    for (let i = this.bladeSparks.length - 1; i >= 0; i--) {
      const spark = this.bladeSparks[i];
      spark.t += dtReal;
      spark.x += spark.vx * dtReal;
      spark.y += spark.vy * dtReal;
      spark.vx *= .9; spark.vy *= .9;
      if (spark.t >= spark.life) this.bladeSparks.splice(i, 1);
    }
  }

  /** 5% maxHp 真伤、0.2 秒内部冷却；随机分散到存活且未倒地的玩家。 */
  _hitPlayer() {
    if (this.hitCd > 0) return false;
    const all = this.context.world?.players?.() ?? [this.context.player];
    const alive = all.filter((pl) => pl && !pl.dead && !pl.downed);
    const p = alive.length ? alive[(this.rng.next() * alive.length) | 0] : this.context.player;
    if (p.dead) return false;
    p.takeDamage(0, this.bx, this.by, {
      ignoreIFrames: true,
      fixedDamage: p.maxHp * HIT_FRAC,
      noMiss: true,
    });
    this.hitCd = HIT_CD;
    return true;
  }

  _enterPhase(n: number) {
    this.phase = n;
    this.spdMul = n === 2 ? 1.1 : n === 3 ? 1.3 : 1;
    // Phase transition owns its five-second damage lock and clears attacks.
    this.invulnLeft = 5;
    this.waves.length = 0;
    this.rifts.length = 0;
    this.radials.length = 0;
    this.aoe = null;
    this.state = 'wander';
    this.stateT = -0.8;                        // 0.8s 缓冲再开始放技能
    if (n === 3) {
      // P3 演出：5 秒静止（BGM 音量 5 秒内 100%→0%，boss 停止攻击），
      // 锁血结束的那一刻由 update 触发大招 + 音量瞬回 100%@2:00
      this.state = 'pause';
      this.stateT = 0;
      this.pauseDur = 5;
      this.bgmFade = 5;
      this.ultCd = 0;
      this._p3Pending = true;   // 锁血+淡出都归零时由 update 触发大招
      // P3 入定时世界慢放，Boss 仍按真实时间推进。
      this.timeScale = 0.2;
      this.chargeT = 5;
      this.chargeParts.length = 0;
      this.chargeCracks.length = 0;
    }
  }

  /** 站桩待机：不移动不转向（呼吸浮动在渲染层），只同步实体坐标 */
  _idle() {
    this.boss.x = this.bx;
    this.boss.y = this.by;
  }

  _pickSkill() {
    // P3 优先已冷却的大招，否则从普通技能池随机抽取，允许重复。
    if (this.phase === 3) {
      this.ultCd -= (this.castGap / this.spd());
      if (this.ultCd <= 0) { this._startUlt(); return; }
    }
    let name = SKILL_ORDER[(this.rng.next() * SKILL_ORDER.length) | 0];
    // 幻影剑被随机抽到时若已在放/刚放过，换成普通技能（自动/计量触发另有通道）
    if (name === 'mirage' && !this._tryMirage()) {
      name = SKILL_ORDER[(this.rng.next() * 4) | 0];
    }
    if (name === 'mirage') {
      // 幻影剑是独立浮游容器（不走 cast 状态机）—— 只记个名，行为在 _tickMirage
      this.skill = { name: 'mirage', st: 0, fired: 0 };
      this.state = 'wander';
      this.stateT = 0;
      return;
    }
    this.state = 'cast';
    this.stateT = 0;
    this.skill = { name, st: 0, fired: 0 };
  }

  // 幻影剑由技能抽选、累计近战伤害或定时器触发；返回是否成功开始。
  _tryMirage() {
    if (this.mirage || this.over || this.state === 'intro' || this.state === 'win') return false;
    this.mirage = {
      st: 0, fired: 0, orbitA: 0,
      swords: Array.from({ length: MIRAGE_COUNT }, (_, i) => ({
        a: (i / MIRAGE_COUNT) * TAU, seed: (this.rng.next() * 1e9) | 0,
      })),
      flying: [],
    };
    this._se('vergil_atk', 0.6);
    return true;
  }

  /** 环绕 3 秒 → 依次朝玩家当前位置发射 → 飞行推进/命中（5% 真伤通道） */
  _tickMirage(dtReal: number) {
    const m = this.mirage;
    if (!m) return;
    const p = this.context.player;
    m.st += dtReal;
    m.orbitA += dtReal * 2.2;

    // 环绕期结束 → 依次发射（每把锁定发射瞬间玩家的位置）
    if (m.st >= MIRAGE_SUMMON && m.fired < MIRAGE_COUNT) {
      const should = Math.min(MIRAGE_COUNT, 1 + (((m.st - MIRAGE_SUMMON) / MIRAGE_GAP) | 0));
      while (m.fired < should) {
        const sw = m.swords[m.fired];
        const a = sw.a + m.orbitA;
        const px = this.bx + Math.cos(a) * MIRAGE_ORBIT;
        const py = this.by + Math.sin(a) * MIRAGE_ORBIT;
        m.flying.push({
          x: px, y: py,
          angle: Math.atan2(p.y - py, p.x - px),
          speed: MIRAGE_SPEED, t: 0, life: 3,
          seed: sw.seed, trail: [], hitCd: 0,
        });
        m.fired++;
        this._se('vergil_atk', 0.45);
      }
    }

    // 飞行剑推进
    for (let i = m.flying.length - 1; i >= 0; i--) {
      const b = m.flying[i];
      b.t += dtReal;
      b.x += Math.cos(b.angle) * b.speed * dtReal;
      b.y += Math.sin(b.angle) * b.speed * dtReal;
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 16) b.trail.shift();
      b.hitCd = Math.max(0, b.hitCd - dtReal);
      // 命中：5% 真伤通道（同刀波），每把剑 0.5s 最多咬一口
      if (!p.dead && b.hitCd <= 0
          && Math.hypot(p.x - b.x, p.y - b.y) < 26) {
        if (this._hitPlayer()) b.hitCd = 0.5;
      }
      // 飞出场外/超时 → 收
      if (b.t >= b.life
          || Math.abs(b.x - this.bx) > 1600 || Math.abs(b.y - this.by) > 1200) {
        m.flying.splice(i, 1);
      }
    }

    // 全部发完且飞完 → 收技能
    if (m.fired >= MIRAGE_COUNT && m.flying.length === 0) this.mirage = null;
  }

  /**
   * 近战计量：world.dealDamage 喂实际伤害，累计达玩家 maxHp 10% 触发一次。
   */
  noteMelee(dealt: number) {
    this.meleeMeter += dealt;
    const maxHp = this.context.player.stats.get('maxHp');
    if (this.meleeMeter >= maxHp * MIRAGE_MELEE_FRAC) {
      this.meleeMeter = 0;
      this._tryMirage();
    }
  }

  // 格挡生成斩线、火花和限频音效；短时间格挡达到阈值时追加涟漪。
  observeDamage({ targetId, melee, dealt }: DamageObservation) {
    if (this.boss && targetId === this.boss.id && melee) this.noteMelee(dealt);
  }

  interceptAttack({ targetId, melee, x, y }: AttackInterception) {
    if (!this.boss || targetId !== this.boss.id || !this.guarding || melee) return false;
    this.parryAt(x, y); return true;
  }

  parryAt(x: number, y: number) {
    if (!this.guarding) return false;
    // 每轮格挡只显示少量特效，并设内部间隔，避免多队友贴脸产生特效风暴。
    if ((this._parryFxT ?? 0) > 0) return true;
    if ((this._parryBurstN ?? 0) >= 2) return true;
    this._parryFxT = 0.05;
    this._parryBurstN = (this._parryBurstN ?? 0) + 1;
    this._parryCount++;
    this.parryFx.push({ x, y, seed: (this.rng.next() * 1e9) | 0, t: 0, life: 0.1 });
    const n = 3 + ((this.rng.next() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const a = this.rng.next() * TAU;
      const sp = 60 + this.rng.next() * 130;
      this.parrySparks.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        t: 0, life: 0.3 + this.rng.next() * 0.3,
      });
    }
    this._seParry();
    return true;
  }

  _tickCast(dtReal: number) {
    const sk = this.skill;
    if (!sk) { this.state = 'wander'; this.stateT = 0; return; }
    sk.st += dtReal;
    const p = this.context.player;
    const spd = this.spd();

    if (sk.name === 'triple') {
      // 141 轮终版：3 个刀波一组齐射，**连用 3 次 = 一共甩 9 个波**。
      // 每 0.2s 一轮，每轮扇形 ±0.2rad 三道，直线快冲（无追踪无旋摆）。
      const roundGap = 0.2 / spd;
      const rounds = Math.min(3, Math.floor(sk.st / roundGap) + 1);
      while (sk.fired < rounds) {
        const base = Math.atan2(p.y - this.by, p.x - this.bx);
        for (const off of [-0.2, 0, 0.2]) {
          this.waves.push({
            x: this.bx, y: this.by, angle: base + off,
            speed: 530 * spd, r: 46, t: 0, life: 2.2,
          });
        }
        this._se('vergil_atk', 0.5);
        sk.fired++;
      }
      if (sk.st > roundGap * 3 + 0.2) this._endCast();
    } else if (sk.name === 'dash') {
      if (!sk.dashed && sk.st >= 0.25 / spd) {
        sk.dashed = true;
        // 转向（冲刺斩是转向时机之一）
        this.chairFacing = Math.atan2(p.y - this.by, p.x - this.bx);
        // 瞬移到玩家面前（玩家与旧位之间 70px 处）
        const dx = this.bx - p.x, dy = this.by - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const nx = p.x + (dx / d) * 70, ny = p.y + (dy / d) * 70;
        this.dashes.push({ x1: this.bx, y1: this.by, x2: nx, y2: ny, t: 0, life: 0.3 });
        // 沿冲刺路径每 55px 留月牙残影，保留实际位移长度。
        const gap = 55;
        const n = Math.max(1, Math.floor(d / gap));
        const dir = Math.atan2(-dy, -dx);            // 刀口朝冲刺方向
        for (let i = 1; i <= n; i++) {
          const t = i / (n + 1);
          this.trails.push({
            x: this.bx + dx * t, y: this.by + dy * t,
            angle: dir,
            t: i * 0.03, life: 0.5,
          });
        }
        // 路径两侧补半月弧，区分横贯主刀光。
        for (const side of [-1, 1]) {
          for (let i = 1; i <= Math.max(2, n - 1); i++) {
            const t = i / (Math.max(2, n - 1) + 1);
            const px = -dy / d, py = dx / d;         // 路径法线
            const off = side * (46 + this.rng.next() * 26);
            this.trails.push({
              x: this.bx + dx * t + px * off,
              y: this.by + dy * t + py * off,
              angle: dir + side * (0.9 + this.rng.next() * 0.5),
              vx: px * side * 90, vy: py * side * 90,   // 向两侧滑出
              t: i * 0.03 + 0.05, life: 0.55,
            });
          }
        }
        this.bx = nx; this.by = ny;
        this.boss.x = nx; this.boss.y = ny;
        // 横贯屏幕的横向刀光（以玩家所在高度为准）
        const halfW = this.context.viewport.viewW;
        this.slashBars.push({ y: p.y, x: this.context.viewport.cx, halfW, t: 0, life: 0.22, armed: true });
        this._se('vergil_atk', 0.6);
        this.whiteFlash = Math.max(this.whiteFlash, 0.3);
      }
      if (sk.st > 0.7 / spd) this._endCast();
    } else if (sk.name === 'aoe') {
      if (!sk.started && sk.st >= 0.1) {
        sk.started = true;
        this.aoe = { x: this.bx, y: this.by, r: 0, maxR: 520, mode: 'grow', st: 0 };
        this._se('vergil_aoe', 0.6);       // 攻击2.ogg：AOE 拉回
      }
      if (sk.st > (0.1 + 0.35 + 0.5 + 0.12 + 0.3) / Math.sqrt(spd)) this._endCast();
    } else if (sk.name === 'sphere') {
      // 【球形次元斩】（普通技能，≠大招）：连放 5 次裂缝 —— 每 0.5s 一道，
      // 2.5s 总计，放完休息 1 秒（一切动作静止）。只后撤一次。
      if (!sk.retreated && sk.st >= 0.05) {
        sk.retreated = true;
        const dx = this.bx - p.x, dy = this.by - p.y;
        const d = Math.hypot(dx, dy) || 1;
        this.bx += (dx / d) * 90;
        this.by += (dy / d) * 90;
        this.boss.x = this.bx; this.boss.y = this.by;
      }
      const gap = 0.5 / spd;
      const should = Math.min(5, Math.floor(sk.st / gap) + 1);
      while (sk.fired < should) {
        sk.fired++;
        // 第 1/3/5 斩瞄当前位置，第 2/4 斩保留上一位置，形成可读的错位节奏。
        if (sk.fired % 2 === 1) sk.lastSpot = { x: p.x, y: p.y };
        this.rifts.push({ x: sk.lastSpot!.x, y: sk.lastSpot!.y, st: 0, dur: 0.3, fired: false });
        this._se('vergil_atk', 0.5);
      }
      if (sk.st > gap * 5 + 0.4) {
        this._endCast();
        // 连放后停顿并播放收刀声。
        this._se('vergil_shutou', 0.65);
        this.state = 'pause';
        this.stateT = 0;
      }
    }
  }

  _endCast() {
    this.state = 'wander';
    this.stateT = 0;
    this.skill = null;
  }

  // 满屏次元斩缩放世界时间；普通 sphere 技能不进入该时间域。
  _startUlt() {
    const p = this.context.player;
    this.state = 'ult';
    this.stateT = 0;
    this.timeScale = 0.05;            // 全场慢动作（用户硬性要求）
    this.chairVisible = false;        // 时停消失
    this._ultWaveN = 0;               // 已爆发的连数（0..5）
    this._ultWaveT = 0;
    // 大招是转向时机
    this.chairFacing = Math.atan2(p.y - this.by, p.x - this.bx);
    this._se('vergil_ult', 0.85);     // 次元斩.ogg
    // P3 转阶段已经拥有音乐 seek，此后的大招不再改 BGM。
    if (!this.ultBgmLocked) {
      try {
        if (this._bgm) {
          if (!this._bgmStarted) {
            this._bgm.currentTime = BGM_START_AT;
            this._bgm.play().catch(() => { /* 自动播放被拦就安静 */ });
            this._bgmStarted = true;
          } else if (this._bgm.paused) {
            this._bgm.play().catch(() => { /* */ });
          }
        }
      } catch { /* */ }
    }
  }

  _tickUlt(dtReal: number) {
    if (this._ultWaveN === undefined || this._ultWaveT === undefined) throw new TypeError('Ultimate must be entered before advancing');
    const cam = this.context.viewport;
    // 蓄力后每 0.18 秒发一连，共十连，每连八道刀光。
    const CHARGE = 0.3, GAP = 0.18, COMBOS = 10;
    if (this.stateT >= CHARGE && this._ultWaveN < COMBOS) {
      if (!this._ultWaveT) this._ultWaveT = 0;
      this._ultWaveT += dtReal;
      while (this._ultWaveT >= GAP && this._ultWaveN < COMBOS) {
        this._ultWaveT -= GAP;
        this._ultWaveN++;
        this.veil = Math.min(1, this.veil + 0.11);
        // 每连同步白闪和震屏。
        this.whiteFlash = Math.max(this.whiteFlash, 0.45);
        cam.shake(9, 0.15);
        const vw = cam.viewW, vh = cam.viewH;
        for (let i = 0; i < 8; i++) {
          const a = this.rng.next() * TAU;
          const ox = cam.cx + (this.rng.next() - 0.5) * vw;
          const oy = cam.cy + (this.rng.next() - 0.5) * vh;
          const half = Math.hypot(vw, vh) * 0.62;
          this.ultBlades.push({
            x1: ox - Math.cos(a) * half, y1: oy - Math.sin(a) * half,
            x2: ox + Math.cos(a) * half, y2: oy + Math.sin(a) * half,
            seed: (this.rng.next() * 1e9) | 0, t: 0, life: 0.2,
          });
          // 刀锋火花：两端 + 路径中段随机溅出（白色细长，0.2s 寿命）
          for (let s = 0; s < 4; s++) {
            const tt = s === 0 ? 0 : s === 1 ? 1 : this.rng.next();
            const sx = ox - Math.cos(a) * half + (2 * tt - 1) * Math.cos(a) * half;
            const sy = oy - Math.sin(a) * half + (2 * tt - 1) * Math.sin(a) * half;
            const sa = a + Math.PI / 2 + (this.rng.next() - 0.5) * 2.4;
            const sp = 160 + this.rng.next() * 260;
            this.bladeSparks.push({
              x: sx, y: sy, vx: Math.cos(sa) * sp, vy: Math.sin(sa) * sp,
              ang: sa, t: 0, life: 0.16 + this.rng.next() * 0.08,
            });
          }
        }
      }
    }
    if (this._ultWaveN >= COMBOS && this.timeScale < 1) {
      // 收刀：恢复时间、瞬移屏幕中央、白闪 + 碎屏
      this.timeScale = 1;
      this.veil = 0;
      this._ultWaveT = 0;
      this.chairVisible = true;
      this.bx = cam.cx; this.by = cam.cy - 60;
      this.boss.x = this.bx; this.boss.y = this.by;
      this.whiteFlash = 1;
      this._shatterBig(cam.cx, cam.cy - 60);
      if (this.phase === 3) this.ultCd = ULT_CD;    // 10 秒后再来一次
      // 收刀停顿复位为默认 1 秒（P3 转阶段曾把它设成 5）
      this.pauseDur = 1.0;
      // 5 连结束 → boss 停顿 1 秒一切动作（喘息收刀）
      this.state = 'pause';
      this.stateT = 0;
    }
  }

  // 半屏半径内按面积均匀撒 26 个爆点，每点两片碎片。
  _shatterBig(x: number, y: number) {
    const R = this.context.viewport.viewH * 0.5;    // ≈ 半屏
    for (let i = 0; i < 26; i++) {
      const a = this.rng.next() * TAU;
      const rr = Math.sqrt(this.rng.next()) * R;
      spawnShatter(this.rng, this.shards, x + Math.cos(a) * rr, y + Math.sin(a) * rr,
        2, 1.4, 1.3);
    }
  }

  _win() {
    if (this.state === 'win') return;
    this.state = 'win';
    this.stateT = 0;
    this.timeScale = 1;
    this.veil = 0;
    this.waves.length = 0;
    this.ultBlades.length = 0;
    this.rifts.length = 0;
    this.radials.length = 0;
    this.trails.length = 0;
    this.aoeBlades.length = 0;
    this.slashBars.length = 0;
    this.dashes.length = 0;
    this.chairVisible = true;
    this.whiteFlash = 1;
    this._shatterBig(this.bx, this.by);
    this.context.notice('大…大排档椅子？！？！碎了', 'good', 4000);
  }

}
