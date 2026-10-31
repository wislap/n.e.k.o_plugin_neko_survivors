import type { WeaponId, ItemId, UpgradeId } from '../content/definitions.ts';
import type { World } from '../world/world.ts';
import type { RNG } from '../math/random.ts';
import type { RuleEffects } from '../world/effects-port.ts';
import type { CharacterDefinition, CharacterId, CharacterSkillDefinition, ItemDefinition } from '../content/definitions.ts';
import type { CharRuntime } from './character-skills.ts';
import type { StatModifiers, StatSnapshot } from '../progression/stats.ts';
import { statEntries, serializeStatMods, restoreStatMods } from '../progression/stats.ts';
import type { Point } from '../views.ts';
export interface PlayerInput { moveAxis(): Point; isDown(key: string): boolean; p2SkillSlow?(): boolean }
import type { PlayerDamageOptions, DirectHit, HealthHooks } from '../combat/player-health.ts';
import { receiveDamage, receiveDirectHit, healPlayer, addPlayerShield, downPlayer, rescuePlayer, rescueNeed, rescueRegain, refillLifesteal, applyLifesteal, LIFESTEAL_PROCS_PER_SEC } from '../combat/player-health.ts';
import { playerDefense } from '../abilities/defense.ts';
import { defenseEquipment, applyEquipmentUpgrade } from '../abilities/equipment.ts';
// 玩家实体
// 负责：移动、受伤/回复、经验、材料、武器槽、属性面板

import { Entity } from './entity.ts';
import { StatSheet, defaultBaseStats } from '../progression/stats.ts';
import { clamp } from '../math/geometry.ts';
import { resolveTerrain } from '../world/terrain.ts';
import { getWeapon } from '../content/weapons.ts';
import { getCharacter } from '../content/characters.ts';
import { getItem } from '../content/items.ts';
import { xpForLevel, getUpgrade } from '../content/upgrades.ts';
import { WeaponInstance } from './weapon.ts';
import { getCharSkill } from '../content/char-skills.ts';
import { attachCharRuntime } from './character-skills.ts';

export interface PlayerStatSnapshot extends StatSnapshot { capBonus: StatModifiers }
export interface PlayerWeaponSnapshot { id: WeaponId; level: number; instanceId?: number }
export interface PlayerSnapshot {
  characterId: CharacterId; id: number; x: number; y: number;
  level: number; xp: number; xpNeeded: number; materials: number; hp: number;
  weapons: PlayerWeaponSnapshot[]; items: [ItemId, number][]; upgrades: [UpgradeId, number][]; stats: PlayerStatSnapshot;
  shield: number; maxShield: number; shieldFullBlock: boolean; apPierce: number;
  kills: number; damageDealt: number; damageTaken: number; timeAlive: number;
  charMul: NonNullable<CharacterSkillDefinition['statMul']>; dealtFinalMul: number; takenFinalMul: number;
  xpDebt: number; materialDebt: number; pendingLevelUps: number; armorWave?: number;
}

export const MAX_WEAPONS = 6;

