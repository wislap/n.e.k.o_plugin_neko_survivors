import { FLANDRE_LASER } from './hazards.ts';
import type { ChallengeController, ChallengeFrame, ChallengeObservation, ChallengeSession } from './types.ts';
import type { EncounterView } from '../views.ts';
import { challengeDisplay } from './display-values.ts';
import type { IncomingHitProfile } from '../combat/incoming-hit.ts';
import { proportionalHit } from './damage-policy.ts';
import { ChallengePlayerPolicy } from './player-policy.ts';
import { createSpell } from './flandre-types.ts';
import type { Spell, SpellId } from './flandre-types.ts';
import type { EnemyShot, BulletShape } from '../actors/bullet.ts';
import type { ControllerContext, ControllerOptions, ChallengeOutcome, Arena } from './types.ts';
import type { RNG } from '../math/random.ts';
import { PurgeField } from './purge-field.ts';
import { FLANDRE_ARENA as ARENA } from './arenas.ts';
import { EnemyBody } from '../actors/enemy.ts';
import { getEnemy } from '../content/enemies.ts';
import { TAU } from '../math/geometry.ts';
import { encounterCues } from './cues.ts';
import { SPELLS } from './flandre-patterns.ts';
import { ruleBudget } from '../platform.ts';
import { FLANDRE_MAX_HP, PROLOGUE_CARD_TIME, CARD_TIME, CARD_HP_FRAC, CARDS_TOTAL, EXTRA_TIME, EXTRA_CARD_TIME, EXTRA_HEART_TIME, SWITCH_LOCK, HIT_FRAC, CULL_MARGIN, LEAD, COLORS, SILENCE_END, SHAKE_AT, CARD_AT, PROLOGUE_END, CARD_POOL, EXTRA_SPELLS, CARD_INFO, SIT_FRAMES, IDLE_FRAMES, STAGE_DY, EP_AT_TIMEOUT } from './flandre-definition.ts';

