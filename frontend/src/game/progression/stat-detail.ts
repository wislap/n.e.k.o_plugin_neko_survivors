// 属性详情解释实际生效数值与规则边界，供投影生成可直接显示的说明。

import { luckBenefits } from './luck-rules.ts';
import type { StatKey, StatValues } from './stats.ts';
import { STAT_DEFS, armorMultiplier, effectiveLuckFor } from './stats.ts';

/** 把 0~1 的比例写成 "60.5%" */
function pct(x: number, digits = 1) {
  return `${(x * 100).toFixed(digits)}%`;
}

/** clamp01 */

// 根据属性ID与当前数值生成解释，不从中文名称或数值大小猜测单位。
export function describeStat(key: StatKey, s: StatValues, luckEffectMul = 1) {
  const v = s[key];
  if (v === undefined) return '';

  switch (key) {
    // ---- 生存 ----
    case 'maxHp':
      return '当前生命上限。受伤后每波结束会回满。';

    case 'hpRegen':
      return v > 0 ? `每秒回复 ${v.toFixed(1)} 点生命。` : '没有生命回复。';

    case 'armor': {
      // 实现：entities/player.js takeDamage → stats.armorMul → armorMultiplier()
      const mul = armorMultiplier(v);
      const cut = 1 - mul;
      if (v <= 0) return '没有护甲，承受全额伤害。';
      return `减伤 ${pct(cut)}，实际只承受 ${pct(mul)} 伤害。`
        + `（递减曲线：30 甲 = 减伤 50%，最多减伤 80%）`;
    }

    case 'dodge':
      // 实现：entities/player.js takeDamage → rng < dodge 则完全免伤
      return v > 0
        ? `有 ${pct(v / 100)} 的概率完全躲开一次伤害（闪避成功不受任何伤害）。`
        : '没有闪避，所有攻击都会命中。';

    case 'lifesteal':
      // 吸血每次固定回复1点，不按伤害百分比回血；文案须反映真实机制。
      return v > 0
        ? `命中时有 ${pct(v / 100)} 的概率回复 1 点生命（每次固定 1 点，不看伤害高低）。`
        : '没有吸血。';

    // ---- 输出 ----
    case 'damage':
      return v !== 0
        ? `所有武器伤害 ×${(1 + v / 100).toFixed(2)}（即 ${v > 0 ? '+' : ''}${Math.round(v)}%）。`
        : '武器伤害没有额外加成。';

    case 'meleeDamage':
      return v !== 0
        ? `仅近战武器伤害 ×${(1 + v / 100).toFixed(2)}。`
        : '近战武器没有额外加成。';

    case 'rangedDamage':
      return v !== 0
        ? `仅远程武器伤害 ×${(1 + v / 100).toFixed(2)}。`
        : '远程武器没有额外加成。';

    case 'elemDamage':
      return v !== 0
        ? `仅元素武器伤害 ×${(1 + v / 100).toFixed(2)}。`
        : '元素武器没有额外加成。';

    case 'attackSpeed': {
      // 实现：entities/weapon.js computeCooldown → base / (1 + as/100)
      const mul = 1 + v / 100;
      if (v === 0) return '武器按原始频率开火。';
      if (mul <= 0) return '攻速被压到极低，武器几乎无法开火。';
      return `开火频率 ×${mul.toFixed(2)}，也就是每秒多打 ${Math.round((mul - 1) * 100)}%。`;
    }

    case 'critChance': {
      // 实现：systems/world.js dealDamage → rng*100 < critChance
      const cd = s.critDamage ?? 50;
      return v > 0
        ? `每次命中 ${pct(v / 100)} 概率暴击，暴击造成 ×${(1 + cd / 100).toFixed(2)} 伤害。`
        : '不会暴击。';
    }

    case 'critDamage':
      // 基础 50 表示"暴击多打 50%"
      return `暴击时额外 +${Math.round(v)}% 伤害（暴击总倍率 ×${(1 + v / 100).toFixed(2)}）。`;

    case 'range':
      // 第三十四轮：近战也吃这个属性了（第三十二轮），提示改成全射程口径
      return v !== 0
        ? `全射程 ×${(1 + v / 100).toFixed(2)}（近战按五折、360 度武器按 150% 结算，远程/炮台全额）。`
        : '武器射程没有加成。';

    // ---- 机动 ----
    case 'moveSpeed':
      return v !== 0
        ? `移动速度 ×${(1 + v / 100).toFixed(2)}。`
        : '基础移动速度。';

    case 'pickupRange':
      return `自动吸取材料的半径 ${Math.round(v)} 像素（越大越不用走过去捡）。`;

    // ---- 收益 ----
    case 'luck': {
      // Share benefit queries with the actual loot/shop settlement.
      if (v === 0) return '没有幸运加成，掉落与商店按基础概率。';
      const eff = effectiveLuckFor(v, luckEffectMul);
      const { dropMultiplier: dropMul, shopQualityBonus: shopBonus, mimicRareBonus: mimicBonus } = luckBenefits(eff);
      const parts = [`材料与医疗包掉落概率 ×${dropMul.toFixed(2)}`];
      if (shopBonus > 0) {
        parts.push(`商店高品质商品权重 +${Math.round(shopBonus * 100)}%`);
      }
      if (mimicBonus > 0) {
        parts.push(`华丽宝箱怪概率 +${pct(mimicBonus)}`);
      }
      // 把"实际按多少计入"明确写出来，否则玩家会觉得数值对不上。
      // 有角色倍率时写真实倍率（0.8 × 1.2 = 96%），没有就写基础的 80%。
      const totalMul = eff / v;
      parts.push(`（幸运总效果已按 ${Math.round(totalMul * 100)}% 计入）`);
      return parts.join('；') + '。';
    }

    case 'harvesting':
      return v > 0
        ? `每波结束时额外获得 ${Math.round(v)} 材料。`
        : '每波结束没有额外材料。';

    // ---- 炮台 ----
    case 'turretDamage':
      return v !== 0
        ? `仅炮台伤害 ×${(1 + v / 100).toFixed(2)}。`
        : '炮台伤害没有额外加成。';

    case 'turretRate':
      return v !== 0
        ? `炮台开火频率 ×${(1 + v / 100).toFixed(2)}。`
        : '炮台按原始频率开火。';

    case 'turretRange':
      return v !== 0
        ? `炮台索敌距离 ×${(1 + v / 100).toFixed(2)}。`
        : '炮台索敌距离没有加成。';

    case 'turretMax': {
      // 唯一保留上限的属性（防止实体过多崩帧）
      const cap = STAT_DEFS.turretMax.max;
      return `额外可同时存在 ${Math.round(v)} 座炮台（上限 ${cap}，超过的会替换最旧的一座）。`;
    }

    default:
      return '';
  }
}