export class Player extends Entity<[PlayerInput, World]> {
  declare _backflip: { t: number; vx: number; vy: number } | null | undefined;
  declare _lastMaxHp: number;
  declare _rescueGate: number;
  declare _rescueIdle: number;
  declare accent: string;
  declare agentMoveTarget: Point | null | undefined;
  declare apPierce: number;
  declare baseSpeed: number;
  declare blinkPhase: number;
  declare blinkTimer: number;
  declare char: CharacterDefinition;
  declare charMul: NonNullable<CharacterSkillDefinition['statMul']>;
  declare characterId: CharacterId;
  declare color: string;
  declare curSpeed: number | undefined;
  declare damageDealt: number;
  declare damageTaken: number;
  declare dealtFinalMul: number;
  declare downCount: number;
  declare downed: boolean;
  declare effects: RuleEffects;
  declare facing: number;
  declare hitR: number;
  declare hp: number;
  declare hurtFlash: number;
  declare wallFlash?: number;
  declare invuln: number;
  declare isMoving: boolean;
  declare items: Map<ItemId, number>;
  declare kills: number;
  declare level: number;
  declare lsBudget: number;
  declare materialDebt: number;
  declare materials: number;
  declare maxShield: number;
  declare mdStacks: number;
  declare pendingLevelUps: number;
  declare presentationRng: RNG;
  declare rescueProgress: number;
  declare rng: RNG;
  declare shield: number;
  declare shieldFullBlock: boolean;
  declare speedBonusMul: number;
  declare stats: StatSheet;
  declare takenFinalMul: number;
  declare timeAlive: number;
  declare upgradesTaken: Map<string, number>;
  declare walkPhase: number;
  declare weapons: WeaponInstance[];
  declare xp: number;
  declare xpDebt: number;
  declare xpNeeded: number;
  declare charRt: CharRuntime; // attachCharRuntime initializes this before the constructor returns.
  declare world: World | undefined;
  declare aimAt: Point | null | undefined;
  declare duoMode: boolean | undefined;
  declare isEnemy?: false;
  declare isPhantom?: false;
  declare pilotBuff: boolean | undefined;
  declare pilotLite?: boolean;
  declare pilotTough?: boolean;
  declare _pilotEarly?: boolean;
  declare _pilotIframe?: number;
  declare _pilotMagnet: number | undefined;
  declare _armorWave: number | undefined;
  declare onHurt: ((damage: number, sourceX: number, sourceY: number) => void) | undefined;
  declare onShieldBreak: (() => void) | undefined;
  declare onDodge: (() => void) | undefined;
  declare onDeath: (() => void) | undefined;
  declare onDown: (() => void) | undefined;
  declare onRevive: (() => void) | undefined;

  /** Growth and equipment entry state; combat transients are replayed by the session. */
  captureState(): PlayerSnapshot {
    return {
      characterId: this.characterId, id: this.id, x: this.x, y: this.y,
      level: this.level, xp: this.xp, xpNeeded: this.xpNeeded,
      materials: this.materials, hp: this.hp,
      shield: this.shield, maxShield: this.maxShield,
      shieldFullBlock: this.shieldFullBlock, apPierce: this.apPierce,
      weapons: this.weapons.map(w => ({ id: w.def.id, level: w.level, instanceId: w.instanceId })),
      items: [...this.items], upgrades: [...this.upgradesTaken].map(([id, count]): [UpgradeId, number] => {
        const definition = getUpgrade(id);
        if (!definition) throw new TypeError('Cannot save an unknown upgrade identity');
        return [definition.id, count];
      }),
      stats: { ...serializeStatMods(this.stats), capBonus: { ...this.stats.capBonus } }, kills: this.kills,
      damageDealt: this.damageDealt, damageTaken: this.damageTaken, timeAlive: this.timeAlive,
      charMul: { ...this.charMul },
      dealtFinalMul: this.dealtFinalMul, takenFinalMul: this.takenFinalMul,
      xpDebt: this.xpDebt, materialDebt: this.materialDebt,
      pendingLevelUps: this.pendingLevelUps,
      armorWave: this._armorWave,
    };
  }
  /** Restore validated growth onto a freshly constructed entry actor. */
  restoreState(data: PlayerSnapshot): void {
    restoreStatMods(this.stats, data.stats);
    for (const [key, value] of statEntries(data.stats.capBonus)) this.stats.addCapBonus(key, value);
    this.weapons.length = 0;
    for (const weapon of data.weapons) {
      const instance = this.addWeapon(weapon.id, weapon.level);
      if (weapon.instanceId !== undefined) instance!.instanceId = weapon.instanceId;
    }
    this.items = new Map(data.items);
    this.upgradesTaken = new Map(data.upgrades);
    for (const key of ['id', 'x', 'y', 'level', 'xp', 'xpNeeded', 'materials', 'hp', 'shield', 'maxShield', 'kills', 'damageDealt',
      'xpDebt', 'materialDebt', 'pendingLevelUps', 'apPierce', 'damageTaken', 'timeAlive', 'dealtFinalMul', 'takenFinalMul'] as const) {
      this[key] = data[key];
    }
    this.shieldFullBlock = data.shieldFullBlock;
    this._lastMaxHp = this.maxHp;
    // Older handovers could round HP above a fractional maximum. Normalize once at restoration.
    this.hp = Math.min(this.hp, this._lastMaxHp);
    this.charMul = { ...data.charMul };
    if (data.armorWave !== undefined) this._armorWave = data.armorWave;
  }

