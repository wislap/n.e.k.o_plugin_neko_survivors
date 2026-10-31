import type { RNG } from '../math/random.ts';
import type { Player } from '../actors/player.ts';
import type { World } from '../world/world.ts';
import type { Arena, ChallengeObservation } from '../encounters/types.ts';
import type { AiSkillId } from './skills.ts';
interface Point { x: number; y: number }
export interface MovementContext { player: Player; world: World; party: boolean }
interface ActiveCombatContext extends MovementContext { challenge: ChallengeObservation; arena: Arena }
type CombatContext = ActiveCombatContext | (MovementContext & { challenge: null; arena?: undefined });
// Movement rules retained from v0.4.18 NekoPilot, without Game or host dependencies.
import { blockedAt } from '../world/terrain.ts';
import { AI_SKILLS } from './skills.ts';

export class MovementPilot {
  declare rng: RNG;
  declare skill: AiSkillId;
  declare entity: boolean;
  declare _rnd: () => number;
  declare _fr: number;
  declare _aimT: number;
  declare target: Point | null;
  declare _tgt: Point | null;
  declare clear: boolean;
  declare rescueTargetId: number | null;
  declare _lastX?: number;
  declare _lastY?: number;
  declare _stuckN?: number;
  declare _dodgeNow?: boolean;
  declare _hwA?: number;
  declare _orbit?: number;
  declare _orbitDir?: number;
  declare _bossArenaClamp?: ((value: Point) => Point) | null;
  _stumble?: { until: number; ang: number } | null;
  constructor(rng: RNG, { skill = 'pro', teammate = false }: { skill?: string; teammate?: boolean } = {}) {
    this.rng = rng;
    this.skill = typeof skill === 'string' && Object.hasOwn(AI_SKILLS, skill) ? skill as AiSkillId : 'pro';
    this.entity = teammate;
    this._rnd = () => rng.next();
    this._fr = 0;
    this._aimT = 0;
    this.target = null;
    this._tgt = null;
  }
  captureState(id: number) { return { id, skill: this.skill, rngState: this.rng.state }; }
  _skillCfg() { return AI_SKILLS[this.skill]; }

  /** One call per 60Hz simulation step, independent of display refresh rate.
   * Returns intent only. The session applies movement and validates rescue/purge.
   */
  decide(context: MovementContext) {
    const { player } = context;
    this.clear = false;
    this.rescueTargetId = null;
    if (!player || player.dead) return { target: null, clear: false, rescueTargetId: null };
    // Original anti-stuck rule: 18 stationary simulation steps (~0.3s).
    if (this._lastX != null && this.target) {
      const moved = Math.hypot(player.x - this._lastX, player.y - this._lastY!);
      this._stuckN = moved < 0.6 ? (this._stuckN ?? 0) + 1 : 0;
      if (this._stuckN > 18) {
        const dx = this.target.x - player.x, dy = this.target.y - player.y;
        const length = Math.hypot(dx, dy) || 1;
        this.target = { x: player.x - dy / length * 130, y: player.y + dx / length * 130 };
        this._stuckN = 0;
        this._lastX = player.x; this._lastY = player.y;
        return { target: this.target, clear: false, rescueTargetId: null };
      }
    }
    this._lastX = player.x; this._lastY = player.y;
    const encounter = context.world.challenge;
    this._combat(encounter
      ? { ...context, challenge: encounter.readCombat(), arena: encounter.arena }
      : { ...context, challenge: null }, player);
    return { target: this.target, clear: this.clear, rescueTargetId: this.rescueTargetId };
  }
  _mateOf(g: MovementContext, p: Player, wantDowned: boolean) {
    let best = null, bestD = Infinity;
    for (const pl of (g.world?.players?.() ?? [])) {
      if (!pl || pl === p || pl.dead) continue;
      if (wantDowned ? !pl.downed : pl.downed) continue;
      const d = Math.hypot(pl.x - p.x, pl.y - p.y);
      if (d < bestD) { bestD = d; best = pl; }
    }
    return best;
  }

