import type { ChallengeController, ChallengeFrame, ChallengeObservation, ChallengeSession } from './types.ts';
import type { EncounterView } from '../views.ts';
import { challengeDisplay } from './display-values.ts';
import type { IncomingHitProfile } from '../combat/incoming-hit.ts';
import { proportionalHit } from './damage-policy.ts';
import { ChallengePlayerPolicy } from './player-policy.ts';
import type { EnemyShot } from '../actors/bullet.ts';
interface Dancer { x: number; y: number; frame?: number; ft: number; alpha: number; spriteId?: string }
interface RemiliaState { base?: number; acc?: number; orb?: number; dir?: number; ff?: number; fr?: number; fs?: number; in?: number; sweep?: number; th?: number; cols?: { a: number; w: number; spd: number; col: string; r: number }[] }
interface RemiliaCard { id: string; name: string; dur: number; tick(this: RemiliaFight, dt: number, elapsed: number): void }
import type { ControllerContext, ControllerOptions, ChallengeOutcome, Arena } from './types.ts';
import type { RNG } from '../math/random.ts';
import { PurgeField } from './purge-field.ts';
import { FLANDRE_ARENA as REMILIA_ARENA } from './arenas.ts';
import { encounterCues } from './cues.ts';
// 蕾米与芙兰的无敌演出：2.5 秒入场、54 秒六段符卡、3.5 秒退场。
// 两者不设受击躯体；玩家仍需躲避按最大生命比例结算的弹幕。
// 符卡出处：红魔乡 ecldata5.ecl 103–117；24 帧素材来自 stg6enm2.anm。
import { TAU } from '../math/geometry.ts';




export const REMILIA_INTRO = 2.5;      // 蕾米飞入 + 芙兰起身
export const REMILIA_OUTRO = 3.5;      // 双人升空退场
export const REMILIA_CARDS = 54;       // 六段符卡总时长
export const REMILIA_TOTAL = REMILIA_INTRO + REMILIA_CARDS + REMILIA_OUTRO;   // 60s

export const REMI_IDLE = [0, 1, 2, 3, 4, 5, 6, 7];
export const REMI_CAST = [10, 11, 12, 13];
export const REMI_CHANT = [14, 15, 16, 17, 18, 19];

export const FLAN_FLY = ['flandre', 'flandre_idle2', 'flandre_idle3', 'flandre_idle4'];