  constructor(characterId: string, rng: RNG, effects: RuleEffects = { emit() {} }) {
    super();
    const char = getCharacter(characterId);
    this.characterId = char.id;
    this.char = char;
    this.rng = rng;
    this.effects = effects;
    this.presentationRng = rng.fork(0x70726c);

    this.radius = 16;
    // 倒地次数须从0开始，避免undefined递增导致救援需求落入错误档位。
    this.downed = false;
    this.downCount = 0;
    this.rescueProgress = 0;
    this._rescueIdle = 0;
    this._rescueGate = 0;
    // 弹幕命中使用0.8倍hitR；身体碰撞、拾取和边界仍使用radius。
    this.hitR = this.radius * 0.8;
    // 默认移速215；后期敌人允许更快，玩家仍需成长移速。
    this.baseSpeed = 215;

    // ---- 属性面板 ----
    this.stats = new StatSheet(defaultBaseStats());
    // 角色的基础值覆盖
    for (const [k, value] of statEntries(char.stats)) this.stats.base[k] = value;
    // 角色的初始修正
    for (const [k, value] of statEntries(char.mods)) this.stats.addFlat(k, value);
    for (const [k, value] of statEntries(char.pct)) this.stats.addPct(k, value);

    // 数量型属性使用StatSheet最终乘算；百分数属性在消费点应用角色倍率。
    const cs = getCharSkill(char.id);
    if (cs?.statsFinalMul) {
      for (const [k, value] of statEntries(cs.statsFinalMul)) this.stats.addFinalMul(k, value);
    }
    this.charMul = { ...(cs?.statMul || {}) };
    // 幸运总效果的角色倍率（悠怡萌妹 = 1.2 → 0.8×1.2 = 0.96）
    if (cs?.luckEffectMul !== undefined) this.stats.luckEffectMul = cs.luckEffectMul;
    // 属性缓存已经算过一轮了，改完 luckEffectMul 要标脏
    this.stats.dirty = true;

    // ---- 生命 ----
    this.hp = this.stats.get('maxHp');
    this._lastMaxHp = this.hp;

    // 护盾是独立生命池，不进属性表；护盾值和上限分别保存。
    this.shield = 0;
    this.maxShield = 0;

    // 完全格挡盾存在时整次伤害由盾承受，即使本击超过余盾也不溢出扣血。
    this.shieldFullBlock = false;

    // 临时技能加速独立于永久StatSheet，过期后归一，不污染成长面板。
    this.speedBonusMul = 1;
    this.mdStacks = 0;       // 开发猫猫的受伤叠层（给渲染/UI 读）

    // ---- 成长 ----
    this.level = 1;
    this.xp = 0;
    this.xpNeeded = xpForLevel(1);
    this.materials = 0;
    this.pendingLevelUps = 0;
    // 补偿按过期物件个数计；后续每次双倍收取消耗1额度，并进入存档。
    this.xpDebt = 0;
    this.materialDebt = 0;
    this.dealtFinalMul = 1; this.takenFinalMul = 1; this.apPierce = 0;

    // ---- 武器 ----
    this.weapons = [];
    this.addWeapon(char.startWeapon);

    // ---- 道具 ----
    this.items = new Map(); // id -> count

    // ---- 升级记录 ----
    this.upgradesTaken = new Map();

    // ---- 战斗状态 ----
    this.facing = -Math.PI / 2;
    this.invuln = 0;
    this.hurtFlash = 0;
    this.isMoving = false;
    this.walkPhase = 0;
    // 吸血每秒最多10次，每次消耗1预算；独立于命中概率与持续回复。
    this.lsBudget = LIFESTEAL_PROCS_PER_SEC;
    // 眨眼使用独立显示随机流，避免全角色固定周期同步。
    this.blinkTimer = 1.5 + this.presentationRng.next() * 3;
    this.blinkPhase = 0;      // > 0 表示正在眨（0.12 秒）

    // ---- 统计 ----
    this.kills = 0;
    this.damageDealt = 0;
    this.damageTaken = 0;
    this.timeAlive = 0;

    // ---- 外观 ----
    this.color = char.color;
    this.accent = char.accent;

    // 技能运行时最后构造，确保它读取的角色身份与属性已初始化。
    attachCharRuntime(this);
  }

