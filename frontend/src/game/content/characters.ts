import type { CharacterDefinition, CharacterId } from './definitions.ts';
export type { CharacterDefinition, CharacterId } from './definitions.ts';
// 8个角色全部可选；静态成长与起始装备在此定义，技能参数另表维护。

export const CHARACTERS: CharacterDefinition[] = [
  {
    id: 'yui',
    name: '悠怡',
    role: '均衡型 · 主角',
    color: '#ff7bac',
    accent: '#ffd6e6',
    glyph: '悠',
    desc: '猫娘计划的主角。各项能力均衡，没有明显短板，适合任何流派。',
    // 基础值覆盖
    stats: {},
    // 初始修正：加法
    mods: { maxHp: 4, moveSpeed: 5 },
    pct: {},
    startWeapon: 'cat_paw',
  },
  {
    id: 'mimi',
    name: '小八',
    role: '狂战型',
    color: '#ff5f6d',
    accent: '#ffc9cd',
    glyph: '八',
    desc: '好战的小猫。伤害更高，但体质偏弱。适合近战莽夫打法。',
    stats: {},
    mods: { maxHp: -4 },
    // 第四十五轮：基础 +5% 吸血（本作吸血 = 每次命中 x% 概率回 1 滴血）。
    // 用户原话："给小八做个基础加强：基础属性里加上5%吸血。"
    pct: { damage: 15, attackSpeed: 10, dodge: -5, lifesteal: 5 },
    startWeapon: 'claw_glove',
  },
  {
    id: 'luna',
    // 角色显示名可以变化；luna存档ID及neon.png资源路径保持稳定。
    name: 'Roki',
    role: '法师型',
    color: '#b794f6',
    accent: '#e3d6ff',
    glyph: 'N',
    desc: '沉迷魔法的猫娘。元素伤害突出，射程更远，但身板很脆。',
    stats: {},
    mods: { maxHp: -6, pickupRange: 15 },

    pct: { elemDamage: 25, rangedDamage: 10, attackSpeed: -5, moveSpeed: 8 },
    startWeapon: 'star_wand',
  },
  {
    id: 'shiro',
    name: '开发猫猫',
    role: '坦克型',
    color: '#5fd3e8',
    accent: '#cbf3fa',
    glyph: '开',
    desc: '毛茸茸的护盾猫。血量厚、护甲高，但走得慢、伤害低。',
    stats: {},
    // 第二十四轮：基础生命回复 0.4 → 0.8（用户："再给他一点点小buff"）
    mods: { maxHp: 12, armor: 3, hpRegen: 0.8 },
    pct: { moveSpeed: -10, damage: -10 },
    startWeapon: 'fish_shield',
  },
  {
    id: 'nana',
    name: '悠怡萌妹',
    role: '幸运型',
    color: '#ffc857',
    accent: '#fff0c9',
    glyph: '萌',
    desc: '被幸运女神眷顾的猫。掉落和商店品质极佳，收获更多材料。',
    stats: {},
    mods: { harvesting: 4, pickupRange: 30 },
    pct: { luck: 35, damage: -5 },
    // 刷新折扣由角色定义提供，商店按实际买家结算。
    rerollCostMul: 0.5,
    startWeapon: 'lucky_coin',
  },
  {
    id: 'kuro',
    name: '库洛',
    role: '刺客型',
    color: '#8b93b0',
    accent: '#d7dced',
    glyph: '库',
    desc: '影子里潜行的黑猫。暴击极高、攻速快，但血量很低。',
    stats: {},
    mods: { maxHp: -8 },

    pct: { critChance: 20, critDamage: 40, attackSpeed: 15, dodge: 12 },
    startWeapon: 'shadow_dagger',
  },
  // 悠怡洛丽塔：支援角色，侧重治疗与护盾。
  {
    id: 'youyi',
    name: '悠怡洛丽塔',
    role: '支援型',
    color: '#a4c0d6',
    accent: '#f7f3ec',
    glyph: '洛',
    desc: '温柔内向的猫娘妹妹。治疗与回复能力出众，护盾厚实，但输出偏低。',
    stats: {},
    // 护甲属于flat属性，必须写入mods；基础值为0时仅设置pct不会产生护甲。
    mods: { maxHp: 6, hpRegen: 0.8, pickupRange: 25, armor: 2 },
    // 输出端明显吃亏，换来的是续航和一点运气（乖巧的孩子运气不会差）
    pct: { damage: -12, attackSpeed: 5, luck: 10 },
    startWeapon: 'fish_shield',
  },
  // Neon：炮台专精，起始炮台和对应成长独立于玩家本体攻击。
  {
    id: 'neon_party',
    // 第一百六十轮：改名 Neon—— 与 Roki（原 neon）区分，
    // 用户："其实是 2 个人"。**id 保持 neon_party 不动**。
    name: 'Neon',
    role: '炮台专精',
    color: '#7ce0d3',
    accent: '#fff2b8',
    glyph: '宴',
    desc: '把战场变成宴会厅的猫娘。炮台伤害、攻速、数量全面强化，但自己又脆又慢。',
    stats: {},
    // 炮台上限属于flat属性，必须写入mods；零基础上的pct加成无效。
    mods: { maxHp: -4, moveSpeed: -8, turretMax: 1 },
    // 炮台三件套（伤害/攻速/上限）全给，换来的是本体输出和闪避为负
    pct: { turretDamage: 30, turretRate: 20, damage: -8, dodge: -5 },
    startWeapon: 'toy_turret',
  },
];

export const CHARACTER_MAP = Object.fromEntries(CHARACTERS.map((c) => [c.id, c])) as Record<CharacterId, CharacterDefinition>;
Object.setPrototypeOf(CHARACTER_MAP, null);

export function getCharacter(id: unknown) {
  return typeof id === 'string' && Object.hasOwn(CHARACTER_MAP, id) ? CHARACTER_MAP[id as CharacterId] : CHARACTERS[0];
}
