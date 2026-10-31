import type { GameEvent } from '../events';
/** Requests for optional presentation. Dropping one cannot change simulation results. */
export type RuleEffect =
  | GameEvent
  | { type: 'camera-shake'; strength: number; duration: number };

/** A session injects its own sink. No global audio, camera, or event bus. */
export interface RuleEffects {
  emit(event: RuleEffect): void;
}