/** 六段符卡：每段 { id, name, dur, tick } —— tick 里只发弹/推进节拍，位置统一由 _moveBosses 管 */
const CARDS: RemiliaCard[] = [
  {
    id: 'vanity',
    name: '天罰「スターオブヴァニティーズ」',
    dur: 8,
    // 四臂十字，每臂 5 发小组；基础角连续旋转（原作角度变量 +0.2/次 的味道，这里放大一点更好看）
    tick(dt) {
      const st = this.st;
      st.base = (st.base ?? 0) + dt * 0.62;
      st.acc = (st.acc ?? 0) + dt;
      if (st.acc >= 1.12) {
        st.acc -= 1.12;
        const b = this.posOf('remilia');
        for (let arm = 0; arm < 4; arm++) {
          const a0 = st.base + (arm * TAU) / 4;
          for (let i = 0; i < 4; i++) {
            const a = a0 + (i - 1.5) * 0.13;
            this.shot(b.x, b.y, a, 150, {
              color: i % 2 ? '#ff3050' : '#ffe0ea', radius: 7, hitRadius: 5, shape: 'orb', range: 1500,
            });
          }
        }
        this.cues.play('flandreShot');
      }
      // 大玉：每 2.6 秒一圈 8 颗，速度很慢，逼玩家绕开
      st.orb = (st.orb ?? 0) + dt;
      if (st.orb >= 3.1) {
        st.orb -= 3.1;
        const bo = this.posOf('remilia');
        const rb = this.rng.next() * TAU;
        for (let i = 0; i < 6; i++) this.bigOrb(bo.x, bo.y, rb + (i * TAU) / 6, 92, { radius: 28, hitRadius: 9 });
        this.cues.play('flandreShot');
      }
      this.flanRing(dt, 2.0, 20, 125, '#ff7f9f', 6);
    },
  },
  {
    id: 'demonlord',
    name: '神罰「幼きデーモンロード」',
    dur: 9,
    // 三束慢速旋转弹列：随机起点角 + 固定角速（0.9 / -0.7 / 1.3 rad/s），速度 30 / 60 / 90
    tick(dt) {
      const st = this.st;
      st.cols = st.cols ?? [
        { a: this.rng.next() * TAU, w: 0.9, spd: 30, col: '#ff3050', r: 6 },
        { a: this.rng.next() * TAU, w: -0.7, spd: 60, col: '#ffb0c8', r: 5 },
        { a: this.rng.next() * TAU, w: 1.3, spd: 90, col: '#ffd9e6', r: 4.5 },
      ];
      for (const c of st.cols) c.a += c.w * dt;
      st.acc = (st.acc ?? 0) + dt;
      if (st.acc >= 0.36) {
        st.acc -= 0.36;
        const b = this.posOf('remilia');
        for (const c of st.cols) {
          for (const off of [-0.05]) {
            const jitter = (this.rng.next() * 2 - 1) * 0.06;
            this.shot(b.x, b.y, c.a + off + jitter, c.spd, { color: c.col, radius: c.r, hitRadius: c.r * 0.62, shape: 'rice', range: 1600 });
          }
        }
      }
      // 大玉：三连瞄准散布（原版幼きデーモンロード里那几颗慢悠悠的大球）
      st.orb = (st.orb ?? 0) + dt;
      if (st.orb >= 1.9) {
        st.orb -= 1.9;
        const bo = this.posOf('remilia');
        const pl = this.context.player;
        const aim = Math.atan2(pl.y - bo.y, pl.x - bo.x);
        for (let i = -1; i <= 1; i++) this.bigOrb(bo.x, bo.y, aim + i * 0.26, 105, { radius: 27, hitRadius: 9 });
        this.cues.play('flandreShot');
      }
      this.flanFan(dt, 1.1, 7, 0.42, 210, '#ff7f9f', 5.5);
      this.flanRing(dt, 3.0, 22, 100, '#ffd166', 5.5);
    },
  },
  {
    id: 'netherworld',
    name: '冥符「紅色の冥界」',
    dur: 9,
    // 双向对旋螺旋：两条从她身侧反向旋转的弹链，速度 108 起、带轻微加速
    tick(dt) {
      const st = this.st;
      st.th = (st.th ?? 0) + dt * 1.5;
      st.acc = (st.acc ?? 0) + dt;
      if (st.acc >= 0.145) {
        st.acc -= 0.145;
        const b = this.posOf('remilia');
        for (const side of [-1, 1]) for (const k of [0, 0.14]) {
          const a = Math.PI / 2 + side * (st.th + k) * 0.62;
          this.shot(b.x + side * 34, b.y, a, 108, {
            color: side < 0 ? '#ff3050' : '#c81e3c', radius: 6, hitRadius: 4.4, shape: 'orb', range: 1700,
            decel: -55, floorSpeed: 210,
          });
        }
      }
      st.orb = (st.orb ?? 0) + dt;
      if (st.orb >= 2.3) {
        st.orb -= 2.3;
        const bo = this.posOf('remilia');
        for (const side of [-1, 1]) this.bigOrb(bo.x + side * 40, bo.y, Math.PI / 2 + side * 0.5, 118, { radius: 30, hitRadius: 9.5 });
        this.cues.play('flandreShot');
      }
      this.flanRing(dt, 1.7, 16, 150, '#ffd166', 5);
    },
  },
  {
    id: 'needle',
    name: '獄符「千本の針の山」',
    dur: 9,
    // 八发一组扇形，扫射角快速左右摆动（±1.9 rad/s），细长针弹
    tick(dt) {
      const st = this.st;
      st.sweep = (st.sweep ?? -0.9) + dt * 1.9 * (st.dir ?? 1);
      if (st.sweep > 0.9) { st.sweep = 0.9; st.dir = -1; }
      if (st.sweep < -0.9) { st.sweep = -0.9; st.dir = 1; }
      st.acc = (st.acc ?? 0) + dt;
      if (st.acc >= 0.31) {
        st.acc -= 0.31;
        const b = this.posOf('remilia');
        const base = Math.PI / 2 + st.sweep;
        for (let i = 0; i < 9; i++) {
          const a = base + (i - 4) * 0.11;
          this.shot(b.x, b.y, a, 205, { color: i % 2 ? '#ff3050' : '#ffb0c8', radius: 5.4, hitRadius: 3.6, shape: 'blade', range: 1700 });
        }
        this.cues.play('flandreShot');
      }
      st.orb = (st.orb ?? 0) + dt;
      if (st.orb >= 2.7) {
        st.orb -= 2.7;
        const bo = this.posOf('remilia');
        const pl = this.context.player;
        this.bigOrb(bo.x, bo.y, Math.atan2(pl.y - bo.y, pl.x - bo.x), 130, { radius: 28, hitRadius: 9 });
        this.cues.play('flandreShot');
      }
      this.flanFan(dt, 1.4, 7, 0.3, 230, '#ffd9e6', 5);
    },
  },
  {
    id: 'shoot',
    name: '紅符「スカーレットシュート」',
    dur: 9,
    // 九发高速直视连发（原作 6.2px/帧 ≈ 372px/s），每 0.85 秒一次齐射，越到后面越密
    tick(dt, T) {
      const st = this.st;
      const period = T > 5 ? 0.68 : 0.98;
      st.acc = (st.acc ?? 0) + dt;
      if (st.acc >= period) {
        st.acc -= period;
        const b = this.posOf('remilia');
        const p = this.context.player;
        const aim = Math.atan2(p.y - b.y, p.x - b.x);
        for (let i = 0; i < 11; i++) {
          const a = aim + (i - 5) * 0.05;
          this.shot(b.x, b.y, a, 372, { color: '#ff3050', radius: 6, hitRadius: 4.2, shape: 'orb', range: 1900 });
        }
        // 齐射同时甩一圈慢环，逼人保持移动
        const rb = this.rng.next() * TAU;
        for (let i = 0; i < 12; i++) this.shot(b.x, b.y, rb + (i * TAU) / 12, 130, { color: '#ffb0c8', radius: 5.5, hitRadius: 3.6, range: 1700 });
        for (let i = -1; i <= 1; i += 2) this.bigOrb(b.x, b.y, aim + i * 0.34, 240, { radius: 26, hitRadius: 8.5 });
        this.cues.play('flandreShot');
      }
      this.flanFan(dt, 0.95, 5, 0.26, 260, '#ff7f9f', 5.5);
    },
  },
  {
    id: 'redmagic',
    name: '「レッドマジック」',
    dur: 10,
    // 最终奥义：旋转五臂大环 + 从场地外向内收束的红环 + 芙兰的星形波前，收尾全屏一红
    tick(dt) {
      const st = this.st;
      st.base = (st.base ?? 0) + dt * 0.85;
      st.acc = (st.acc ?? 0) + dt;
      if (st.acc >= 0.95) {
        st.acc -= 0.95;
        const b = this.posOf('remilia');
        for (let arm = 0; arm < 5; arm++) {
          const a0 = st.base + (arm * TAU) / 6;
          for (let i = 0; i < 4; i++) {
            const a = a0 + (i - 1.5) * 0.08;
            this.shot(b.x, b.y, a, 175, { color: i % 2 ? '#ff3050' : '#ffd9e6', radius: 7, hitRadius: 5, shape: 'orb', range: 1800 });
          }
        }
      }
      st.in = (st.in ?? 0) + dt;
      if (st.in >= 2.5) {
        st.in -= 2.5;
        const b = this.posOf('remilia');
        const n = 24, base = this.rng.next() * TAU;
        for (let i = 0; i < n; i++) {
          const a = base + (i * TAU) / n;
          const R = 720;
          // 从场地外朝圆心收束（视觉上是"红雾从四周压进来"）
          this.shot(b.x + Math.cos(a) * R, b.y + Math.sin(a) * R, a + Math.PI, 150, {
            color: '#c81e3c', radius: 6.5, hitRadius: 4.6, shape: 'rice', range: 1100,
          });
        }
      }
      st.orb = (st.orb ?? 0) + dt;
      if (st.orb >= 2.4) {
        st.orb -= 2.4;
        const bo = this.posOf('remilia');
        const rb = this.rng.next() * TAU;
        for (let i = 0; i < 8; i++) this.bigOrb(bo.x, bo.y, rb + (i * TAU) / 8, 100, { radius: 29, hitRadius: 9.5 });
        this.cues.play('flandreShot');
      }
      this.flanStar(dt, 1.7, '#ffd166');
      this.flanRing(dt, 2.1, 18, 170, '#ff7f9f', 5.5);
    },
  },
];