  // 角色最终倍率独立于道具加法修正；未声明的倍率为1。
  mulFor(key: keyof NonNullable<CharacterSkillDefinition['statMul']>) {
    const m = this.charMul?.[key];
    return typeof m === 'number' && m > 0 ? m : 1;
  }

  // 武器管理
  get weaponCount() { return this.weapons.length; }
  get hasWeaponSlot() { return this.weapons.length < MAX_WEAPONS; }

  addWeapon(weaponId: string, level = 1) {
    if (this.weapons.length >= MAX_WEAPONS && level === 1) return null;
    const def = getWeapon(weaponId);
    if (!def) return null;
    const inst = new WeaponInstance(def, level);
    this.weapons.push(inst);
    return inst;
  }

  /** 找到某个武器 id 的所有实例 */
  findWeapons(weaponId: string) {
    return this.weapons.filter((w) => w.def.id === weaponId);
  }

  removeWeapon(inst: WeaponInstance) {
    const i = this.weapons.indexOf(inst);
    if (i >= 0) this.weapons.splice(i, 1);
  }

  // 道具
  addItem(itemId: string) {
    const def = getItem(itemId);
    if (!def) return false;
    const count = this.items.get(def.id) || 0;
    if (count >= (def.maxStacks ?? 99)) return false;
    this.items.set(def.id, count + 1);
    this.applyItemMods(def);
    // 最大生命变化时，按比例保留当前血量
    this._refreshMaxHp();
    return true;
  }

  /** 第一百三十四轮：是否拥有某道具（Boss 专属红品的效果查询用） */
  hasItem(itemId: ItemId) {
    return (this.items.get(itemId) || 0) > 0;
  }

  applyItemMods(def: ItemDefinition) {
    for (const [k, value] of statEntries(def.mods)) this.stats.addFlat(k, value);
    for (const [k, value] of statEntries(def.pct)) this.stats.addPct(k, value);
    // 诅咒类（扣最大生命等）走乘算，避免叠加到 1 点血上限
    for (const [k, value] of statEntries(def.curse)) this.stats.addCurse(k, value);
    // 第一百三十四轮：属性上限放宽（黑色披风：闪避上限 80 → 90）
    for (const [k, value] of statEntries(def.statCapBonus)) this.stats.addCapBonus(k, value);
    // 最终伤害/承伤乘区使用独立字段，不能对基础为零的百分数属性做乘算。
    if (def.finalDamageMul) this.dealtFinalMul = this.dealtFinalMul * def.finalDamageMul;
    if (def.finalTakenMul) this.takenFinalMul = this.takenFinalMul * def.finalTakenMul;
    // 道具穿透存为子弹附加参数，叠加上限5，不进入面板属性。
    if (def.apPierce) this.apPierce = Math.min(5, this.apPierce + def.apPierce);
  }

  /** 升级带来的修正。队友固定发育包复用全部等级被动，但不冒充选卡
   * 记录，也保留原先“绝对血量 +6”而非比例回血的规则。 */
  applyUpgrade(def: { id: string; mods?: StatModifiers; pct?: StatModifiers; heal?: number; shieldPct?: number }, { record = true, preserveHealthRatio = true } = {}) {
    applyEquipmentUpgrade(this, this.stats);
    for (const [k, value] of statEntries(def.mods)) this.stats.addFlat(k, value);
    for (const [k, value] of statEntries(def.pct)) this.stats.addPct(k, value);
    if (record) {
      const prev = this.upgradesTaken.get(def.id) || 0;
      this.upgradesTaken.set(def.id, prev + 1);
    }
    if (preserveHealthRatio) this._refreshMaxHp();
    else {
      this._lastMaxHp = this.maxHp;
      this.hp = clamp(this.hp, 1, this._lastMaxHp);
    }
    if (def.heal) this.hp = this.stats.get('maxHp');

    // 先结算回血，再按当前生命上限与本次稀有度比例发护盾。
    const pct = def.shieldPct ?? 0;
    if (pct > 0) {
      this.addShield(this.stats.get('maxHp') * pct);
    }
  }

