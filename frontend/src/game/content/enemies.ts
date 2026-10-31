import type { RandomSource } from '../math/geometry.ts';
import type { EnemyDefinition, EnemyId } from './definitions.ts';
export type { EnemyDefinition, EnemyId } from './definitions.ts';
// 敌人静态定义包含普通行为与专用Boss参数，Boss经验和材料统一乘掉落系数。
export const BOSS_LOOT_MUL = 0.8;

// 敌人基础移速下限固定120；玩家默认215不反向改变这条绝对下限。
export const ENEMY_SPEED_FLOOR = 120;

export const ENEMIES: EnemyDefinition[] = [
  // ---------- 普通 ----------
  {
    id: 'slime', name: '史莱姆', hp: 8, speed: 120, damage: 3, radius: 13,
    color: '#6ee7a8', shape: 'blob', behavior: 'chase', xp: 1, materials: 1,
    desc: '最基础的敌人，慢吞吞地撞过来。',
  },
  {
    id: 'mouse', name: '机械鼠', hp: 6, speed: 120, damage: 2, radius: 11,
    color: '#9aa3bb', shape: 'tri', behavior: 'zigzag', xp: 1, materials: 1,
    desc: '跑得很快，走位飘忽。',
  },
  {
    id: 'bat', name: '蝙蝠猫', hp: 10, speed: 120, damage: 3, radius: 12,
    color: '#b794f6', shape: 'diamond', behavior: 'orbit', xp: 1, materials: 1,
    desc: '喜欢绕着你转圈，抓不太准。',
  },
  {
    id: 'crab', name: '硬壳蟹', hp: 22, speed: 120, damage: 5, radius: 16,
    color: '#ff9f68', shape: 'hex', behavior: 'chase', armor: 4, xp: 2, materials: 2,
    desc: '壳很硬，需要更高伤害才打得动。',
  },
  {
    id: 'spitter', name: '吐酸猫', hp: 14, speed: 120, damage: 4, radius: 14,
    color: '#a5d64a', shape: 'blob', behavior: 'shooter', xp: 2, materials: 2,
      projectileShape: 'drop',      // 185 轮：酸液水滴（头圆尾尖，沿飞行方向）
    attackCooldown: 2.0, attackRange: 240, projectileSpeed: 220, projectileDamage: 4,
    desc: '会远程吐酸液，注意保持距离。',
  },
  {
    id: 'bomber', name: '自爆猫', hp: 12, speed: 120, damage: 0, radius: 14,
    color: '#ff5f6d', shape: 'circle', behavior: 'exploder', xp: 2, materials: 2,
    explosionDamage: 14, explosionRadius: 76,
    desc: '靠近就自爆，务必提前打掉。',
  },
  {
    id: 'tank', name: '铁甲猫', hp: 60, speed: 120, damage: 8, radius: 22,
    color: '#8b93b0', shape: 'square', behavior: 'chaseShooter', armor: 8, xp: 4, materials: 4,
      projectileShape: 'shard', projectileColor: '#ffa04a',   // 185 轮：重炮 = 橙色金属碎片（灰色弹在暗图上看不清）
    // 铁甲猫边追击边射击，不使用会主动后退的shooter行为。
    bulletPattern: 'aimed',
    attackCooldown: 3.2, attackRange: 300, projectileSpeed: 190,
    projectileDamage: 9, projectileCount: 1, projectileRadius: 10,
    desc: '移动缓慢但极难击杀，撞上很痛，还会远距离轰一发重炮。',
  },
  {
    id: 'charger', name: '冲锋猫', hp: 26, speed: 120, damage: 7, radius: 16,
    color: '#ff7043', shape: 'tri', behavior: 'charger', xp: 3, materials: 3,

    chargeSpeed: 312, chargeWindup: 0.7, chargeDuration: 0.55,
    // 冲锋出手时重新瞄准，距离倍率只延长冲刺距离，不改变蓄力时间。
    chargeDistanceMul: 2,
    desc: '会蓄力后高速冲撞，看到红光就闪开。',
  },
  {
    id: 'splitter', name: '分裂猫', hp: 30, speed: 120, damage: 5, radius: 19,
    color: '#7dd87d', shape: 'blob', behavior: 'splitter', xp: 3, materials: 3,
    splitInto: 'slime', splitCount: 3,
    desc: '死亡后会分裂成三只史莱姆。',
  },
  {
    id: 'ghost', name: '幽灵猫', hp: 18, speed: 120, damage: 6, radius: 15,
    color: '#c9d6e8', shape: 'diamond', behavior: 'chase', xp: 3, materials: 3,
    dodge: 0.25,
    desc: '身体半透明，有四分之一概率打空。',
  },

  // 弹幕类别分别由混乱蛋、螺旋猫等行为定义，基础数值不在行为层复制。
  {
    id: 'chaos_egg', name: '混乱蛋', hp: 20, speed: 120, damage: 4, radius: 15,
    color: '#ff8fd4', shape: 'circle', behavior: 'shooter', xp: 3, materials: 3,
      projectileShape: 'star',      // 185 轮：混乱 = 乱飞的小星星
    // 随机蛋：角度在 360° 内随机 → 玩家没法靠"站桩躲准星"规避
    bulletPattern: 'random', randomSpread: 360,
    attackCooldown: 1.6, attackRange: 300, projectileSpeed: 170,
    projectileDamage: 5, projectileCount: 2, projectileRadius: 9,
    desc: '吐出的蛋方向完全随机，没有安全站位可言。',
  },
  {
    id: 'spiral_cat', name: '螺旋猫', hp: 34, speed: 120, damage: 5, radius: 17,
    color: '#7ad7ff', shape: 'hex', behavior: 'shooter', xp: 4, materials: 4,
      projectileShape: 'petal',     // 185 轮：螺旋 = 旋出的花瓣
    // 螺旋：每发角度递增，形成旋转的弹幕墙，逼玩家绕着走
    bulletPattern: 'spiral', spiralStep: 0.62,
    attackCooldown: 0.5, attackRange: 340, projectileSpeed: 195,
    projectileDamage: 5, projectileCount: 1, projectileRadius: 8,
    desc: '持续旋转喷射弹幕，把场地切成一片片。',
  },
  {
    id: 'blade_cat', name: '刃猫', hp: 40, speed: 120, damage: 9, radius: 17,
    color: '#ffb347', shape: 'tri', behavior: 'chaseShooter', xp: 4, materials: 4,
      projectileShape: 'blade',     // 185 轮：刃猫 = 甩出的弯刃（环形 6 连）
    // 一边贴脸追一边放环形弹幕：拉开距离也躲不掉，必须真的走位
    bulletPattern: 'ring',
    attackCooldown: 2.6, attackRange: 300, projectileSpeed: 180,
    projectileDamage: 6, projectileCount: 6, projectileRadius: 8,
    desc: '贴着你打，同时甩出一圈弹幕，拉开距离也没用。',
  },
  {
    id: 'stalker', name: '猎杀猫', hp: 30, speed: 132, damage: 8, radius: 14,
    color: '#ff5c8a', shape: 'diamond', behavior: 'chase', xp: 3, materials: 3,
    // 用户要的"一直追着玩家的感觉"：速度刻意高于玩家基础移速，
    // 所以不靠位移甩不掉，必须靠输出或地形把它清掉。
    desc: '跑得比你快，会一直咬着你不放。',
  },

  // 奶妈从指定起始波注入候选池，治疗按目标类别分档。
  {
    id: 'healer_bunny', name: '樱花护士', hp: 34, speed: 130, damage: 4, radius: 15,
    color: '#ffb3c9', shape: 'circle', behavior: 'healer', armor: 2,
    xp: 4, materials: 4,
    // 从这里开始才会出现在刷怪池里
    spawnFromWave: 11,
    // 治疗参数
    healRadius: 190,          // AOE 半径
    // 治疗为5秒一次脉冲；Boss每次仅回0.5%，避免召唤奶妈瞬间回满。
    healInterval: 5,          // 治疗脉冲每5秒执行，各目标类别的恢复比例分别定义。
    healPct: {                // 每次脉冲回复**目标生命上限**的比例
      normal: 0.15,           //   小怪 20% → 15%
      elite: 0.05,            //   精英 10% → 5%
      boss: 0.005,            //   Boss 0.5%（不变）
    },
    healBuffDuration: 4,      // 被奶到的敌人保持 buff 4 秒
    healBuff: { damagePct: 20, damageReduction: 0.30 },
    // 保持距离：和 shooter 类似，但不后退得那么远
    keepDistance: 260,
    // 它自己**不攻击玩家**（damage 只在被贴脸时象征性生效）。
    // 这是刻意的：一个又奶又打的怪会让"优先点掉奶妈"这个正确解法
    // 变成"必须点掉奶妈"，压力过大。它只是让别的怪变强。
    desc: '樱花色的兔耳护士。会远远地给受伤的同伴回血并加持护盾，优先点掉它。',
  },

  // ---------- 精英 ----------
  {
    id: 'elite_crab', name: '巨型蟹将', hp: 160, speed: 120, damage: 12, radius: 30,
    color: '#ff8a50', shape: 'hex', behavior: 'chase', armor: 12, xp: 10, materials: 12,
    elite: true, scale: 1.0,
    desc: '精英敌人。血厚甲高，击杀后掉落大量材料。',
  },
  {
    id: 'elite_spitter', name: '毒液女王', hp: 120, speed: 120, damage: 8, radius: 26,
    color: '#c6e04a', shape: 'blob', behavior: 'shooter', xp: 10, materials: 12,
      projectileShape: 'drop',      // 185 轮：毒液女王三连酸液水滴
    elite: true, attackCooldown: 1.3, attackRange: 280, projectileSpeed: 260,
    projectileDamage: 7, projectileCount: 3, projectileSpread: 26,
    desc: '精英敌人。三连吐酸，压制力很强。',
  },

  // 宝箱怪逃离玩家并发光；击杀产生待结算道具，回合结束后领取。
  {
    id: 'treasure_mimic', name: '宝箱怪', hp: 26, speed: 120, damage: 0, radius: 15,
    color: '#ffc857', shape: 'chest', behavior: 'flee',
    xp: 6, materials: 6, glow: true,
    treasure: true,
    desc: '会逃跑的宝箱怪。追到并击杀它，就能拿到一件道具（回合结束时结算）。',
  },
  {
    id: 'treasure_mimic_elite', name: '华丽宝箱怪', hp: 70, speed: 120, damage: 0, radius: 20,
    color: '#ff9f68', shape: 'chest', behavior: 'flee',
    xp: 14, materials: 14, glow: true,
    treasure: true, treasureRare: true,
    desc: '更稀有的宝箱怪，掉落品质更好。',
  },

  // Boss基础生命按其波次定位定义，运行时还会叠波次和难度成长。
  {
    id: 'boss_cat_king', name: '路过被殴打的猫娘', hp: 1860, speed: 160, damage: 19.2, radius: 46,
    color: '#ff4d94', shape: 'star', behavior: 'boss', armor: 10,
    xp: 60 * BOSS_LOOT_MUL, materials: 60 * BOSS_LOOT_MUL,
    boss: true, bossName: '路过被殴打的猫娘',
    attackCooldown: 2.4, attackRange: 320, projectileSpeed: 240, projectileDamage: 12,
    projectileCount: 8, projectileSpread: 360, summonCount: 4, summonCooldown: 8,
    // Boss弹幕角度的抖动幅度也随机，避免固定偏转产生可背板的轨迹。
    bulletJitterDeg: [5, 15],
    // 自带完整脸部的Boss贴图不叠加程序眼睛，普通无脸贴图仍使用动态眼睛。
    noCanvasEyes: true,
    // 猫王使用flee保持射击距离；贴图自身含眼睛，禁用程序眼睛。
    kite: 'flee',
    // 三阶段移速倍率作用于逃离行为，独立叠加在阶段速度倍率之后。
    phase3SpeedMul: 1.2,
    // 普通Boss各阶段使用不同弹型；晶体弹按实际命中半径判定。
    crystalEvery: 3,
    crystalColor: '#ff8fb8',
    crystalFan: {
      fromPhase: 2, count: 3, spreadDeg: 34, speedMul: 1.1,
      colors: ['#ff7fae', '#fff2f4'],
    },
    phase3CrystalRings: true,
    desc: '第 10 波的守关 Boss。会环形弹幕并召唤小怪，血量越低攻势越猛，还会一路躲着你跑。',
  },
  {
    id: 'boss_void_lord', name: '黑化开发猫猫', hp: 2250, speed: 120, damage: 26.4, radius: 54,
    color: '#7c4dff', shape: 'star', behavior: 'boss', armor: 18,
    xp: 120 * BOSS_LOOT_MUL, materials: 120 * BOSS_LOOT_MUL,
    boss: true, bossName: '黑化开发猫猫',
    attackCooldown: 2.0, attackRange: 360, projectileSpeed: 280, projectileDamage: 16.8,
    projectileCount: 12, projectileSpread: 360, summonCount: 6, summonCooldown: 7,
    chargeSpeed: 300,
    // 环形弹幕同样使用随机角度扰动。
    bulletJitterDeg: [5, 15],
    // 第十五轮 ④：立绘自带脸，关掉 canvas 眼睛（理由见 boss_cat_king）
    noCanvasEyes: true,
    // 开发猫猫以紫色结晶扇和三阶段七彩结晶环区分阶段。
    crystalEvery: 4,
    crystalColor: '#b388ff',
    crystalFan: {
      fromPhase: 2, count: 5, spreadDeg: 46, speedMul: 1.15,
      colors: ['#c56cf0', '#e879f9', '#70a1ff'],
    },
    phase3RainbowRing: true,
    desc: '第 20 波的最终 Boss。弹幕更密，还会冲锋与召唤，第三阶段压迫感极强。',
  },

  // 近战Boss以冲刺制造威胁，与普通追击敌人使用不同速度/距离参数。
  {
    // speed 120 = 移速地板（第十八轮：所有怪不得慢于地板）
    id: 'boss_pandora', name: '格镜魔女·潘多拉', hp: 1860, speed: 120, damage: 19.2, radius: 44,
    color: '#c56cf0', shape: 'star', behavior: 'boss', armor: 10,
    xp: 60 * BOSS_LOOT_MUL, materials: 60 * BOSS_LOOT_MUL,
    boss: true, bossName: '格镜魔女·潘多拉',
    attackCooldown: 2.8, attackRange: 340, projectileSpeed: 200, projectileDamage: 12,
    projectileCount: 6, projectileSpread: 360, summonCount: 3, summonCooldown: 9,
    bulletJitterDeg: [5, 15],
    noCanvasEyes: true,
    // 不配 kite:'flee'：那是被殴猫娘的专属走位（第四十轮测试钉死"只有她在用"）；潘多拉走通用的保持中距离。
    signature: 'pandora',
    desc: '第 10 波的守关 Boss（魔女）。弹幕按 64px 网格左右镜像砸落，正对你的位置留着安全缝；血越少，侧击与星弹螺旋越多。',
  },
  {
    id: 'boss_nono', name: '天幕机兵·诺诺', hp: 2250, speed: 120, damage: 26.4, radius: 50,
    color: '#4ab8ff', shape: 'star', behavior: 'boss', armor: 18,
    xp: 120 * BOSS_LOOT_MUL, materials: 120 * BOSS_LOOT_MUL,
    boss: true, bossName: '天幕机兵·诺诺',
    attackCooldown: 2.4, attackRange: 360, projectileSpeed: 220, projectileDamage: 16.8,
    projectileCount: 8, projectileSpread: 360, summonCount: 4, summonCooldown: 8,
    bulletJitterDeg: [5, 15],
    noCanvasEyes: true,
    signature: 'nono',
    desc: '第 20 波的守关 Boss（机器人）。斜雨铺满天幕，二阶段起三向落柱围出三块安全方块，三阶段预判你的走位。',
  },
  {
    id: 'boss_acid_cat',
    name: '蒜蓉粉丝开背虾',

    hp: 2100, speed: 120, damage: 24, radius: 44,
    hpNightmare: 2935,
    color: '#ff8a5c', shape: 'shrimp', behavior: 'meleeBoss', armor: 12,
    xp: 60 * BOSS_LOOT_MUL, materials: 60 * BOSS_LOOT_MUL,
    boss: true, bossName: '蒜蓉粉丝开背虾',
    // 近战 Boss 的弹幕是"液体飞溅"：条数少、扇面窄、速度慢但持续久，
    // 作用是把玩家**从安全位置赶开**，而不是靠密度杀人。
    // 所以 projectileCount 远低于远程 Boss 的 8~12。
    attackCooldown: 2.2, attackRange: 240, projectileSpeed: 210, projectileDamage: 10.8,   // 第十九轮②：9 × 1.2
    projectileCount: 5, projectileSpread: 70, summonCount: 3, summonCooldown: 9,
    // 冲刺参数：蓄力 0.55s（玩家有反应时间），冲刺 0.5s，速度 340。
    // 蓄力期间会画红色预警线（复用 charger 的表现），所以是"可读的威胁"。
    chargeSpeed: 340, chargeWindup: 0.55, chargeDuration: 0.5,
    bulletJitterDeg: [5, 15],
    // 虾Boss冲刺有独立距离倍率、风墙与三阶段弹幕，参数由其行为消费。
    facePlayer: true,
    // 第二十轮：立绘的头在**顶端中心** → 渲染层整图旋转（renderer 的
    // faceRotate 分支），让"那个点"始终对着玩家；其他 Boss 仍是水平镜像。
    faceRotate: true,
    phaseCharge: true,
    // 立绘自带"脸"（虾头和虾壳的纹理），关掉 canvas 眼睛（理由见 boss_cat_king）
    noCanvasEyes: true,
    phaseWaterJet: {
      // 后退距离（px）：要"猛的后退一大截"，取 420 —— 比一次冲刺还远，
      // 让玩家立刻失去贴脸机会，然后被迫面对接下来的水柱。
      retreatDistance: 420,
      // 后退耗时：0.28s 走完 420px ≈ 1500px/s，观感是"弹开"而不是"走开"。
      retreatDuration: 0.28,
      // 后退结束到水柱发射之间的停顿（蓄势，给玩家一点点反应时间但不长）
      windup: 0.22,
      // 水柱：又细又快，像激光。"很快"是用户的原话。
      jetSpeed: 1400,
      jetLength: 900,
      jetWidth: 16,
      jetDamage: 26,
      jetCount: 1,
      // 一次水柱结束后到下次尝试之间的间隔（避免刷屏）
      cooldown: 3.4,
    },
    desc: '第 10 波的守关 Boss（近战型，50% 概率出场）。虾头永远对着你，二阶段会突然撞过来，三阶段会弹开并喷出高速水柱。',
  },
  {
    id: 'boss_apple_cider',
    name: '依趣苹果醋',
    // 苹果醋基础移速遵守120下限；冲刺速度与弹幕寿命独立定义。
    hp: 2400, speed: 132, damage: 31.2, radius: 52,   // 第十九轮②：伤害 26×1.2；第十九轮：速度 120×1.1
    color: '#c8862f', shape: 'bottle', behavior: 'meleeBoss', armor: 20,
    xp: 120 * BOSS_LOOT_MUL, materials: 120 * BOSS_LOOT_MUL,
    boss: true, bossName: '依趣苹果醋',
    // Boss贴图或程序造型已经包含眼睛，禁用额外眼睛叠绘。
    noCanvasEyes: true,
    // 第 20 波的近战 Boss，比派特全面更强：
    // 冲刺更快、弹幕更酸（更多、更慢、留得更久，逼玩家持续移动）。
    attackCooldown: 1.9, attackRange: 280, projectileSpeed: 190, projectileDamage: 15.6,   // 第十九轮②：13 × 1.2
    projectileRange: 1040,   // 第十九轮：弹幕消失范围 ×2（默认 520）
    projectileCount: 7, projectileSpread: 90, summonCount: 4, summonCooldown: 8,
    chargeSpeed: 418, chargeWindup: 0.48, chargeDuration: 0.55,   // 第十九轮：380 × 1.1（包括冲刺）
    // 苹果醋的追击速度、冲刺距离和弹幕寿命独立调节，不用同一倍率替代。
    chaseSpeedMul: 1.2,
    chargeDistanceMul: 1.3,
    // 苹果醋的"招牌"：冲刺**连续两次**（停顿一下再冲一次），
    // 玩家躲开第一次就以为安全，正是第二次的命中时机。
    // 这是"饮料敌人"的性格化设计 —— 酸得**回甘**，后劲在第二口。
    chargeRepeats: 2,
    bulletJitterDeg: [5, 15],
    // 苹果西打使用金黄和青苹果色结晶弹作为阶段特征；其他Boss不继承这些参数。
    crystalEvery: 3,
    crystalColor: '#ffd166',
    phase3AppleCrystals: { color: '#7bed9f' },
    desc: '第 20 波的最终 Boss（近战型，50% 概率出场）。黏着你不放，停顿即冲刺，还会连冲两次。',
  },

  // 芙兰挑战素材来自touhou-flandre拆包；其阶段和控制器归encounters。
  {
    id: 'flandre', name: '芙兰朵露·斯卡蕾特',
    // 第八十六轮：总血量 50万 → 80万（用户："把芙兰的总血量改到80万"；
    // 配套每卡 20% 锁血分段见 flandre.js CARD_HP_FRAC）
    hp: 800000, speed: 120, damage: 12, radius: 48,
    color: '#ff4060', shape: 'circle', behavior: 'boss', armor: 0,
    xp: 0, materials: 0,
    boss: true, bossName: '芙兰朵露·斯卡蕾特',
    // 她的攻击全部由符卡脚本发（flandre:true 敌弹走 30% 真实伤害），
    // Boss AI 的自带弹环必须永久哑火：Infinity 冷却永远不会 <= 0。
    attackCooldown: Infinity,
    noCanvasEyes: true,
    desc: '隐藏挑战 Boss。噩梦难度 20 波通关且重开不超 3 次才会现身。',
  },
  { id: 'flandre_sit', name: '芙兰朵露（抱腿）', hp: 500000, speed: 120, damage: 0, radius: 48,
    color: '#ff4060', shape: 'circle', behavior: 'boss', armor: 0, xp: 0, materials: 0,
    boss: true, bossName: '芙兰朵露', attackCooldown: Infinity, noCanvasEyes: true,
    desc: 'Extra Phantom 姿势贴图位（循环帧 202）。',
  },
  // 第五十轮：常态动画循环帧（用户："172-175 的插图其实是个她不移动的
  // 常态动画（只有翅膀再动），把芙兰一动不动变成172-175慢慢循环"）
  { id: 'flandre_idle2', name: '芙兰朵露（常态2）', hp: 500000, speed: 120, damage: 0, radius: 48,
    color: '#ff4060', shape: 'circle', behavior: 'boss', armor: 0, xp: 0, materials: 0,
    boss: true, bossName: '芙兰朵露', attackCooldown: Infinity, noCanvasEyes: true,
    desc: '常态动画贴图位（循环帧 173，只有翅膀在动）。',
  },
  { id: 'flandre_idle3', name: '芙兰朵露（常态3）', hp: 500000, speed: 120, damage: 0, radius: 48,
    color: '#ff4060', shape: 'circle', behavior: 'boss', armor: 0, xp: 0, materials: 0,
    boss: true, bossName: '芙兰朵露', attackCooldown: Infinity, noCanvasEyes: true,
    desc: '常态动画贴图位（循环帧 174）。',
  },
  { id: 'flandre_idle4', name: '芙兰朵露（常态4）', hp: 500000, speed: 120, damage: 0, radius: 48,
    color: '#ff4060', shape: 'circle', behavior: 'boss', armor: 0, xp: 0, materials: 0,
    boss: true, bossName: '芙兰朵露', attackCooldown: Infinity, noCanvasEyes: true,
    desc: '常态动画贴图位（循环帧 175）。',
  },
  { id: 'flandre_sit2', name: '芙兰朵露（抱腿2）', hp: 500000, speed: 120, damage: 0, radius: 48,
    color: '#ff4060', shape: 'circle', behavior: 'boss', armor: 0, xp: 0, materials: 0,
    boss: true, bossName: '芙兰朵露', attackCooldown: Infinity, noCanvasEyes: true,
    desc: 'Extra Phantom 姿势贴图位（循环帧 205）。',
  },
  { id: 'flandre_sit3', name: '芙兰朵露（抱腿3）', hp: 500000, speed: 120, damage: 0, radius: 48,
    color: '#ff4060', shape: 'circle', behavior: 'boss', armor: 0, xp: 0, materials: 0,
    boss: true, bossName: '芙兰朵露', attackCooldown: Infinity, noCanvasEyes: true,
    desc: 'Extra Phantom 姿势贴图位（循环帧 208）。',
  },
  { id: 'flandre_laevateinn', name: '芙兰朵露（莱万汀）', hp: 500000, speed: 120, damage: 0, radius: 48,
    color: '#ff4060', shape: 'circle', behavior: 'boss', armor: 0, xp: 0, materials: 0,
    boss: true, bossName: '芙兰朵露', attackCooldown: Infinity, noCanvasEyes: true,
    desc: 'Lævateinn 符卡专属攻击姿势贴图位（192）。',
  },
];

