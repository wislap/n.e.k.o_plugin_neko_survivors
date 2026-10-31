import { getEnemy } from './enemies.ts';
export type SpecialWaveKind = 'charge' | 'bullet' | 'tank' | 'chaos' | 'slack' | 'payday' | 'egg';
import type { WaveDefinition, EnemyId } from './definitions.ts';
export type { WaveDefinition } from './definitions.ts';
// 波次表使用0-based索引；时长随波次成长，Boss波限90秒且击杀立即结算。

export const WAVE_COUNT = 20;

// 刷怪量随1-based波数每波增0.05，20波达到2倍，无尽保持封顶。
export const SPAWN_RATE_PER_WAVE = 0.05;
export const SPAWN_RATE_MAX = 2.0;

/** 第 N 波（0-based waveIndex）的刷怪量倍率 */
export function spawnRateMul(waveIndex: number) {
  const wave1 = (waveIndex ?? 0) + 1;   // 转成 1-based
  return Math.min(SPAWN_RATE_MAX, 1 + wave1 * SPAWN_RATE_PER_WAVE);
}

// 21波起进入无尽；Boss数量按出场计划增长，40波后每波四Boss。
export const ENDLESS_START_WAVE = 21;      // 第 21 波起是无限模式
export const ENDLESS_BOSS_EVERY = 5;       // （旧表，保留给外部引用）无限模式每 5 波一个 Boss
export const ENDLESS_STAT_MUL = 2;         // 21 波起敌人属性/数量翻倍
export const ENDLESS_BOSS_GROWTH = 3;      // 无限模式的 Boss 成长是 3 倍

// 普通生成受600存活敌人与预警门槛限制，被挡预算保留；Boss和宝箱怪另有生成路径。
export const ENEMY_ALIVE_CAP = 600;

// 第四十八轮：无尽 Boss 出场计划（1-based 波号 → 该波 Boss 数量）。
// 23/26 单 Boss 热身，29/32 双人组，35/38 三人组，40 起每波全员四连。
export const ENDLESS_BOSS_PLAN = [
  { wave: 23, count: 1 }, { wave: 26, count: 1 },
  { wave: 29, count: 2 }, { wave: 32, count: 2 },
  { wave: 35, count: 3 }, { wave: 38, count: 3 },
  { wave: 40, count: 4 },
];

// 四个 Boss 的轮换池（40 波刚好全员一次：4 个出场位对 4 个 Boss）
export const ENDLESS_BOSS_IDS: EnemyId[] = [
  'boss_cat_king',      // 路过被殴打的猫娘（远程弹幕）
  'boss_void_lord',     // 黑化开发猫猫（远程弹幕+冲锋）
  'boss_acid_cat',      // 蒜蓉粉丝开背虾（近战冲刺）
  'boss_apple_cider',   // 依趣苹果醋（近战冲刺+远弹）
];

/** 无限模式下第 N 波（1-based）该出几个 Boss */
export function endlessBossCount(wave1based: number) {
  if (wave1based >= 40) return 4;
  const hit = ENDLESS_BOSS_PLAN.find((p) => p.wave === wave1based);
  return hit ? hit.count : 0;
}

// 阵容按此前累计出场数轮换，同波内不重复，重试不消费随机流。
export function endlessBossLineup(wave1based: number) {
  const count = endlessBossCount(wave1based);
  if (!count) return null;
  let spawnedBefore = 0;
  for (let w = ENDLESS_START_WAVE; w < wave1based; w++) {
    spawnedBefore += endlessBossCount(w);
  }
  const start = spawnedBefore % ENDLESS_BOSS_IDS.length;
  const ids: EnemyId[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(ENDLESS_BOSS_IDS[(start + i) % ENDLESS_BOSS_IDS.length]);
  }
  return ids;
}

/** 第 N 波（1-based）是不是 Boss 波 */
export function isBossWave1(wave1based: number) {
  if (wave1based === 10 || wave1based === 20) return true;
  return endlessBossCount(wave1based) > 0;
}

export const WAVE_DURATION = 30;         // 第 1 波的基准时长
export const WAVE_DURATION_MAX = 60;     // 普通波的上限（用户要求）
export const BOSS_WAVE_DURATION = 90;    // Boss 关时长（用户要求 90s）
export const ENDLESS_DURATION_MAX = 120; // 无限模式的时长上限