export class FlandreFight implements ChallengeController {
  readonly rules = Object.freeze({ blocksWeather: true, disablesPetAttack: true, suppressesTrueDamage: true, disablesPhantoms: true });
  readonly capabilities: Pick<ChallengeSession, 'guard' | 'purge' | 'displayTiming'> = Object.freeze({
    guard: null,
    purge: Object.freeze({ manual: () => this.tryManualPurge() }),
    displayTiming: Object.freeze({ sample: (seconds: number) => this.sampleDisplayInterval(seconds) }),
  });
  readClock() { return { overridden: true, timer: this.getDisplayTimer() }; }
  advance(dt: number) { this.update(dt); }
  dispose() { this.over = true; if (this.boss) this.boss.dead = true; this.timeScale = 1; }
  readCombat(): ChallengeObservation {
    const boss = this.boss;
    const lasers = (this.spell?.id === 'laevateinn' ? this.spell.st.lasers ?? [] : []).map(laser => ({
      x: laser.x, y: laser.y, angle: laser.angle, angularVelocity: laser.angVel,
      activeAfter: Math.max(0, laser.warn),
      activeFor: laser.warn > 0 ? FLANDRE_LASER.sweep + FLANDRE_LASER.fade * (1 - FLANDRE_LASER.damageFadeThreshold)
        : Math.max(0, laser.life - FLANDRE_LASER.fade * FLANDRE_LASER.damageFadeThreshold),
      length: laser.len, halfWidth: laser.width + this.context.player.radius,
      sweepAngle: laser.warn > 0 ? laser.sweep : laser.angVel * Math.max(0, laser.life - FLANDRE_LASER.fade),
    }));
    return { bodyId: boss?.id ?? null, target: boss ? { id: boss.id, x: boss.x, y: boss.y, dead: boss.dead } : null,
      guarding: false, movement: boss ? 'duel' : 'teaching',
      purgeReady: !this.over && this._hinted && this.purgeCd <= 0 && !this.nova, lasers, crosses: [] };
  }
  readFrame(): ChallengeFrame {
    const fight = this, kind = this.kind, arena = this.arena;
    const { actors, projectiles, effects, telegraphs, actor, effect, line } = challengeDisplay(kind);
    const base = { state: String(fight.phase), time: fight.t, introTime: Math.max(0, -fight.t),
      arena: { x: arena.cx, y: arena.cy, halfWidth: arena.hw, halfHeight: arena.hh },
      hp: fight.boss?.hp ?? 0, maxHp: fight.boss?.maxHp ?? 0, boss: { x: fight.boss?.x ?? fight.bx, y: fight.boss?.y ?? fight.by }, flash: 0, fade: 0 };
    const spell = fight.spell;
    const encounter: EncounterView = { ...base, kind, cardId: fight.spell?.id ?? '', cardName: fight.spellName ?? '',
      declaration: Math.max(0, 1 - (fight.spell?.t ?? 5) / 3), purgeCooldown: fight.purgeCd };
    if (fight.boss && !fight.boss.flandreHidden) actor('boss', fight.boss.spriteId ?? fight.boss.def.id, fight.boss);
    for (const [i, clone] of (spell?.id === 'fourkind' ? spell.st.clones ?? [] : []).entries()) actor(`clone-${i}`, clone.spriteId ?? 'flandre', clone);
    for (const [i, laser] of (spell?.id === 'laevateinn' ? spell.st.lasers ?? [] : []).entries()) {
      if (laser.warn > 0 && laser.sweep) telegraphs.push({
        id: `flandre-laser-sweep-${i}`, kind: 'cone', x: laser.x, y: laser.y,
        radius: laser.len, angle: laser.angle + laser.sweep / 2, spread: Math.abs(laser.sweep), color: '#ff3c28',
        alpha: 0.07 + 0.10 * (1 - Math.min(1, laser.warn / FLANDRE_LASER.warning)),
      });
      const length = laser.len * (laser.warn > 0 ? 1 : Math.min(1, (laser.age ?? 1) / FLANDRE_LASER.growth));
      line(`laser-${i}`, laser.x, laser.y, laser.x + Math.cos(laser.angle) * length,
        laser.y + Math.sin(laser.angle) * length, laser.width * (laser.warn > 0 ? 0.2 : 2), '#ff5064', laser.warn > 0 ? 0.4 : laser.fade ?? 1);
    }
    for (const [i, emitter] of (spell?.st.vis ?? []).entries()) effect(`emitter-${i}`, { ...emitter, alpha: emitter.alpha ?? emitter.a ?? 0.8, variant: emitter.kind }, 'emitter', emitter.color, emitter.r ?? 15);
    if (fight.nova) effect('nova', { ...fight.nova, alpha: 0.8 }, 'ring', fight.nova.auto ? '#aef3ff' : '#ffe9a8', fight.nova.r);

    return { encounter, actors, projectiles, effects, telegraphs };
  }

  declare spell: Spell | null;
  declare cardsQueue: SpellId[];
  declare extraQueue?: SpellId[];
  declare _hintQueue: { text: string; dur?: number }[] | undefined;
  declare _bossRadiusSave?: number | null;
  declare _bossDamageSave?: number | null;
  declare timeScale: number | undefined;