export const ENEMY_MAP = Object.fromEntries(ENEMIES.map((e) => [e.id, e])) as Record<EnemyId, EnemyDefinition>;
Object.setPrototypeOf(ENEMY_MAP, null);
export const getEnemy = (id: unknown) => typeof id === 'string' && Object.hasOwn(ENEMY_MAP, id) ? ENEMY_MAP[id as EnemyId] : undefined;

// 按移动策略分类近战：追击/冲刺类算近战，主动拉开距离的shooter不算；Boss排除。
export const MELEE_BEHAVIORS = new Set([
  'chase', 'zigzag', 'orbit', 'charger', 'splitter', 'exploder', 'flee',
  'chaseShooter',
]);

/** 这个敌人算不算近战（用于噩梦移速的 +15% 档） */
export function isMeleeEnemy(def: Pick<Partial<EnemyDefinition>, 'boss' | 'behavior'> | null | undefined) {
  if (!def) return false;
  if (def.boss) return false;
  return MELEE_BEHAVIORS.has(def.behavior ?? 'chase');
}

export const getEliteEnemies = () => ENEMIES.filter((e) => e.elite);
/** 宝箱怪单独一类 */
export const getTreasureEnemies = () => ENEMIES.filter((e) => e.treasure);

// Boss贴图采用明确白名单；没有素材时使用程序造型，避免每局请求已知缺失资源。
export const BOSS_SPRITE_IDS = new Set([
  'boss_cat_king',    // 第 10 关远程：路过被殴打的猫娘
  'boss_acid_cat',    // 第 10 关近战：蒜蓉粉丝开背虾
  'boss_void_lord',   // 第 20 关远程：黑化开发猫猫
  'boss_pandora',     // 第 10 关远程(新)：格镜魔女·潘多拉（185 轮，几何绘制立绘 tools/make-boss-art.py）
  'boss_nono',        // 第 20 关远程(新)：天幕机兵·诺诺
  // 第四十九轮：芙兰朵露全套（本体 + 常态三帧 + 抱腿坐姿三帧 + 莱万汀姿势）
  'flandre',
  'flandre_idle2',
  'flandre_idle3',
  'flandre_idle4',
  'flandre_sit',
  'flandre_sit2',
  'flandre_sit3',
  'flandre_laevateinn',
]);

