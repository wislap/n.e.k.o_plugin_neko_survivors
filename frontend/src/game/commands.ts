export type DifficultyId = 'easy' | 'normal' | 'hard' | 'nightmare';
export type PartySize = 1 | 2 | 3 | 4;

export interface RunOptions {
  characterId: string;
  difficulty: DifficultyId;
  partySize: PartySize;
  seed?: number;
  pilot?: boolean;
  randomParty?: boolean;
}

export interface InputFrame {
  /** One consumed display interval for the legacy mobile Flandre budget controller. */
  displaySeconds?: number;
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  manualAim: boolean;
  slow: boolean;
  clear: boolean;
  ultimate: boolean;
  p2MoveX: number;
  p2MoveY: number;
  p2Slow: boolean;
  p2Clear: boolean;
}

export const EMPTY_INPUT: Readonly<InputFrame> = Object.freeze({
  moveX: 0, moveY: 0, aimX: 0, aimY: 0, manualAim: false,
  slow: false, clear: false, ultimate: false,
  p2MoveX: 0, p2MoveY: 0, p2Slow: false, p2Clear: false,
});

export type GameCommand =
  | { type: 'start-run'; options: RunOptions }
  | { type: 'start-challenge'; challenge: 'flandre' | 'vergil' | 'remilia' | 'halloween'; options: RunOptions }
  | { type: 'pause' | 'resume' | 'retry-wave' | 'return-title' | 'abandon-run' | 'next-wave' }
  | { type: 'choose-upgrade'; optionId: string; revision: number }
  | { type: 'buy-offer' | 'toggle-lock'; offerId: string; revision: number; playerId?: number }
  | { type: 'reroll'; revision: number; playerId?: number }
  | { type: 'combine'; weaponId: string; revision: number; playerId?: number }
  | { type: 'sell-weapon'; weaponInstanceId: number; revision: number; playerId?: number }
  | { type: 'claim-reward' | 'sell-reward'; rewardId: string; revision: number }
  | { type: 'set-pilot'; enabled: boolean }
  | { type: 'auto-upgrade' }
  | { type: 'set-auto-upgrade'; enabled: boolean }
  | { type: 'continue-endless' | 'finish-run' };

export type CommandResult =
  | { ok: true }
  | { ok: false; reason: string };
