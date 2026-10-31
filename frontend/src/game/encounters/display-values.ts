import type { ChallengeKind } from './types.ts';
import type { ActorView, ProjectileView, EffectView, TelegraphView } from '../views.ts';
interface DisplayActor { x: number; y: number; radius?: number; angle?: number; alpha?: number; scale?: number }
interface DisplayEffect { x?: number; y?: number; cx?: number; cy?: number; r?: number; angle?: number; a?: number; color?: string; alpha?: number; t?: number; life?: number; variant?: EffectView['variant'] }

export const displayAlpha = (elapsed: number, life: number) => Math.max(0, Math.min(1, 1 - elapsed / Math.max(0.001, life)));

/** Shared semantic display construction; challenge state stays with its owner. */
export function challengeDisplay(kind: ChallengeKind) {
  const actors: ActorView[] = [], projectiles: ProjectileView[] = [], effects: EffectView[] = [], telegraphs: TelegraphView[] = [];
  const actor = (id: string, definitionId: string, value: DisplayActor, radius = 28) => actors.push({
    id: `${kind}-${id}`, kind: 'enemy', definitionId, x: value.x, y: value.y,
    radius: value.radius ?? radius, angle: value.angle ?? 0, color: '#ffffff',
    alpha: value.alpha ?? 1, scale: value.scale ?? 1, boss: true,
  });
  const effect = (id: string, value: DisplayEffect, type: EffectView['kind'] = 'spark', color = '#ddf5ff', radius = 12) => effects.push({
    id: `${kind}-${id}`, kind: type, x: value.x ?? value.cx ?? 0, y: value.y ?? value.cy ?? 0,
    radius: value.r ?? radius, angle: value.angle ?? value.a ?? 0, color: value.color ?? color,
    alpha: value.alpha ?? displayAlpha(value.t ?? 0, value.life ?? 1), variant: value.variant,
  });
  const line = (id: string, x: number, y: number, endX: number, endY: number, width: number, color: string, opacity = 1) => telegraphs.push({
    id: `${kind}-${id}`, kind: 'line', x, y, end: { x: endX, y: endY }, width, color, alpha: opacity,
  });
  return { actors, projectiles, effects, telegraphs, actor, effect, line };
}
