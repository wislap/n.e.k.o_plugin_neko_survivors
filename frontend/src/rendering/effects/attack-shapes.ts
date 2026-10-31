import { Graphics } from 'pixi.js';
import type { EffectView, Point } from '../../game';
const TAU = Math.PI * 2;
/** Visual entropy depends only on the snapshot; paused frames do not shimmer. */
function random(seed: number) { let s = seed >>> 0; return () => { s = Math.imul(s, 1664525) + 1013904223 | 0; return (s >>> 0) / 4294967296; }; }
function path(g: Graphics, points: readonly Point[]): void {
  if (!points.length) return;
  g.moveTo(points[0].x, points[0].y); for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
}
function bladeArc(g: Graphics, radius: number, start: number, end: number, fade: number, color: string): void {
  // Three nested blades taper at both tips; the geometry follows the original _bladeArc.
  for (const [width, tint, alpha] of [[15, color, .26], [8, '#5ab8ff', .8], [3, '#e9ffff', 1]] as const) {
    const segments = 18;
    for (let i = 0; i < segments; i++) {
      const a = start + (end - start) * i / segments, b = start + (end - start) * (i + 1) / segments;
      const taper = Math.pow(Math.sin(Math.PI * (i + .5) / segments), .5);
      g.arc(0, 0, radius, a, b).stroke({ color: tint, width: (width * fade + .6) * taper, alpha });
    }
  }
}
/** Returns true only when a dedicated source FX_TYPE has been drawn. */
export function drawAttackEffect(g: Graphics, view: EffectView, time: number): boolean {
  const k = Math.max(0, Math.min(1, view.progress ?? 0)), fade = 1 - k, r = view.radius;
  switch (view.kind) {
    case 'slash': {
      const half = (view.arc ?? 1.6) / 2;
      bladeArc(g, r * (view.progress === undefined ? 1 : .62 + k * .5), -half, half, fade, view.color); return true;
    }
    case 'spin': {
      g.rotation = k * Math.PI * 1.7;
      bladeArc(g, r * (.78 + k * .14), -.35, Math.PI * .7, fade, view.color); return true;
    }
    case 'thrust': {
      const end = view.end ?? { x: view.x + r, y: view.y };
      const dx = end.x - view.x, dy = end.y - view.y, distance = Math.hypot(dx, dy) || 1;
      const x = dx / distance, y = dy / distance, nx = -y, ny = x;
      const shrink = k < .28 ? 1 : 1 - Math.pow((k - .28) / .72, 1.5), tip = distance * shrink, w = (view.width ?? 10) * (.8 + .2 * shrink);
      g.moveTo(x * tip, y * tip).quadraticCurveTo(x * tip * .55 + nx * w * .62, y * tip * .55 + ny * w * .62, nx * w * .5, ny * w * .5)
        .lineTo(-nx * w * .5, -ny * w * .5).quadraticCurveTo(x * tip * .55 - nx * w * .62, y * tip * .55 - ny * w * .62, x * tip, y * tip).fill({ color: 0xcfe4ff, alpha: .85 });
      g.moveTo(x * tip * .25, y * tip * .25).lineTo(x * tip, y * tip).stroke({ color: 0xffffff, width: Math.max(.6, w * .18), alpha: .95 });
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * w * .85, back = tip * (.2 + i * .08);
        g.moveTo(x * back * .35 + nx * off, y * back * .35 + ny * off).lineTo(x * (tip * .82 - back * .2) + nx * off, y * (tip * .82 - back * .2) + ny * off).stroke({ color: 0xcfe4ff, width: 1.1, alpha: .22 - i * .05 });
      }
      if (shrink > .25) g.star(x * tip, y * tip, 4, w * .55, w * .2).fill(0xffffff);
      return true;
    }
    case 'beam': {
      const x = (view.end?.x ?? view.x + r) - view.x, y = (view.end?.y ?? view.y) - view.y, w = view.width ?? 8;
      g.moveTo(0, 0).lineTo(x, y).stroke({ color: view.color, width: w * (.4 + fade * .6) })
        .moveTo(0, 0).lineTo(x, y).stroke({ color: 0xffffff, width: Math.max(.5, w * .3 * fade), alpha: .9 }); return true;
    }
    case 'chain': {
      const source = view.points ?? [], rng = random((view.seed ?? 0) + Math.floor(time * 60));
      const points: Point[] = [], branches: { from: Point; to: Point }[] = [];
      for (let i = 0; i < source.length; i++) {
        const p = { x: source[i].x - view.x, y: source[i].y - view.y };
        if (i) {
          const prior = source[i - 1], dx = source[i].x - prior.x, dy = source[i].y - prior.y, distance = Math.hypot(dx, dy) || 1;
          const mid = .35 + rng() * .3, jitter = (rng() - .5) * 34;
          const bend = { x: prior.x - view.x + dx * mid - dy / distance * jitter, y: prior.y - view.y + dy * mid + dx / distance * jitter };
          points.push(bend);
          if (rng() < .75) { const angle = Math.atan2(dy, dx) + (rng() - .5) * 1.9, length = 18 + rng() * 34; branches.push({ from: bend, to: { x: bend.x + Math.cos(angle) * length, y: bend.y + Math.sin(angle) * length } }); }
        }
        points.push(p);
      }
      for (const [width, tint, alpha] of [[13, view.color, .45], [5.5, view.color, .95], [2, '#ffffff', 1]] as const) { path(g, points); g.stroke({ color: tint, width, alpha }); }
      for (const b of branches) g.moveTo(b.from.x, b.from.y).lineTo(b.to.x, b.to.y);
      g.stroke({ color: 0xffffff, width: 1.6, alpha: .8 }); return true;
    }
    case 'nova': {
      const eased = 1 - Math.pow(1 - k, 2.6);
      for (const [width, speed, tint, alpha] of [[6.5, 1, '#ffd23a', .52], [4, .8, '#ffe98a', .42], [2, .6, '#fff6d0', .36]] as const) {
        const radius = r * (.16 + Math.pow(eased, speed) * .94);
        for (let i = 0; i <= 56; i++) { const a = i / 56 * TAU, wobble = 1 + Math.sin(a * 9 + k * 38) * .011; const x = Math.cos(a) * radius * wobble, y = Math.sin(a) * radius * wobble; if (!i) g.moveTo(x, y); else g.lineTo(x, y); }
        g.closePath().stroke({ color: tint, width: width * fade + .6, alpha });
      }
      if (k < .22) g.star(0, 0, 4, 14 * (1 - k / .22) + 3, 2).fill({ color: 0xfff6d0, alpha: 1 - k / .22 });
      return true;
    }
    case 'impact': {
      const power = view.power ?? .5, rays = view.rays ?? 9;
      for (let i = 0; i < rays; i++) {
        const a = i / rays * TAU, ca = Math.cos(a), sa = Math.sin(a), long = i % 2 === 0;
        const inner = (6 + power * 8) * (.5 + k * .9), outer = inner + (long ? 20 : 11) * (.6 + power * .9) * (.4 + fade * .8), w = (long ? 2.6 : 1.6) * (.5 + fade * .6);
        g.poly([ca * inner - sa * w, sa * inner + ca * w, ca * outer, sa * outer, ca * inner + sa * w, sa * inner - ca * w]).fill(0xffffff);
      }
      g.circle(0, 0, (power * 10 + 5) * (.4 + k * 1.2)).fill({ color: view.color, alpha: .32 }); return true;
    }
    case 'shockwave': {
      const radius = r * (.35 + k * 1.15);
      g.circle(0, 0, radius).stroke({ color: view.color, width: 14 * fade + 2, alpha: .85 })
        .circle(0, 0, radius + 6 * fade).stroke({ color: 0xffffff, width: 3 * fade + .5, alpha: .7 }); return true;
    }
    case 'shard': {
      const size = r * (.5 + fade * .7);
      g.poly([0, -size, size * .9, size * .8, -size * .9, size * .7]).fill(view.color); return true;
    }
    case 'sparkle': g.circle(0, 0, Math.max(.1, r * fade)).fill(view.color); return true;
    case 'hit': {
      g.circle(0, 0, 3 + k * 4).fill(0xffffff);
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + .4; const inner = 4 + k * 8, outer = 8 + k * 16;
        g.moveTo(Math.cos(a) * inner, Math.sin(a) * inner).lineTo(Math.cos(a) * outer, Math.sin(a) * outer).stroke({ color: view.color, width: (i % 2 ? 1.6 : 3) * fade + .6 }); }
      return true;
    }
    case 'explosion': {
      const radius = r * (.35 + k * .85);
      g.circle(0, 0, radius * .92).stroke({ color: view.color, width: 7 * fade + 1.5, alpha: .55 });
      for (let i = 10; i > 0; i--) g.circle(0, 0, radius * i / 10).fill({ color: view.color, alpha: .045 * (1 - i / 11) });
      g.circle(0, 0, radius * (.46 - k * .16)).fill({ color: 0xffffff, alpha: .65 }); return true;
    }
    case 'ring': {
      if (view.progress === undefined) { g.circle(0, 0, r).stroke({ color: view.color, width: 2 }); return true; }
      const radius = r * (.4 + k * .8), crack = k > .55 ? (1 - k) / .45 : 1;
      for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + (view.seed ?? 0); g.arc(0, 0, radius, a, a + TAU / 12 * .63).stroke({ color: view.color, width: 3 * fade + 1, alpha: k > .55 ? crack * crack : .7 }); }
      return true;
    }
    default: return false;
  }
}