export const WAVES: WaveDefinition[] = [
  // 1-3：教学期，只有最基础的敌人
  { spawns: [{ id: 'slime', weight: 10 }, { id: 'mouse', weight: 6 }], budget: 7 },
  { spawns: [{ id: 'slime', weight: 10 }, { id: 'mouse', weight: 8 }], budget: 9 },
  { spawns: [{ id: 'slime', weight: 8 }, { id: 'mouse', weight: 9 }, { id: 'bat', weight: 5 }], budget: 11 },

  // 4-6：引入硬壳与远程
  { spawns: [{ id: 'slime', weight: 6 }, { id: 'mouse', weight: 8 }, { id: 'bat', weight: 7 }, { id: 'crab', weight: 5 }], budget: 14 },
  { spawns: [{ id: 'mouse', weight: 7 }, { id: 'bat', weight: 7 }, { id: 'crab', weight: 7 }, { id: 'spitter', weight: 5 }], budget: 17 },
  // 第九轮：从第 6 波开始加入"高速追击"的猎杀猫（用户："让一种近战敌人移动速度
  // 稍快点，可以一直追着玩家的感觉"），以及随机蛋 —— 让远程弹幕早点变多样。
  { spawns: [{ id: 'bat', weight: 6 }, { id: 'crab', weight: 8 }, { id: 'spitter', weight: 6 }, { id: 'bomber', weight: 5 }, { id: 'stalker', weight: 4 }, { id: 'chaos_egg', weight: 4 }], budget: 20 },

  // 7-9：加入精英与高威胁单位
  { spawns: [{ id: 'crab', weight: 7 }, { id: 'spitter', weight: 7 }, { id: 'bomber', weight: 7 }, { id: 'charger', weight: 6 }, { id: 'stalker', weight: 5 }], budget: 23, elites: 1 },
  { spawns: [{ id: 'spitter', weight: 6 }, { id: 'bomber', weight: 6 }, { id: 'charger', weight: 7 }, { id: 'splitter', weight: 6 }, { id: 'chaos_egg', weight: 5 }, { id: 'spiral_cat', weight: 4 }], budget: 27, elites: 1 },
  { spawns: [{ id: 'charger', weight: 7 }, { id: 'splitter', weight: 7 }, { id: 'tank', weight: 5 }, { id: 'ghost', weight: 6 }, { id: 'blade_cat', weight: 5 }, { id: 'spiral_cat', weight: 5 }], budget: 31, elites: 1 },

  // 10：第一个 Boss
  {
    spawns: [{ id: 'slime', weight: 6 }, { id: 'bomber', weight: 5 }, { id: 'ghost', weight: 5 }, { id: 'stalker', weight: 4 }],
    budget: 22, boss: 'boss_cat_king', isBoss: true, duration: BOSS_WAVE_DURATION,
  },

  // 11-14：Boss 后的压力回升
  { spawns: [{ id: 'spitter', weight: 6 }, { id: 'charger', weight: 7 }, { id: 'splitter', weight: 6 }, { id: 'tank', weight: 6 }, { id: 'blade_cat', weight: 6 }, { id: 'chaos_egg', weight: 5 }], budget: 34, elites: 2 },
  { spawns: [{ id: 'bomber', weight: 6 }, { id: 'charger', weight: 7 }, { id: 'ghost', weight: 7 }, { id: 'tank', weight: 6 }, { id: 'spiral_cat', weight: 6 }, { id: 'stalker', weight: 6 }], budget: 37, elites: 2 },
  { spawns: [{ id: 'splitter', weight: 7 }, { id: 'ghost', weight: 7 }, { id: 'tank', weight: 7 }, { id: 'spitter', weight: 6 }, { id: 'blade_cat', weight: 6 }, { id: 'chaos_egg', weight: 6 }], budget: 40, elites: 2 },
  { spawns: [{ id: 'charger', weight: 7 }, { id: 'ghost', weight: 7 }, { id: 'tank', weight: 8 }, { id: 'bomber', weight: 6 }, { id: 'spiral_cat', weight: 6 }, { id: 'stalker', weight: 7 }], budget: 44, elites: 3 },

  // 15-19：终盘高压
  { spawns: [{ id: 'ghost', weight: 7 }, { id: 'tank', weight: 8 }, { id: 'splitter', weight: 7 }, { id: 'charger', weight: 7 }, { id: 'blade_cat', weight: 7 }, { id: 'stalker', weight: 7 }], budget: 48, elites: 3 },
  { spawns: [{ id: 'tank', weight: 8 }, { id: 'ghost', weight: 8 }, { id: 'charger', weight: 7 }, { id: 'spitter', weight: 6 }, { id: 'spiral_cat', weight: 7 }, { id: 'chaos_egg', weight: 7 }], budget: 52, elites: 3 },
  { spawns: [{ id: 'tank', weight: 9 }, { id: 'ghost', weight: 8 }, { id: 'splitter', weight: 7 }, { id: 'bomber', weight: 7 }, { id: 'blade_cat', weight: 8 }, { id: 'stalker', weight: 8 }], budget: 57, elites: 4 },
  { spawns: [{ id: 'tank', weight: 9 }, { id: 'ghost', weight: 9 }, { id: 'charger', weight: 8 }, { id: 'splitter', weight: 7 }, { id: 'spiral_cat', weight: 8 }, { id: 'blade_cat', weight: 8 }], budget: 62, elites: 4 },
  { spawns: [{ id: 'tank', weight: 10 }, { id: 'ghost', weight: 9 }, { id: 'charger', weight: 9 }, { id: 'bomber', weight: 8 }, { id: 'stalker', weight: 9 }, { id: 'chaos_egg', weight: 8 }], budget: 68, elites: 5 },

  // 20：最终 Boss
  {
    spawns: [{ id: 'ghost', weight: 7 }, { id: 'tank', weight: 7 }, { id: 'charger', weight: 6 }, { id: 'blade_cat', weight: 6 }, { id: 'spiral_cat', weight: 6 }],
    budget: 30, boss: 'boss_void_lord', isBoss: true, duration: BOSS_WAVE_DURATION,
  },
];

