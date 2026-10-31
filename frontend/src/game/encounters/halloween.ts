import type { ChallengeController, ChallengeFrame, ChallengeObservation, ChallengeSession } from './types.ts';
import type { EncounterView } from '../views.ts';
import { challengeDisplay } from './display-values.ts';
import type { IncomingHitProfile } from '../combat/incoming-hit.ts';
import { proportionalHit } from './damage-policy.ts';
import { ChallengePlayerPolicy } from './player-policy.ts';
import type { Player } from '../actors/player.ts';
import type { EnemyBullet } from '../actors/bullet.ts';
import type { EnemyShot } from '../actors/bullet.ts';
type CatId = 'choco' | 'vanilla';
interface CatState { x: number; y: number; cast: number; frame: number; ft: number }
interface HalloweenSection { name: string; spell: string; word?: string[]; dur: number; tick(dt: number, elapsed: number): void }
interface HalloweenShot extends Partial<EnemyShot> { hwKind?: string; hwPhase?: number }
import type { ControllerContext, ControllerOptions, ChallengeOutcome, Arena } from './types.ts';
import type { RNG } from '../math/random.ts';
import { HALLOWEEN_LASER, PUMPKIN_CROSS } from './hazards.ts';
import { HALLOWEEN_ARENA as ARENA } from './arenas.ts';
// 巧克力与香草按固定时间轴演出，不设受击躯体。
// 弹幕按最大生命 10% 结算，宽竞技场与分裂位置由本控制器维护。
// 素材与弹幕规格来自 Rabi-Ribi 万圣节 DLC；原 px/帧弹速按 60Hz 换算。
import { TAU } from '../math/geometry.ts';
import { encounterCues } from './cues.ts';

import { layoutWord } from './halloween-font.ts';

// 双猫悬浮基线位于宽竞技场上半部。
export const CAT_Y = ARENA.cy - ARENA.hh + 120;

// 追踪猫爪与角落封堵参数。
export const CLAW_SECTION_S = 13;   // 节长（原 7）
export const CLAW_LIFE_S = 12;       // 爪寿命（原 6）
export const CLAW_TURN = 2.8;        // 转向速率上限 rad/s（原 2.2）
export const CLAW_INTERVAL = 2.2;    // 发射间隔（原 1.2）
export const CLAW_PER_VOLLEY = 2;    // 每次几只（原 3）。寿命 12s ÷ 间隔 2.2s ≈ 5.5 次 × 2 ≈ 11 只同时在场
export const EMBER_SPEED = 0.8;       // 202 轮：追踪爪散出的紫色小弹，px/帧（原 0.4）
export const EMBER_RANGE = 280;       // 202 轮：射程 px（原 70）→ 飞行时间 = 280/(0.8×60) ≈ 5.8s（原 2.9s）
export const BEAD_SPLASH_Y = 6;      // 202 轮：灯珠触到场地底边以上多少 px 就散开
export const CLAW_MAX = 14;          // 同屏上限 —— 必须 > 稳态数量，否则「丢最老」会把寿命实际压回 ~6s（测试抓到过）
export const CORNER_PERIOD = { 2: 4.6, 3: 3.0 };   // 角落封堵的间隔（按阶段）
export const NO_CORNER_SECTIONS = new Set(['intro', 'split', 'candy']);   // 这些节不加角落弹
export const CAT_X_OFF = 270;

// 弹速换算：原版 px/帧 @60fps → px/s
const V = (framesPerPx: number) => framesPerPx * 60;

// 每发弹幕真伤 = 玩家 maxHp × 10%（用户拍板的测试口径）
export const HALLOWEEN_HIT_FRAC = 0.10;