  declare playerPolicy: ChallengePlayerPolicy;
  declare hitProfile: IncomingHitProfile;
  private prologueEase = 1;
  declare context: ControllerContext;
  declare kind: 'flandre';
  declare arena: Arena;
  declare budget: ReturnType<typeof ruleBudget>;
  declare _capNow: number;
  declare mobile: boolean;
  declare cues: ReturnType<typeof encounterCues>;
  declare onDone: ControllerOptions["onDone"];
  declare rng: RNG;
  declare t: number;
  declare phase: 'prologue' | 'cards' | 'extra' | 'done';
  declare over: boolean;
  declare cardsDone: number;
  declare lockLeft: number;
  declare extraLeft: number;
  declare extraCardTimer: number;
  declare extraCardsLeft: number;
  declare boss: EnemyBody | null;
  declare phaseStartHp: number;
  declare spellName: string;
  declare _warned: boolean;
  declare _named: boolean;
  declare _hinted: boolean;
  declare purge: PurgeField;
  declare _hintAt?: number;
  declare _hintDone?: number;
  declare _ema?: number;
  declare cardsElapsed?: number;
  declare _tickSec?: number | null;
  constructor(main: ControllerContext, opts: ControllerOptions) {
    this.context = main;
    this.playerPolicy = new ChallengePlayerPolicy({ primary: main.player, blocksPrimaryAttack: true, speedMultiplier: 1.2 });
    this.kind = 'flandre'; this.arena = ARENA;
    this.budget = ruleBudget(main.platform);
    this._capNow = this.budget.flandreBullets;
    this.mobile = main.platform === 'mobile';
    this.cues = encounterCues(main.effects);
    this.onDone = opts.onDone;
    this.rng = main.world.rng;
    this.t = 0;                    // 整场计时
    this.phase = 'prologue';       // prologue | cards | extra | done
    this.over = false;
    this.spell = null;             // 当前符卡 {id,name,t,dur,st,speedMul}
    this.cardsQueue = [];
    this.cardsDone = 0;            // 打败的符卡数（30 秒内打掉 25% 才算）
    this.lockLeft = 0;             // 切符卡锁血剩余
    this.extraLeft = 0;
    this.extraCardTimer = 0;
    this.extraCardsLeft = 0;
    this.boss = null;
    this.phaseStartHp = 0;
    this.spellName = '';
    // 序章旗标
    this._warned = false;
    this._named = false;
    this._hinted = false;
    // 消弹
    this.purge = new PurgeField({ world: main.world, player: main.player, cues: this.cues,
      shake: main.shake, accepts: bullet => bullet.hitProfile === this.hitProfile, onReady: () => this.petSay('人家准备好了，力量恢复了。'), onCooldown: () => this.petSay('人家还没准备好，再等等。') });
    this.hitProfile = proportionalHit({ fraction: HIT_FRAC, ignoreDowned: false,
      multiplier: player => (player.pilotBuff ? 0.25 : 1) * (player === this.context.player ? 1 : this.prologueEase),
      onApplied: () => this.autoPurge() });

  }

  /** 竞技场锚点 */
  get ax() { return ARENA.cx; }
  get ay() { return ARENA.cy; }
  get P() { return this.context.player; }
  get bx() { return this.boss ? this.boss.x : this.ax; }
  get by() { return this.boss ? this.boss.y : this.ay; }
  /** 符卡脚本里的随机数便捷入口 */
  rnd() { return this.rng.next(); }

  // ---------- 发射原语（emit 数学来自反编译规格，参考系换成本竞技场）----------

  emit(cfg: EnemyShot) {
    if (this.over) return;
    const list = this.context.world.enemyBullets;
    if (list.items.length >= this._capNow) return;   // 预算硬顶（自适应：BULLET_CAP_MIN ~ BULLET_CAP）
    // 齐射声由音频层限频。
    this.cues.play('flandreShot');
    const mul = this.spell?.speedMul ?? 1;
    this.context.world.spawnEnemyBullet({
      x: cfg.x, y: cfg.y, angle: cfg.angle,
      speed: cfg.speed * mul,
      damage: 0,             // The profile computes proportional damage at hit time.
      radius: cfg.radius ?? 6, color: cfg.color ?? COLORS.red,
      // 反弹弹需足够射程完成三次跨场。
      range: cfg.wall ? 4800 : (cfg.range ?? 1500),
      hitProfile: this.hitProfile,
      wall: cfg.wall ?? null,
      decel: cfg.decel ?? 0,
      floorSpeed: cfg.floorSpeed ?? 0,
      shape: cfg.shape ?? 'orb',
      // 大玉外圈没有判定，hitRadius 独立于视觉半径。
      hitRadius: cfg.hitRadius,
      jadeColor: cfg.jadeColor,
      tag: cfg.tag ?? '',
    });
    // 第一颗弹幕出现 → 小小猫娘提示（用户指定台词与空格教学）
    if (!this._hinted) {
      this._hinted = true;
      // 教学每句间隔 2.6 秒，避免气泡互相覆盖。
      this._hintQueue = [
        { text: '我可以用我的力量帮你！' },
        { text: '按空格键，我可以帮你清理弹幕哦' },
        { text: '按住 Shift 可以慢速移动', dur: 5000 },
      ];
      this._hintAt = this.t;
    }
  }

