export type StatKey = 'maxHp' | 'hpRegen' | 'lifesteal' | 'damage' | 'meleeDamage' | 'rangedDamage' | 'elemDamage' | 'attackSpeed' | 'critChance' | 'critDamage' | 'armor' | 'dodge' | 'moveSpeed' | 'luck' | 'harvesting' | 'pickupRange' | 'range' | 'turretDamage' | 'turretRate' | 'turretRange' | 'turretMax';
export type StatValues = Record<StatKey, number>;
export type StatModifiers = Partial<StatValues>;
export interface StatDefinition { name: string; short: string; kind: 'flat' | 'percent'; base: number; min?: number; max?: number; fmt: 'int' | 'dec1' | 'pct'; desc: string }
export interface StatSnapshot { base: StatModifiers; flat: StatModifiers; pct: StatModifiers; curse: StatModifiers; finalMul: StatModifiers; luckEffectMul: number }
export function isStatKey(value: string): value is StatKey { return Object.hasOwn(STAT_DEFS, value); }

// 属性由基础、加法和百分比修正组成；概率/实体数量等必要上限显式定义。

/** 属性定义表：key -> { name, short, kind, base, min, max, fmt, desc } */
export const STAT_DEFS: Record<StatKey, StatDefinition> = {
  maxHp:        { name: '最大生命',  short: 'HP',   kind: 'flat',    base: 20,  min: 1,    fmt: 'int',   desc: '你能承受的伤害总量' },
  hpRegen:      { name: '生命回复',  short: 'REG',  kind: 'flat',    base: 0,   min: 0,    max: 10,   fmt: 'dec1',  desc: '每秒回复的生命值（上限10，第九十六轮）' },
  // 吸血是概率，保留 100% 上限（用户明确要求）
  lifesteal:    { name: '吸血',      short: 'LS',   kind: 'percent', base: 0,   min: 0,    max: 100, fmt: 'pct', desc: '命中时回复生命的概率' },
  damage:       { name: '伤害',      short: 'DMG',  kind: 'percent', base: 0,   min: -90,  fmt: 'pct',   desc: '对所有武器的伤害加成' },
  meleeDamage:  { name: '近战伤害',  short: 'MEL',  kind: 'percent', base: 0,   min: -90,  fmt: 'pct',   desc: '仅对近战武器生效' },
  rangedDamage: { name: '远程伤害',  short: 'RNG',  kind: 'percent', base: 0,   min: -90,  fmt: 'pct',   desc: '仅对远程武器生效' },
  elemDamage:   { name: '元素伤害',  short: 'ELE',  kind: 'percent', base: 0,   min: -90,  fmt: 'pct',   desc: '仅对元素武器生效' },
  // 攻速上限已取消（原来封顶 400%）
  attackSpeed:  { name: '攻击速度',  short: 'AS',   kind: 'percent', base: 0,   min: -80,  fmt: 'pct', desc: '武器开火频率' },
  // 暴击率是概率，保留 100% 上限（用户明确要求）
  critChance:   { name: '暴击率',    short: 'CRIT', kind: 'percent', base: 0,   min: 0,    max: 100, fmt: 'pct', desc: '造成双倍伤害的概率' },
  critDamage:   { name: '暴击伤害',  short: 'CDMG', kind: 'percent', base: 50,  min: 0,    fmt: 'pct',   desc: '暴击时的额外伤害倍率' },
  armor:        { name: '护甲',      short: 'ARM',  kind: 'flat',    base: 0,   min: 0,    fmt: 'int',   desc: '按递减曲线减少受到的伤害' },
  // 闪避基础上限80%，防止堆叠到完全免伤；装备可显式放宽上限。
  dodge:        { name: '闪避',      short: 'DGE',  kind: 'percent', base: 0,   min: 0,    max: 80,  fmt: 'pct', desc: '完全躲开伤害的概率' },
  // 移速上限已取消（原来封顶 200%）
  moveSpeed:    { name: '移动速度',  short: 'SPD',  kind: 'percent', base: 0,   min: -70,  fmt: 'pct', desc: '移动快慢' },
  // 幸运上限已取消（原来封顶 300%）
  luck:         { name: '幸运',      short: 'LCK',  kind: 'percent', base: 0,   min: -50,  fmt: 'pct', desc: '更好的掉落与商店品质' },
  harvesting:   { name: '收获',      short: 'HRV',  kind: 'flat',    base: 0,   min: 0,    fmt: 'int',   desc: '每波结束额外获得的材料' },
  // 拾取范围基础110，扩大收集范围以免后期掉落滞留。
  pickupRange:  { name: '拾取范围',  short: 'PICK', kind: 'flat',    base: 110, min: 20,   fmt: 'int',   desc: '自动吸取材料的半径' },
  range:        { name: '射程',      short: 'RNG2', kind: 'percent', base: 0,   min: -60,  fmt: 'pct',   desc: '全射程加成：近战五折、360 度武器 150%、远程/炮台全额（第三十二轮起）' },
  // ---- 炮台流派 ----
  turretDamage: { name: '炮台伤害',  short: 'TDMG', kind: 'percent', base: 0,   min: -90,  fmt: 'pct',   desc: '仅对炮台生效' },
  // 炮台攻速上限已取消（原来封顶 400%）
  turretRate:   { name: '炮台攻速',  short: 'TRATE',kind: 'percent', base: 0,   min: -80,  fmt: 'pct', desc: '炮台的开火频率' },
  turretRange:  { name: '炮台射程',  short: 'TRNG', kind: 'percent', base: 0,   min: -60,  fmt: 'pct',   desc: '炮台的索敌距离' },
  // turretMax限制实际炮台数量；不保留没有真实承伤机制的炮台耐久属性。
  turretMax:    { name: '炮台上限',  short: 'TMAX', kind: 'flat',    base: 0,   min: 0,    max: 8,   fmt: 'int',   desc: '额外可同时存在的炮台数量' },
};