  _combat(g: CombatContext, ent: Player) {
    const vergilMode = g.challenge !== null;
    const p = ent ?? g.player;
    if (!p || p.dead) return;
    // 倒地者以15%移速爬向活着的队友；AI只提供目标，不推进救援规则。
    if (p.downed) {
      const mate = this._mateOf(g, p, false);
      if (mate) {
        this.target = { x: mate.x, y: mate.y };
      }
      return;
    }
    // 正常决策频率按AI档位区分；队友倒地时统一每4帧更新救援目标。
    const S = this._skillCfg();
    this._fr++;
    const rescueMode = (g.world?.players?.() ?? []).some((pl) => pl && pl !== p && pl.downed && !pl.dead);
    const per = rescueMode ? 4 : S.period;
    if (++this._aimT % per !== 1 % per) return;
    this._dodgeNow = false;   // 本次决策是否处于"躲弹中"（置位后跳过走位低通，指令直达）

    const world = g.world;
    const half = world?.halfSize ?? 700;
    const lowHp = p.maxHp > 0 && p.hp / p.maxHp < 0.6;   // 6 成血就开始怂
    const threatR = lowHp ? 430 : 310;      // 残血更怂：警戒圈加大
    const fleeMag = lowHp ? 300 : 210;

    const enemies = world?.enemies?.items;
    let fleeX = 0, fleeY = 0, nearest = null, nearestD = Infinity;
    let bossE = null, bossD = Infinity;   // 普通波的 boss（交战拉力用）
    // 挑战Boss不参与普通怪逃离向量，否则近战AI会被推离有效攻击距离。
    const bossBodyId = g.challenge?.bodyId;
    if (Array.isArray(enemies)) {
      for (const e of enemies) {
        if (!e || e.dead || e.isChest) continue;
        if (e.id === bossBodyId) continue;
        const dx = p.x - e.x, dy = p.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < nearestD) { nearestD = d; nearest = e; }
        // 第一百八十四轮：标记波次 boss（"几乎不打 boss"修复的拉力目标）
        if (e.def?.boss && d < bossD) { bossD = d; bossE = e; }
        // The content/actor behavior contract has no 'bullet' tag. The original
        // comparison never selected its extra radius for a real enemy.
        const R = threatR;
        if (d < R) {
          const w = 1 - d / R;
          fleeX += (dx / d) * w;
          fleeY += (dy / d) * w;
        }
      }
      // 包围逃逸：加权和会被多方向抵消（=站桩等死被围死，实测 4-6 波
      // 全这么死的）—— 最近怪的完整权重单独主导，保证永远在"离开
      // 最危险方向"的路上
      if (nearest && nearestD < threatR) {
        const ux = (p.x - nearest.x) / (nearestD || 1);
        const uy = (p.y - nearest.y) / (nearestD || 1);
        fleeX += ux * 1.1;
        fleeY += uy * 1.1;
      }
    }

