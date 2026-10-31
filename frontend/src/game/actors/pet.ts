import type { Player } from './player.ts';
import type { EnemyBody } from './enemy.ts';
import type { Chest } from './chest.ts';
import type { Pickup } from './pickup.ts';
import type { World } from '../world/world.ts';
import type { CombatTarget } from '../combat/types.ts';
export type PetSpeechKind = 'line' | 'heal' | 'pickup' | 'vacuum' | 'freeItem';
export type PetState = 'follow' | 'attack' | 'fetch' | 'heal';

/** Entry replay state. Entity targets are owned by the live world and are never persisted. */
export interface PetSnapshot {
  rngState: number;
  fields: {
    state: PetState;
    x: number;
    y: number;
    vx: number;
    vy: number;
    facing: number;
    attackCd: number;
    healCd: number;
    healsGiven: number;
    pickedUp: number;
    kills: number;
    damageDealt: number;
    vacuumCd: number;
    vacuumsUsed: number;
    vacuumAnim: number;
    bobPhase: number;
    walkPhase: number;
    attackAnim: number;
    healAnim: number;
    stealAnim: number;
    emote: string;
    line: string;
    lineTimer: number;
    _pickupLineCd: number;
    age: number;
  };
}

// 宠物跟随玩家、索敌、治疗与拾取；战斗力随玩家成长，奖励仍归玩家。

import { Entity } from './entity.ts';
import { clamp, dist } from '../math/geometry.ts';
import { RNG } from '../math/random.ts';
import { WEAPONS } from '../content/weapons.ts';
import {
  PET_HEAL_LINES, PET_PICKUP_LINES, PET_FREE_ITEM_LINES, makeLinePicker,
} from '../content/pet-lines.ts';

// ---- 可调参数 ----
const FOLLOW_DISTANCE = 58;     // 跟随时想保持的距离
const LEASH = 260;              // 超过这个距离就必须回来（"不会离玩家太远"）
const ATTACK_RANGE = 190;       // 索敌范围
const PICKUP_RANGE = 240;       // 帮忙捡东西的范围
const PET_RADIUS = 11;
const BASE_SPEED = 215;

// 回血
export const PET_HEAL_THRESHOLD = 0.5;   // 玩家血量低于这个比例才触发
export const PET_HEAL_RATIO = 0.2;       // 回 20% 最大生命
export const PET_HEAL_COOLDOWN = 15;     // 冷却 15 秒

// 大范围吸取以宠物为圆心，只吸经验和材料，医疗包留给玩家。
export const PET_VACUUM_RADIUS = 420;    // 吸取半径（比平时的 240 大一截）
export const PET_VACUUM_COOLDOWN = 15;   // 冷却 15 秒

// 战斗中攒够6件掉落才吸取；不要求完全无敌人，避免后期永不触发。
export const PET_VACUUM_MIN_PICKUPS = 6;

/**
 * 白色（T1）武器的平均 DPS 基准。
 * 从武器表实时算出来，而不是写死一个数字 ——
 * 以后调整 T1 武器数值时宠物会自动跟着变。
 */
export function whiteWeaponBaseline() {
  const t1 = WEAPONS.filter((w) => w.tier === 1 && w.kind !== 'turret');
  if (t1.length === 0) return { damage: 6, cooldown: 0.8 };
  let dmg = 0, cd = 0;
  for (const w of t1) { dmg += (w.damage ?? 5); cd += (w.cooldown ?? 0.8); }
  return { damage: dmg / t1.length, cooldown: cd / t1.length };
}

/** 宠物的种类（用户之后给图，这里先留好扩展位） */
export const PET_TYPES = {
  kitten: {
    id: 'kitten',
    name: '小小猫娘',
    color: '#ffe0ec',
    accent: '#ff7bac',
    radius: PET_RADIUS,
  },
};

const PET_TYPE_BY_ID = new Map(Object.entries(PET_TYPES));

export class Pet extends Entity<[Player, World]> {
  def: typeof PET_TYPES.kitten;
  invulnerable: boolean;
  state: PetState;
  facing: number;
  attackCd: number;
  healCd: number;
  healsGiven: number;
  pickedUp: number;
  kills: number;
  damageDealt: number;
  vacuumCd: number;
  vacuumsUsed: number;
  vacuumAnim: number;
  bobPhase: number;
  walkPhase: number;
  attackAnim: number;
  healAnim: number;
  stealAnim: number;
  emote: string;
  rng: RNG;
  _healLine: () => string;
  _pickupLine: () => string;
  _freeItemLine: () => string;
  line: string;
  lineTimer: number;
  _pickupLineCd: number;
  target: EnemyBody | Chest | null;
  fetchTarget: Pickup | null;
  _baseline: { damage: number; cooldown: number };
  declare player?: Player;