export const STAT_KEYS = Object.keys(STAT_DEFS) as StatKey[];

// 多件诅咒按乘算叠加并夹紧下限，避免生命上限降至零或负数。
export const CURSE_FLOOR = 0.45;

// 有效幸运为面板幸运乘全局0.8，各消费点统一使用该换算。
export const LUCK_EFFECT_MUL = 0.8;

// 只转换幸运效果，不修改面板数值；消费点不能重复乘全局倍率。
export function effectiveLuck(luck: number) {
  const v = Number(luck);
  if (!Number.isFinite(v)) return 0;
  return v * LUCK_EFFECT_MUL;
}

// 角色幸运倍率叠加全局倍率后使用，不能在不同消费点各自实现。
export function effectiveLuckFor(luck: number, mul?: number) {
  const base = effectiveLuck(luck);
  const m = Number(mul);
  if (!Number.isFinite(m) || m === 1) return base;
  return base * m;
}

/** 全部属性归零的修正对象 */
export function emptyMods() {
  const m = Object.fromEntries(STAT_KEYS.map(key => [key, 0])) as StatValues;
  return m;
}

/** Preserve modifier insertion order while retaining the finite stat key contract. */
export function statEntries(mods: Readonly<StatModifiers> = {}): [StatKey, number][] {
  const entries: [StatKey, number][] = [];
  for (const [key, value] of Object.entries(mods)) {
    if (isStatKey(key) && typeof value === 'number') entries.push([key, value]);
  }
  return entries;
}

// 百分数属性按百分点相加；数量属性使用(base+flat)*(1+pct)，负乘数遵守诅咒下限。
export function computeStats(base: StatModifiers, flatMods: StatModifiers, pctMods: StatModifiers, capBonus: StatModifiers = {}): StatValues {
  const out = emptyMods();
  for (const k of STAT_KEYS) {
    const def = STAT_DEFS[k];
    const b = typeof base[k] === 'number' && Number.isFinite(base[k]) ? base[k] : def.base;
    // NaN / undefined / Infinity 一律当 0：脏数据只该"不生效"，
    // 不该顺着乘法把整条属性链污染成 NaN（NaN 连 min/max 都夹不住）。
    const f = typeof flatMods[k] === 'number' && Number.isFinite(flatMods[k]) ? flatMods[k] : 0;
    const p = typeof pctMods[k] === 'number' && Number.isFinite(pctMods[k]) ? pctMods[k] : 0;

    let v;
    if (def.kind === 'percent') {
      // 值本身就是百分数：pct 按百分点相加
      v = b + f + p;
    } else {
      // 数量属性的百分比是乘数；夹紧其下限，避免负生命/负收益反向放大。
      let mul = 1 + p;
      if (mul < CURSE_FLOOR) mul = CURSE_FLOOR;
      v = (b + f) * mul;
    }

    // capBonus须在夹紧发生前参与，否则已被基础上限截断的值无法恢复。
    const cap = def.max !== undefined ? def.max + (capBonus[k] ?? 0) : undefined;
    if (def.min !== undefined) v = Math.max(def.min, v);
    if (cap !== undefined) v = Math.min(cap, v);
    out[k] = v;
  }
  // 护甲上限：避免无敌
  out.armor = Math.min(out.armor, 120);
  return out;
}