  // 扇形按角度均匀发射；extra 原样透传弹体参数。
  fan(x: number, y: number, angle: number, count: number, spreadDeg: number, speed: number, color: string, radius: number, shape?: BulletShape, extra?: Partial<EnemyShot>) {
    const spread = (spreadDeg * Math.PI) / 180;
    for (let i = 0; i < count; i++) {
      const a = count === 1 ? angle : angle + spread * (i / (count - 1) - 0.5);
      this.emit({ x, y, angle: a, speed, color, radius, shape, ...extra });
    }
  }

  /** 环形：count 发均布（原版 bullet_circle），jitterDeg 可选随机抖动 */
  ring(x: number, y: number, count: number, baseAngle: number, speed: number, color: string, radius: number, jitterRad = 0, shape?: BulletShape, extra?: Partial<EnemyShot>) {
    for (let i = 0; i < count; i++) {
      const a = baseAngle + (i / count) * TAU + (jitterRad ? (this.rng.next() * 2 - 1) * jitterRad : 0);
      this.emit({ x, y, angle: a, speed, color, radius, shape, ...extra });
    }
  }

  /** 提前量瞄准（VS-HANDOFF 4.2：lead 0.6） */
  aim(x: number, y: number) {
    const p = this.P;
    const lead = LEAD;
    const tx = p.x + (p.vx || 0) * lead;
    const ty = p.y + (p.vy || 0) * lead;
    return Math.atan2(ty - y, tx - x);
  }

  teleportBoss() {
    // 瞬移限于舞台上带，不追踪玩家。
    if (!this.boss) return;
    this.boss.x = this.ax + (this.rng.next() * 2 - 1) * (ARENA.hw - 140);
    this.boss.y = this.ay - 120 + (this.rng.next() * 2 - 1) * 150;
    this.boss.vx = 0;
    this.boss.vy = 0;
  }

  // 清除击退速度，保留符卡直接控制的位置。
  _settleBoss() {
    if (!this.boss) return;
    this.boss.vx = 0;
    this.boss.vy = 0;
  }

  petSay(text: string, _duration?: number) {
    this.context.speak(text, { key: `flandre:${text.slice(0, 8)}` });
  }

  // ---------- 消弹（小小猫娘）----------

  get purgeCd() { return this.purge.cooldown; }
  get nova() { return this.purge.nova; }
  tryManualPurge() {
    if (this.over || !this._hinted) return false;
    return this.purge.manual();
  }
  autoPurge() { if (!this.over) this.purge.start(true); }

  _purgeUpdate(dt: number) { this.purge.advance(dt); }

  // ---------- 主循环 ----------

  /** 第七十六轮：教学台词按档期逐句上屏（第 idx 句在 +2.6×idx 秒触发） */
  _hintTick() {
    const q = this._hintQueue;
    if (!q?.length) return;
    if (this._hintAt === undefined) throw new TypeError('Queued hints require an activation time');
    if (this.t - this._hintAt >= 2.6 * (this._hintDone ?? 0)) {
      const h = q.shift()!;
      this._hintDone = (this._hintDone ?? 0) + 1;
      this.petSay(h.text, h.dur);
    }
  }

  // 显示间隔 EMA 决定弹量预算；忽略超过 0.1 秒的后台尖峰。
  _adaptCap(dt: number) {
    if (!(dt > 0) || dt > 0.1) return;
    // Mobile targets 30fps: its healthy 33ms display interval is not a slowdown.
    // Leave hysteresis around that target; desktop retains its original thresholds.
    const target = 1 / 30;
    const slow = this.mobile ? target * 1.35 : 0.027;
    const fast = this.mobile ? target * 1.1 : 0.021;
    this._ema = (this._ema ?? (this.mobile ? target : 0.016)) * 0.96 + dt * 0.04;
    if (this._ema > slow) this._capNow = Math.max(this.budget.flandreBulletMinimum, this._capNow - 3);
    else if (this._ema < fast) this._capNow = Math.min(this.budget.flandreBullets, this._capNow + 1);
  }