// 普通生命按前20波复利成长，开局倍率保持1；无尽使用独立接续曲线。
export const HP_GROWTH_PER_WAVE = 0.23776392063804086 * 1.2;

// Boss生命成长独立于普通敌人，避免修改普通曲线时连带改变Boss目标。
export const BOSS_HP_GROWTH_PER_WAVE = 0.1455793292535872 * 1.2;

/** Boss 血量曲线（1~20 波用；和普通怪曲线一样从第 1 波的 1.0 起步） */
export function bossHpCurve(w: number) {
  return Math.pow(1 + BOSS_HP_GROWTH_PER_WAVE, w);
}

/** 第九轮那版复利成长率。留着只为了推导下面的 ENDLESS_HP_CARRY。 */
const OLD_HP_GROWTH_PER_WAVE = 0.10;

// 攻击成长是每波复利系数，包含Boss；不能把增幅误作全局固定倍率。
export const ENEMY_DAMAGE_GROWTH_PER_WAVE = 0.12;

// 伤害按波次复利成长，与基础难度倍率相乘。

// 无尽从21波起叠加额外伤害成长，与前20波成长分别表达。
export const ENDLESS_DAMAGE_GROWTH_PER_WAVE = 0.06 * (0.12 / 0.075);  // 0.096

// 精英/Boss使用独立伤害乘区，接触和弹幕都须消费，不能只改一条路径。
export const ELITE_DAMAGE_MUL = 0.7864;
export const BOSS_DAMAGE_MUL = 0.3257;

// 弹幕射程按波成长；不通过改变弹速替代射程成长。
export const ENEMY_BULLET_RANGE_GROWTH_PER_WAVE = 0.08;

// 无尽生命倍率接续20波终点，避免切换曲线时生命倒退。
export const ENDLESS_HP_CARRY = Math.pow(
  (1 + HP_GROWTH_PER_WAVE) / (1 + OLD_HP_GROWTH_PER_WAVE),
  WAVE_COUNT - 1,
);

// 前20波旧生命曲线保留为实际下限，仍参与当前waveScaling。
export function legacyHpCurve(w: number) {
  return 1 + w * 0.13 + Math.pow(w, 1.25) * 0.018;
}