  // 生命上限变化时同步当前血量，保留既有比例和回血边界语义。
  _refreshMaxHp() {
    const max = this.stats.get('maxHp');
    const prev = this._lastMaxHp;
    if (prev > 0 && Math.abs(max - prev) > 0.001) {
      const ratio = clamp(this.hp / prev, 0, 1);
      this.hp = ratio * max;
    }
    this._lastMaxHp = max;
    this.hp = clamp(this.hp, 1, max);
  }

  get maxHp() { return this.stats.get('maxHp'); }

  // 经验
  gainXp(amount: number) {
    // 经验角色倍率在唯一gainXp入口应用，覆盖拾取、宠物和过波收入。
    const mul = this.charRt?.xpMul?.() ?? 1;
    const gain = mul === 1 ? amount : amount * mul;
    this.xp += gain;
    let leveled = 0;
    while (this.xp >= this.xpNeeded) {
      this.xp -= this.xpNeeded;
      this.level++;
      this.xpNeeded = xpForLevel(this.level);
      this.pendingLevelUps++;
      leveled++;
      if (leveled > 50) break; // 保险
    }
    return leveled;
  }

  // 材料全队共享；通过唯一入账路径发放，避免各成员重复分摊。
  gainMaterials(amount: number) {
    this._gainMaterialsLocal(amount);
    try {
      for (const other of (this.world?.players?.() ?? [])) {
        if (other && other !== this && !other.dead) other._gainMaterialsLocal(amount);
      }
    } catch { /* 共享失败不影响本体到账 */ }
  }

  /** 本体入账（不带共享，供 gainMaterials 的队友侧调用） */
  _gainMaterialsLocal(amount: number) {
    this.materials += amount;
  }

  /** Character abilities and external notifications have a fixed, synchronous order. */
  private readonly healthHooks: HealthHooks = {
    tryLethalSave: (x, y) => this.charRt?.tryLethalSave(x, y) ?? false,
    onHealthDamage: () => this.charRt?.onHurt(),
    onShieldBreak: () => { this.charRt?.onShieldBreak(); this.onShieldBreak?.(); },
    onHurt: (damage, x, y) => this.onHurt?.(damage, x, y),
    onDodge: () => this.onDodge?.(),
    onDeath: () => this.onDeath?.(),
    onDown: () => this.onDown?.(),
    onRevive: () => this.onRevive?.(),
    onKnockdown: () => this.effects.emit({ type: 'sound', name: 'knockdown' }),
    onOverheal: overflow => this.charRt?.healToShield(overflow),
  };

  private readonly damageDefense = this.createDamageDefense();

  private createDamageDefense() {
    const player = this;
    return playerDefense({
      inventory: player,
      get random() { return player.rng; },
      get weather() { return player.world?.weather; },
      get dodge() { return player.stats.get('dodge'); },
      get armorMultiplier() { return player.stats.armorMul; },
      get characterTakenMultiplier() { return player.mulFor('damageTaken'); },
      get equipmentTakenMultiplier() { return player.takenFinalMul; },
      get pilotBuff() { return player.pilotBuff; },
      get pilotLite() { return player.pilotLite; },
      get pilotTough() { return player.pilotTough; },
      get pilotEarly() { return player._pilotEarly; },
      get pilotInvulnerability() { return player._pilotIframe; },
      luckyGuard: () => player.charRt?.rollLuckyGuard() ?? 1,
    });
  }