// 护甲使用递减曲线，避免线性护甲轻易达到完全免伤。
export function armorMultiplier(armor: number) {
  const m = 1 / (1 + Math.max(0, armor) / 30);
  return Math.max(0.2, m); // 最多减伤 80%
}

/** 格式化显示 */
export function fmtStat(key: StatKey, value: number) {
  const def = STAT_DEFS[key];
  if (!def) return String(value);
  switch (def.fmt) {
    case 'pct':  return `${value >= 0 ? '' : ''}${Math.round(value)}%`;
    case 'int':  return String(Math.round(value));
    case 'dec1': return (Math.round(value * 10) / 10).toFixed(1);
    default:     return String(value);
  }
}

/**
 * 运行时属性容器：缓存最终值，脏标记重算。
 */
export class StatSheet {
  declare base: StatModifiers;
  declare flat: StatValues;
  declare pct: StatValues;
  declare curse: StatValues;
  declare capBonus: StatModifiers;
  declare finalMul: StatModifiers;
  declare luckEffectMul: number;
  declare cache: StatValues | null;
  declare dirty: boolean;
  declare _warnedFinalMul?: Set<StatKey>;
  constructor(baseValues: StatModifiers) {
    this.base = { ...baseValues };
    this.flat = emptyMods();
    this.pct = emptyMods();
    // 诅咒：key -> 累计乘数（每次购买乘以 (1-frac)，真正的乘算）
    this.curse = emptyMods();
    for (const k of STAT_KEYS) this.curse[k] = 1;
    // capBonus只增加属性上限，不改变负值下限。
    this.capBonus = {};

    // 最终乘算只保存声明过的键，空表代表全1，避免每帧无效遍历。
    this.finalMul = {};

    // 角色幸运倍率默认为1；未配置时只应用全局幸运倍率。
    this.luckEffectMul = 1;

    this.cache = null;
    this.dirty = true;
  }

  /** 累加一条加法修正 */
  addFlat(key: StatKey, value: number) {
    if (!(key in this.flat)) return;
    this.flat[key] += value;
    this.dirty = true;
  }

  /** 累加一条百分比修正（0.1 = +10%） */
  addPct(key: StatKey, value: number) {
    if (!(key in this.pct)) return;
    this.pct[key] += value;
    this.dirty = true;
  }

  // 诅咒独立乘到最终数量属性上，不与普通pct修正线性相加。
  addCurse(key: StatKey, frac: number) {
    if (!(key in this.curse)) return;
    this.curse[key] *= Math.max(0.01, 1 - frac);
    // 兜底：不管叠多少层，至少保留 CURSE_FLOOR 的比例
    if (this.curse[key] < CURSE_FLOOR) this.curse[key] = CURSE_FLOOR;
    this.dirty = true;
  }

  /** 批量应用 { flat: {...}, pct: {...} } 或直接的 mods 对象 */
  apply(mods: StatModifiers | null | undefined, asPercent = false) {
    if (!mods) return;
    for (const k in mods) {
      if (!isStatKey(k) || mods[k] === undefined) continue;
      if (asPercent) this.addPct(k, mods[k]);
      else this.addFlat(k, mods[k]);
    }
  }