// 每个Boss波在开局抽定近/远程阵容并入档，重试不重抽。

// 10/20波分别有近战和远程候选，远程分支可含替代Boss。
export const BOSS_VARIANTS: Record<10 | 20, { ranged: EnemyId; rangedAlt: EnemyId[]; melee: EnemyId }> = {
  // rangedAlt（185 轮）：远程名额里的"备选"；远程 50% 里 ranged 与 rangedAlt 平分。
  10: { ranged: 'boss_cat_king', rangedAlt: ['boss_pandora'], melee: 'boss_acid_cat' },
  20: { ranged: 'boss_void_lord', rangedAlt: ['boss_nono'], melee: 'boss_apple_cider' },
};

// 只用一次随机抽取近/远程与远程备选；显式forceMelee用于固定阵容验证。
export function pickBossForWave(wave1based: number, rng: RandomSource, forceMelee: boolean | null = null) {
  const pair = wave1based === 10 || wave1based === 20 ? BOSS_VARIANTS[wave1based] : undefined;
  if (!pair) return null;
  // Boss配对选择只消耗一次随机数；forceMelee=false明确选择主远程配对。
  if (forceMelee !== null) return forceMelee ? pair.melee : pair.ranged;
  const u = rng.next();
  if (u < 0.5) return pair.melee;
  const pool = [pair.ranged, ...(pair.rangedAlt ?? [])];
  const sub = (u - 0.5) * 2;                                  // [0,1)
  return pool[Math.min(pool.length - 1, Math.floor(sub * pool.length))];
}