export class RemiliaFight implements ChallengeController {
  readonly rules = Object.freeze({ blocksWeather: true, disablesPetAttack: false, suppressesTrueDamage: false, disablesPhantoms: false });
  readonly capabilities: Pick<ChallengeSession, 'guard' | 'purge' | 'displayTiming'> = Object.freeze({
    guard: null,
    purge: Object.freeze({ manual: () => this.tryManualPurge() }),
    displayTiming: null,
  });
  readClock() { return { overridden: false, timer: null }; }
  advance(dt: number) { this.update(dt); }
  dispose() { this.over = true; this.timeScale = 1; }
  readCombat(): ChallengeObservation {
    return { bodyId: null, target: null, guarding: false, movement: 'survival', purgeReady: false, lasers: [], crosses: [] };
  }
  readFrame(): ChallengeFrame {
    const fight = this, kind = this.kind, arena = this.arena;
    const { actors, projectiles, effects, telegraphs, actor, effect } = challengeDisplay(kind);
    const base = { state: String(fight.phase), time: fight.t, introTime: Math.max(0, -fight.t),
      arena: { x: arena.cx, y: arena.cy, halfWidth: arena.hw, halfHeight: arena.hh },
      hp: 0, maxHp: 0, boss: { x: arena.cx, y: arena.cy }, flash: fight.flash, fade: fight.fade };
    const encounter: EncounterView = { ...base, kind, boss: { x: fight.b.remilia.x, y: fight.b.remilia.y }, animationFrame: fight.b.remilia.frame, alpha: fight.b.remilia.alpha, title: fight.cardInfo.name, sigil: fight.phase === 'cards' ? 1 : 0,
      ending: fight.phase === 'outro' ? Math.min(1, (fight.t - 56.5) / 3.5) : 0,
      bats: fight.bats.map(bat => ({
        x: arena.cx + Math.cos(bat.a) * 560 * bat.r,
        y: arena.cy + Math.sin(bat.a) * 560 * bat.r * .55,
        width: 26 * bat.s,
        height: 26 * bat.s * .62 * (.55 + .45 * Math.sin(fight.t * 13 + bat.ph)),
        alpha: .55 + .35 * Math.sin(fight.t * 2 + bat.ph),
      })) };
    actor('flandre', fight.b.flandre.spriteId ?? 'flandre', fight.b.flandre);
    if (fight.nova) effect('nova', { ...fight.nova, alpha: 0.8 }, 'ring', '#ffe9a8', fight.nova.r);

    return { encounter, actors, projectiles, effects, telegraphs };
  }

