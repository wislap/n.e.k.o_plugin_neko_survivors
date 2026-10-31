// 雪原固定迷宫的位置和种子使入口路径、宝箱深度、死胡同与回路保持确定。
export interface MazeGate { side: 'N' | 'E' | 'S' | 'W'; idx: number }
export interface MazeConfig { cx: number; cy: number; n: number; cell: number; wall: number; seed: number; entrance: MazeGate; exit: MazeGate; braid?: number }
export const SNOW_MAZE: MazeConfig = {
  cx: 600, cy: -600, n: 6, cell: 112, wall: 34, seed: 0x44e6a9a0,
  entrance: { side: 'W', idx: 1 },   // 西侧（朝场心）第 2 行
  exit: { side: 'S', idx: 4 },       // 南侧（朝场心）第 5 列 —— 与入口隔着整座迷宫
  braid: 3,
};
