import type { Player } from '../actors/player.ts';

export interface ChallengePlayerRules {
  readonly blocksHealing: boolean;
  readonly blocksAttack: boolean;
  readonly speedMultiplier: number | null;
}

/** Owns the restrictions for one challenge; removing the session removes every restriction. */
export class ChallengePlayerPolicy {
  private readonly primary: Player;
  private readonly speedMultiplier: number | null;
  private blocksPrimaryAttack: boolean;
  constructor({ primary, blocksPrimaryAttack = false, speedMultiplier = null }: {
    primary: Player; blocksPrimaryAttack?: boolean; speedMultiplier?: number | null;
  }) {
    this.primary = primary; this.speedMultiplier = speedMultiplier;
    this.blocksPrimaryAttack = blocksPrimaryAttack;
  }
  allowPrimaryAttack() { this.blocksPrimaryAttack = false; }
  rulesFor(player: Player): ChallengePlayerRules {
    return { blocksHealing: true, blocksAttack: player === this.primary && this.blocksPrimaryAttack,
      speedMultiplier: this.speedMultiplier };
  }
}