  declare b: { remilia: Dancer; flandre: Dancer };
  declare st: RemiliaState;
  declare bats: { a: number; r: number; spd: number; ph: number; s: number }[];

  declare playerPolicy: ChallengePlayerPolicy;
  declare hitProfile: IncomingHitProfile;
  declare context: ControllerContext;
  declare kind: 'remilia';
  declare arena: Arena;
  declare cues: ReturnType<typeof encounterCues>;
  declare purge: PurgeField;
  declare onDone: ControllerOptions["onDone"];
  declare over: boolean;
  declare timeScale: number;
  declare t: number;
  declare rng: RNG;
  declare orbit: number;
  declare orbitSpeed: number;
  declare cardIdx: number;
  declare cardT: number;
  declare flash: number;
  declare fade: number;
  declare bgmOn: boolean;
  constructor(main: ControllerContext, opts: ControllerOptions) {
    this.context = main;
    this.playerPolicy = new ChallengePlayerPolicy({ primary: main.player, speedMultiplier: 1.2 });
    this.kind = 'remilia'; this.arena = REMILIA_ARENA;
    this.cues = encounterCues(main.effects);
    this.purge = new PurgeField({ world: main.world, player: main.player, cues: this.cues, shake: main.shake, accepts: bullet => bullet.hitProfile === this.hitProfile });
    this.hitProfile = proportionalHit({ fraction: 0.10, ignoreDowned: false, onApplied: () => this.autoPurge() });
    this.onDone = opts.onDone;
    this.over = false;
    this.timeScale = 1;
    this.t = -(opts.chain ? 3 : 1.2);     // 负值 = 黑屏换场（与万圣节同口径）
    this.rng = main.world.rng.fork(0x5e9e77e);

    // 两人各占一个位置：蕾米 = 主角，芙兰 = 对角（一左一右、一上一下）
    this.b = {
      remilia: { x: REMILIA_ARENA.cx + 520, y: REMILIA_ARENA.cy - 420, frame: 0, ft: 0, alpha: 0 },
      flandre: { x: REMILIA_ARENA.cx - 520, y: REMILIA_ARENA.cy + 180, spriteId: FLAN_FLY[0], ft: 0, alpha: 0 },
    };
    this.orbit = 0;
    this.orbitSpeed = 0.55;
    this.cardIdx = -1;
    this.cardT = 0;
    this.st = {};
    this.flash = 0;          // 全屏白/红闪
    // 黑屏进入正片后淡出，避免直接跳场。
    this.fade = 1;
    this.bgmOn = false;
    this._buildBats();
  }