const IDLE_F = [0,1,2,3,4,5,6,7,8,9];
const CAST_F = [10,11,12,13,14,15,16,17,18,19,20];
export class HalloweenFight implements ChallengeController {
  readonly rules = Object.freeze({ blocksWeather: true, disablesPetAttack: false, suppressesTrueDamage: false, disablesPhantoms: false });
  readonly capabilities: Pick<ChallengeSession, 'guard' | 'purge' | 'displayTiming'> = Object.freeze({
    guard: null,
    purge: null,
    displayTiming: null,
  });
  readClock() { return { overridden: false, timer: null }; }
  advance(dt: number) { this.update(dt); }
  dispose() { this.over = true; this.timeScale = 1; }
  readCombat(): ChallengeObservation {
    const lasers = this.waves.map(wave => {
      const activeAfter = Math.max(0, HALLOWEEN_LASER.warning - (wave.life - wave.t));
      return { x: wave.x, y: wave.y, angle: wave.angle, angularVelocity: wave.rot,
        activeAfter, activeFor: Math.max(0, wave.t - activeAfter),
        length: Infinity, halfWidth: HALLOWEEN_LASER.halfWidth };
    });
    const crosses = this.pumpkins.map(pumpkin => ({ x: pumpkin.x, y: pumpkin.y,
      activeAfter: Math.max(0, pumpkin.t), activeFor: pumpkin.t > 0 ? PUMPKIN_CROSS.duration : Math.max(0, pumpkin.boom),
      halfWidth: PUMPKIN_CROSS.halfWidth, radius: PUMPKIN_CROSS.radius }));    return { bodyId: null, target: null, guarding: false, movement: 'survival', purgeReady: false, lasers, crosses };
  }
  readFrame(): ChallengeFrame {
    const fight = this, kind = this.kind, arena = this.arena;
    const { actors, projectiles, effects, telegraphs, line } = challengeDisplay(kind);
    const base = { state: String(fight.phase), time: fight.t, introTime: Math.max(0, -fight.t),
      arena: { x: arena.cx, y: arena.cy, halfWidth: arena.hw, halfHeight: arena.hh },
      hp: 0, maxHp: 0, boss: { x: arena.cx, y: arena.cy }, flash: fight.flash, fade: 0 };
    const pumpkins = fight.pumpkins.map((pumpkin, id) => ({ id: `halloween-pumpkin-${id}`, x: pumpkin.x, y: pumpkin.y,
      radius: pumpkin.t > 0 ? 28 : PUMPKIN_CROSS.radius, exploding: pumpkin.t <= 0, progress: Math.max(0, (pumpkin.age ?? 0) / PUMPKIN_CROSS.afterglow), alpha: pumpkin.t > 0 ? 0.75 : Math.max(0, 1 - (pumpkin.age ?? 0) / PUMPKIN_CROSS.afterglow) }));
    const candies = (fight._candies ?? []).map((candy, id) => ({ id: `halloween-candy-${id}`, x: candy.x, y: candy.y, color: candy.color }));
    const encounter: EncounterView = { ...base, kind, state: fight.t < 0 ? 'blackout' : fight.sections[fight.phaseIdx]?.name ?? 'outro', title: fight.curSpell,
      moonPhase: Math.min(1, fight.phaseIdx / Math.max(1, fight.sections.length - 1)), veil: fight.t < 0 ? 1 : 0, pumpkins, candies,
      cats: (['choco', 'vanilla'] as const).map(id => {
        const cat = fight.cats[id];
        const ph = id === 'choco' ? 0 : 2.2;
        const split = fight.splitAt != null ? Math.min(1, (fight.t - fight.splitAt) / .9) : fight.merged ? 0 : 1;
        const ease = 1 - Math.pow(1 - split, 3), mergedX = arena.cx + (id === 'choco' ? -14 : 14);
        return { id, x: (fight.merged ? mergedX : mergedX + (cat.x - mergedX) * ease) + Math.sin(fight.t * 1.1 + ph * .7) * 7,
          y: cat.y + Math.sin(fight.t * 1.9 + ph) * 11, frame: cat.frame, alpha: Math.max(0, Math.min(1, fight.t)) };
      }) };
    for (const [i, wave] of fight.waves.entries()) {
      const age = wave.life - wave.t, warning = age < HALLOWEEN_LASER.warning;
      line(`laser-${i}`, wave.x, wave.y, wave.x + Math.cos(wave.angle) * 1700, wave.y + Math.sin(wave.angle) * 1700,
        warning ? 5 : 56 * (1 + .07 * Math.sin(fight.t * 30 + wave.angle * 3)),
        wave.who === 'vanilla' ? '#d6f4ff' : '#ffad81', warning ? .25 + .35 * age / HALLOWEEN_LASER.warning : Math.max(0, Math.min(1, wave.t / .35, (age - HALLOWEEN_LASER.warning) / .12)));
    }
    for (const [i, claw] of (fight._claws ?? []).entries()) projectiles.push({ id: `halloween-claw-${i}`, x: claw.x, y: claw.y, angle: Math.atan2(claw.vy, claw.vx), radius: 20, color: '#db7fff', hostile: true, shape: 'paw', alpha: Math.min(1, claw.t / 0.4) });
    return { encounter, actors, projectiles, effects, telegraphs };
  }

  declare _sfxAt: Map<string, number>;
  declare cats: { choco: CatState; vanilla: CatState };
  declare waves: { x: number; y: number; angle: number; rot: number; t: number; life: number; who: CatId }[];
  declare pumpkins: { x: number; y: number; t: number; boom: number; age?: number }[];
  declare _q: { at: number; fn(): void }[];
  declare splitAt: number | null;
  declare sections: HalloweenSection[];
  declare _claws: { x: number; y: number; vx: number; vy: number; t: number; life: number }[] | undefined;
  declare _candies: { x: number; y: number; vx: number; vy: number; bounces: number; t: number; color: string }[] | undefined;

