import type { Player } from './actors/player.ts';
import { updateAiAssistance } from './ai/assistance.ts';
import { captureHealthFraction, restoreHealthFraction } from './combat/player-health.ts';

type ControlState = { kind: 'human' }
  | { kind: 'pilot'; entry: 'new-attempt' }
  | { kind: 'pilot'; entry: 'takeover'; healthFraction: number };
export interface ControlSnapshot { pilot: boolean; handoverHealth: number | null }

/** Owns the main actor's control lifecycle. Combat AI and permanent growth retain their owners. */
export class RunControl {
  private state: ControlState = { kind: 'human' };
  get enabled(): boolean { return this.state.kind === 'pilot'; }

  begin(enabled: boolean) {
    this.state = enabled ? { kind: 'pilot', entry: 'new-attempt' } : { kind: 'human' };
  }
  restore(snapshot: ControlSnapshot) {
    this.state = !snapshot.pilot ? { kind: 'human' }
      : snapshot.handoverHealth === null ? { kind: 'pilot', entry: 'new-attempt' }
      : { kind: 'pilot', entry: 'takeover', healthFraction: snapshot.handoverHealth };
  }
  change(enabled: boolean, player: Player): boolean {
    if (enabled === this.enabled) return false;
    const previous = this.state;
    if (enabled) {
      const fraction = captureHealthFraction(player, player.maxHp);
      this.state = fraction === null ? { kind: 'pilot', entry: 'new-attempt' }
        : { kind: 'pilot', entry: 'takeover', healthFraction: fraction };
    } else {
      if (previous.kind === 'pilot' && previous.entry === 'takeover') {
        restoreHealthFraction(player, previous.healthFraction, player.maxHp);
      }
      this.state = { kind: 'human' };
    }
    this.clearActor(player);
    return true;
  }
  /** Ending an attempt invalidates its handover, without healing a dead/downed actor. */
  endAttempt(player: Player, keepPilot: boolean) {
    this.clearActor(player);
    this.begin(keepPilot);
  }
  applyAssistance(player: Player, solo: boolean, waveIndex: number, dt: number) {
    const full = this.enabled && solo && !player.dead && !player.downed;
    updateAiAssistance(player, full ? 'full' : 'none', waveIndex, dt);
  }
  capture(): ControlSnapshot {
    return { pilot: this.enabled, handoverHealth: this.state.kind === 'pilot' && this.state.entry === 'takeover'
      ? this.state.healthFraction : null };
  }
  private clearActor(player: Player) {
    player.agentMoveTarget = null;
    updateAiAssistance(player, 'none', 0, 0);
  }
}