  // 与后续符卡共用 RNG；投影复用这些真实轨道，不另外生成显示蝙蝠。
  _buildBats() {
    this.bats = [];
    for (let i = 0; i < 26; i++) {
      this.bats.push({
        a: this.rng.next() * TAU,
        r: 0.45 + this.rng.next() * 0.75,
        spd: 0.35 + this.rng.next() * 0.75,
        ph: this.rng.next() * TAU,
        s: 0.55 + this.rng.next() * 0.7,
      });
    }
  }

  get phase() {
    if (this.t < 0) return 'blackout';
    if (this.t < REMILIA_INTRO) return 'intro';
    if (this.t < REMILIA_INTRO + REMILIA_CARDS) return 'cards';
    return 'outro';
  }

  /** 某个角色的世界坐标 */
  posOf(who: 'remilia' | 'flandre') { return this.b[who] ?? this.b.remilia; }

  /**
   * 双人镜像走位：
   * 蕾米在椭圆上按 this.orbit 取点，芙兰取对角（+π）—— 天然满足"一个在左另一个就在右、一个在上另一个就在下"。
   * 再叠一点的垂直呼吸，让两人像在"飞"而不是沿轨道滑。
   */
  _moveBosses(dt: number) {
    const A = this.arena;
    const ph = this.phase;
    if (ph === 'blackout') return;
    const R = this.b.remilia, F = this.b.flandre;
    // 段落推进：越到后面转得越快、半径越大（压迫感递增）
    const prog = ph === 'cards' ? Math.min(1, Math.max(0, (this.t - REMILIA_INTRO) / REMILIA_CARDS)) : 0;
    this.orbitSpeed = 0.5 + prog * 0.55;
    this.orbit += dt * this.orbitSpeed;
    const rx = A.hw * (0.6 + prog * 0.09);
    const ry = A.hh * (0.52 + prog * 0.07);

    let tx, ty, fx, fy;
    if (ph === 'intro') {
      // 蕾米从右上飞入；芙兰原地待机（已经是飞行姿势）
      const u = Math.min(1, Math.max(0, this.t / REMILIA_INTRO));
      const e = 1 - (1 - u) * (1 - u);
      tx = A.cx + (1 - e) * 640;
      ty = A.cy - 300 - (1 - e) * 260;
      fx = A.cx - 300;
      fy = A.cy + 130;
      R.alpha = Math.min(1, u * 1.6);
      // 芙兰与蕾米一同渐显。
      F.alpha = Math.min(1, u * 1.6);
    } else if (ph === 'outro') {
      const u = Math.min(1, Math.max(0, (this.t - REMILIA_INTRO - REMILIA_CARDS) / REMILIA_OUTRO));
      tx = R.x; ty = R.y - u * u * 620;
      fx = F.x; fy = F.y - u * u * 720;
      R.alpha = 1 - u * 0.85;
      F.alpha = 1 - u * 0.85;
    } else {
      tx = A.cx + Math.cos(this.orbit) * rx;
      ty = A.cy + Math.sin(this.orbit) * ry * 0.62 - 40 + Math.sin(this.orbit * 2.1) * 26;
      fx = A.cx + Math.cos(this.orbit + Math.PI) * rx;
      fy = A.cy + Math.sin(this.orbit + Math.PI) * ry * 0.62 - 40 + Math.sin(this.orbit * 2.1 + Math.PI) * 26;
      // 正戏两人必须完全不透明（alpha 初值 0 是给飞入渐显用的；只在 intro 里置 1 的话，
      // 任何跳过 intro 的路径——测试直接改 t、读档、调试——都会让蕾米一直隐形）
      R.alpha = 1;
      F.alpha = 1;
    }
    // 平滑跟随（飞的感觉，不是瞬移）；intro 段蕾米自己从外面飞进来，别被 lerp 拉回
    const k = ph === 'intro' ? 1 : Math.min(1, dt * 3.2);
    R.x += (tx - R.x) * k;
    R.y += (ty - R.y) * k;
    F.x += (fx - F.x) * (ph === 'intro' ? Math.min(1, dt * 2.2) : k);
    F.y += (fy - F.y) * (ph === 'intro' ? Math.min(1, dt * 2.2) : k);


    // 换段初期使用咏唱帧，其余施法段使用施法帧。
    R.ft += dt;
    const casting = ph === 'cards';
    const pool = casting ? (this.cardT < 0.7 ? REMI_CHANT : REMI_CAST) : REMI_IDLE;
    R.frame = pool[Math.floor(R.ft / 0.26) % pool.length];
    F.ft += dt;
    // 芙兰入场即使用飞行帧。
    F.spriteId = FLAN_FLY[Math.floor(F.ft / 0.3) % FLAN_FLY.length];
  }