  declare playerPolicy: ChallengePlayerPolicy;
  declare hitProfile: IncomingHitProfile;
  declare context: ControllerContext;
  declare kind: 'halloween';
  declare arena: Arena;
  declare cues: ReturnType<typeof encounterCues>;
  declare rng: RNG;
  declare onDone: ControllerOptions["onDone"];
  declare over: boolean;
  declare t: number;
  declare timeScale: number;
  declare merged: boolean;
  declare phaseIdx: number;
  declare phaseT: number;
  declare _emit: number;
  declare curSpell: string;
  declare _alt: number;
  declare _cornerAlt: number;
  declare flash: number;
  declare _cornerT?: number;
  declare _cornerRot?: number;
  declare _fanT?: number;
  declare _pkT?: number;
  declare _bgmOn?: boolean;
  declare outroT?: number;
  constructor(main: ControllerContext, opts: ControllerOptions) {
    this.context = main;
    this.playerPolicy = new ChallengePlayerPolicy({ primary: main.player });
    this.kind = 'halloween'; this.arena = ARENA;
    this.hitProfile = proportionalHit({ fraction: HALLOWEEN_HIT_FRAC, ignoreDowned: true });
    this.cues = encounterCues(main.effects);
    this.rng = main.rng.fork(0x48414c);
    this._sfxAt = new Map();
    this.onDone = opts.onDone;
    this.over = false;
    this.t = -(opts.chain ? 3 : 1.2);   // 黑屏换场 3 秒（芙兰衔接）/ 测试直入 1.2 秒
    this.timeScale = 1;
    // 双猫演出状态
    this.cats = {
      choco: { x: ARENA.cx - CAT_X_OFF, y: CAT_Y, cast: 0, frame: 0, ft: 0 },
      vanilla: { x: ARENA.cx + CAT_X_OFF, y: CAT_Y + 26, cast: 0, frame: 0, ft: 0 },
    };
    this.merged = true;          // 开场"合并猫"，第 5 节分裂成双猫
    this.phaseIdx = 0;           // 当前 section 下标
    this.phaseT = 0;             // section 内局部时间
    this._emit = 0;              // 通用发射计时器
    this.curSpell = '';
    this._alt = 0;               // 双猫交替旗
    this._cornerAlt = 0;         // 185 轮：角落封堵由哪只猫出手（交替）
    this.waves = [];             // 激光束（{x,y,angle,rot,t,life,who}）
    this.pumpkins = [];          // 南瓜（投影点 + 落地计时）
    // 定时队列随规则暂停，不能使用浏览器计时器。
    this._q = [];                // 定时队列 [{at, fn}] —— 取代 setTimeout，暂停时同步冻结
    this.splitAt = null;         // 分裂发生的演出时刻（渲染层做飞散缓动）
    this.flash = 0;              // 全屏白闪强度（分裂瞬间）
    this._buildTimeline();
  }

  /** 演出时间轴 —— 每节 {name, dur, tick(dt, T)}，顺序执行，跑完 outro 即胜 */
  _buildTimeline() {
    this.sections = [
      // word 灯珠字母也是真实弹幕；spell 为显示的招式名。
      { name: 'intro', spell: 'MISCHIEVOUS MASQUERADE', word: ['TRICK'], dur: 4.5, tick: (dt) => this._tickIntro(dt) },
      { name: 'ring', spell: 'FANG OF HARVEST', dur: 6, tick: (dt) => this._tickRing(dt) },
      { name: 'fan', spell: 'TRICK OR TREAT', word: ['TREAT'], dur: 7, tick: (dt, T) => this._tickFan(dt, T) },
      { name: 'wall', spell: 'MIDNIGHT BARRAGE', dur: 6, tick: (dt) => this._tickWall(dt) },
      { name: 'pumpkin', spell: 'PUMPKIN PANIC', word: ['BOO!'], dur: 8, tick: (dt) => this._tickPumpkin(dt) },
      { name: 'split', spell: 'WE ARE SCARY!', word: ['HAPPY', 'HALLOWEEN'], dur: 6, tick: () => this._tickSplit() },
      { name: 'alt_ring', spell: 'TWIN FANG DANCE', dur: 10, tick: (dt) => this._tickAltRing(dt) },
      { name: 'laser', spell: 'CROSS NIGHT PARADE', dur: 10, tick: (dt) => this._tickLaser(dt) },
      { name: 'claw', spell: 'NEKO TRACKER', dur: CLAW_SECTION_S, tick: (dt) => this._tickClaw(dt) },
      { name: 'candy', spell: 'SUGAR RUSH', word: ['SWEET'], dur: 7, tick: (dt) => this._tickCandy(dt) },
      { name: 'rage', spell: 'BUNNY EXTINCTION', word: ['BUNNY', 'EXTINCTION'], dur: 12, tick: (dt) => this._tickRage(dt) },
    ];
  }