/** 波次难度倍率：敌人血量/伤害随波数成长 */
export function waveScaling(waveIndex: number) {
  const w = waveIndex; // 0-based

  // 普通敌人生命与Boss生命分别成长，防止混用曲线。
  const legacyHp = legacyHpCurve(w);
  const compoundHp = Math.pow(1 + HP_GROWTH_PER_WAVE, w);
  let hp = Math.max(legacyHp, compoundHp);

  // Boss使用独立血量曲线；无尽阶段再切回既有成长公式。
  let bossHp = bossHpCurve(w);

  let damage = 1 + w * ENEMY_DAMAGE_GROWTH_PER_WAVE;
  let xp = 1 + w * 0.05;
  let materials = 1 + w * 0.03;

  // 无尽叠加属性翻倍与独立Boss成长；常规波与Boss波分别计算。
  const wave1 = w + 1;
  const isEndless = wave1 >= ENDLESS_START_WAVE;

  // 新复利曲线只作用前20波；无尽保留旧曲线与接续倍率，避免重新抬高既有平衡。
  if (isEndless) hp = legacyHp * ENDLESS_HP_CARRY;

  // Boss 血量：1~20 波走单独的 bossHpCurve；
  // 无限模式回到 legacyHp（**不乘 CARRY**），复现原来 def.hp × (旧曲线×2)
  // × bossGrowth 的数值 —— Boss 在 20→21 波本来就是涨的，没有断崖要补。
  if (isEndless) bossHp = legacyHp;

  let bossGrowth = 1;
  if (isEndless) {
    const extra = wave1 - ENDLESS_START_WAVE;   // 第 21 波 = 0
    // 基础 3 倍（用户要求），之后每个 Boss 周期（5 波）再 ×1.35
    const cycles = (wave1 - WAVE_COUNT) / ENDLESS_BOSS_EVERY;
    bossGrowth = ENDLESS_BOSS_GROWTH * Math.pow(1.35, cycles);
    hp *= ENDLESS_STAT_MUL;
    // Boss 血量在无限模式下**必须**跟着 ×2 —— 因为它取代了原来
    // def.hp × hp(=旧曲线×2) 里的那个 hp。漏掉这一步会让 21 波起的
    // Boss 凭空少一半血，正是 round4-check 里断言过的数值。
    bossHp *= ENDLESS_STAT_MUL;
    damage *= 1 + extra * ENDLESS_DAMAGE_GROWTH_PER_WAVE;
    xp *= 1 + extra * 0.04;
    materials *= 1 + extra * 0.02;
  }

  return {
    // 血量成长：1~20 波 = max(旧曲线, 复利ⁿ)（见上面 compoundHp 的说明）；
    // 无限模式 = 旧曲线 ×2（ENDLESS_STAT_MUL），保持原有难度设计。
    hp,
    // Boss 专属血量曲线（第十四轮）。普通怪不吃这个字段。
    bossHp,
    // 只对 Boss 额外生效的成长倍率（普通敌人不吃）
    bossGrowth,
    // 伤害成长偏缓（否则中期就被秒）
    damage,
    // 全局移速成长：1.5%/波封顶 28%（原有）。
    speed: 1 + Math.min(0.28, w * 0.015),
    // 普通敌人按自身基础速度逐波线性成长，Boss不应用该项且不增加移速上限。
    speedOwn: 1 + w * 0.01,
    // 敌弹射程按波次成长，不乘难度倍率。
    bulletRange: 1 + w * ENEMY_BULLET_RANGE_GROWTH_PER_WAVE,
    xp,
    // 材料成长：从 1 + w*0.06 降到 1 + w*0.03。
    // 第 20 波 2.2 倍 → 1.6 倍，配合清场奖励封顶一起收紧中后期收入。
    materials,
  };
}

// 过波奖励是独立材料收入，与掉落、收获和清场补偿分别结算。
export function waveClearBonus(waveIndex: number) {
  const early = 10 + waveIndex * 2;              // 1-3 波：10 / 12 / 14
  const capped = Math.min(24, 14 + (waveIndex - 3) * 1.1); // 前三波的边界使用<3，保证后续敌人数曲线单调且逐步封顶。
  return Math.round(waveIndex < 3 ? early : capped);
}

// 奶妈按1-based波号判断注入，避免起始波偏一。


// Boss战追加小怪预算按战斗进度释放，不替代Boss本体或普通波规则。

/** Boss 战开头的刷怪频率倍率（相对该波标准频率） */
export const BOSS_ADD_RATE_START = 0.5;
/** Boss 战结束（90 秒）时的刷怪频率倍率 */
export const BOSS_ADD_RATE_END = 1.5;

// Boss追加刷怪频率由战斗进度插值，不随渲染帧率变化。
export function bossAddRate(waveElapsed: number, waveDuration: number) {
  const total = Math.max(1e-6, waveDuration);
  const t = Math.min(1, Math.max(0, waveElapsed / total));
  return BOSS_ADD_RATE_START + (BOSS_ADD_RATE_END - BOSS_ADD_RATE_START) * t;
}

// 计算当前进度应释放的累计预算比例；积分进度避免低帧率漏刷或重复刷。
export function bossAddProgress(waveElapsed: number, waveDuration: number) {
  const total = Math.max(1e-6, waveDuration);
  const u = Math.min(1, Math.max(0, waveElapsed / total));
  return 0.5 * u + 0.5 * u * u;
}

/** 奶妈怪在刷怪池里的权重。刻意低：它是**战术目标**，不是主力。 */
export const HEALER_WEIGHT = 5;

// 奶妈只在指定波次注入一次；使用原池副本避免修改共享内容表。

