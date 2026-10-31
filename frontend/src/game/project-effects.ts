import type { EffectView, Point } from './views';

/** The rule-side effect record is independent of any drawing backend. */
export interface RuleEffectRecord {
  id: number; player?: boolean;
  type: 'slash' | 'thrust' | 'spin' | 'beam' | 'nova' | 'explosion' | 'chain'
    | 'sparkle' | 'damage_text' | 'ring' | 'hit' | 'impact' | 'shockwave' | 'shard';
  t: number; life: number; color: string;
  x?: number; y?: number; radius?: number; range?: number; size?: number; angle?: number;
  vx?: number; vy?: number; ox?: number; oy?: number; rot?: number; spin?: number;
  ex?: number; ey?: number; points?: readonly Point[]; arcDeg?: number;
  width?: number; power?: number; rays?: number; seed?: number; text?: string; isCrit?: boolean;
  notes?: readonly { a: number; sp: number; ch: string; size: number; rot: number; spin: number }[];
}

export function projectEffect(effect: Readonly<RuleEffectRecord>): EffectView {
  const progress = Math.max(0, Math.min(1, effect.life > 0 ? effect.t / effect.life : 1));
  let x = effect.x ?? effect.points?.[0]?.x ?? 0;
  let y = effect.y ?? effect.points?.[0]?.y ?? 0;
  let angle = effect.angle;
  let alpha = 1 - progress;
  if (effect.type === 'shard') {
    x += (effect.ox ?? 0) + (effect.vx ?? 0) * effect.t;
    y += (effect.oy ?? 0) + (effect.vy ?? 0) * effect.t + 90 * effect.t * effect.t;
    angle = (effect.rot ?? 0) + (effect.spin ?? 0) * effect.t;
  } else if (effect.type === 'sparkle') {
    x += (effect.vx ?? 0) * effect.t;
    y += (effect.vy ?? 0) * effect.t;
  } else if (effect.type === 'damage_text') {
    y += (effect.vy ?? 0) * effect.t;
    alpha = progress < 0.7 ? 1 : 1 - (progress - 0.7) / 0.3;
  }
  return {
    id: `fx-${effect.id}`, kind: effect.type === 'damage_text' ? 'text' : effect.type,
    x, y, angle, playerOwned: !!effect.player, alpha: Math.max(0, alpha), color: effect.color,
    radius: effect.radius ?? effect.range ?? effect.size ?? 14,
    progress, text: effect.text, critical: effect.isCrit,
    end: effect.ex == null || effect.ey == null ? undefined : { x: effect.ex, y: effect.ey },
    points: effect.points?.map(point => ({ x: point.x, y: point.y })),
    arc: effect.arcDeg == null ? undefined : effect.arcDeg * Math.PI / 180,
    width: effect.width, power: effect.power, rays: effect.rays, seed: effect.seed,
    notes: effect.notes?.map(note => ({ angle: note.a, speed: note.sp, text: note.ch,
      size: note.size, rotation: note.rot, spin: note.spin })),
  };
}