  sampleDisplayInterval(seconds: number) {
    if (this.mobile) this._adaptCap(seconds);
  }

  update(dt: number) {
    if (this.over) return;
    if (this.context.world.players().every(actor => actor.dead || actor.downed)) { this.onPlayerDeath(); return; }
    this.t += dt;
    if (!this.mobile) this._adaptCap(dt);
    this._purgeUpdate(dt);
    this._hintTick();

    // 序章演出
    if (this.phase === 'prologue') {
      if (this.t >= SILENCE_END && !this._warned) {
        this._warned = true;
        this.petSay('注意，有什么危险的家伙靠近了！');
      }
      if (this.t >= SHAKE_AT && this.t < SHAKE_AT + 2.5) {
        // 屏幕轻微晃动 2~3 秒
        this.context.shake(4.5, 0.12);
      }
      if (this.t >= CARD_AT && !this._named) {
        this._named = true;
        this.spellName = CARD_INFO.prologue.name;
        this.cues.playScene?.('flandre');                   // U.N. Owen
        this._beginSpell('prologue', PROLOGUE_CARD_TIME);
      }
      // 序章教学对队友减伤，P1 的代打减伤独立结算。
      this._setPrologueEase(0.5);
      if (this.spell) this._tickSpell(dt);
      if (this.t >= PROLOGUE_END) { this._setPrologueEase(1); this._spawnFlandre(); }
      return;
    }

    // 正式符卡战
    if (this.phase === 'cards') {
      this._settleBoss();   // 第五十一轮：只压速度；符卡自带移动保留
      this._wanderUpdate(dt);   // 第六十一轮：舞台点附近慢速游走（上半屏）
      this._timeoutTick();      // 第六十二轮：最后 10 秒滴答
      // 正式战最多 120 秒；完成四张卡可以提前进入 Extra。
      this.cardsElapsed = (this.cardsElapsed ?? 0) + dt;
      if (EP_AT_TIMEOUT && this.cardsElapsed >= CARDS_TOTAL * CARD_TIME) {
        this._enterExtra();
        return;
      }
      if (this.lockLeft > 0) {
        this.lockLeft -= dt;
      } else {
        this._tickSpell(dt);
      }
      const lost = this.phaseStartHp - (this.boss?.hp ?? 0);
      const beaten = lost >= FLANDRE_MAX_HP * CARD_HP_FRAC;
      const timeUp = this.spell && this.spell.t >= this.spell.dur;
      if ((beaten || timeUp) && this.lockLeft <= 0) {
        if (beaten) this.cardsDone++;
        else {
          // 超时扣到本卡地板，使下一张卡的伤害进度从分段线重新起算。
          const floor = this._hpFloor();
          if (this.boss && this.boss.hp > floor) this.boss.hp = floor;
        }
        // 只有普通卡超时才播放收符失败音。
        if (!beaten) this.cues.play('cardEnd');
        this._nextCard();
      }
      return;
    }

    // Extra Phantom：无敌抱腿坐姿存活战（第六十一轮：20 + 20 + 30 = 70 秒）
    if (this.phase === 'extra') {
      this._settleBoss();   // 第五十一轮：同上
      // Extra 保持坐姿，不游走。
      this._timeoutTick();      // 第六十二轮：最后 10 秒滴答
      this.extraLeft -= dt;
      this.extraCardTimer -= dt;
      if (this.extraCardTimer <= 0 && this.extraCardsLeft > 0) {
        this.extraCardsLeft--;
        // Extra 前两段各 20 秒，最后一段 30 秒。
        this.extraCardTimer = this.extraCardsLeft === 0 ? EXTRA_HEART_TIME : EXTRA_CARD_TIME;
        // Extra 按专属队列顺序播放，不抽普通符卡，也不播收符失败音。
        if (!this.extraQueue || this.extraQueue.length === 0) {
          this.extraQueue = [...EXTRA_SPELLS];
        }
        this._beginSpell(this.extraQueue.shift()!, EXTRA_CARD_TIME, 1.25);
        this._clearBullets();
      }
      this._tickSpell(dt);
      if (this.extraLeft <= 0) this.finish('beat');   // 存活 60 秒 → 满奖励
    }
  }

