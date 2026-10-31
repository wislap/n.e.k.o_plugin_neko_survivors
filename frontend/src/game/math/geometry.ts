export interface RandomSource { next(): number }
// 数学与向量工具

export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

export function dist2(ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
}
export function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.sqrt(dist2(ax, ay, bx, by));
}
export function angleTo(ax: number, ay: number, bx: number, by: number) {
  return Math.atan2(by - ay, bx - ax);
}

/** 把角度差归一到 [-PI, PI] */
export function angleDiff(a: number, b: number) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** 指数趋近，帧率无关 */
export function damp(current: number, target: number, lambda: number, dt: number) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}
