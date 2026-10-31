// 商店按商品流派与角色偏好匹配加权；未匹配保持基础权重。

import type { CharacterId, WeaponId, ItemId, WeaponDefinition, ItemDefinition } from './definitions.ts';
export type Archetype = 'sweep' | 'quake' | 'crit' | 'ranged' | 'homing' | 'chain' | 'turret' | 'tank' | 'damage' | 'luck' | 'speed';

/** 商店里「本命流派」商品的权重倍率（用户要求 120%） */
export const SHOP_ARCH_BONUS = 1.2;

// 武器ID到流派的唯一映射，用于商店与AI偏好。
export const WEAPON_ARCH: Record<WeaponId, Archetype> = {
  // 近战·横扫吸血
  cat_paw: 'sweep',
  claw_glove: 'sweep',
  tuna_blade: 'sweep',
  fish_bone_scythe: 'sweep',
  void_scythe: 'sweep',
  // 近战·重击
  fish_shield: 'quake',
  mouse_toy: 'quake',
  iron_hammer: 'quake',
  cat_king_hammer: 'quake',
  // 近战·暴击
  shadow_dagger: 'crit',
  crit_lance: 'crit',
  thousand_claw: 'crit',
  nine_lives_claw: 'crit',
  // 远程
  pebble_toss: 'ranged',
  yarn_thrower: 'ranged',
  laser_pointer: 'ranged',
  meow_cannon: 'ranged',
  // 元素·追踪
  star_wand: 'homing',
  bubble_gun: 'homing',
  meteor_paw: 'homing',
  // 元素·连锁
  lucky_coin: 'chain',
  bell_chime: 'chain',
  chain_bell: 'chain',
  thunder_god_bell: 'chain',
  // 炮台
  toy_turret: 'turret',
  cardboard_turret: 'turret',
  cat_ear_turret: 'turret',
  meow_fortress: 'turret',
};

/**
 * 道具 id → 流派。
 * 一件道具只归一个流派（决定它受哪个角色的加权）。
 */
export const ITEM_ARCH: Record<ItemId, Archetype> = {
  // 生存
  warm_milk: 'tank',
  cat_armor: 'tank',
  thick_fur: 'tank',
  healing_herb: 'tank',
  steel_plate: 'tank',
  // 通用输出
  sharp_fang: 'damage',
  catnip: 'damage',
  glass_cannon: 'damage',
  cursed_collar: 'damage',
  blood_pact: 'damage',
  berserk_pill: 'damage',
  // 分路输出
  scope_lens: 'ranged',
  // 第一百一十五轮：穿甲弹 —— 远程/元素/炮台穿透，归远程流派
  ap_round: 'ranged',
  iron_knuckle: 'sweep',
  magic_gem: 'homing',
  crit_eye: 'crit',
  // 第四十九轮：芙兰的魔剑 —— 纯输出（最终乘算通道）
  laevatein: 'damage',
  // 第一百四十一轮：维吉尔的阎魔刀 —— 次元斩清场，归输出流派
  yamato: 'damage',
  // 第一百三十四轮：Boss 专属掉落红品（8 件）—— round4 要求每件道具
  // 都有流派标签；按效果主轴归档。
  dried_fish: 'damage',        // 全属性 +1：泛用成长，归输出
  lobster_pillow: 'damage',    // 吸血转伤害：吸血输出流
  smart_wand: 'ranged',        // 远程追踪 + 射程
  dr_m_notes: 'tank',          // 承伤 -20% + 受击反伤
  lucky_cat_paw: 'crit',       // 暴击再暴击
  black_cape: 'tank',          // 闪避生存
  cat_taffy: 'tank',           // 回复生存
  overload_chip: 'damage',     // 易伤叠层：输出
  // 炮台
  gear_oil: 'turret',
  radar_chip: 'turret',
  turret_blueprint: 'turret',
  // 幸运经济
  lucky_bell: 'luck',
  shiny_coin: 'luck',
  magnet_paw: 'luck',
  four_leaf: 'luck',
  lucky_cat: 'luck',
  greed_idol: 'luck',
  // 机动
  running_shoes: 'speed',
  feather: 'speed',
};

// 角色可偏好多种流派；共享流派商品只应用一次匹配倍率。
export const CHARACTER_ARCH: Record<CharacterId, Archetype[]> = {
  yui: ['sweep', 'ranged'],
  mimi: ['sweep', 'crit'],
  luna: ['homing', 'chain'],
  shiro: ['quake', 'turret'],
  nana: ['chain', 'luck'],
  kuro: ['crit', 'ranged'],
  // 悠怡洛丽塔的副流派偏生存，配合其续航定位。
  youyi: ['quake', 'tank'],
  // Neon两个流派槽均为turret，商店偏好倍率叠乘。
  neon_party: ['turret', 'turret'],
};

/** 取武器流派 */
export function weaponArch(def: Pick<WeaponDefinition, 'id'> | null | undefined) {
  return (def ? WEAPON_ARCH[def.id] : null) || null;
}

/** 取道具流派 */
export function itemArch(def: Pick<ItemDefinition, 'id'> | null | undefined) {
  return (def ? ITEM_ARCH[def.id] : null) || null;
}

/** 取角色的本命流派列表 */
export function characterArch(characterId: unknown) {
  return typeof characterId === 'string' && Object.hasOwn(CHARACTER_ARCH, characterId) ? CHARACTER_ARCH[characterId as CharacterId] : [];
}

// 匹配本命流派时返回SHOP_ARCH_BONUS，其他商品权重为1。
export function archWeightMul(arch: Archetype | null, playerArch: readonly Archetype[] | null | undefined) {
  if (!arch || !playerArch || playerArch.length === 0) return 1;
  return playerArch.includes(arch) ? SHOP_ARCH_BONUS : 1;
}
