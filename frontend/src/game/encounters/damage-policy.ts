import type { IncomingHitProfile, IncomingHitTarget } from '../combat/incoming-hit.ts';

/** Challenge direct damage deliberately bypasses armor, dodge, shields and ordinary hurt hooks. */
export const CHALLENGE_HIT_INVULNERABILITY = 1;
interface ProportionalHitOptions {
  fraction: number;
  ignoreDowned: boolean;
  multiplier?(player: IncomingHitTarget): number;
  onApplied?(): void;
}
export function proportionalHit({ fraction, ignoreDowned, multiplier, onApplied }: ProportionalHitOptions): IncomingHitProfile {
  return Object.freeze({ hit(player: IncomingHitTarget, sourceX: number, sourceY: number) {
    return player.receiveHit({ damage: Math.max(1, Math.round(player.maxHp * fraction * (multiplier?.(player) ?? 1))),
      sourceX, sourceY, invulnerabilitySeconds: CHALLENGE_HIT_INVULNERABILITY, ignoreDowned, onApplied });
  } });
}
