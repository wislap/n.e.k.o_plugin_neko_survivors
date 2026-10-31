import type { WeatherDefinition, WeatherId } from './definitions.ts';
export type { WeatherDefinition, WeatherId } from './definitions.ts';
// 天气静态参数与台词在此定义；状态推进和直接生命效果由环境系统拥有。

export const WEATHER_DEFS: WeatherDefinition[] = [
  {
    id: 'fog', name: '浓雾', color: '#e8eaf0', rampS: 3,
    hint: '呜哇，人家啥都看不到了还打不到人了，不过敌人好像也是？ ( ⚫︎ー⚫︎ )',
    say: '呜哇，人家啥都看不到了还打不到人了，不过敌人好像也是？',
    miss: 20,            // 双方额外 20% miss（无视 80% 闪避上限，叠在闪避之外）
  },
  {
    id: 'bloodMoon', name: '血月', color: '#ff5a5a', rampS: 2.5,
    hint: '哇，大家的眼睛都开始变红了呢，我也要红吗？(๑°⌓°๑)',
    say: '哇，大家的眼睛都开始变红了呢，我也要红吗？',
    atkBase: 0.10, atkStep: 0.10, atkStepS: 5,   // 攻速 +10% 起步，每 5 秒再 +10%（敌我）
  },
  {
    id: 'meteor', name: '流星雨', color: '#ff8a5a', rampS: 1,
    hint: '是流星耶٩(ˊᗜˋ*)و！怎么越来越大了？！',
    say: '是流星耶！怎么越来越大了？！',
  },
  {
    id: 'rain', name: '雾雨', color: '#9fd8ff', rampS: 2,
    hint: '呜喵，人家的毛都湿透了，但是不知道为什么充满了力量。挨打也更痛了？！(°ロ°) !?',
    say: '呜喵，人家的毛都湿透了，但是不知道为什么充满了力量。挨打也更痛了？！',
    outMul: 1.25,        // 所有人造成的伤害 +25%（最终乘算）
  },
  {
    id: 'breeze', name: '晴岚', color: '#b8f0c8', rampS: 1.5,
    hint: '好天气喵，人家跑的更快了~(๑•̀ᴗ-) ✧',
    say: '好天气喵，人家跑的更快了~',
    moveMul: 1.25,       // 所有人移速 +25%
  },
  {
    id: 'typhoon', name: '台风', color: '#c8d0dc', rampS: 2,
    hint: '呜哇，好大的风，要被吹走了喵。( ´•̥̥̥ω•̥̥̥` )',
    say: '呜哇，好大的风，要被吹走了喵。',
    invulnMin: 1.5,      // 玩家无敌时间延长到 1.5s（弹幕/接触都算）
    noKnockback: true,   // 所有人免疫击退（台风自己的推挤不算击退）
  },
  {
    id: 'clear', name: '快晴', color: '#ffe9a8', rampS: 1.5,
    hint: '暖洋洋的天气喵，人家更有干劲了呢。帮你捡走更多东西！(๑>ᴗ<๑)',
    say: '暖洋洋的天气喵，人家更有干劲了呢。帮你捡走更多东西！',
    vacuum: true,        // 自动吸收地图上所有掉落物
  },
  {
    id: 'scorch', name: '烈日', color: '#ffb060', rampS: 2,
    hint: '要烤干了喵要烤干了喵！人家的毛自己起火了！૮(ꈔꈊꈔ)ა',
    say: '要烤干了喵要烤干了喵！人家的毛自己起火了！',
    dotPct: 0.02,        // 每秒扣 2% 最大生命（不会致死，血量不足扣到 1）
  },
  {
    id: 'calm', name: '无风', color: '#cfe8d8', rampS: 1.5,
    hint: '这个天气的温度和湿度都刚刚好，人家充满了活力哦~ฅ●ω●ฅ',
    say: '这个天气的温度和湿度都刚刚好，人家充满了活力哦~',
    regenPct: 0.05,      // 每秒回 5% 最大生命
  },
  {
    id: 'riverFog', name: '川雾', color: '#d8e4f0', rampS: 2,
    hint: '呜哇，人家被推来推去了，不，不要抛下我喵QAQ。',
    say: '呜哇，人家被推来推去了，不，不要抛下我喵。',
  },
];

export const WEATHER_MAP = Object.fromEntries(WEATHER_DEFS.map((d) => [d.id, d])) as Record<WeatherId, WeatherDefinition>;
Object.setPrototypeOf(WEATHER_MAP, null);