  get phase() { return this.phaseIdx >= 6 ? 3 : this.phaseIdx >= 2 ? 2 : 1; }

  /** 当前双猫的演出位置（分裂前重叠居中） */
  _catPos(who: CatId) {
    if (!this.merged) return this.cats[who];
    return { x: ARENA.cx, y: CAT_Y + 10 };
  }

  // ---- 弹幕发射：全部走 world.spawnEnemyBullet，挑战 profile 结算 10% 真伤 ----
  _shot(x: number, y: number, angle: number, speedPxFrame: number, opts: HalloweenShot = {}) {
    const w = this.context.world;
    // 弹幕上限：普通弹 650（芙兰 750 同级）；灯珠字母弹可冲到 900（单词是演出主角，不能被密度挤掉）
    const cap = opts.hwKind === 'bead' ? 900 : 650;
    if (w.enemyBullets.items.length > cap) return null;
    return w.spawnEnemyBullet({
      x, y, angle, speed: V(speedPxFrame),
      damage: 0,                       // 比例伤害由 hitProfile 在命中时计算
      radius: opts.radius ?? 8,        // 渲染缩放基准（8 = 标准弹，视觉直径 ≈ 34）
      // 判定半径独立于视觉：白核 + 亮盘约 6px 才是"实体"，外围光晕不判定
      // （原版擦弹才刺激；之前 9px 判定 + 密度上去后会"明明没碰到也中弹"）
      hitRadius: opts.hitRadius ?? 5.5,
      color: opts.color ?? 'amber',    // 发光色带键：amber/red/gold/violet/cyan/green（见 halloween-render.js）
      // 离开 laser 节后仍推进残留激光寿命，防止它们永久冻结。
      range: (opts.range ?? 900) * 2,
      shape: opts.shape ?? 'orb',
      hitProfile: this.hitProfile,
      hwKind: opts.hwKind ?? '',
      hwPhase: opts.hwPhase ?? 0,
    });
  }

  _catShot(who: CatId, angle: number, speed: number, opts?: HalloweenShot) {
    const p = this._catPos(who);
    this._shot(p.x, p.y + 20, angle, speed, opts);
  }

  /** 环形弹：起始角随机，N 发均分（RECON-SPEC：RandomInt(0,359)、angle = base + i*360/N） */
  _ring(who: CatId, n: number, speed: number, color: string) {
    const base = Math.floor(this.rng.next() * 360) * Math.PI / 180;
    for (let i = 0; i < n; i++) this._catShot(who, base + (i * TAU / n), speed, { color });
  }

  /** 三重对称扇：X 偏移 ±48/±96/±144 三对（RECON-SPEC 原值），向下扇 */
  _fan(who: CatId) {
    const px = this._catPos(who);
    for (const off of [-144, -96, -48, 48, 96, 144]) {
      const x = px.x + off;
      const dy = ARENA.cy + ARENA.hh - px.y;
      this._shot(x, px.y + 20, Math.atan2(dy, 0) + off * 0.0006, 2.0, { color: 'gold' });
    }
  }

  /** 直线弹墙：沿角度 56.16px/步 × 18.52 步，4 波 × 2 发（RECON-SPEC） */
  _wall(who: CatId, angle: number) {
    const px = this._catPos(who);
    const step = 56.16, steps = 18;
    for (let wv = 0; wv < 4; wv++) {
      // 走定时队列而非 setTimeout：暂停(ESC)时 update 不跑，弹墙也跟着冻结
      this._q.push({
        at: this.t + wv * 0.55,
        fn: () => {
          for (const perp of [-1, 1]) {
            const a = angle + perp * Math.PI / 2;
            for (let i = -steps / 2; i <= steps / 2; i++) {
              const sx = px.x + Math.cos(a) * step * i, sy = px.y + Math.sin(a) * step * i;
              if (Math.abs(sx - ARENA.cx) < ARENA.hw + 60 && Math.abs(sy - ARENA.cy) < ARENA.hh + 60) {
                this._shot(sx, sy, angle, 2.2, { color: 'red', shape: 'longball' });
              }
            }
          }
        },
      });
    }
  }