    // 只避让轨迹将命中的敌弹，沿其速度垂线选择更远的一侧，近弹权重更高。
    try {
      const ebs = world?.enemyBullets?.items;
      if (Array.isArray(ebs)) {
        for (const b of ebs) {
          if (!b || b.dead || b.hostileToEnemies) continue;
          const dx = p.x - b.x, dy = p.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d > 230 * S.scan || d < 1) continue;   // 敌弹通常由angle/speed推进，vx/vy可能恒为0；感知时按实际运动字段还原速度。
          const spd0 = b.speed ?? 0;
          const bvx = b.vx || Math.cos(b.angle ?? 0) * spd0;
          const bvy = b.vy || Math.sin(b.angle ?? 0) * spd0;
          const bv = Math.hypot(bvx, bvy);
          if (bv < 40) continue;   // 慢速/静止的（燃烧带之类走专门逻辑）
          // 接近性：弹速方向与"弹→我"方向的夹角余弦 > 0.55 才算朝我来
          const dot = ((bvx / bv) * dx + (bvy / bv) * dy) / d;
          if (dot < 0.55) continue;
          // 瞄准线垂距：打不着的弹不躲（省下走位专心输出）
          const along = d * dot;
          const miss = Math.sqrt(Math.max(0, d * d - along * along));
          if (miss > 46) continue;
          // 197 轮：漏看——该躲的弹有概率根本没注意到（pro 为 0，行为不变）
          if (S.skip && this._rnd() < S.skip) continue;
          // 垂直闪避：两侧选离弹更远的一边，越近权重越大
          let px = -bvy / bv, py = bvx / bv;
          if (S.angErr) {   // 197 轮：躲避方向误差——知道要躲，但闪得不够准
            const er = (this._rnd() - 0.5) * 2 * S.angErr, ce = Math.cos(er), se = Math.sin(er);
            const rx = px * ce - py * se, ry = px * se + py * ce; px = rx; py = ry;
          }
          const side = (dx * px + dy * py) >= 0 ? 1 : -1;
          const w = (1 - d / 230) * 2.4;
          fleeX += px * side * w;
          fleeY += py * side * w;
        }
      }
    } catch { /* 弹幕列表异常不影响走位 */ }

    // 救援优先于拆箱；接近后直接近身救援，不依赖弹道恰好命中。
    const downedMates = (g.world?.players?.() ?? []).filter((pl) => pl && pl !== p && pl.downed && !pl.dead);
    // 小队状态从当前观察读取，不依赖旧浏览器全局标志。
    const duoOn = g.party;
    // 救援先保活：残血或自身受围攻时脱身；多人倒地时适当放宽救援点怪数门槛。
    const hpRatio = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    const hpOk = hpRatio > 0.45;
    const selfGate = lowHp ? 260 : 150;
    let swarmN = 0;
    if (duoOn && downedMates.length > 0) {
      // 救援按倒地次数和距离共同评分，优先需要更少攻击次数的队友。
      let best = null, bestScore = Infinity;
      for (const m of downedMates) {
        const d = Math.hypot(m.x - p.x, m.y - p.y);
        const score = d + (m.downCount ?? 0) * 260;
        if (score < bestScore) { bestScore = score; best = m; }
      }
      if (best) {
        const rawD = bestScore - (best.downCount ?? 0) * 260;
        for (const e of (Array.isArray(enemies) ? enemies : [])) {
          if (!e || e.dead || e.isChest) continue;
          if (Math.hypot(e.x - best.x, e.y - best.y) < 150) swarmN++;
        }
        const multiDown = downedMates.length >= 2;
        const swarmed = swarmN >= (multiDown ? 7 : 5);
        // 250px内首次倒地的队友绕过自保闸优先救援；其他情况仍经过三道安全检查。
        const faceDown = rawD < 250 && (best.downCount ?? 0) <= 1;
        if (faceDown || (hpOk && !swarmed && nearestD > selfGate)) {
          if (rawD < 60) {
            // 已贴身：站桩踹（清移动目标防止漂移），rescueHit 的 0.2s gate
            // 在 player.update 里按 dt 递减，这里每帧调只会按节拍生效
            this.target = null;
            this.rescueTargetId = best.id;
          } else {
            this.target = { x: best.x, y: best.y };
          }
          return;
        }
        // 三道闸任一没过 → 记下最近倒地者供弹道顺手救援（武器开火照旧），
        // 走位交给正常风筝/拆箱 —— 保活优先于救援
      }
    }

    // 只要有"非近战"武器就风筝（ranged/element/turret 都算）；
    // 全近战则保持攻击半径环绕输出
    let hasRanged = false;
    try {
      hasRanged = (p.weapons || []).some((w) => {
        const k = w?.def?.kind;
        return k === 'ranged' || k === 'element' || k === 'turret';
      });
    } catch { /* */ }

    // 宝箱不移动；近战AI必须主动进入攻击范围才能拆箱。
    if (!vergilMode && nearestD > 90) {
      let chest = null, chestD = Infinity;
      if (Array.isArray(enemies)) {
        for (const e of enemies) {
          if (!e || e.dead || !e.isChest) continue;   // 只管静止宝箱
          const d = Math.hypot(e.x - p.x, e.y - p.y);
          if (d < chestD) { chestD = d; chest = e; }
        }
      }
      if (chest && chestD < 420) {
        const stand = hasRanged ? 150 : 58;
        if (chestD > stand + 8) {
          // 直奔箱子（救援已在上面的分支 return；这里优先于风筝/巡逻，
          // 路上武器照常开火，扫到谁打谁）
          this.target = { x: chest.x, y: chest.y };
          return;
        }
        // 已进攻击距离：清移动目标站桩 —— 走近后宝箱就是"最近的敌人"，
        // 武器自动开火自然转火拆箱
        this.target = null;
        return;
      }
    }

    let tx: number, ty: number;
    if (vergilMode) {
      // 挑战移动受竞技场约束；不能沿用普通波的全世界边界。
      const encounter = g.challenge;
      const perf = encounter.movement === 'survival';
      if (encounter.purgeReady && !this.entity) this._maybePurge(world, p, encounter);
      const b = encounter.target;
      const arena = g.arena;
      if (b && !b.dead) {
        const dx = p.x - b.x, dy = p.y - b.y;
        const d = Math.hypot(dx, dy) || 1;
        // 维吉尔格挡只阻止远程；AI贴近后用近战拼刀，避免卡在无效射击位。
        const guarding = encounter.guarding;
        const hasMelee = (p.weapons || []).some((w) => w?.def?.kind === 'melee');
        const inner = guarding ? (hasMelee ? 95 : 260) : (hasMelee ? 70 : 200);
        const outer = guarding ? (hasMelee ? 150 : 330) : (hasMelee ? 120 : 280);
        if (d < inner) { tx = p.x + (dx / d) * (inner - 15); ty = p.y + (dy / d) * (inner - 15); }
        else if (d > outer) { tx = b.x + (dx / d) * (outer - 25); ty = b.y + (dy / d) * (outer - 25); }
        else { // 环绕切向移动，不吃直线弹幕
          const tang = hasMelee ? (guarding ? 90 : 60) : (guarding ? 120 : 110);
          tx = p.x + (-dy / d) * tang; ty = p.y + (dx / d) * tang;
        }
        // 挑战环绕目标必须叠加避弹向量，单纯切向环绕无法躲开全屏弹幕。
        const dodgeW = lowHp ? 1.1 : 0.8;
        const fm = Math.hypot(fleeX, fleeY);
        if (fm > 0.01) {
          const kpx = (Math.min(fm, 1.6) / fm) * fleeMag * dodgeW;
          tx += fleeX * kpx;
          ty += fleeY * kpx;
        }
      } else if (perf) {
        // 无可攻击目标的演出阶段以场内巡游和危险区躲避为主，不原地追击虚拟目标。
        this._hwA = (this._hwA ?? this._rnd() * 6.283) + 0.5 / 60;
        tx = arena.cx + Math.cos(this._hwA) * arena.hw * 0.6;
        ty = arena.cy + Math.sin(this._hwA) * arena.hh * 0.55;
        // 躲弹幕/激光/南瓜十字：预测式找缝（见 _safeStep）。没危险时返回原目标，照常巡游。
        const ss = this._safeStep(g, p, tx, ty, arena);
        tx = ss.x; ty = ss.y;
        this._dodgeNow = !!ss.danger;
      } else if (encounter.movement === 'teaching') {
        // 教学序章没有Boss实体时也执行预测避弹，并在场地下半区巡游。
        const band = (p.y >= arena.cy ? 1 : -1) * arena.hh * 0.55;
        tx = Math.max(arena.cx - arena.hw * 0.2, Math.min(arena.cx + arena.hw * 0.2, p.x));
        ty = arena.cy + band;
        // 不做任何位移躲避 —— 三种躲法 A/B 实测（10 个种子，30 秒）：
        //   纯口袋待命 5.5 次 ＜ 口袋+逃避向量 7.0 次 ＜ 口袋+_safeStep 预测跳步 7.6~9.7 次。
        // 这张卡是以场地中心为轴的切线"风车"弹线，一动就容易横穿弹线；站在口袋里让弹线从旁边掠过最稳。
        // （旧行为：站在场地正中心不动 = 17.0 次，所以"全死"。）
      } else {
        // boss 不在场（演出阶段）：守在场地中心附近待命，绝不乱跑出框
        tx = arena.cx; ty = arena.cy;
      }
      // 目标点 clamp 进 boss 场地（内缩 46 —— 贴空气墙也有走位余量）。
      // 威胁躲避目标同样被 clamp：躲弹幕也不会被挤出场。
      const clampToArena = (v: Point) => ({
        x: Math.max(arena.cx - arena.hw + 46, Math.min(arena.cx + arena.hw - 46, v.x)),
        y: Math.max(arena.cy - arena.hh + 46, Math.min(arena.cy + arena.hh - 46, v.y)),
      });
      ({ x: tx, y: ty } = clampToArena({ x: tx, y: ty }));
      this._bossArenaClamp = clampToArena;   // 走位平滑/救援目标也走同一 clamp
    } else {
      this._bossArenaClamp = null;
      if (!hasRanged && nearest && nearestD < 200) {
        // 近战：只对"落单"怪环绕输出（200 内 ≤3 只）；被围殴立刻转逃跑。
        // 环绕半径 70 = 猫爪类武器攻击边缘 —— 打得到怪、碰撞吃不到。
        let crowd = 0;
        if (Array.isArray(enemies)) {
          for (const e of enemies) {
            if (!e || e.dead || e.isChest) continue;
            if (Math.hypot(e.x - p.x, e.y - p.y) < 200) crowd++;
          }
        }
        if (crowd <= 3) {
          const d = nearestD || 1;
          if (d > 95) {
            tx = nearest.x + (p.x - nearest.x) / d * 70;
            ty = nearest.y + (p.y - nearest.y) / d * 70;
          } else {
            // 切向环绕 + 拉回 70 半径
            const ux = (p.x - nearest.x) / d, uy = (p.y - nearest.y) / d;
            tx = p.x + (-uy) * 70 + ux * (70 - d) * 0.6;
            ty = p.y + (ux) * 70 + uy * (70 - d) * 0.6;
          }
        } else {
          tx = p.x + fleeX * fleeMag;
          ty = p.y + fleeY * fleeMag;
        }
      } else {
        // 普通波的巡逻/风筝分支不处理挑战，避免无普通敌人时错误巡游出场。
        const hasThreat = (fleeX !== 0 || fleeY !== 0);
        if (hasThreat) {
          // 弧线风筝叠加场心拉力；逃跑方向锥内有安全掉落时顺路拾取。
          const rot = 0.6 * (this._orbitDir ??= (this._rnd() < 0.5 ? 1 : -1));
          const cosR = Math.cos(rot), sinR = Math.sin(rot);
          const rfX = fleeX * cosR - fleeY * sinR;
          const rfY = fleeX * sinR + fleeY * cosR;
          const distC = Math.hypot(p.x, p.y);
          const pullC = Math.max(0, distC - half * 0.78) / 160;
          const onPath = this._pickupOnPath(g, p, rfX, rfY);
          if (onPath) {
            tx = onPath.x; ty = onPath.y;
          } else {
            tx = p.x + rfX * fleeMag - p.x * 0.1 * pullC + this._pickupPull(g, p, 'x') * 0.5;
            ty = p.y + rfY * fleeMag - p.y * 0.1 * pullC + this._pickupPull(g, p, 'y') * 0.5;
          }
        } else if (nearest && nearestD > 500) {
          // 最近敌人超过500px才脱离巡逻圈拾取，并要求掉落自身离怪超过220px。
          const pk = this._safePickup(g, p, 620);
          if (pk) {
            tx = pk.x; ty = pk.y;
          } else {
            this._orbit = (this._orbit ?? this._rnd() * 6.283) + 0.3;
            tx = Math.cos(this._orbit) * half * 0.72;
            ty = Math.sin(this._orbit) * half * 0.72;
          }
        } else {
          // 安全期绝不站桩：贴边绕场巡逻（0.72×半场）—— 怪从场内刷，
          // 场边一侧永远只有半个方向的怪，幸存者类的经典遛怪位。
          // 场心拉力 dead-zone 同步放大到 0.78，巡逻圈不被拽回。
          this._orbit = (this._orbit ?? this._rnd() * 6.283) + 0.3;
          const px = Math.cos(this._orbit) * half * 0.72;
          const py = Math.sin(this._orbit) * half * 0.72;
          const pk = this._nearestPickup(g, p);
          tx = pk ? pk.x * 0.6 + px * 0.4 : px;
          ty = pk ? pk.y * 0.6 + py * 0.4 : py;
        }
      }
    }
    // ---- 走位平滑（低通 + 迟滞）----
    // 威胁向量帧间微小变化 → 目标点左右横跳（实测"鬼畜般高速抖动"）。
    // 新目标先和旧目标按 4:6 混合；混合后位移 <26px 就不更新 —— 角色继续
    // 朝旧目标走，只有真正有意义的方向变化才会改道。
    // 躲弹中(_dodgeNow)不做低通：0.52s 的预测窗口里，60% 旧目标惯性会让闪避慢半拍
    let mix = (this._tgt && !this._dodgeNow)
      ? { x: tx * 0.4 + this._tgt.x * 0.6, y: ty * 0.4 + this._tgt.y * 0.6 }
      : { x: tx, y: ty };
    // 目标穿墙时依次尝试±52°、±97°的通路；落点外推另行兜底。
    try {
      const terrain = g.world?.terrain;
      if (terrain && ((terrain.rects?.length ?? 0) + (terrain.circles?.length ?? 0)) > 0) {
        const pad = (p.radius ?? 12) + 14;
        const mdx = mix.x - p.x, mdy = mix.y - p.y;
        const md = Math.hypot(mdx, mdy);
        if (md > 60) {   // 短移动不预判（绕行本身有走位成本）
          const blocked = (x: number, y: number) => blockedAt(terrain, x, y, pad);
          const pathHit = [0.35, 0.65, 1.0].some((k) => blocked(p.x + mdx * k, p.y + mdy * k));
          if (pathHit) {
            const baseA = Math.atan2(mdy, mdx);
            let done = false;
            for (const da of [0.9, -0.9, 1.7, -1.7]) {
              const a = baseA + da;
              const nx = p.x + Math.cos(a) * md, ny = p.y + Math.sin(a) * md;
              if (!blocked(p.x + (nx - p.x) * 0.5, p.y + (ny - p.y) * 0.5) && !blocked(nx, ny)) {
                mix = { x: nx, y: ny };
                done = true;
                break;
              }
            }
            if (!done) mix = { x: p.x * 0.55, y: p.y * 0.55 };   // 四面全堵 → 拉回身位
          }
        }
      }
    } catch { /* 地形异常不影响走位 */ }
    // 目标落入生成预警240px范围时推出危险区，避免站在即将生成的怪身上。
    try {
      const warns = g.world?.waves.read().warnings;
      if (Array.isArray(warns) && warns.length) {
        for (const w of warns) {
          const dx = mix.x - w.x, dy = mix.y - w.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < 240) {
            const push = (240 - d) + 60;   // 推出危险半径再多让 60px
            mix = { x: mix.x + (dx / d) * push, y: mix.y + (dy / d) * push };
          }
        }
      }
    } catch { /* 预告列表异常不影响走位 */ }
    // 移动目标避让真实地形，避免局部最优方向把AI持续压进障碍。
    try {
      const terrain = g.world?.terrain;
      if (terrain && ((terrain.rects?.length ?? 0) + (terrain.circles?.length ?? 0)) > 0) {
        const pad = (p.radius ?? 12) + 18;
        if (blockedAt(terrain, mix.x, mix.y, pad)) {
          // 找包含/最贴近落点的障碍，拿它的中心当"外推源"；外推量按
          // 障碍**实际尺寸**算（实验室地砖 ~290px 见方，推 90px 还在砖里）
          let cx = 0, cy = 0, halfSpan = 0, best = Infinity;
          for (const r of (terrain.rects ?? [])) {
            const mx = (r.x0 + r.x1) / 2, my = (r.y0 + r.y1) / 2;
            const d = Math.hypot(mix.x - mx, mix.y - my);
            if (d < best) {
              best = d; cx = mx; cy = my;
              halfSpan = Math.max(r.x1 - r.x0, r.y1 - r.y0) / 2;   // 半宽
            }
          }
          for (const c of (terrain.circles ?? [])) {
            const d = Math.hypot(mix.x - c.cx, mix.y - c.cy);
            if (d < best) { best = d; cx = c.cx; cy = c.cy; halfSpan = c.r; }
          }
          let dx = mix.x - cx, dy = mix.y - cy;
          const d = Math.hypot(dx, dy) || 1;
          dx /= d; dy /= d;
          const push = halfSpan + pad + 26;   // 半宽 + 身位余量，保证出墙
          let nx = cx + dx * push, ny = cy + dy * push;
          if (blockedAt(terrain, nx, ny, pad)) {
            // 外推还堵（落点在障碍另一侧/贴角落）：改朝场心拉
            nx = mix.x * 0.4; ny = mix.y * 0.4;
          }
          mix = { x: nx, y: ny };
        }
      }
    } catch { /* 地形异常不影响走位 */ }
    // 挑战环绕不使用普通移动迟滞；目标变化很小仍须更新，防止四角挂机。
    if (bossE && !vergilMode) {
      mix = { x: mix.x * 0.68 + bossE.x * 0.32, y: mix.y * 0.68 + bossE.y * 0.32 };
    }
    // ---- 197 轮：偶发走位失误（只在非救援/非拆箱的常规走位阶段；救援与拆箱在更早处已 return）----
    // 每个决策拍以 (拍长秒数 / stumbleEvery) 的概率开始一次踉跄：stumbleDur 秒内朝随机方向走，无视目标。
    if (S.stumbleEvery) {
      const nowS = this._fr / 60;
      if (!this._stumble && this._rnd() < (per / 60) / S.stumbleEvery) {
        this._stumble = { until: nowS + S.stumbleDur, ang: this._rnd() * Math.PI * 2 };
      }
      if (this._stumble) {
        if (nowS < this._stumble.until) {
          let sx = p.x + Math.cos(this._stumble.ang) * 140, sy = p.y + Math.sin(this._stumble.ang) * 140;
          if (this._bossArenaClamp) ({ x: sx, y: sy } = this._bossArenaClamp({ x: sx, y: sy }));
          this._dodgeNow = true;
          this.target = { x: sx, y: sy };
          return;
        }
        this._stumble = null;
      }
    }
    if (!vergilMode && !bossE && this._tgt && Math.hypot(mix.x - this._tgt.x, mix.y - this._tgt.y) < 26) return;
    // 生成预警和地形避让后的最终目标仍需限制在当前挑战场地内。
    if (this._bossArenaClamp) mix = this._bossArenaClamp(mix);
    this._tgt = mix;
    // 直设实体自己的 agentMoveTarget（第一百七十一轮修复，不走全局 doAction）
    this.target = { x: mix.x, y: mix.y };
  }

  // 预测多个未来时点和候选方向的弹幕距离，选择安全空隙；保持既有扫描与决策频率。
  // 芙兰代打主动使用消弹保命；判断使用真实冷却、弹幕威胁与血线。
  _maybePurge(world: World, p: Player, encounter: ChallengeObservation) {
    if (!encounter.purgeReady) return false;
    const ebs = world?.enemyBullets?.items;
    if (!Array.isArray(ebs)) return false;
    const myR = p.hitR ?? p.radius ?? 10;
    let imminent = 0;
    for (const b of ebs) {
      if (!b || b.dead) continue;
      const dx = p.x - b.x, dy = p.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 > 140 * 140) continue;
      const sp = b.speed ?? 0; if (sp < 30) continue;
      const vx = Math.cos(b.angle ?? 0) * sp, vy = Math.sin(b.angle ?? 0) * sp;
      const tcl = (dx * vx + dy * vy) / (sp * sp);          // 最近点时刻
      if (tcl < 0 || tcl > 0.3) continue;
      const mx = dx - vx * tcl, my = dy - vy * tcl;
      if (Math.hypot(mx, my) < (b.hitRadius ?? b.radius ?? 6) + myR + 10) imminent++;
      if (imminent >= 1) break;
    }
    if (imminent < 1) return false;   // 冷却只有 15s、手动触发还送 1s 无敌：有 1 颗确定会命中就按，不省着
    this.clear = true;
    return true;
  }
  _safeStep(g: ActiveCombatContext, p: Player, tx: number, ty: number, arena: Arena) {
    const S = this._skillCfg();
    // 197 轮：走神——整次预测被跳过（返回原目标，当没看见）。pro 为 0
    if (S.safeSkip && this._rnd() < S.safeSkip) return { x: tx, y: ty, danger: 0 };
    const world = g.world;
    const ebs = world?.enemyBullets?.items;
    const SCAN = 290;
    const th: number[] = [];   // 扁平数组：x, y, vx, vy, r
    if (Array.isArray(ebs)) {
      for (const b of ebs) {
        if (!b || b.dead || b.hostileToEnemies) continue;
        const dx = b.x - p.x, dy = b.y - p.y;
        if (dx * dx + dy * dy > SCAN * SCAN) continue;
        const sp = b.speed ?? 0;
        th.push(b.x, b.y, b.vx || Math.cos(b.angle ?? 0) * sp, b.vy || Math.sin(b.angle ?? 0) * sp, b.hitRadius ?? b.radius ?? 7);
      }
    }
    const lasers = g.challenge.lasers;
    const crosses = g.challenge.crosses;
    if (!th.length && !lasers.length && !crosses.length) return { x: tx, y: ty, danger: 0 };

    const myR = p.hitR ?? p.radius ?? 10;
    const spd = Math.max(120, (p.baseSpeed ?? 220) * (p.stats?.moveSpeedMultiplier ?? 1));
    const TAUS = S.taus;   // 197 轮：预测地平线随档位（pro 0.52s / normal 0.36s / rookie 0.22s）
    const minX = arena.cx - arena.hw + 40, maxX = arena.cx + arena.hw - 40;
    const minY = arena.cy - arena.hh + 40, maxY = arena.cy + arena.hh - 40;

    // 非弹危险区代价：激光射线 / 南瓜十字（预警期也避，免得到点才反应）
    const safety = { halfWidth: 20, rayLength: 40, crossRadius: 25, anticipation: .12 };
    const hazard = (x: number, y: number, tau: number) => {
      let cost = 0;
      for (const w of lasers) {
        if (tau >= w.activeAfter + w.activeFor) continue;
        if (w.sweepAngle != null) {
          const dx = x - w.x, dy = y - w.y, d = Math.hypot(dx, dy);
          if (d < 1 || d > w.length + safety.rayLength) continue;
          let da = Math.atan2(dy, dx) - w.angle;
          while (da > Math.PI) da -= 2 * Math.PI;
          while (da < -Math.PI) da += 2 * Math.PI;
          const sgn = w.sweepAngle >= 0 ? 1 : -1, off = da * sgn, half = Math.atan((w.halfWidth + safety.halfWidth) / d);
          if (off >= -half && off <= Math.abs(w.sweepAngle) + half) cost += 70;
          continue;
        }
        if (tau < w.activeAfter - safety.anticipation) continue;
        const ang = w.angle + w.angularVelocity * tau;
        const dx = x - w.x, dy = y - w.y;
        const proj = dx * Math.cos(ang) + dy * Math.sin(ang);
        if (proj <= 0 || proj > w.length + safety.rayLength) continue;
        if (Math.abs(-dx * Math.sin(ang) + dy * Math.cos(ang)) < w.halfWidth + safety.halfWidth) cost += 70;
      }
      for (const pk of crosses) {
        if (tau < pk.activeAfter - safety.anticipation || tau >= pk.activeAfter + pk.activeFor) continue;
        const dx = x - pk.x, dy = y - pk.y;
        if ((Math.abs(dx) < pk.halfWidth + safety.halfWidth || Math.abs(dy) < pk.halfWidth + safety.halfWidth)
          && Math.hypot(dx, dy) < pk.radius + safety.crossRadius) cost += 70;
      }
      return cost;
    };

    let best = null, bestScore = -Infinity, stayClear = 99;
    for (let k = -1; k < S.dirs; k++) {
      const ang = k < 0 ? 0 : (k * 2 * Math.PI) / S.dirs;   // pro: 16 向，与旧版 k*π/8 逐位相同
      const ux = k < 0 ? 0 : Math.cos(ang), uy = k < 0 ? 0 : Math.sin(ang);
      let clear = 99, hz = 0, lx = p.x, ly = p.y;
      for (const tau of TAUS) {
        const x = Math.max(minX, Math.min(maxX, p.x + ux * spd * tau));
        const y = Math.max(minY, Math.min(maxY, p.y + uy * spd * tau));
        lx = x; ly = y;
        for (let i = 0; i < th.length; i += 5) {
          const bx = th[i] + th[i + 2] * tau, by = th[i + 1] + th[i + 3] * tau;
          const gap = Math.hypot(x - bx, y - by) - (myR + th[i + 4] + 6);
          if (gap < clear) clear = gap;
        }
        if (lasers.length || crosses.length) hz += hazard(x, y, tau);
      }
      if (k < 0) stayClear = clear;
      const c = clear < 0 ? clear * 3 : Math.min(clear, 36);
      const score = c - hz - Math.hypot(lx - tx, ly - ty) * 0.06 + (S.scoreNoise ? (this._rnd() - 0.5) * S.scoreNoise : 0);
      if (score > bestScore) { bestScore = score; best = { ux, uy, k }; }
    }
    if (!best || best.k < 0) return { x: p.x, y: p.y, danger: stayClear < 30 ? 1 : 0, stay: true };
    return { x: p.x + best.ux * 160, y: p.y + best.uy * 160, danger: stayClear < 30 ? 1 : 0 };
  }

  /** 420 内最近拾取物（巡逻时顺路捡） */
  _nearestPickup(g: MovementContext, p: Player) {
    try {
      const items = g.world?.pickups?.items;
      if (!Array.isArray(items)) return null;
      let best = null, bestD = 420;
      for (const it of items) {
        if (!it || it.dead) continue;
        const d = Math.hypot(it.x - p.x, it.y - p.y);
        if (d < bestD) { bestD = d; best = it; }
      }
      return best;
    } catch { return null; }
  }

  /** 第一百六十九轮：安全掉落 —— 范围内且自身离最近怪 >220 的掉落 */
  _safePickup(g: MovementContext, p: Player, maxD: number) {
    try {
      const items = g.world?.pickups?.items;
      const enemies = g.world?.enemies?.items;
      if (!Array.isArray(items)) return null;
      let best = null, bestD = maxD;
      for (const it of items) {
        if (!it || it.dead) continue;
        const d = Math.hypot(it.x - p.x, it.y - p.y);
        if (d >= bestD) continue;
        let minE = Infinity;
        if (Array.isArray(enemies)) {
          for (const e of enemies) {
            if (!e || e.dead || e.isChest) continue;
            const ed = Math.hypot(it.x - e.x, it.y - e.y);
            if (ed < minE) minE = ed;
          }
        }
        if (minE > 220) { bestD = d; best = it; }
      }
      return best;
    } catch { return null; }
  }

  /** 第一百六十九轮：吸附 —— 逃跑方向锥（夹角 <45°、距离 <180）内的
   *  安全掉落（自身离怪 >200），逃跑路上顺路吃 */
  _pickupOnPath(g: MovementContext, p: Player, dirX: number, dirY: number) {
    try {
      const m = Math.hypot(dirX, dirY) || 1;
      const ux = dirX / m, uy = dirY / m;
      const items = g.world?.pickups?.items;
      const enemies = g.world?.enemies?.items;
      if (!Array.isArray(items)) return null;
      let best = null, bestD = 180;
      for (const it of items) {
        if (!it || it.dead) continue;
        const dx = it.x - p.x, dy = it.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d < 1 || d > 180) continue;
        if ((dx * ux + dy * uy) / d <= 0.7 || d >= bestD) continue;
        let minE = Infinity;
        if (Array.isArray(enemies)) {
          for (const e of enemies) {
            if (!e || e.dead || e.isChest) continue;
            const ed = Math.hypot(it.x - e.x, it.y - e.y);
            if (ed < minE) minE = ed;
          }
        }
        if (minE > 200) { bestD = d; best = it; }
      }
      return best;
    } catch { return null; }
  }

  /** 最近的拾取物对走位的吸引（只追 420 内的，弱权重） */
  _pickupPull(g: MovementContext, p: Player, axis: 'x' | 'y') {
    try {
      const items = g.world?.pickups?.items;
      if (!Array.isArray(items)) return 0;
      let best = null, bestD = 420;
      for (const it of items) {
        if (!it || it.dead) continue;
        const d = Math.hypot(it.x - p.x, it.y - p.y);
        if (d < bestD) { bestD = d; best = it; }
      }
      if (!best) return 0;
      return (best[axis] - p[axis]) * 0.25;
    } catch { return 0; }
  }

}
