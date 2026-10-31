import type { ItemId } from '../content/definitions.ts';
import { getItem } from '../content/items.ts';

interface RetaliationActor {
  readonly x: number;
  readonly y: number;
  readonly dead: boolean;
  hasItem(id: ItemId): boolean;
  readonly stats: { get(key: 'armor'): number };
}
interface RetaliationTarget { readonly x: number; readonly y: number; readonly dead: boolean; readonly isEnemy: boolean }
interface RetaliationEffects<Target> {
  nearby(x: number, y: number, radius: number): readonly Target[];
  damage(target: Target, amount: number): void;
  ring(x: number, y: number, radius: number, color: string, duration: number): void;
}

/** The equipped ability owns its eligibility, geometry, damage and feedback. */
export function createRetaliation<Target extends RetaliationTarget>(actor: RetaliationActor, effects: RetaliationEffects<Target>): () => void {
  return () => {
    if (actor.dead || !actor.hasItem('dr_m_notes')) return;
    const definition = getItem('dr_m_notes');
    if (!definition) throw new TypeError('Missing retaliation item definition');
    const radius = definition.thornsRadius ?? 0;
    const damage = Math.round(actor.stats.get('armor') * (definition.thornsArmorMul ?? 0));
    if (damage <= 0) return;
    for (const enemy of effects.nearby(actor.x, actor.y, radius)) {
      if (enemy.isEnemy && !enemy.dead && Math.hypot(enemy.x - actor.x, enemy.y - actor.y) <= radius) {
        effects.damage(enemy, damage);
      }
    }
    effects.ring(actor.x, actor.y, 105, '#ffd23a', .4);
  };
}
