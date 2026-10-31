import type { RNG } from '../math/random.ts';
export interface Shard { x: number; y: number; vx: number; vy: number; rot: number; vr: number; verts: number[][]; t: number; life: number }
import { TAU } from '../math/geometry.ts';
export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}
export function spawnShatter(rng: RNG, list: Shard[], x: number, y: number, count = 12, spread = 1, scale = 1) {
  for (let i = 0; i < count; i++) {
    const a = rng.next() * TAU;
    const spd = (140 + rng.next() * 340) * spread;
    // 5-7 边不规则凸多边形（外接半径 8-22 的随机极坐标顶点）
    const n = 5 + (rng.next() * 3 | 0);
    const verts = [];
    for (let v = 0; v < n; v++) {
      const va = (v / n) * TAU + rng.next() * 0.5;
      const vr = (8 + rng.next() * 14) * scale;
      verts.push([Math.cos(va) * vr, Math.sin(va) * vr]);
    }
    list.push({
      x, y,
      vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      rot: rng.next() * TAU, vr: (rng.next() - 0.5) * 9,
      verts, t: 0, life: 0.7 + rng.next() * 0.5,
    });
  }
}
export function updateShards(list: Shard[], dt: number) {
  for (let i=list.length-1;i>=0;i--) {
    const s=list[i];s.t+=dt;if(s.t>=s.life){list.splice(i,1);continue;}
    s.x+=s.vx*dt;s.y+=s.vy*dt;s.vx*=1-1.4*dt;s.vy*=1-1.4*dt;s.rot+=s.vr*dt;
  }
}
