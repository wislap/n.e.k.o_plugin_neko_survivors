// 迷宫由固定配置生成规则墙体；入口、出口与中央广场保持连通。

/** mulberry32：小而好的 32 位种子随机数 */
import type { MazeGate, MazeConfig } from '../content/maze.ts';
export type Maze = ReturnType<typeof buildMaze>;
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 迷宫配置使用世界坐标，墙宽和通道尺寸参与碰撞与显示。

export function buildMaze(cfg: MazeConfig) {
  const { n, cell, wall: T, seed } = cfg;
  const P = cell + T;
  const size = n * P + T;
  const ox = cfg.cx - size / 2, oy = cfg.cy - size / 2;
  const rnd = mulberry32(seed);

  // V[r][c]: 第 r 行、第 c 条竖墙线上的墙（true = 存在）；H[r][c]: 第 r 条横墙线、第 c 列
  const V = Array.from({ length: n }, () => Array<boolean>(n + 1).fill(true));
  const H = Array.from({ length: n + 1 }, () => Array<boolean>(n).fill(true));

  const open = (r1: number, c1: number, r2: number, c2: number) => {
    if (r1 === r2) V[r1][Math.max(c1, c2)] = false;
    else H[Math.max(r1, r2)][c1] = false;
  };
  const isOpen = (r1: number, c1: number, r2: number, c2: number) => (r1 === r2 ? !V[r1][Math.max(c1, c2)] : !H[Math.max(r1, r2)][c1]);

  // ---- 递归回溯（DFS）：生成"完美迷宫"（任意两格之间恰有一条路）----
  const seen = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  const stack = [[Math.floor(rnd() * n), Math.floor(rnd() * n)]];
  seen[stack[0][0]][stack[0][1]] = true;
  let passages = 0;
  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const nb = [];
    if (r > 0 && !seen[r - 1][c]) nb.push([r - 1, c]);
    if (r < n - 1 && !seen[r + 1][c]) nb.push([r + 1, c]);
    if (c > 0 && !seen[r][c - 1]) nb.push([r, c - 1]);
    if (c < n - 1 && !seen[r][c + 1]) nb.push([r, c + 1]);
    if (!nb.length) { stack.pop(); continue; }
    const [nr, nc] = nb[Math.floor(rnd() * nb.length)];
    open(r, c, nr, nc); passages++;
    seen[nr][nc] = true;
    stack.push([nr, nc]);
  }

  // ---- 少量回路 ----
  let braided = 0;
  for (let tries = 0; braided < (cfg.braid ?? 0) && tries < 400; tries++) {
    const r = Math.floor(rnd() * n), c = Math.floor(rnd() * n);
    const horiz = rnd() < 0.5;
    const r2 = horiz ? r : r + 1, c2 = horiz ? c + 1 : c;
    if (r2 >= n || c2 >= n) continue;
    if (isOpen(r, c, r2, c2)) continue;
    open(r, c, r2, c2); braided++;
  }

  // ---- 入口 / 出口（外圈缺口）----
  const gap = (g: MazeGate) => {
    const { side, idx } = g;
    if (side === 'E') { V[idx][n] = false; return { r: idx, c: n - 1 }; }
    if (side === 'W') { V[idx][0] = false; return { r: idx, c: 0 }; }
    if (side === 'N') { H[0][idx] = false; return { r: 0, c: idx }; }
    H[n][idx] = false; return { r: n - 1, c: idx };   // 'S'
  };
  const entCell = gap(cfg.entrance), exitCell = gap(cfg.exit);

  const cellCenter = (r: number, c: number) => ({ x: ox + T + c * P + cell / 2, y: oy + T + r * P + cell / 2 });
  /** 缺口外侧一点（引导点 / 灯笼位置）：缺口中心再往外 T */
  const gateOutside = (g: MazeGate, cellRC: { r: number; c: number }) => {
    const cc = cellCenter(cellRC.r, cellRC.c);
    const d = T + cell / 2 + 4;
    return g.side === 'E' ? { x: cc.x + d, y: cc.y } : g.side === 'W' ? { x: cc.x - d, y: cc.y } : g.side === 'N' ? { x: cc.x, y: cc.y - d } : { x: cc.x, y: cc.y + d };
  };

  // ---- 墙段 → 矩形 ----
  const walls = [];
  for (let r = 0; r < n; r++) for (let c = 0; c <= n; c++) if (V[r][c]) {
    walls.push({ x0: ox + c * P, y0: oy + r * P, x1: ox + c * P + T, y1: oy + (r + 1) * P + T, maze: true });
  }
  for (let r = 0; r <= n; r++) for (let c = 0; c < n; c++) if (H[r][c]) {
    walls.push({ x0: ox + c * P, y0: oy + r * P, x1: ox + (c + 1) * P + T, y1: oy + r * P + T, maze: true });
  }

  // ---- BFS：入口到每格的步数，最远的格放宝箱；出口距离用于验证连通 ----
  const dist = Array.from({ length: n }, () => Array<number>(n).fill(-1));
  const q = [[entCell.r, entCell.c]]; dist[entCell.r][entCell.c] = 0;
  let far = { r: entCell.r, c: entCell.c, d: 0 };
  for (let h = 0; h < q.length; h++) {
    const [r, c] = q[h];
    if (dist[r][c] > far.d) far = { r, c, d: dist[r][c] };
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const r2 = r + dr, c2 = c + dc;
      if (r2 < 0 || c2 < 0 || r2 >= n || c2 >= n || dist[r2][c2] >= 0) continue;
      if (!isOpen(r, c, r2, c2)) continue;
      dist[r2][c2] = dist[r][c] + 1; q.push([r2, c2]);
    }
  }
  const chest = cellCenter(far.r, far.c);
  const deadEnds = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    let open4 = 0;
    if (r > 0 && isOpen(r, c, r - 1, c)) open4++;
    if (r < n - 1 && isOpen(r, c, r + 1, c)) open4++;
    if (c > 0 && isOpen(r, c, r, c - 1)) open4++;
    if (c < n - 1 && isOpen(r, c, r, c + 1)) open4++;
    if (open4 === 1) deadEnds.push(cellCenter(r, c));
  }

  return {
    cfg, n, cell, wall: T, pitch: P, size, x0: ox, y0: oy, x1: ox + size, y1: oy + size,
    walls, V, H, passages, braided,
    entrance: { ...gateOutside(cfg.entrance, entCell), side: cfg.entrance.side, r: entCell.r, c: entCell.c },
    exit: { ...gateOutside(cfg.exit, exitCell), side: cfg.exit.side, r: exitCell.r, c: exitCell.c },
    chest, chestSteps: far.d, distToExit: dist[exitCell.r][exitCell.c], reachableCells: q.length,
    deadEnds, cellCenter,
  };
}