  captureState(): PetSnapshot {
    return { fields: {
      state: this.state,
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      facing: this.facing,
      attackCd: this.attackCd,
      healCd: this.healCd,
      healsGiven: this.healsGiven,
      pickedUp: this.pickedUp,
      kills: this.kills,
      damageDealt: this.damageDealt,
      vacuumCd: this.vacuumCd,
      vacuumsUsed: this.vacuumsUsed,
      vacuumAnim: this.vacuumAnim,
      bobPhase: this.bobPhase,
      walkPhase: this.walkPhase,
      attackAnim: this.attackAnim,
      healAnim: this.healAnim,
      stealAnim: this.stealAnim,
      emote: this.emote,
      line: this.line,
      lineTimer: this.lineTimer,
      _pickupLineCd: this._pickupLineCd,
      age: this.age,
    }, rngState: this.rng.state };
  }

  restoreState(snapshot: PetSnapshot): void {
    this.state = snapshot.fields.state;
    this.x = snapshot.fields.x;
    this.y = snapshot.fields.y;
    this.vx = snapshot.fields.vx;
    this.vy = snapshot.fields.vy;
    this.facing = snapshot.fields.facing;
    this.attackCd = snapshot.fields.attackCd;
    this.healCd = snapshot.fields.healCd;
    this.healsGiven = snapshot.fields.healsGiven;
    this.pickedUp = snapshot.fields.pickedUp;
    this.kills = snapshot.fields.kills;
    this.damageDealt = snapshot.fields.damageDealt;
    this.vacuumCd = snapshot.fields.vacuumCd;
    this.vacuumsUsed = snapshot.fields.vacuumsUsed;
    this.vacuumAnim = snapshot.fields.vacuumAnim;
    this.bobPhase = snapshot.fields.bobPhase;
    this.walkPhase = snapshot.fields.walkPhase;
    this.attackAnim = snapshot.fields.attackAnim;
    this.healAnim = snapshot.fields.healAnim;
    this.stealAnim = snapshot.fields.stealAnim;
    this.emote = snapshot.fields.emote;
    this.line = snapshot.fields.line;
    this.lineTimer = snapshot.fields.lineTimer;
    this._pickupLineCd = snapshot.fields._pickupLineCd;
    this.age = snapshot.fields.age;
    this.rng.state = snapshot.rngState;
    this.target = null;
    this.fetchTarget = null;
  }

  constructor(typeId: string, player: Pick<Player, 'x' | 'y'>) {
    super();
    this.def = PET_TYPE_BY_ID.get(typeId) || PET_TYPES.kitten;
    this.radius = this.def.radius;
    this.invulnerable = true;      // 默认无敌（用户要求）

    // 出生在玩家旁边
    this.x = player.x + 40;
    this.y = player.y + 20;
    this.vx = 0;
    this.vy = 0;

    // 行为
    this.state = 'follow';         // follow | attack | fetch | heal
    this.facing = 0;
    this.attackCd = 0;
    this.healCd = 0;               // 回血冷却剩余
    this.healsGiven = 0;
    this.pickedUp = 0;             // 帮忙捡了多少件
    this.kills = 0;
    this.damageDealt = 0;
    // 大范围吸取（见 PET_VACUUM_* 的说明）。
    // 初始给一个较短的"首触"冷却，免得开局第一帧就吸一次 ——
    // 那时场上还没有掉落物，吸了也没观感。
    this.vacuumCd = 6;
    this.vacuumsUsed = 0;
    this.vacuumAnim = 0;           // 吸取特效的动画计时

    // 动画
    this.bobPhase = 0;
    this.walkPhase = 0;
    this.attackAnim = 0;
    this.healAnim = 0;
    // 偷取表情使用会自然衰减的计时器，显示从计时器推导。
    this.stealAnim = 0;
    this.emote = '';               // 头顶小表情（! / ♥ / …）

    // 台词使用独立随机流，避免一句反馈改变后续战斗抽取。
    this.rng = new RNG(20250815);
    // 三个"洗牌袋"取词器（见 data/pet-lines.js 的 makeLinePicker）。
    // 每类 10 句，抽完一轮之前不重复。
    const rand = () => this.rng.next();
    this._healLine = makeLinePicker(PET_HEAL_LINES, rand);
    this._pickupLine = makeLinePicker(PET_PICKUP_LINES, rand);
    this._freeItemLine = makeLinePicker(PET_FREE_ITEM_LINES, rand);
    // 最近说的一句 + 剩余显示时间。
    // 渲染器据此在头顶画气泡（和 emote 一样的计时器套路）。
    this.line = '';
    this.lineTimer = 0;
    // 拾取台词要**节流**：捡东西一帧可能连捡 5 件，
    // 每件都说一句会把气泡刷成走马灯（而且听起来像卡带）。
    this._pickupLineCd = 0;

    // 目标缓存
    this.target = null;
    this.fetchTarget = null;

    // 基准伤害（对标白色武器）
    this._baseline = whiteWeaponBaseline();
  }