  /**
   * 灯珠字母弹幕：把单词拼成 5×7 点阵，每个格点一颗灯珠弹，整块刚体坠落。
   *  · 间距 pitch 随词宽自适应（11~21px，整词 ≤980px 宽），灯珠光晕 ≥ 间距 → 视觉串成霓虹管
   *  · 整词倾斜 7°（右上扬，报告 §3.1），从左到右每列延迟 28ms 依次点亮（报告 §3.4）
   *  · 延迟生成的灯珠起点按 v·delay 前移，保证整词是刚体、不会因为错时生成而"剪切"变形
   *  · 判定半径 4.5（只有白核算实体），字怀/笔画间隙就是安全通道
   */
  _spawnWord(lines: readonly string[]) {
    const { cells, widthCells, heightCells } = layoutWord(lines);
    const pitch = Math.max(12, Math.min(24, 1160 / widthCells));   // 整词 ≤1160px 宽；单行短词可放大到 24px 间距（字高 168px）
    const tilt = -0.12;
    const cs = Math.cos(tilt), sn = Math.sin(tilt);
    const fall = 46;                                    // px/s，整词坠落速度
    const cx = ARENA.cx;
    const cy = ARENA.cy - ARENA.hh + 60 + (heightCells * pitch) / 2;   // 词顶贴近场地上沿
    for (const c of cells) {
      const lx = c.cx * pitch, ly = c.cy * pitch;
      const delay = c.col * 0.028;
      const x = cx + lx * cs - ly * sn;
      const y = cy + lx * sn + ly * cs + fall * delay;  // 延迟补偿：等价于 t0 时刻一起出发
      this._q.push({
        at: this.t + delay,
        fn: () => this._shot(x, y, Math.PI / 2, fall / 60, {
          color: 'gold', hwKind: 'bead', hwPhase: this.rng.next() * TAU, hitRadius: 4.5, range: 1300,
          radius: pitch * 0.5,   // 仅渲染：灯珠光晕/白核随点阵间距等比放大（报告：核:距 ≈ 1:4.2）
        }),
      });
    }
    this.sfx('etc13', 0.6);
  }

  /** 南瓜炸弹：抛物线落点 → 十字爆风（伪横版灵魂：下落可预判，横走可躲） */
  _pumpkin() {
    const x = ARENA.cx + (this.rng.next() * 2 - 1) * (ARENA.hw - 80);
    const y = ARENA.cy + (this.rng.next() * 2 - 1) * (ARENA.hh - 70);
    this.pumpkins.push({ x, y, t: PUMPKIN_CROSS.warning, boom: 0 });
  }

  // 时间轴各节
  _tickIntro(dt: number) {
    // 登场：合并猫浮现（画层做 alpha 渐入），偶尔丢一颗环形弹当预告
    this._emit += dt;
    if (this._emit > 1.4) { this._emit = 0; this._ring('choco', 8, 2.4, 'amber'); }
  }

  _tickRing(dt: number) {
    this._emit += dt;
    if (this._emit > 1.15) { this._emit = 0; this._ring('choco', 16 + this.phase * 4, 3.0, 'amber'); }
  }

  _tickFan(dt: number, _elapsed?: number) {
    this._emit += dt;
    if (this._emit > 1.05) {
      this._emit = 0;
      this._fan(this._alt % 2 ? 'vanilla' : 'choco');
      this._alt++;
    }
  }

  _tickWall(dt: number) {
    this._emit += dt;
    if (this._emit > 2.4) {
      this._emit = 0;
      const a = (this.rng.next() < 0.5 ? 0 : Math.PI / 2) + (this.rng.next() - 0.5) * 0.3;
      this._wall(this._alt % 2 ? 'vanilla' : 'choco', a);
      this._alt++;
    }
  }

  _tickPumpkin(dt: number) {
    this._emit += dt;
    if (this._emit > 0.55) { this._emit = 0; this._pumpkin(); }
  }

  _tickSplit() {
    // 分裂演出：前 2.5s 合并猫闪烁蓄力 → 拆成双猫（保留原版 25% HP 拆分
    // 的结构神韵，改成纯演出节点 —— 用户拍板纯演出不打血）
    if (this.merged && this.phaseT > 2.5) {
      this.merged = false;
      this.splitAt = this.t;     // 渲染层据此做"从中间飞向两侧"的缓动
      this.flash = 1;            // 全屏白闪
      this.sfx('hit13', 0.5);   // 原版分裂音
    }
  }

  _tickAltRing(dt: number) {
    this._emit += dt;
    if (this._emit > 1.0) {
      this._emit = 0;
      this._ring(this._alt % 2 ? 'vanilla' : 'choco', 24, 3.2, this._alt % 2 ? 'gold' : 'amber');
      this._alt++;
    }
  }