  // 最终乘算拒绝百分数属性：其基础通常为0，须在真实消费点乘到效果。
  addFinalMul(key: StatKey, mul: number) {
    if (!(key in this.flat)) return;
    const def = STAT_DEFS[key];
    if (def && def.kind === 'percent') {
      // 不抛异常：数据层写错不该让整局游戏崩掉。
      // 但也不静默吞掉 —— 返回 false 让测试能断言"这条没生效"。
      if (typeof console !== 'undefined' && !this._warnedFinalMul) {
        this._warnedFinalMul = new Set();
      }
      if (this._warnedFinalMul && !this._warnedFinalMul.has(key)) {
        this._warnedFinalMul.add(key);
        console.warn(`[stats] addFinalMul 对 percent 属性 "${key}" 无效（base=0，乘算恒为 0）。` +
          '请把这条加成放到伤害结算处。');
      }
      return false;
    }
    this.finalMul[key] = (this.finalMul[key] ?? 1) * mul;
    this.dirty = true;
    return true;
  }

  /** 第一百三十四轮：放宽某属性的上限（黑色披风：闪避 +10 上限） */
  addCapBonus(key: StatKey, extra: number) {
    if (!(key in this.capBonus)) this.capBonus[key] = 0;
    this.capBonus[key] = (this.capBonus[key] ?? 0) + extra;
    this.dirty = true;
  }

  get values() {
    if (this.dirty || !this.cache) {
      const out = computeStats(this.base, this.flat, this.pct, this.capBonus ?? {});
      // 诅咒按乘算作用在最终值上（夹紧同样感知 capBonus）
      for (const k of STAT_KEYS) {
        const c = this.curse[k];
        if (c !== 1) {
          out[k] *= c;
          const def = STAT_DEFS[k];
          const cap = def.max !== undefined ? def.max + ((this.capBonus ?? {})[k] ?? 0) : undefined;
          if (def.min !== undefined) out[k] = Math.max(def.min, out[k]);
          if (cap !== undefined) out[k] = Math.min(cap, out[k]);
        }
      }
      // 最终乘算在诅咒之后应用；调整顺序会改变正负修正的实际收益。
      for (const k in this.finalMul) {
        if (!isStatKey(k)) continue;
        const m = this.finalMul[k];
        if (m === undefined) continue;
        if (m === 1) continue;
        out[k] *= m;
        const def = STAT_DEFS[k];
        if (def) {
          if (def.min !== undefined) out[k] = Math.max(def.min, out[k]);
          if (def.max !== undefined) out[k] = Math.min(def.max, out[k]);
        }
      }
      // 护甲上限兜底：finalMul 也可能把护甲推过 120
      out.armor = Math.min(out.armor, 120);
      this.cache = out;
      this.dirty = false;
    }
    return this.cache;
  }

  get(key: StatKey) { return this.values[key]; }

  /** 方便地拿常用派生值 */
  get moveSpeedMultiplier() { return 1 + this.values.moveSpeed / 100; }
  get armorMul() { return armorMultiplier(this.values.armor); }

  // 消费点读取本角色luckEff，统一包含全局与角色幸运倍率。
  get luckEff() { return effectiveLuckFor(this.values.luck, this.luckEffectMul); }
}

/** 默认基础值 */
export function defaultBaseStats() {
  const b = emptyMods();
  for (const k of STAT_KEYS) b[k] = STAT_DEFS[k].base;
  return b;
}

// 属性模块拥有自身存档字段，避免外部手抄漏掉诅咒或最终倍率。

// 只保存成长修正，不保存cache/dirty等可重建缓存。
export function serializeStatMods(sheet: StatSheet): StatSnapshot {
  return {
    base: { ...sheet.base },
    flat: { ...sheet.flat },
    pct: { ...sheet.pct },
    curse: { ...sheet.curse },
    // 角色最终乘算属于成长快照，续档与重试不能漏存。
    finalMul: { ...sheet.finalMul },
    // Explicit identity multiplier is part of every current snapshot.
    luckEffectMul: sheet.luckEffectMul,
  };
}

/** Restore a validated current snapshot. Sparse modifier maps preserve their neutral entries. */
export function restoreStatMods(sheet: StatSheet, data: StatSnapshot) {
  // base remains character-owned; saved base is descriptive and never overrides content.
  sheet.flat = { ...sheet.flat, ...data.flat };
  sheet.pct = { ...sheet.pct, ...data.pct };
  sheet.curse = { ...sheet.curse, ...data.curse };
  sheet.finalMul = { ...sheet.finalMul, ...data.finalMul };
  sheet.luckEffectMul = data.luckEffectMul;
  sheet.dirty = true;
  return sheet;
}