  takeDamage(amount: number, sourceX: number, sourceY: number, options: PlayerDamageOptions = {}) {
    return receiveDamage(this, amount, sourceX, sourceY, options, this.damageDefense, this.healthHooks);
  }

  receiveHit(hit: DirectHit) {
    return receiveDirectHit(this, hit, this.healthHooks);
  }

  heal(amount: number, options: { force?: boolean } = {}) {
    if (this.world?.challenge?.playerRules(this).blocksHealing && !options.force) return 0;
    const maxHp = this.stats.get('maxHp');
    return healPlayer(this, defenseEquipment.healing(this, amount, this.hp, maxHp), maxHp, this.healthHooks);
  }

  addShield(amount: number, replace = true) {
    return addPlayerShield(this, amount, replace);
  }

  // 每帧更新
  // 救援需求随倒地次数增加；进度表示剩余刀数，3秒未获救援后回涨。
  get rescueNeed() { return rescueNeed(this); }
  get rescueRegain() { return rescueRegain(this); }
  down() { downPlayer(this, this.healthHooks); }
  rescueHit() { return rescuePlayer(this, this.maxHp, this.healthHooks); }

  /** 波次结束：倒下次数清零（第一百七十轮规格） */
  resetDownCount() {
    this.downCount = 0;
  }

