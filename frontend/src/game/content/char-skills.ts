// 角色能力与技能定义只存静态参数；运行时触发归actors/character-skills。

// 数量型属性的最终倍率进入statsFinalMul；百分数型属性的倍率在实际消费点应用。
import type { CharacterId, CharacterSkillDefinition } from './definitions.ts';
export type { CharacterSkillDefinition } from './definitions.ts';
export const CHAR_SKILLS: Record<CharacterId, CharacterSkillDefinition> = {
  // 悠怡：均衡成长与锁血后的移动技能。
  yui: {
    ability: {
      name: '主角的余裕',
      text: '获得的经验 +20%。每回合结束时额外获得 2 点收获。',
    },
    skill: {
      name: '猫的步伐',
      text: '受到致死伤害时锁住 1 点生命，无敌 3 秒并获得 40% 移动速度。每回合只能触发 1 次。',
    },
    params: {
      xpMul: 1.2,             // 经验 ×1.2
      harvestPerRound: 2,     // 每回合结束 +2 收获
      // ---- 猫的步伐 ----
      lethalInvuln: 3,        // 锁血后的无敌秒数
      lethalSpeedMul: 1.4,    // 锁血后的移速倍率（+40%）
      lethalSpeedTime: 3,     // 加速持续时间（跟无敌同步）
      lethalPerRound: 1,      // 每回合次数上限
    },
  },

  // 小八：近战与狂战能力。
  mimi: {
    ability: {
      name: '狂战本能',
      text: '近战武器伤害 +20%。远程武器与炮台伤害 -20%。',
    },
    skill: {
      name: '龙虾突击',

      text: '近战武器命中敌人时有 20% 概率召唤一次龙虾追击，造成该次武器伤害 200% 的伤害，触发时小八回复 5 滴血。',
    },
    statMul: {
      meleeDamage: 1.2,       // 近战 ×1.2
      rangedDamage: 0.8,      // 远程 ×0.8
      turretDamage: 0.8,      // 炮台 ×0.8
    },
    params: {
      lobsterChance: 0.20,    // 触发概率
      lobsterMul: 2.0,        // 伤害倍率（相对**触发的武器**的本次伤害）
    },
  },

  // neon：元素与法师能力。
  luna: {
    ability: {
      name: '元素亲和',
      text: '远程伤害与元素伤害 +20%。最大生命与近战武器伤害 -20%。',
    },
    skill: {
      name: '保持安全距离喵',
      text: '离敌人越远，造成的伤害越高，最远约一个屏幕时额外追加 40% 伤害。',
    },
    statsFinalMul: { maxHp: 0.8 },   // 生命成长 ×0.8
    statMul: {
      rangedDamage: 1.2,
      elemDamage: 1.2,
      meleeDamage: 0.8,
    },
    params: {
      distanceBonusMax: 0.40,   // 最高额外 40%
      distanceFull: 640,        // 达到满加成所需的像素距离（约一个屏幕）
    },
  },

  // 开发猫猫：受伤叠层独立计时，动态作用于伤害与移速。
  shiro: {
    ability: {
      name: '重装猫体',
      text: '最大生命与护甲 +20%。伤害、攻速、移速 -12%。',
    },
    skill: {
      name: 'M博士来了',
      text: '受到伤害时伤害 +5%、移速 +5%，持续 5 秒且可无限叠加。5 秒内没有受伤则加成清零。每次受伤还会获得 1 材料（不清零）。',
    },
    statsFinalMul: { maxHp: 1.2, armor: 1.2 },
    statMul: {
      damage: 0.88,
      attackSpeed: 0.88,
      moveSpeed: 0.88,
    },
    params: {
      stackDamage: 5,       // 第二十轮：每层 +3% → +5% 伤害
      stackMove: 5,         // 第二十轮：每层 +3% → +5% 移速
      stackDuration: 5,     // 5 秒没受伤清零
      stackGold: 1,         // 第二十四轮：每次挨打 +1 材料（永久，不清零）
    },
  },

  // 悠怡萌妹：幸运效果倍率与额外收益。
  nana: {
    ability: {
      name: '欧气侧漏',
      text: '幸运总效果 +20%。每拥有 10 点幸运，收获 +1。',
    },
    skill: {
      name: '本喵最欧',
      text: '造成伤害时有 10% 概率造成 150% 伤害；受到伤害时有 10% 概率减少 50% 伤害。两者都随幸运提升，各自最高 30% 概率。',
    },
    luckEffectMul: 1.2,     // 0.8 × 1.2 = 0.96
    params: {
      luckPerHarvest: 10,       // 每 10 点幸运 +1 收获
      luckyHitChance: 10,       // 基础 10%
      luckyHitMul: 1.5,         // 150% 伤害
      luckyGuardReduction: 0.5, // 减 50% 最终伤害
      luckyChanceMax: 30,       // 两条都封顶 30%
      luckyChancePerLuck: 0.1,  // 每 1 点实际幸运 +0.1%（即每 10 点 +1%）
    },
  },

  // 库洛：攻速增加诅咒概率，范围随拾取半径成长。
  kuro: {
    ability: {

      name: '影袭',
      text: '近战武器攻击距离 +20%，攻速 +20%，移速 +20%。受到的伤害 +12%。',
    },
    skill: {
      name: '毒舌猫娘',
      text: '拾取范围内的敌人每 3 秒被判定一次，有 20% 概率中招：伤害、移速、攻速各 -20%，持续 5 秒且不可叠加。库洛每多 10% 攻速，判定概率 +1%。',
    },
    statMul: {
      attackSpeed: 1.2,
      moveSpeed: 1.2,
      damageTaken: 1.12,      // 受到的伤害 ×1.12（第一百五十六轮 1.2 → 1.12）
    },
    params: {
      meleeRangeMul: 1.2,     // 近战攻击距离 ×1.2
      curseInterval: 3,       // 每 3 秒判定一次
      curseChance: 0.20,      // 基础 20%
      // 每10%攻速增加1个百分点，即每1%攻速增加0.001概率。
      curseChancePerAS: 0.001,
      curseDuration: 5,       // 持续 5 秒
      curseDamageMul: 0.8,    // 敌人伤害 ×0.8
      curseSpeedMul: 0.8,     // 敌人移速 ×0.8
      curseRateMul: 0.8,      // 敌人攻速 ×0.8（= 冷却 ÷0.8）
    },
  },

  // 悠怡洛丽塔：完全格挡盾与溢出治疗转盾。
  youyi: {
    ability: {
      name: '洋娃娃体质',
      text: '生命回复与拾取范围 +20%。伤害 -10%。',
    },
    skill: {
      name: '伤不到我喵',
      text: '生命已满时，多出来的治疗会转化为护盾，最高为总生命的 30%。护盾存在期间不会受到生命伤害。护盾破碎后 5 秒内无法再获得护盾。',
    },
    statsFinalMul: { hpRegen: 1.2, pickupRange: 1.2 },
    statMul: { damage: 0.9 },
    params: {
      shieldMaxPct: 0.30,     // 护盾上限 = 总生命 × 0.3
      breakLockout: 5,        // 碎盾后 5 秒不能再拿盾
    },
  },

  // Neon：炮台最终倍率与对同一目标的独立叠层。
  neon_party: {
    ability: {
      name: '宴会指挥',
      text: '炮台伤害与炮台攻速 +20%。其他所有伤害 -20%。',
    },
    skill: {
      name: '火力即正义',
      text: '炮台命中同一个敌人时，它受到的最终伤害每次 +1%，最高 +30%。该敌人 5 秒内没再被炮台命中则加成重置。',
    },
    statMul: {
      turretDamage: 1.2,
      turretRate: 1.2,
      damage: 0.8,            // 其他伤害（不含炮台）
    },
    params: {
      stackPerHit: 0.01,      // 每次 +1%
      stackMax: 0.30,         // 最高 +30%
      stackDuration: 5,       // 5 秒没被炮台打中就重置
    },
  },
};

/** 取某个角色的能力/技能定义；没有就返回 null（别的角色不受影响） */
export function getCharSkill(characterId: unknown) {
  return typeof characterId === 'string' && Object.hasOwn(CHAR_SKILLS, characterId) ? CHAR_SKILLS[characterId as CharacterId] : null;
}
