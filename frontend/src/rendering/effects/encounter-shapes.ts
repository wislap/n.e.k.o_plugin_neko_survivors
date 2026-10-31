import type { Graphics } from 'pixi.js';
import type { EffectView } from '../../game';

/** The reference dmc-blades.js stream is visual-only, including seed zero. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

/** Exact source paths for the three encounter effects, without rule mutation. */
export function drawEncounterEffect(graphic: Graphics, view: EffectView): boolean {
  const fade = Math.max(0, 1 - (view.progress ?? 0));
  if (view.kind === 'sparkle' && view.end) {
    const progress = view.progress ?? 0;
    graphic.circle(0, 0, view.radius).fill(view.color)
      .moveTo(0, 0).lineTo(view.end.x - view.x, view.end.y - view.y)
      .stroke({ color: view.color, width: view.width ?? 1,
        alpha: (.35 * progress + .1) / (.5 + .5 * progress) });
    return true;
  }
  if (view.variant === 'glass' && view.kind === 'shard' && view.points?.length) {
    graphic.poly(view.points.flatMap(point => [point.x - view.x, point.y - view.y]), true)
      .fill({ color: 0xbeebff, alpha: .3 * fade })
      .stroke({ color: 0xf0fcff, alpha: .9 * fade, width: 1.4 });
    return true;
  }
  if (view.variant === 'blade' && view.kind === 'spark') {
    const length = 5 + 7 * fade;
    // The owning display rotates by the supplied original spark angle.
    graphic.moveTo(0, 0).lineTo(-length, 0)
      .stroke({ color: 0xffffff, alpha: .9, width: 1.3, cap: 'round' })
      .moveTo(0, 0).lineTo(-length * .6, 0)
      .stroke({ color: 0x78dcff, alpha: .4, width: 2.6, cap: 'round' });
    return true;
  }
  if (view.variant === 'crack' && view.kind === 'trail') {
    const random = mulberry32(view.seed ?? 0), points = [0, 0];
    let x = 0, y = 0, angle = random() * Math.PI * 2;
    for (let segment = 0; segment < 5; segment++) {
      angle += (random() - .5) * 1.5;
      x += Math.cos(angle) * (10 + random() * 18);
      y += Math.sin(angle) * (10 + random() * 18);
      points.push(x, y);
    }
    graphic.poly(points, false)
      .stroke({ color: 0x1e042c, width: 2.6, cap: 'round', join: 'round' })
      .poly(points, false)
      .stroke({ color: 0x000000, alpha: .9, width: 1.1, cap: 'round', join: 'round' });
    return true;
  }
  return false;
}