  _beginSpell(id: SpellId, dur: number, speedMul = 1) {
    this.spell = createSpell(id, CARD_INFO[id].name, dur, speedMul);
    this.spellName = this.spell.name;
    this._removeClones();   // 第六十三轮：上一张的四重存在分身退场
    this.cues.play('spellCard');
    // 旋转激光以舞台中心为轴，避免角落起手封死退路。
    if (id === 'laevateinn' && this.boss) {
      this.boss.x = this.ax;
      this.boss.y = this.ay - STAGE_DY;
      this.boss.vx = 0;
      this.boss.vy = 0;
    }
  }

  _tickSpell(dt: number) {
    const sp = this.spell;
    if (!sp) return;
    sp.t += dt;
    switch (sp.id) {
      case 'prologue': SPELLS.prologue.tick(sp, dt, this); break;
      case 'ripples': SPELLS.ripples.tick(sp, dt, this); break;
      case 'cranberry': SPELLS.cranberry.tick(sp, dt, this); break;
      case 'kagome': SPELLS.kagome.tick(sp, dt, this); break;
      case 'maze': SPELLS.maze.tick(sp, dt, this); break;
      case 'starbow': SPELLS.starbow.tick(sp, dt, this); break;
      case 'catadioptric': SPELLS.catadioptric.tick(sp, dt, this); break;
      case 'clock': SPELLS.clock.tick(sp, dt, this); break;
      case 'fragile': SPELLS.fragile.tick(sp, dt, this); break;
      case 'bloodstain': SPELLS.bloodstain.tick(sp, dt, this); break;
      case 'heart': SPELLS.heart.tick(sp, dt, this); break;
      case 'laevateinn': SPELLS.laevateinn.tick(sp, dt, this); break;
      case 'fourkind': SPELLS.fourkind.tick(sp, dt, this); break;
    }
    this._cullOutside();
    // 莱万汀用攻击姿势；Extra 坐姿与普通飞行各自按时间切帧。
    if (this.boss) {
      if (this.phase === 'extra') {
        this.boss.spriteId = SIT_FRAMES[Math.floor(this.t / 0.3) % SIT_FRAMES.length];
      } else if (sp.id === 'laevateinn') {
        this.boss.spriteId = 'flandre_laevateinn';
      } else {
        // 常态：172~175 翅膀慢慢循环（0.35s 一帧）
        this.boss.spriteId = IDLE_FRAMES[Math.floor(this.t / 0.35) % IDLE_FRAMES.length];
      }
    }
  }

  /** 序章减伤：对 P2~P4（队友 AI）生效，P1 不动（P1 要么是人类，要么有代打光环自带 0.25×） */
  _setPrologueEase(v: number) {
    this.prologueEase = v;
  }