  _tickLaser(dt: number) {
    // 双猫旋转扫射激光：每束绕自身缓慢旋转，持续扫过场地（玩家找角速度差）
    this._emit += dt;
    if (this._emit > HALLOWEEN_LASER.duration) {
      this._emit = 0;
      const who = this._alt % 2 ? 'vanilla' : 'choco';
      this.waves.push({ ...this._catPos(who), angle: this.rng.next() * TAU, rot: (this.rng.next() < 0.5 ? 1 : -1) * 0.9, t: HALLOWEEN_LASER.duration, life: HALLOWEEN_LASER.duration, who });
      this._alt++;
      this.sfx('laser13', 0.3);   // 原版激光音
    }
    for (const b of this.waves) {
      b.angle += b.rot * dt;
      // 前 0.7s 是预警细线（渲染层画淡线），不伤人 —— 给走位反应时间
      if (b.life - b.t < HALLOWEEN_LASER.warning) continue;
      // 激光伤害走 挑战 profile 的 10% 真伤：判定 = 玩家到射线垂距
      for (const pl of this.context.world.players()) {
        if (!pl || pl.dead || pl.downed || pl.invuln > 0) continue;
        const dx = pl.x - b.x, dy = pl.y - b.y;
        const proj = dx * Math.cos(b.angle) + dy * Math.sin(b.angle);
        if (proj <= 0) continue;
        const perp = Math.abs(-dx * Math.sin(b.angle) + dy * Math.cos(b.angle));
        if (perp < HALLOWEEN_LASER.halfWidth) this.hitProfile.hit(pl, b.x, b.y);   // 视觉软边半宽 ≈ 28，核心更窄，判定收到 20
      }
    }
    this.waves = this.waves.filter((b) => (b.t -= dt) > 0);
  }

  // 阶段 2 起向四角逐个错开 0.3 秒发扇形弹，防止角落永久安全。
  // 开场、分裂和糖果雨不叠加；轮换起始角给玩家读弹时间。
  _tickCorners(dt: number) {
    const period = this.phase === 1 ? undefined : CORNER_PERIOD[this.phase];
    if (!period) return;
    this._cornerT = (this._cornerT ?? period * 0.5) - dt;
    if (this._cornerT > 0) return;
    this._cornerT = period;
    const who = this._cornerAlt++ % 2 ? 'vanilla' : 'choco';
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const start = (this._cornerRot = ((this._cornerRot ?? -1) + 1) % 4);   // 每轮从不同的角开始，别让人背
    for (let k = 0; k < 4; k++) {
      const [sx, sy] = corners[(start + k) % 4];
      const tx = ARENA.cx + sx * (ARENA.hw - 30), ty = ARENA.cy + sy * (ARENA.hh - 30);
      this._q.push({
        at: this.t + k * 0.3,
        fn: () => {
          const p = this._catPos(who);
          const base = Math.atan2(ty - (p.y + 20), tx - p.x);
          for (let i = -1; i <= 1; i++) this._shot(p.x, p.y + 20, base + i * 0.1, 2.3, { color: 'cyan', radius: 6, range: 1500, hwKind: 'corner' });
        },
      });
    }
  }

