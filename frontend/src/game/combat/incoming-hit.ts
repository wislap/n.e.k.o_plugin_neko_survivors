import type { DirectHit } from './player-health.ts';

/** Only the facts a direct-hit policy needs; no mutable entity or world is exposed. */
export interface IncomingHitTarget {
  readonly maxHp: number;
  readonly pilotBuff: boolean | undefined;
  receiveHit(hit: DirectHit): number;
}

/** An attack owns its damage policy; projectiles only deliver it. */
export interface IncomingHitProfile {
  hit(target: IncomingHitTarget, sourceX: number, sourceY: number): number;
}
