import { WORLD_SIZE } from './config.ts';
import { BG_TILE, TERRAIN } from '../content/terrain.ts';
import { buildMaze, type Maze } from './maze.ts';
import type { BackgroundId } from '../content/backgrounds.ts';
export interface Rect { x0: number; y0: number; x1: number; y1: number; maze?: boolean }
export interface Circle { cx: number; cy: number; r: number }
export interface Terrain { rects: Rect[]; circles: Circle[]; maze?: Maze; plaza?: Rect | null }
interface Position { x: number; y: number }

// 背景地形按世界尺寸展开；图案内归一化坐标转为世界障碍物，规则与显示共用。
export function expandTerrain(bgId: string | null, worldSize = WORLD_SIZE): Terrain {
  const t = bgId === null ? undefined : TERRAIN[bgId as BackgroundId];
  const out: Terrain = { rects: [], circles: [] };
  if (!t) return out;

  const half = worldSize / 2;
  // 迷宫广场吞并所有相交图案的完整视觉范围，同时撤掉对应碰撞体，避免半片地形有图无碰撞。
  let maze: Maze | null = null, plaza: Rect | null = null;
  if (t.maze) {
    maze = buildMaze(t.maze);
    plaza = { x0: maze.x0 - 50, y0: maze.y0 - 50, x1: maze.x1 + 50, y1: maze.y1 + 50 };
    const inst = [];
    const sp = Math.ceil(half / BG_TILE) + 1;
    for (let i = -sp; i <= sp; i++) for (let j = -sp; j <= sp; j++) for (const c of t.circles) {
      const rr = (c.r * BG_TILE) / 0.92;
      inst.push({ cx: i * BG_TILE + c.cx * BG_TILE, cy: j * BG_TILE + c.cy * BG_TILE, rr });
    }
    for (let grow = true, guard = 0; grow && guard < 20; guard++) {
      grow = false;
      for (const c of inst) {
        if (c.cx + c.rr <= plaza.x0 || c.cx - c.rr >= plaza.x1 || c.cy + c.rr <= plaza.y0 || c.cy - c.rr >= plaza.y1) continue;
        const nx0 = Math.min(plaza.x0, c.cx - c.rr), ny0 = Math.min(plaza.y0, c.cy - c.rr), nx1 = Math.max(plaza.x1, c.cx + c.rr), ny1 = Math.max(plaza.y1, c.cy + c.rr);
        if (nx0 < plaza.x0 || ny0 < plaza.y0 || nx1 > plaza.x1 || ny1 > plaza.y1) { plaza = { x0: nx0, y0: ny0, x1: nx1, y1: ny1 }; grow = true; }
      }
    }
  }
  const inPlaza = (cx: number, cy: number, r: number) => plaza && cx + r > plaza.x0 && cx - r < plaza.x1 && cy + r > plaza.y0 && cy - r < plaza.y1;
  // 需要覆盖 [-half, half] 的重复范围：i 从 -ceil(half/tile) 到 +ceil(half/tile)
  const span = Math.ceil(half / BG_TILE) + 1;
  for (let i = -span; i <= span; i++) {
    for (let j = -span; j <= span; j++) {
      const ox = i * BG_TILE;
      const oy = j * BG_TILE;

      for (const [x0, y0, x1, y1] of t.rects) {
        const r = {
          x0: ox + x0 * BG_TILE,
          y0: oy + y0 * BG_TILE,
          x1: ox + x1 * BG_TILE,
          y1: oy + y1 * BG_TILE,
        };
        if (r.x1 <= -half || r.x0 >= half || r.y1 <= -half || r.y0 >= half) continue;
        if (plaza && r.x1 > plaza.x0 && r.x0 < plaza.x1 && r.y1 > plaza.y0 && r.y0 < plaza.y1) continue;
        out.rects.push(r);
      }

      for (const c of t.circles) {
        const cc = {
          cx: ox + c.cx * BG_TILE,
          cy: oy + c.cy * BG_TILE,
          r: c.r * BG_TILE,
        };
        if (cc.cx + cc.r <= -half || cc.cx - cc.r >= half
          || cc.cy + cc.r <= -half || cc.cy - cc.r >= half) continue;
        if (inPlaza(cc.cx, cc.cy, cc.r / 0.92)) continue;   // 198 轮：广场内的图案障碍已被盖住，同步撤掉碰撞体
        out.circles.push(cc);
      }
    }
  }
  if (maze) {
    for (const w of maze.walls) out.rects.push(w);
    out.maze = maze;
    out.plaza = plaza;
  }
  return out;
}