  get nova() { return this.purge.nova; }
  tryManualPurge() { if (!this.over) return this.purge.manual(); return false; }
  autoPurge() { if (!this.over) this.purge.start(true); }

  _purgeUpdate(dt: number) { this.purge.advance(dt); }

  // 大玉使用独立命中半径，外部视觉圆环不参与判定。
  bigOrb(x: number, y: number, angle: number, speed: number, opts: Partial<EnemyShot> = {}) {
    return this.shot(x, y, angle, speed, {
      color: opts.color ?? '#ff2040',
      shape: 'jade',
      jadeColor: opts.jadeColor ?? '#ff2040',
      radius: opts.radius ?? 30,
      hitRadius: opts.hitRadius ?? 9.5,
      range: opts.range ?? 1900,
    });
  }

  // 发弹原语
  shot(x: number, y: number, angle: number, speed: number, opts: Partial<EnemyShot> = {}) {
    const w = this.context?.world;
    if (!w) return null;
    if (w.enemyBullets.items.length >= 1100) return null;
    return w.spawnEnemyBullet({
      x, y, angle, speed,
      damage: 0,
      radius: opts.radius ?? 6,
      hitRadius: opts.hitRadius ?? (opts.radius ?? 6) * 0.62,
      color: opts.color ?? '#ff3050',
      range: (opts.range ?? 1600) * 2,
      shape: opts.shape ?? 'orb',
      jadeColor: opts.jadeColor,
      decel: opts.decel ?? 0,
      floorSpeed: opts.floorSpeed ?? 0,
      hitProfile: this.hitProfile,
    });
  }

  /** 芙兰的环形弹（从她自己的位置放） */
  flanRing(dt: number, period: number, n: number, speed: number, color: string, r: number) {
    const st = this.st;
    st.fr = (st.fr ?? 0) + dt;
    if (st.fr < period) return;
    st.fr -= period;
    const b = this.posOf('flandre');
    const base = this.rng.next() * TAU;
    for (let i = 0; i < n; i++) this.shot(b.x, b.y, base + (i * TAU) / n, speed, { color, radius: r, hitRadius: r * 0.6, range: 1700 });
  }