  /** 宠物不受伤（无敌）：保留接口，方便以后做"宠物也会掉血"的玩法 */
  takeDamage() { return 0; }

  // 气泡立即更新，语音交给外部事件；台词抽取不消费世界随机流。
  say(text: string, holdMs = 1800, world: World | null = null, kind: PetSpeechKind = 'line') {
    if (!text) return;
    this.line = text;
    this.lineTimer = holdMs / 1000;
    world?.onPetSay?.(this, text, kind);
  }

  /** 治疗台词（治疗技能触发时调用） */
  sayHeal(world: World) { this.say(this._healLine(), 1800, world, 'heal'); }

  // 拾取反馈受独立冷却限制，避免密集掉落刷屏。
  sayPickup(world: World) {
    if (this._pickupLineCd > 0) return;
    this._pickupLineCd = 1.6;
    this.say(this._pickupLine(), 1600, world, 'pickup');
  }

  // 范围吸取只在确实收取物品后播报，避免空技能刷反馈。
  sayVacuum(world: World) {
    this.say(this._pickupLine(), 1800, world, 'vacuum');
  }

  /** 从商店拿到免费道具时的台词（注意：措辞是"帮你拿到"，不含"偷"） */
  sayFreeItem(world: World) { this.say(this._freeItemLine(), 2600, world, 'freeItem'); }

  // 宠物伤害和攻速使用白色武器基准，再乘玩家对应属性。
  get damage() {
    const s = this.player?.stats.values;
    if (!s) return this._baseline.damage;
    return this._baseline.damage * (1 + s.damage / 100);
  }

  get attackInterval() {
    const s = this.player?.stats.values;
    const aspd = s ? s.attackSpeed : 0;
    return Math.max(0.18, this._baseline.cooldown / (1 + aspd / 100));
  }

  update(dt: number, player: Player, world: World) {
    this.age += dt;
    this.player = player;
    this.bobPhase += dt * 4;
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.healCd > 0) this.healCd -= dt;
    if (this.vacuumCd > 0) this.vacuumCd -= dt;
    if (this.attackAnim > 0) this.attackAnim -= dt;
    if (this.healAnim > 0) this.healAnim -= dt;
    if (this.vacuumAnim > 0) this.vacuumAnim -= dt;
    if (this.stealAnim > 0) this.stealAnim -= dt;
    // 第十五轮 ③：台词气泡与拾取台词的节流计时
    if (this.lineTimer > 0) this.lineTimer -= dt;
    if (this._pickupLineCd > 0) this._pickupLineCd -= dt;

    // ---- 行为分派 ----
    // 优先级：回血 > 打架 > 捡东西 > 跟随
    if (this._tryHeal(player, world)) {
      this._moveToward(player.x, player.y, dt, 1.15);
      return;
    }

    const toPlayer = dist(this.x, this.y, player.x, player.y);
    // 离得太远就无条件回来（"不会离玩家太远"）
    if (toPlayer > LEASH) {
      this.state = 'follow';
      this._moveToward(player.x, player.y, dt, 1.35);
      this._face(player.x, player.y);
      return;
    }

    // 芙兰战只跟随护卫，确保以宠物为圆心的消弹光圈覆盖玩家。
    this.target = world.challenge?.rules.disablesPetAttack ? null : this._findEnemy(world);
    this.fetchTarget = this._findPickup(world);

    // 吸取按冷却触发；不要求全场无敌人，否则后期战斗几乎永不触发。
    if (this.vacuumCd <= 0) {
      const minCount = this.target ? PET_VACUUM_MIN_PICKUPS : 1;
      this._tryVacuum(world, player, minCount);
    }