  // 飞出场地加余量才回收，避免短射程让弹幕在场内消失。
  // 反弹弹仍在边缘内，侧边发射点也包含在余量内。
  _cullOutside() {
    const items = this.context.world.enemyBullets?.items;
    if (!items) return;
    const cx = this.ax, cy = this.ay, hw = ARENA.hw + CULL_MARGIN, hh = ARENA.hh + CULL_MARGIN;
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      if (b.dead || b.hitProfile !== this.hitProfile) continue;
      if (Math.abs(b.x - cx) > hw || Math.abs(b.y - cy) > hh) b.dead = true;
    }
  }

  _pickCard() {
    if (this.cardsQueue.length === 0) {
      this.cardsQueue = [...CARD_POOL];
      for (let i = this.cardsQueue.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng.next() * (i + 1));
        [this.cardsQueue[i], this.cardsQueue[j]] = [this.cardsQueue[j], this.cardsQueue[i]];
      }
    }
    return this.cardsQueue.pop();
  }

  /** 芙兰登场：序章结束（用户："30秒结束符卡结束，芙兰从屏幕中心偏上方出现"） */
  _spawnFlandre() {
    const w = this.context.world;
    this.spell = null;
    const def = getEnemy('flandre')!;
    const e = new EnemyBody(def, this.ax, this.ay - STAGE_DY,
      { hp: 1, bossHp: 1, damage: 1, speed: 1, xp: 1, materials: 1, bulletRange: 1 }, this.rng,
      { damageGate: { filter: (body, amount) => {
        // Each card owns one HP segment. Extra remains invulnerable; no ordinary
        // Boss phase machine or death/restore cycle participates in this fight.
        const allowed = body.hp - this._hpFloor();
        if (this.over || this.lockLeft > 0 || this.phase === 'extra' || allowed <= 0) {
          return { blocked: true, amount: 0, reason: 'flandre' };
        }
        return { blocked: false, amount: Math.min(amount, allowed) };
      } } });
    this.playerPolicy.allowPrimaryAttack();
    w.enemies.add(e);
    this.boss = e;
    w.fx.shockwave?.(e.x, e.y, 120, COLORS.red);
    w.fx.nova(e.x, e.y, 260, COLORS.gold, null);
    this.context.shake(6, 0.5);
    this.phase = 'cards';
    this._nextCard();
  }

  // 普通卡锁住当前 20% 分段，Extra 永久保留最后 20% 血量。
  // 返回地板值，伤害门与超时扣血共用。
  _hpFloor() {
    const start = this.phaseStartHp || FLANDRE_MAX_HP;
    return Math.max(FLANDRE_MAX_HP * 0.2, start - FLANDRE_MAX_HP * CARD_HP_FRAC);
  }

  /** 切符卡：清全屏弹幕 + 锁血 3 秒（用户要求） */
  _nextCard() {    this._clearBullets();
    this.lockLeft = SWITCH_LOCK;
    // 切卡回到舞台点，再恢复上半屏游走。
    if (this.boss) {
      this.boss.x = this.ax;
      this.boss.y = this.ay - STAGE_DY;
      this.boss.vx = 0; this.boss.vy = 0;
    }
    if (this.cardsDone >= CARDS_TOTAL) {
      // 四张卡完成即进入 Extra，不要求全部击破。
      this._enterExtra();
      return;
    }
    const prevNo = this.spell?.st?._cardNo ?? 0;
    if (prevNo >= CARDS_TOTAL) {
      // 第四张超时同样进入 Extra，不能走 partial 结算。
      this._enterExtra();
      return;
    }
    const id = this._pickCard()!;
    this._beginSpell(id, CARD_TIME);
    this.spell!.st._cardNo = prevNo + 1;
    this.phaseStartHp = this.boss?.hp ?? FLANDRE_MAX_HP;
  }

  // 在舞台附近平滑游走，2～4 秒换目标；莱万汀固定中心。
  // 不覆盖符卡自己的位移，Extra 保持坐姿不移动。
  _wanderUpdate(dt: number) {
    const boss = this.boss;
    if (!boss) return;
    if (this.spell?.id === 'laevateinn') return;   // 莱万汀钉在舞台中心
    const homeY = this.ay - STAGE_DY;
    const st = this.spell?.st;
    if (!st) return;
    st.think = (st.think ?? 0) - dt;
    const dx = (st.tx ?? boss.x) - boss.x;
    const dy = (st.ty ?? boss.y) - boss.y;
    if (st.think <= 0 || (dx * dx + dy * dy) < 100) {
      st.tx = this.ax + (this.rng.next() * 2 - 1) * 130;
      st.ty = Math.max(-480, Math.min(-230, homeY + (this.rng.next() * 2 - 1) * 110));
      st.think = 2 + this.rng.next() * 2;
    }
    const d = Math.hypot(dx, dy) || 1;
    const step = Math.min(42 * dt, d);
    boss.x += (dx / d) * step;
    boss.y += (dy / d) * step;
  }

  _clearBullets() {
    for (const b of this.context.world.enemyBullets.items) b.dead = true;
  }

  // 恢复四重存在期间修改的本体隐身、半径与接触伤害。
  _removeClones() {
    if (this.boss) {
      this.boss.flandreHidden = false;
      if (this._bossRadiusSave != null) this.boss.radius = this._bossRadiusSave;
      if (this._bossDamageSave != null) this.boss.damage = this._bossDamageSave;
      this._bossRadiusSave = null;
      this._bossDamageSave = null;
    }
  }

  // 分段倒计时只供 HUD 显示，不驱动切卡或结算。
  getDisplayTimer() {
    if (this.over || this.phase === 'done') return null;
    if (this.phase === 'prologue') {
      // 序章发出第一颗弹后才显示倒计时。
      if (!this.spell) return null;
      return {
        left: Math.max(0, this.spell.dur - this.spell.t),
        total: this.spell.dur,
        label: '？？？',
      };
    }
    if (this.phase === 'cards') {
      const no = Math.min(CARDS_TOTAL, this.spell?.st?._cardNo ?? 1);
      return {
        left: this.spell ? Math.max(0, this.spell.dur - this.spell.t) : CARD_TIME,
        total: CARD_TIME,
        label: `符卡 ${no}/${CARDS_TOTAL}`,
      };
    }
    if (this.phase === 'extra') {
      // Extra 三段的倒计时来自独立段计时器，不用总剩余时间代替。
      const seg = Math.min(3, Math.max(1, 3 - (this.extraCardsLeft ?? 3)));
      const total = seg === 3 ? EXTRA_HEART_TIME : EXTRA_CARD_TIME;
      return { left: Math.max(0, this.extraCardTimer ?? 0), total, label: `ExtraPhantom ${seg}/3` };
    }
    return null;
  }

  // 普通卡或 Extra 总计时的最后 10 秒，每秒播放一次滴答。
  _timeoutTick() {
    let left = null;
    if (this.phase === 'cards' && this.spell) left = this.spell.dur - this.spell.t;
    else if (this.phase === 'extra') left = this.extraLeft;
    if (left !== null && left > 0 && left <= 10) {
      const c = Math.ceil(left);
      if (this._tickSec !== c) { this._tickSec = c; this.cues.play('cardTick'); }
    } else {
      this._tickSec = null;
    }
  }

  // Extra：专属音乐与坐姿，锁血存活 70 秒。
  _enterExtra() {
    this.phase = 'extra';
    this._removeClones();   // 第六十三轮：EP 开始前分身退场（本体独自抱腿）
    this.extraLeft = EXTRA_TIME;
    this.extraCardTimer = 0;      // 立刻开第一张（update 里会重置成 20）
    this.extraCardsLeft = 3;      // 每 20 秒一张，60 秒 3 张
    // 先初始化专属队列，第一张必须是 fragile。
    this.extraQueue = [...EXTRA_SPELLS];
    this.spellName = 'Extra Phantom';
    this.cues.playScene?.('flandre_ex');
    // 抱腿坐姿由 _tickSpell 每帧按时间切帧（this.t 驱动循环）
    this.context.notice('芙兰朵露展开了她真正的力量……', 'bad', 3000);
  }

  finish(outcome: ChallengeOutcome) {
    if (this.over) return;
    this.over = true;
    this.phase = 'done';
    this.cues.play('flandreCrash');
    this._removeClones();   // 第六十三轮：分身退场
    this._clearBullets();
    if (this.boss) this.boss.dead = true;   // 静默移走，不掉任何东西
    this.boss = null;
    this.spell = null;
    this.spellName = '';
    this.onDone(outcome);
  }

  /** 玩家死了（任何阶段）：整场作废 —— 第六十五轮起 EP 阶段死亡另有结算 */
  onPlayerDeath() {
    this.petSay('呜……快逃啊——！');
    // Extra 死亡给经验和材料；普通卡死亡没有奖励。
    this.finish(this.phase === 'extra' ? 'extraDeath' : 'death');
  }

}
