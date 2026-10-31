import { Graphics } from 'pixi.js';
import type { ProjectileView } from '../game';
export const HALLOWEEN_COLORS: Record<string, number> = {
  amber: 0xffc24a, red: 0xff9a3c, gold: 0xffe05a, violet: 0xc8a2ff, cyan: 0x9cffff, green: 0xb6ff7a,
};
export function projectileColor(color: string): string | number { return HALLOWEEN_COLORS[color] ?? color; }
/** Neutral white silhouettes are GPU-baked once and tinted in the sprite batch. */
export function makeProjectileGraphic(shape: ProjectileView['shape'] | 'halo'): Graphics {
  const g = new Graphics();
  switch (shape) {
    case 'halo':
      for (let i = 16; i > 0; i--) g.circle(0, 0, i).fill({ color: 0xffffff, alpha: Math.pow(1 - i / 17, 2) * .08 });
      break;
    case 'laser': g.poly([-16, -4, 16, -1, 16, 1, -16, 4]).fill(0xffffff); break;
    case 'needle': case 'shard': g.poly([-12, 0, 0, -4, 12, 0, 0, 4]).fill(0xffffff); break;
    case 'rice': g.ellipse(0, 0, 14, 5).fill(0xffffff); break;
    case 'drop': g.moveTo(-16, 0).bezierCurveTo(-6, -2, 0, -10, 8, -6).arc(8, 0, 6, -Math.PI / 2, Math.PI / 2).bezierCurveTo(0, 10, -6, 2, -16, 0).fill(0xffffff); break;
    case 'petal': g.moveTo(-14, 0).bezierCurveTo(-3, -12, 10, -10, 14, 0).bezierCurveTo(10, 10, -3, 12, -14, 0).fill(0xffffff); break;
    case 'ring': g.circle(0, 0, 10).stroke({ color: 0xffffff, width: 3 }); break;
    case 'blade': g.moveTo(-12, -9).bezierCurveTo(18, -12, 18, 12, -12, 9).bezierCurveTo(5, 4, 5, -4, -12, -9).fill(0xffffff); break;
    case 'star': g.star(0, 0, 5, 12, 5).fill(0xffffff); break;
    case 'paw':
      g.ellipse(1, 4, 8, 7).circle(-9, -2, 4).circle(-3, -8, 4).circle(5, -8, 4).circle(11, -2, 4).fill(0xffffff); break;
    default: g.circle(0, 0, 12).fill(0xffffff);
  }
  return g;
}

/** Reference vector trail, also used for degenerate/self-turning paths. */
export function paintPlayerTrail(trail: Graphics, view: ProjectileView): void {
  trail.clear();
  const r = view.radius, color = projectileColor(view.color), points = (view.trail ?? []).filter(point => point.alpha > 0);
  const style = view.playerStyle;
  if (style === 'coin') {
    if ((view.trail?.length ?? 0) > 0) {
      const ca = Math.cos(view.angle), sa = Math.sin(view.angle);
      for (let i = 0; i < 3; i++) {
        const offset = (i - 1) * r * 1.1, length = r * (3.2 - i * .7);
        const x1 = -r * 1.2, x2 = x1 - length;
        trail.moveTo(x1 * ca - offset * sa, x1 * sa + offset * ca)
          .lineTo(x2 * ca - offset * 1.4 * sa, x2 * sa + offset * 1.4 * ca)
          .stroke({ color, alpha: .4 - i * .1, width: 1.6 - i * .3, cap: 'round' });
      }
    }
  } else if (style === 'orb') {
    if (points.length > 1) {
      const count = Math.min(4, points.length);
      for (let i = 0; i < count; i++) {
        const fraction = 1 - (i + 1) / (count + 1), point = points[points.length - 1 - i];
        trail.circle(point.x - view.x, point.y - view.y, r * (.35 + fraction * .6))
          .fill({ color, alpha: .34 * (.4 + fraction * .6) });
      }
    }
  } else if (points.length > 1) {
    const tracer = style === 'tracer';
    for (const [width, tint, alpha] of [[r * (tracer ? 2.1 : 1.7), color, tracer ? .4 : .34], [r * (tracer ? .75 : .55), 0xffffff, .5]] as const) {
      trail.moveTo(points[0].x - view.x, points[0].y - view.y);
      for (const point of points.slice(1)) trail.lineTo(point.x - view.x, point.y - view.y);
      trail.lineTo(0, 0).stroke({ color: tint, alpha, width, cap: 'round', join: 'round' });
    }
  }
}
export function paintPlayerBody(body: Graphics, view: ProjectileView, redraw = true): void {
  if (redraw) body.clear();
  const r = view.radius, color = projectileColor(view.color), age = view.age ?? 0;
  if (view.playerStyle === 'coin') {
    body.rotation = age * 8;
    if (redraw) body.ellipse(0, 0, r * 1.4, r * .8).fill(color)
      .moveTo(0, -r * .8).lineTo(0, r * .8).stroke({ color: 0x7a500a, alpha: .9, width: Math.max(1, r * .22) })
      .circle(-r * .45, -r * .25, r * .2).fill({ color: 0xffffff, alpha: .85 });
  } else if (view.playerStyle === 'orb') {
    body.rotation = 0;
    body.circle(0, 0, r * 1.15).fill(color).circle(0, 0, r * .5).fill({ color: 0xffffff, alpha: .95 });
    for (let i = 0; i < 3; i++) {
      const angle = age * 5 + i / 3 * Math.PI * 2;
      body.star(Math.cos(angle) * r * 1.9, Math.sin(angle) * r * 1.9, 4, r * .4, r * .16, angle * 2).fill('#ffe08a');
    }
  } else {
    body.rotation = view.angle;
    if (view.playerStyle === 'tracer') {
      body.ellipse(0, 0, r * 2.3, r * 1.25).stroke({ color, alpha: .3, width: r * 1.3 })
        .ellipse(-r * .3, 0, r * 2, r * .9).fill(color);
      const flame = r * (2.6 + Math.sin(age * 40) * .5);
      body.poly([-r * 1.2, -r * .55, -r * 1.2 - flame, 0, -r * 1.2, r * .55]).fill({ color: 0xffffff, alpha: .55 })
        .star(0, 0, 6, r * 1.9, r * .65).fill(0xffffff);
    } else if (redraw) body.ellipse(0, 0, r * 1.5, r).fill(color).circle(r * .25, 0, r * .42).fill({ color: 0xffffff, alpha: .95 });
  }
}

/** Legacy/mobile path preserves the original per-primitive compositing order. */
export function paintPlayerProjectile(trail: Graphics, body: Graphics, view: ProjectileView, redrawBody = true): void {
  paintPlayerTrail(trail, view); paintPlayerBody(body, view, redrawBody);
}