function withHealer(cfg: WaveDefinition, wave1: number) {
  if (!(wave1 >= (getEnemy('healer_bunny')?.spawnFromWave ?? Infinity))) return cfg;
  if (!cfg || !Array.isArray(cfg.spawns) || cfg.spawns.length === 0) return cfg;


  // 已经手动写进池子的话就别重复注入了
  const already = cfg.spawns.some((s) => s.id === 'healer_bunny');
  if (already) return cfg;

  const out: WaveDefinition = {
    ...cfg,
    spawns: [...cfg.spawns, { id: 'healer_bunny', weight: HEALER_WEIGHT }],
  };
  return out;
}

// 特殊波在合法波次按概率与冷却抽取，已抽结果入缓存供重试复现。

/** 特殊波次从第 11 波开始（1-based 波号，即 waveIndex >= 10） */
export const SPECIAL_WAVE_FROM = 11;

/** 触发一次特殊波后，接下来 2 个回合不再触发 */
export const SPECIAL_WAVE_COOLDOWN = 2;

// 七类特殊波均分既有总触发率，增加类别不提高整体特殊波频率。
export const SPECIAL_WAVE_CHANCE = 0.2;

// 特殊波类别分别替换敌人池，概率和冷却由导演统一处理。
export const SPECIAL_WAVE_POOLS: Record<SpecialWaveKind, { label: string; ids?: EnemyId[] }> = {
  charge: { label: '全是冲锋敌人！', ids: ['charger'] },
  bullet: { label: '全是弹幕敌人！', ids: ['spitter', 'chaos_egg', 'spiral_cat', 'blade_cat'] },
  tank: { label: '全是肉盾敌人！', ids: ['tank', 'crab', 'elite_crab', 'splitter'] },
  // 混乱/偷懒/丰收/怪蛋是波次修饰，不重建基础刷怪构成。
  chaos: { label: '内部混乱！近战与远程互相敌对！' },
  slack: { label: '全员摸鱼日！敌人移速 -30%、攻速 -50%' },
  payday: { label: '发薪日！敌人攻击 +20%、射速 +20%' },
  egg: { label: '隔壁发免费鸡蛋了？怪少一半，掉落翻倍！' },
};

/** 某一波的配置（无限模式会合成 Boss 波并继续加难度） */
export function getWaveConfig(waveIndex: number) {
  if (waveIndex < WAVES.length) return withHealer(WAVES[waveIndex], waveIndex + 1);
  const wave1 = waveIndex + 1;
  // 无限模式的 Boss 波：按 endlessBossCount 决定放几个 Boss
  const bossCount = endlessBossCount(wave1);
  if (bossCount > 0) {
    const extra = wave1 - ENDLESS_START_WAVE;
    return withHealer({
      spawns: [
        { id: 'ghost', weight: 7 },
        { id: 'tank', weight: 7 },
        { id: 'charger', weight: 6 },
      ],
      budget: 30 + extra * 3,
      // 第四十八轮：按轮换表取阵容（波内不重复，40 波全员四连）
      bosses: endlessBossLineup(wave1) || [],
      isBoss: true,
      duration: BOSS_WAVE_DURATION,
      endless: true,
    }, wave1);
  }

  // 无限模式的普通波：复用最后几波并持续加难度
  const fallback = WAVES[WAVES.length - 2];
  const extra = wave1 - ENDLESS_START_WAVE + 1;
  return withHealer({
    ...fallback,
    budget: fallback.budget * (1 + extra * 0.15) * ENDLESS_STAT_MUL,
    endless: true,
  }, wave1);
}

// 普通波渐增至60秒，Boss90秒，无尽渐增至120秒。
export function getWaveDuration(waveIndex: number, cfg = getWaveConfig(waveIndex)) {
  // 显式配了 duration 的（Boss 关）优先
  if (cfg.duration) return cfg.duration;

  const wave1 = waveIndex + 1;
  if (wave1 > WAVE_COUNT) {
    // 无限模式：从 60s 继续往 120s 慢慢加
    const t = Math.min(1, (wave1 - WAVE_COUNT) / 20);
    return Math.round(WAVE_DURATION_MAX + (ENDLESS_DURATION_MAX - WAVE_DURATION_MAX) * t);
  }

  // 普通波：从 WAVE_DURATION 线性爬到 WAVE_DURATION_MAX（第 19 波到顶）
  const LAST_NORMAL = Math.max(1, WAVE_COUNT - 2);   // 18
  const t = Math.min(1, Math.max(0, waveIndex) / LAST_NORMAL);
  return Math.round(WAVE_DURATION + (WAVE_DURATION_MAX - WAVE_DURATION) * t);
}
