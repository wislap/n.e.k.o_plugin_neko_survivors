// 背景按种子生成覆盖全部地图且不相邻重复的序列；ID对应assets/backgrounds/bg_<id>.jpg。
export type BackgroundId = 'lab' | 'city' | 'station' | 'rooftop' | 'garden' | 'forest' | 'snow' | 'desert';
export interface BackgroundDefinition { id: BackgroundId; name: string; mood: string }
export const BACKGROUNDS: BackgroundDefinition[] = [
  {
    id: 'lab',
    name: '猫娘实验室',
    mood: '干净明亮的研究所地板，最贴合猫娘计划的气质',
  },
  // ---- 以下 4 张是第十一轮新增，凑成 5 张随机池 ----
  {
    id: 'city',
    name: '城市人行道',
    mood: '现代都市的铺装广场，浅灰石板接缝规整，白天感',
  },
  {
    id: 'station',
    name: '地铁站台',
    mood: '近未来地铁站台，深灰地砖配一条低对比度安全线，灯光偏暗',
  },
  {
    id: 'rooftop',
    name: '天台机房',
    mood: '设备层天台，深色花纹钢板与检修标记，工业冷感',
  },
  {
    id: 'garden',
    name: '修剪花园',
    mood: '整齐的草坪与浅色石板，零星花瓣 —— 给洛丽塔风的角色配的舞台',
  },
  // ---- 第一百八十五轮新增 3 张（用户："也画几个新地图包括地图上的障碍……目前只有 5 个地图有点少而且都偏机械风了"）----
  // 自然风景向，和前 5 张的科技/城市感拉开；三张都带障碍(见 terrain.js)，Boss 波自动避开。
  {
    id: 'forest',
    name: '月光森林',
    mood: '苔藓林地与落叶，浓密的树冠和长满青苔的巨石挡路',
  },
  {
    id: 'snow',
    name: '雪原',
    mood: '冰蓝色雪地，冰封的池塘、覆雪的松树与冰岩',
  },
  {
    id: 'desert',
    name: '沙漠遗迹',
    mood: '暖色沙丘上的古代遗迹：砂岩石块、倒塌石柱、开花的仙人掌',
  },
];

// 整数散列驱动背景专用排列，不消费游戏随机流。
function hash32(x: number) {
  let z = (x + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

// 缓存每轮排列；轮交界也排除上轮末图，保证确定性与不连续重复。
let _permN = -1;
let _perms: number[][] = [];

function ensurePerms(n: number, uptoCycle: number) {
  if (_permN !== n) { _permN = n; _perms = []; }
  while (_perms.length <= uptoCycle) {
    const c = _perms.length;
    const arr = [];
    for (let k = 0; k < n; k++) arr.push(k);
    // 确定性 Fisher-Yates：种子只来自轮次号
    let h = hash32(c * 0x9e3779b9 + 0x85ebca6b);
    for (let i = n - 1; i > 0; i--) {
      h = hash32(h + i * 0x27d4eb2f);
      const j = h % (i + 1);
      const t: number = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    // 接缝：这一轮的第一个不能等于上一轮的最后一个
    if (c > 0 && n > 1 && arr[0] === _perms[c - 1][n - 1]) {
      arr.push(arr.shift()!);   // 旋转一格，仍然"每张用一次"
    }
    _perms.push(arr);
  }
}

// 按波次与上张图选背景，不依赖调用历史；重试与继续得到同一张图。
export function backgroundForWave(waveIndex: number, prevId: string | null = null) {
  const n = BACKGROUNDS.length;
  if (!n) return null;

  const i = Math.max(0, waveIndex | 0);
  const cycle = Math.floor(i / n);
  const pos = i % n;
  ensurePerms(n, cycle);
  const perm = _perms[cycle];

  let pick = perm[pos];
  // 排列元素互异；命中上张图时移一格，避免跨轮连续重复。
  if (prevId != null && n > 1 && BACKGROUNDS[pick].id === prevId) {
    pick = perm[(pos + 1) % n];
  }
  return BACKGROUNDS[pick].id;
}

// Boss禁用复杂地形图；搜索后续三轮，仍无候选时确定性选择可用图。
export function backgroundForBossWave(waveIndex: number, prevId: string | null, banned: readonly string[]) {
  const bg = backgroundForWave(waveIndex, prevId);
  if (!bg || !banned.includes(bg)) return bg;
  const n = BACKGROUNDS.length;
  for (let k = 1; k <= n * 3; k++) {
    const cand = backgroundForWave(waveIndex + k, prevId);
    if (cand && !banned.includes(cand)) return cand;
  }
  const ok = BACKGROUNDS.filter((b) => !banned.includes(b.id));
  if (!ok.length) return bg;                       // 全部被禁：无从避让，保持原抽取结果
  return (ok.find((b) => b.id !== prevId) ?? ok[0]).id;
}
