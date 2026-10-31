import type { SpellId } from './flandre-types.ts';
// 芙兰符卡、时间轴和数值；预算由设备规则档位拥有。
// 弹幕几何参考 touhou-flandre 的红魔乡 Extra 反编译规格。



// 前四张各消耗总血量 20%，最后 20% 留给 Extra 锁血演出。
export const FLANDRE_MAX_HP = 800000;      // "血量为80万"（第八十六轮 50万 → 80万）
export const PROLOGUE_CARD_TIME = 30;     // 秘弹生存 30 秒（原版 90 秒）
export const CARD_TIME = 30;              // 每张 EX 符卡 30 秒
export const CARD_HP_FRAC = 0.2;          // 第八十六轮：每张卡 20%（16 万）——
// 打掉 20% 锁血切下一张（30 秒内打不掉就超时切，两条路先到先切）；
// 前 4 张共 80%，最后 20%（16 万）是 EP 的演出血量，全程锁死。
export const CARDS_TOTAL = 4;             // 一共随机 4 张
export const EXTRA_TIME = 70;             // 第六十一轮：20 + 20 + 30 = 70 秒
export const EXTRA_CARD_TIME = 20;        // EP 前两张各 20 秒
export const EXTRA_HEART_TIME = 30;       // 第六十一轮：最后的「弹幕的心脏」30 秒
export const SWITCH_LOCK = 3;             // 切符卡：清全屏弹幕 + 锁血 3 秒
export const HIT_FRAC = 0.22;             // 每发命中扣 22% 最大生命的真实伤害
export const CULL_MARGIN = 140;               // 199 轮：弹飞出场地外多少 px 回收（见 _cullOutside）
export const LEAD = 0.6;                  // 提前量系数（VS-HANDOFF 4.2 推荐 0.6）


export const COLORS = {
  red: '#ff4060', dark: '#c81e3c', white: '#fff2f4',
  gold: '#ffd166', pink: '#ff7f9f', deep: '#8f1029',
  sky: '#5fd4ff',
};
export const RAINBOW = ['#ff4060', '#ff9f43', '#ffe066', '#7bed9f', '#4cd7d0', '#70a1ff', '#c56cf0'];

// 序章演出时间轴（秒）
export const SILENCE_END = 6;    // 再静默 3 秒（3+3）
export const SHAKE_AT = 6;       // 静默结束 → 小小猫娘警告 + 屏幕轻微晃动 2.5 秒
export const CARD_AT = 8.5;      // 震动结束 → 右上角符卡名 + BGM + 第一颗弹幕
export const PROLOGUE_END = CARD_AT + PROLOGUE_CARD_TIME;   // 38.5 秒芙兰登场

// ---- EX 难度符卡池（原版 10 张减掉序章秘弹 = 9 张随机；新典 3 张不进池）----
export const CARD_POOL: SpellId[] = [
  'cranberry', 'laevateinn', 'fourkind', 'kagome', 'maze',
  'starbow', 'catadioptric', 'clock', 'ripples',
];

// Extra 专属符卡按固定顺序播放。
export const EXTRA_SPELLS: SpellId[] = ['fragile', 'bloodstain', 'heart'];

export const CARD_INFO = {
  prologue: { name: '秘弹「之后就一个人都没有了吗？」' },
  cranberry: { name: '禁忌「Cranberry Trap」' },
  laevateinn: { name: '禁忌「Lævateinn」' },
  fourkind: { name: '禁忌「Four of a Kind」' },
  kagome: { name: '禁忌「笼中鸟 Kagome Kagome」' },
  maze: { name: '禁忌「恋之迷宫 Maze of Love」' },
  starbow: { name: '禁弹「Starbow Break」' },
  catadioptric: { name: '禁弹「Catadioptric」' },
  clock: { name: '禁弹「过后一时辰的时钟」' },
  ripples: { name: '禁弹「495 年的波纹」' },
  // 第五十六轮：Extra Phantom 专属（新典追加）
  fragile: { name: '咒弹「Fragile Wing」' },
  bloodstain: { name: '咒弹「伏行之血痕」' },
  heart: { name: '「弹幕的心脏」' },
};

// 姿势素材：普通飞行、Extra 坐姿和莱万汀攻击。
// 原作切片：常态 172–175，坐姿 202/205/208，莱万汀 192。
export const SIT_FRAMES = ['flandre_sit', 'flandre_sit2', 'flandre_sit3'];
export const IDLE_FRAMES = ['flandre', 'flandre_idle2', 'flandre_idle3', 'flandre_idle4'];

// 舞台点高于竞技场中心；正式战到时必进 Extra。
export const STAGE_DY = 270;
export const EP_AT_TIMEOUT = true;