  // 灯珠触底后溅出向上的普通小弹；先收集命中项再生成，避免遍历中新弹被重复消费。
  // 溅射使用普通弹量上限，不占灯珠额度。
  _tickBeadSplash() {
    const floor = ARENA.cy + ARENA.hh - BEAD_SPLASH_Y;
    const list = this.context.world.enemyBullets.items;
    let hit: EnemyBullet[] | null = null;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.dead || b.hwKind !== 'bead' || b.y < floor) continue;
      b.dead = true;
      (hit ??= []).push(b);
    }
    if (!hit) return;
    for (const b of hit) {
      // 上半圆随机方向（避开贴地的水平方向，±0.3rad），速度 1.0~3.0 px/帧，射程 140~360
      const ang = -Math.PI + 0.3 + this.rng.next() * (Math.PI - 0.6);
      this._shot(b.x, floor, ang, 1.0 + this.rng.next() * 2.0, { color: 'gold', radius: 4.5, hitRadius: 3.5, range: 140 + this.rng.next() * 220 });
    }
  }

  /** 离 (x,y) 最近的存活且未倒地的玩家（没有则 null） */
  _nearestAlive(x: number, y: number): Player | null {
    let best: Player | null = null, bd = Infinity;
    for (const pl of this.context.world.players()) {
      if (!pl || pl.dead || pl.downed) continue;
      const d = (pl.x - x) ** 2 + (pl.y - y) ** 2;
      if (d < bd) { bd = d; best = pl; }
    }
    return best;
  }

  _tickClaw(dt: number) {
    // 追踪猫爪追最近的存活玩家，寿命、间隔与同屏上限共同限制密度。
    this._emit += dt;
    if (this._emit > CLAW_INTERVAL) {
      this._emit = 0;
      const who = this._alt % 2 ? 'vanilla' : 'choco';
      const px = this._catPos(who);
      const target = this._nearestAlive(px.x, px.y);
      if (target) {
        const base = Math.atan2(target.y - px.y, target.x - px.x);
        for (let i = 0; i < CLAW_PER_VOLLEY; i++) {
          const a = base + (i - (CLAW_PER_VOLLEY - 1) / 2) * 0.5;   // 2 只：±0.25rad；3 只：-0.5/0/+0.5
          const b = { x: px.x, y: px.y + 20, vx: Math.cos(a) * V(1.1), vy: Math.sin(a) * V(1.1), t: CLAW_LIFE_S, life: CLAW_LIFE_S };
          const list = (this._claws ??= []);
          list.push(b);
          if (list.length > CLAW_MAX) list.shift();   // 超限丢最老的
        }
      }
      this._alt++;
    }
    for (const c of (this._claws ?? [])) {
      const target = this._nearestAlive(c.x, c.y);
      if (target) {
        const want = Math.atan2(target.y - c.y, target.x - c.x);
        const cur = Math.atan2(c.vy, c.vx);
        let da = want - cur;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        const turn = Math.max(-CLAW_TURN * dt, Math.min(CLAW_TURN * dt, da));   // 转向速率上限
        const sp = Math.hypot(c.vx, c.vy);
        const na = cur + turn;
        c.vx = Math.cos(na) * sp; c.vy = Math.sin(na) * sp;
      }
      c.x += c.vx * dt; c.y += c.vy * dt;
      c.t -= dt;
      // 余烬速度从 px/帧换成 px/秒，射程独立于本体追踪寿命。
      if (this.rng.next() < dt * 7) this._shot(c.x, c.y, this.rng.next() * TAU, EMBER_SPEED, { color: 'violet', radius: 5, hitRadius: 4, range: EMBER_RANGE });
    }
    this._claws = (this._claws ?? []).filter((c) => c.t > 0
      && Math.abs(c.x - ARENA.cx) < ARENA.hw + 80 && Math.abs(c.y - ARENA.cy) < ARENA.hh + 80);
  }

  _tickCandy(dt: number) {
    // 糖果雨：随机落下，落地弹跳两下（垂直速度 ×-0.55，水平保留）
    this._emit += dt;
    if (this._emit > 0.3) {
      this._emit = 0;
      const x = ARENA.cx + (this.rng.next() * 2 - 1) * (ARENA.hw - 40);
      this._candies ??= [];
      this._candies.push({ x, y: ARENA.cy - ARENA.hh - 20, vx: (this.rng.next() - 0.5) * 160, vy: 60, bounces: 2, t: 7, color: ['red', 'gold', 'green', 'cyan'][(this.rng.next() * 4) | 0] });
    }
    const floor = ARENA.cy + ARENA.hh;
    for (const c of (this._candies ?? [])) {
      c.vy += 900 * dt;   // 伪横版重力
      c.x += c.vx * dt; c.y += c.vy * dt;
      if (c.y > floor && c.bounces > 0) {
        c.y = floor; c.vy = -c.vy * 0.55; c.bounces--;
      }
      if (c.y > floor && c.bounces <= 0) {
        // 落定炸开 4 向小弹
        for (let i = 0; i < 4; i++) this._shot(c.x, c.y, i * Math.PI / 2 + Math.PI / 4, 2.0, { color: c.color, radius: 5 });
        c.t = 0;
      }
      c.t -= dt;
    }
    this._candies = (this._candies ?? []).filter((c) => c.t > 0);
  }

  _tickRage(dt: number) {
    // 狂暴合奏：环形 + 扇 + 南瓜雨三线叠加，1.3× 节奏（BGM 高潮对齐这里）
    this._emit += dt;
    const k = 1 / 1.3;
    if (this._emit > 1.15 * k) { this._emit = 0; this._ring(this._alt % 2 ? 'vanilla' : 'choco', 30, 3.6, 'red'); this._alt++; }
    this._fanT = (this._fanT ?? 0) + dt;
    if (this._fanT > 1.4 * k) { this._fanT = 0; this._fan('choco'); this._fan('vanilla'); }
    this._pkT = (this._pkT ?? 0) + dt;
    if (this._pkT > 0.7 * k) { this._pkT = 0; this._pumpkin(); }
  }

  update(dtReal: number) {
    if (this.over) return;
    const dt = dtReal * this.timeScale;
    this.t += dt;

    // 黑屏换场：t<0 期间只走计时（渲染层按 t 画黑幕），t 过 0 的瞬间
    // 场景变亮 + BGM 起（用户："bgm也是场景变亮之后放"）
    if (this.t < 0) return;
    if (!this._bgmOn) {
      this._bgmOn = true;
      this.cues.playScene('halloween');   // 原曲 Mischievous Masquerade（wav 直播）
    }

    // 白闪按规则时间衰减。
    this.flash = Math.max(0, this.flash - dt * 1.8);

    // 定时队列（弹墙分波 / 灯珠字母逐列点亮）
    if (this._q.length) {
      const keep = [];
      for (const e of this._q) { if (e.at <= this.t) e.fn(); else keep.push(e); }
      this._q = keep;
    }

    this._tickBeadSplash();

    // 南瓜落地/爆风
    for (const pk of this.pumpkins) {
      if (pk.t > 0) {
        pk.t -= dt;
        if (pk.t <= 0) {
          pk.boom = PUMPKIN_CROSS.duration;
          pk.age = 0;           // 爆后时间：渲染层据此做"生长 → 判定期 → 余辉淡出"
          this.sfx('etc13', 0.25);   // 原版爆风音
          for (let i = 0; i < 4; i++) {
            this._shot(pk.x, pk.y, i * Math.PI / 2, 3.0, { color: 'amber', radius: 8, range: 420 });
          }
        }
      } else {
        pk.age = (pk.age ?? 0) + dt;
        // 判定窗口仍是 0.35s（boom）；age 超过它之后只是视觉余辉，**不再伤人**
        if (pk.boom > 0) {
          pk.boom -= dt;
          // 爆风持续判定：十字线附近 30px 内的玩家吃 10% 真伤
          for (const pl of this.context.world.players()) {
            if (!pl || pl.dead || pl.downed || pl.invuln > 0) continue;
            const dx = pl.x - pk.x, dy = pl.y - pk.y;
            if ((Math.abs(dx) < PUMPKIN_CROSS.halfWidth || Math.abs(dy) < PUMPKIN_CROSS.halfWidth) && Math.hypot(dx, dy) < PUMPKIN_CROSS.radius) this.hitProfile.hit(pl, pk.x, pk.y);
          }
        }
      }
    }
    // 余辉 0.9s 才移除（用户："十字火焰断的有点太明显了，稍微过渡一丢丢"）
    this.pumpkins = this.pumpkins.filter((pk) => pk.t > 0 || (pk.age ?? 0) < PUMPKIN_CROSS.afterglow);

    // 时间轴推进
    if (this.phaseIdx < this.sections.length) {
      const sec = this.sections[this.phaseIdx];
      const step = Math.min(dt, sec.dur - this.phaseT);
      // 离开 laser 节后仍推进残留激光寿命，防止它们永久冻结。
      if (sec.name !== 'laser' && this.waves.length) {
        this.waves = this.waves.filter((b) => (b.t -= dt) > 0);
      }
      // 灯珠单词开场 1.6 秒独奏，避免其他攻击遮住字形。
      if (!(sec.word && this.phaseT < 1.6)) {
        sec.tick.call(this, dt, this.t);
        if (!NO_CORNER_SECTIONS.has(sec.name)) this._tickCorners(dt);
      }
      this.phaseT += step;
      if (this.phaseT >= sec.dur) { this.phaseIdx++; this.phaseT = 0; this._emit = 0; }
    } else {
      // outro：收招挥手 → 飞向月亮离场 → 胜利
      this.outroT = (this.outroT ?? 0) + dt;
      this.cats.choco.y = CAT_Y - this.outroT * 130;
      this.cats.vanilla.y = CAT_Y + 26 - this.outroT * 150;
      this.cats.choco.x += 60 * dt; this.cats.vanilla.x += 90 * dt;
      if (this.outroT > 4.2) this.finish('beat');
      return;
    }

    // 切节时更新招式名，并产生该节的灯珠字母。
    const curSec = this.sections[this.phaseIdx];
    if (curSec && curSec.spell !== this.curSpell) {
      this.curSpell = curSec.spell;
      if (curSec.word) this._spawnWord(curSec.word);   // 换招 → 灯珠单词坠落
    }

    // 帧动画推进（待机/施法循环；狂暴期固定攻击帧）
    for (const who of ['choco', 'vanilla'] as const) {
      const c = this.cats[who];
      c.ft += dt;
      const casting = this.phaseIdx >= 1;
      const frames = casting && this.phaseIdx >= 10 ? CAST_F : casting ? [10, 11, 12, 13] : IDLE_F;
      if (c.ft > 0.14) { c.ft = 0; c.frame = frames[(frames.indexOf(c.frame) + 1) % frames.length] ?? frames[0]; }
    }

    // 玩家全队失去战斗力 → 战败
    const team = this.context.world?.players?.() ?? [this.context.player];
    if (team.every((pl) => !pl || pl.dead || pl.downed)) { this.finish('death'); }

  }

  finish(outcome: ChallengeOutcome) {
    if (this.over) return;
    this.over = true;
    try { this.cues.stopMusic(); } catch { /* */ }

    this.onDone(outcome);
  }

  sfx(name: string, minGap = 0.18) {
    if (this.t - (this._sfxAt.get(name) ?? -9) < minGap) return;
    this._sfxAt.set(name, this.t);
    this.cues.play(`halloween_${name}`);
  }
}