  /** 芙兰的瞄准扇 */
  flanFan(dt: number, period: number, n: number, spread: number, speed: number, color: string, r: number) {
    const st = this.st;
    st.ff = (st.ff ?? 0) + dt;
    if (st.ff < period) return;
    st.ff -= period;
    const b = this.posOf('flandre');
    const p = this.context.player;
    const aim = Math.atan2(p.y - b.y, p.x - b.x);
    for (let i = 0; i < n; i++) {
      const a = aim + (i - (n - 1) / 2) * (spread / Math.max(1, n - 1));
      this.shot(b.x, b.y, a, speed, { color, radius: r, hitRadius: r * 0.6, shape: 'rice', range: 1800 });
    }
  }

  /** 芙兰的星形波前（五角星轮廓，带星门缺口 —— 她的禁弹签名） */
  flanStar(dt: number, period: number, color: string) {
    const st = this.st;
    st.fs = (st.fs ?? 0) + dt;
    if (st.fs < period) return;
    st.fs -= period;
    const b = this.posOf('flandre');
    const p = this.context.player;
    const rot = this.rng.next() * TAU;
    const NB = 44;
    const towards = Math.atan2(p.y - b.y, p.x - b.x);
    for (let i = 0; i < NB; i++) {
      const th = rot + (i * TAU) / NB;
      let d = th - towards;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      if (Math.abs(d) < 0.28) continue;          // 星门：留一条可钻的缝
      this.shot(b.x, b.y, th, 165, { color, radius: 5.6, hitRadius: 3.4, shape: 'star', range: 1900 });
    }
  }

  update(dtReal: number) {
    if (this.over) return;
    const dt = dtReal * this.timeScale;
    this.t += dt;
    // 换场过渡：黑屏期间全黑，进入正片后 0.9 秒淡出（用户要的"慢慢加个过渡画面"）
    this.fade = this.t < 0 ? 1 : Math.max(0, 1 - this.t / 0.9);
    if (this.t < 0) return;      // 黑屏换场期间只走计时

    if (!this.bgmOn) {
      this.bgmOn = true;
      this.cues.playScene?.('remilia');
    }

    this.flash = Math.max(0, this.flash - dt * 2.2);

    this._purgeUpdate(dt);
    this._moveBosses(dt);

    // 段落推进
    if (this.phase === 'cards') {
      const rel = this.t - REMILIA_INTRO;
      let acc = 0, idx = 0;
      for (let i = 0; i < CARDS.length; i++) {
        if (rel < acc + CARDS[i].dur) { idx = i; break; }
        acc += CARDS[i].dur;
        idx = i;
      }
      if (idx !== this.cardIdx) {
        this.cardIdx = idx;
        this.st = {};                        // 每段独立状态
        this.flash = 0.3;
        this.cues.play('spellCard');
      }
      const c = CARDS[idx];
      this.cardT = rel - acc;
      c.tick.call(this, dt, this.cardT);
    } else if (this.phase === 'outro') {
      if (this.t >= REMILIA_TOTAL) this.finish('done');
    }

    // 蝙蝠群
    for (const bt of this.bats) bt.a += dt * bt.spd;

    // 玩家全灭 → 演出结束（挑战失败，回商店整备）
    const team = this.context?.world?.players?.() ?? [this.context?.player];
    // downed 是状态，不能用 down 方法判断全队倒地。
    if (team.every((pl) => !pl || pl.dead || pl.downed) && this.t > REMILIA_INTRO) {
      this.finish('death');
    }
  }

  finish(outcome: ChallengeOutcome) {
    if (this.over) return;
    this.over = true;
    try { this.onDone(outcome); } catch { /* 结算异常不影响主循环 */ }
  }

  /** 供渲染层：当前段的卡名与进度 */
  get cardInfo() {
    if (this.cardIdx < 0) return { name: '', idx: 0, n: CARDS.length };
    return { name: CARDS[this.cardIdx].name, idx: this.cardIdx, n: CARDS.length };
  }
}

export const REMILIA_CARDS_INFO = CARDS.map((c) => ({ id: c.id, name: c.name, dur: c.dur }));