    // 顺手拾取在攻击分支之前执行，战斗期间也能收取碰到的掉落。
    this._grabTouching(world, player);

    // ---- 决定：去捡东西还是去打人 ----
    // 规则简单且可预测：**谁近做谁**。
    // 用距离比较而不是固定优先级，是因为两者的"值得做"程度本来就随
    // 距离变化：脚边的金币顺手就捡了，远处的怪才值得专门跑过去。
    if (this.fetchTarget) {
      const dp = dist(this.x, this.y, this.fetchTarget.x, this.fetchTarget.y);
      const de = this.target ? dist(this.x, this.y, this.target.x, this.target.y) : Infinity;
      if (dp <= de) {
        this.state = 'fetch';
        const p = this.fetchTarget;
        this._face(p.x, p.y);
        this._moveToward(p.x, p.y, dt, 1.1);
        if (dist(this.x, this.y, p.x, p.y) < this.radius + p.radius + 6) {
          this._collect(p, world, player);
        }
        return;
      }
    }

    if (this.target) {
      this.state = 'attack';
      this._doAttack(dt, world);
      return;
    }

    this.state = 'follow';
    this._followPlayer(dt, player);
  }

  // 直接收取已经接触的掉落；目标寻路与接触拾取分开。
  _grabTouching(world: World, player: Player) {
    const list = world?.pickups?.items;
    if (!list || list.length === 0) return 0;
    let n = 0;
    // 收集后再结算：_collect 会把 pickup.dead 置位，边遍历边改容易漏。
    const touch = [];
    for (const p of list) {
      if (p.dead) continue;
      if (p.type !== 'xp' && p.type !== 'material') continue;
      const r = this.radius + p.radius + 10;
      const dx = p.x - this.x, dy = p.y - this.y;
      if (dx * dx + dy * dy <= r * r) touch.push(p);
    }
    for (const p of touch) { this._collect(p, world, player); n++; }
    return n;
  }

  // 回血
  _tryHeal(player: Player, world: World) {
    if (this.healCd > 0) return false;
    if (player.dead) return false;
    const max = player.stats.get('maxHp');
    if (max <= 0) return false;
    const ratio = player.hp / max;
    if (ratio >= PET_HEAL_THRESHOLD) return false;

    // 触发一次 20% 最大生命的回复，然后进入 15 秒冷却
    const amount = max * PET_HEAL_RATIO;
    // force：芙兰战 noHeal 唯一合法豁免（第四十九轮明确保留小小猫娘半血治疗）
    const healed = player.heal(amount, { force: true });
    // 治疗触发时，所有存活且非倒地队员各回自身最大生命的20%。
    let teamHealed = 0;
    for (const pl of (world.players?.() ?? [player])) {
      if (!pl || pl === player || pl.dead || pl.downed) continue;
      const m2 = pl.stats?.get?.('maxHp') ?? 0;
      if (m2 > 0 && pl.hp > 0) teamHealed += pl.heal(m2 * PET_HEAL_RATIO, { force: true });
    }
    if (teamHealed > 0) {
      world.fx?.damageText(player.x, player.y - 52, `全队 +${Math.round(teamHealed)}`, false, '#6ee7b7');
    }
    this.healCd = PET_HEAL_COOLDOWN;
    this.healsGiven++;
    this.healAnim = 0.7;
    this.emote = 'heart';
    // 第十五轮 ③：治疗台词
    this.sayHeal(world);

    world.fx?.sparkle(this.x, this.y, '#ff7bac');
    world.fx?.ring(this.x, this.y, 34, '#ff7bac', 0.5);
    world.fx?.damageText(player.x, player.y - 30, `+${Math.round(healed)}`, false, '#6ee7a8');
    world.onPetHeal?.(this, healed);
    return true;
  }

  // 索敌与攻击
  _findEnemy(world: World) {
    if (!world.grid) return null;
    // 优先打最近的；用 grid 的 nearest 避免遍历全部敌人
    const target = world.grid.nearest(this.x, this.y, ATTACK_RANGE, (e: CombatTarget) => e.isEnemy === true && !e.dead);
    return target?.isEnemy === true ? target : null;
  }

  _doAttack(dt: number, world: World) {
    const t = this.target;
    if (!t || t.dead) { this.target = null; return; }
    this._face(t.x, t.y);

    const d = dist(this.x, this.y, t.x, t.y);
    // 贴身一点再打（远程距离也够得着，但走过去打更有"一起上"的感觉）
    if (d > this.radius + t.radius + 8) {
      this._moveToward(t.x, t.y, dt, 1.2);
    } else {
      // 到身位了就停住，避免抖
      this.vx *= 0.6; this.vy *= 0.6;
    }

    if (this.attackCd > 0) return;
    if (d > ATTACK_RANGE) return;

    this.attackCd = this.attackInterval;
    this.attackAnim = 0.22;

    const dealt = world.petDealDamage(this, t, this.damage);
    this.damageDealt += Number(dealt);
    if (t.dead) this.kills++;
  }

  // 捡东西
  _findPickup(world: World) {
    let best = null, bestD = PICKUP_RANGE;
    for (const p of world.pickups.items) {
      if (p.dead) continue;
      // 只帮忙捡经验和材料（医疗包留给玩家自己踩，避免抢手感）
      if (p.type !== 'xp' && p.type !== 'material') continue;
      const d = dist(this.x, this.y, p.x, p.y);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  _collect(pickup: Pickup, world: World, player: Player) {
    pickup.dead = true;
    this.pickedUp++;
    if (pickup.type === 'xp') player.gainXp(pickup.value);
    else if (pickup.type === 'material') player.gainMaterials(pickup.value);
    world.fx?.sparkle(pickup.x, pickup.y, '#ffd166');
    world.onPickup?.(pickup);
    // 顺手捡与范围吸取共用拾取反馈入口，sayPickup统一限频。
    this.sayPickup(world);
  }

  // 只回收吸取范围内的经验与材料，医疗包排除；奖励通过统一拾取结算。
  _tryVacuum(world: World, player: Player, minCount = 1) {
    // 冷却由技能自己把关，而不是只靠调用方 ——
    // 这样以后别的地方（比如某个道具"立刻刷新宠物技能"）调这个函数时，
    // 也不会绕过冷却。
    if (this.vacuumCd > 0) return 0;

    const list = world?.pickups?.items;
    if (!list || list.length === 0) return 0;

    // 先收集，再结算 —— 不能边遍历边改 dead 标记（_collect 会改）。
    const hit = [];
    const r2 = PET_VACUUM_RADIUS * PET_VACUUM_RADIUS;
    for (const p of list) {
      if (p.dead) continue;
      if (p.type !== 'xp' && p.type !== 'material') continue;
      const dx = p.x - this.x, dy = p.y - this.y;
      if (dx * dx + dy * dy <= r2) hit.push(p);
    }

    // 没有收取或未攒够最低数量时不消耗技能冷却。
    if (hit.length === 0) return 0;
    if (hit.length < minCount) return 0;

    for (const p of hit) this._collect(p, world, player);

    // 范围吸取结算后补专用反馈，覆盖循环里受限频的普通拾取台词。
    this.sayVacuum(world);

    this.vacuumCd = PET_VACUUM_COOLDOWN;
    this.vacuumsUsed++;
    // 只维护动画计时器，表情由显示推导。
    this.vacuumAnim = 0.5;
    // 视觉反馈：一圈扩散的环 + 从她身上散出的光点
    world.fx?.ring?.(this.x, this.y, PET_VACUUM_RADIUS * 0.5, '#ffe0ec', 0.5);
    world.fx?.nova?.(this.x, this.y, PET_VACUUM_RADIUS * 0.35, '#ffd166');
    return hit.length;
  }

  // 移动
  _followPlayer(dt: number, player: Player) {
    const d = dist(this.x, this.y, player.x, player.y);
    // 离得太近就不挤（避免和玩家模型重叠抖动）
    if (d < FOLLOW_DISTANCE) {
      this.vx *= 0.82; this.vy *= 0.82;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      return;
    }
    this._moveToward(player.x, player.y, dt, 1);
  }

  _moveToward(tx: number, ty: number, dt: number, speedMul = 1) {
    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const s = BASE_SPEED * speedMul;
    this.vx = (dx / d) * s;
    this.vy = (dy / d) * s;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.walkPhase += dt * 12;
    this._face(tx, ty);
  }

  _face(tx: number, ty: number) {
    this.facing = Math.atan2(ty - this.y, tx - this.x);
  }

  /** 世界边界 */
  clampToWorld(world: World) {
    const half = world.halfSize - this.radius;
    this.x = clamp(this.x, -half, half);
    this.y = clamp(this.y, -half, half);
  }
}