  update(dt: number, input: PlayerInput, world: World) {
    this.age += dt;
    this.timeAlive += dt;

    // 倒地者不攻击也不被索敌；救援空闲后按倒地次数恢复剩余需求。
    if (this.downed) {
      if (this.invuln > 0) this.invuln -= dt;
      if (this.hurtFlash > 0) this.hurtFlash -= dt;
      if ((this._rescueGate ?? 0) > 0) this._rescueGate -= dt;
      this._rescueIdle = (this._rescueIdle ?? 0) + dt;
      if (this._rescueIdle >= 3) {
        this.rescueProgress = Math.min(this.rescueNeed,
          (this.rescueProgress ?? this.rescueNeed) + this.rescueRegain * dt);
      }
      // ---- 龟速爬行（15% 移速，不能攻击）----
      let axis = input?.moveAxis?.() ?? { x: 0, y: 0 };
      if (this.agentMoveTarget) {
        const adx = this.agentMoveTarget.x - this.x;
        const ady = this.agentMoveTarget.y - this.y;
        const ad = Math.hypot(adx, ady);
        if (ad < 8) this.agentMoveTarget = null;
        else axis = { x: adx / ad, y: ady / ad };
      }
      if (axis.x || axis.y) {
        const crawl = this.baseSpeed * 0.15 * (world?.weather?.moveMul ?? 1);
        this.x += axis.x * crawl * dt;
        this.y += axis.y * crawl * dt;
        // 倒地爬行也走共同地形解算，不能穿过正常移动无法通过的墙。
        if (world.terrain) {
          resolveTerrain(world.terrain, this);
        }
      }
      return;
    }

    // AI移动意图驱动目标点；接近8px时清除，停止命令直接清空。
    let axis = input.moveAxis();
    if (this.agentMoveTarget) {
      const adx = this.agentMoveTarget.x - this.x;
      const ady = this.agentMoveTarget.y - this.y;
      const ad = Math.hypot(adx, ady);
      if (ad < 8) {
        this.agentMoveTarget = null;   // 到位即停，防原地抖动
      } else {
        axis = { x: adx / ad, y: ady / ad };
      }
    }
    const speedMul = this.stats.moveSpeedMultiplier;
    // 角色最终移速、锁血临时加速、受伤叠层和天气分别处于既有乘区。
    const mdMove = this.charRt?.mdMoveBonus ?? 0;
    // 第一百零八轮：晴岚 —— 所有人移速 +25%（乘区，天气结束自动归一）
    let speed = this.baseSpeed * speedMul * this.mulFor('moveSpeed')
      * (this.speedBonusMul ?? 1) * (1 + mdMove / 100)
      * (world?.weather?.moveMul ?? 1);
    // Pilot movement is replaced, rather than multiplied, when the current
    // challenge explicitly locks movement to a fraction of base speed.
    if (this.pilotBuff) speed *= 1.25;
    const challengeSpeed = world.challenge?.playerRules(this).speedMultiplier;
    if (challengeSpeed && challengeSpeed !== 1) {
      speed = this.baseSpeed * challengeSpeed;
      // 第一百七十一轮：P2 的减速键 = 小键盘 0（input 桩带 p2SkillSlow）
      if (input.isDown('ShiftLeft') || input.isDown('ShiftRight') || input.p2SkillSlow?.()) speed *= 0.5;
    }
    // 202 轮：把本帧的实际移速记下来，四重存在的分身直接取它（"移速和玩家一致"）。
    // 只是个只读快照，不参与任何玩家自己的计算。
    this.curSpeed = speed;
    // 后空翻0.5秒内接管位移，武器照常更新；沿用地形与边界限制。
    if (this._backflip) {
      this._backflip.t -= dt;
      if (this._backflip.t <= 0) this._backflip = null;   // 翻完交还控制权
    }
    this.vx = axis.x * speed;
    this.vy = axis.y * speed;
    if (this._backflip) {
      // 后空翻速度覆盖玩家输入轴（放在轴赋值之后，权重最高）
      this.vx = this._backflip.vx;
      this.vy = this._backflip.vy;
    }
    this.isMoving = axis.x !== 0 || axis.y !== 0 || !!this._backflip;

    if (this.isMoving) {
      this.walkPhase += dt * 11;
    } else {
      this.walkPhase = 0;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // 世界边界
    const half = world.halfSize - this.radius;
    this.x = clamp(this.x, -half, half);
    this.y = clamp(this.y, -half, half);

    // 位移后立即结算地形，避免多留一帧墙内位置。
    if (world.terrain) {
      if (resolveTerrain(world.terrain, this)) {
        // 撞墙清速度分量：不清的话玩家会贴着墙持续"顶"，
        // 手感上是黏住不动，而不是顺着墙滑走。
        this.vx *= 0.2;
        this.vy *= 0.2;
      }
    }

    // ---- 朝向：跟随移动方向（停下时保持） ----
    if (this.isMoving) {
      this.facing = Math.atan2(axis.y, axis.x);
    }

    // ---- 计时器 ----
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hurtFlash > 0) this.hurtFlash -= dt;

    // 技能状态先于武器更新，确保本帧debuff对首次命中已生效。
    this.charRt?.update?.(dt, world);

    // ---- 眨眼 ----
    if (this.blinkPhase > 0) {
      this.blinkPhase -= dt;
    } else {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) {
        this.blinkPhase = 0.12;                    // 眨一次约 0.12 秒
        // 隔 1.5~4.5 秒眨下一次。区间偏长是故意的：
        // 眨太勤会显得焦躁，偶尔眨一下才自然。
        this.blinkTimer = 1.5 + this.presentationRng.next() * 3;
      }
    }

    // 挑战可禁止持续回复；宠物半血治疗有独立豁免，不走regen路径。
    const regen = world.challenge?.playerRules(this).blocksHealing ? 0 : this.stats.get('hpRegen');
    if (regen > 0 && this.hp < this.stats.get('maxHp')) {
      this.heal(regen * dt);
    }
    // 吸血限频预算回填（第九十六轮，见 refillLifestealBudget）
    this.refillLifestealBudget(dt);

    // ---- 武器更新 ----
    // The challenge owns when its performance permits primary attacks.
    if (!world.challenge?.playerRules(this).blocksAttack) {
      for (const w of this.weapons) {
        w.update(dt, this, world);
      }
    }

    // ---- 武器冷却缩减来自攻速属性，统一在 weapon.update 里读取 ----
  }

  applyLifesteal(percentChance: number) {
    return applyLifesteal(this, percentChance, {
      blocked: this.world?.challenge?.playerRules(this).blocksHealing ?? false,
      random: this.rng,
      heal: () => this.heal(defenseEquipment.lifesteal(this)),
    });
  }

  refillLifestealBudget(dt: number) { return refillLifesteal(this, dt); }
}