// 位置检查同时考虑实体半径；矩形与圆障碍均使用真实几何。
export function blockedAt(terrain: Terrain | null | undefined, x: number, y: number, radius = 0) {
  if (!terrain) return false;

  for (const r of terrain.rects) {
    // 圆 vs 轴对齐矩形：先找矩形上离圆心最近的点，再比距离
    const nx = Math.max(r.x0, Math.min(x, r.x1));
    const ny = Math.max(r.y0, Math.min(y, r.y1));
    const dx = x - nx, dy = y - ny;
    if (dx * dx + dy * dy < radius * radius) return true;
    // radius 为 0 时上面的比较是 `0 < 0` = false，要单独处理"点在矩形内"
    if (radius === 0 && x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return true;
  }

  for (const c of terrain.circles) {
    const dx = x - c.cx, dy = y - c.cy;
    const rr = c.r + radius;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}

// 用最小平移推出障碍：圆外沿法线，圆心陷入矩形时推最近边，避免贴墙抖动。
export function resolveTerrain(terrain: Terrain | null | undefined, ent: Position & { radius: number }) {
  if (!terrain) return false;
  let hit = false;

  for (const r of terrain.rects) {
    // 圆 vs 矩形：最近点
    const nx = Math.max(r.x0, Math.min(ent.x, r.x1));
    const ny = Math.max(r.y0, Math.min(ent.y, r.y1));
    let dx = ent.x - nx, dy = ent.y - ny;
    const d2 = dx * dx + dy * dy;

    if (d2 >= ent.radius * ent.radius && d2 > 0) continue;   // 没碰上
    hit = true;

    if (d2 > 1e-9) {
      // 圆心在矩形外：沿最近点方向推到刚好相切
      const d = Math.sqrt(d2);
      const push = ent.radius - d;
      ent.x += (dx / d) * push;
      ent.y += (dy / d) * push;
    } else {
      // 圆心在矩形内（陷进去了）：选**最近的一条边**推出去，推得最少
      const dl = ent.x - r.x0, dr = r.x1 - ent.x;
      const dt = ent.y - r.y0, db = r.y1 - ent.y;
      const m = Math.min(dl, dr, dt, db);
      if (m === dl) ent.x = r.x0 - ent.radius;
      else if (m === dr) ent.x = r.x1 + ent.radius;
      else if (m === dt) ent.y = r.y0 - ent.radius;
      else ent.y = r.y1 + ent.radius;
    }
  }

  for (const c of terrain.circles) {
    const dx = ent.x - c.cx, dy = ent.y - c.cy;
    const d2 = dx * dx + dy * dy;
    const rr = c.r + ent.radius;
    if (d2 >= rr * rr) continue;
    hit = true;
    const d = Math.sqrt(d2);
    if (d < 1e-6) {
      // 正好在圆心：没有方向信息，随便挑一个方向推出去
      ent.x = c.cx + rr;
    } else {
      ent.x = c.cx + (dx / d) * rr;
      ent.y = c.cy + (dy / d) * rr;
    }
  }

  return hit;
}

// 从候选出生点寻找无碰撞位置；失败使用既有确定性回退，保留抽数顺序。
export function findFreeSpot<T extends Position>(terrain: Terrain | null | undefined, pick: () => T, radius: number, tries = 24): T | null {
  if (!terrain || (terrain.rects.length === 0 && terrain.circles.length === 0)) {
    return pick();
  }
  for (let i = 0; i < tries; i++) {
    const p = pick();
    if (!blockedAt(terrain, p.x, p.y, radius)) return p;
  }
  return null;
}
