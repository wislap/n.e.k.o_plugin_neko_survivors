import type { ItemId, UpgradeId, EnemyId, RarityId } from '../content/definitions.ts';
import type { ChallengeKind } from '../encounters/types.ts';
import type { SpecialWaveKind } from '../content/waves.ts';
import type { AiSkillId } from '../ai/skills.ts';
import type { PetSave } from './pet-state.ts';
import type { WaveSystemsSave } from './wave-systems.ts';
import type { DifficultyId } from '../commands';
import type { GamePhase } from '../views';
import type { GameMeta } from './meta.ts';
export type { PlayerStatSnapshot as StatModifiersSave, PlayerWeaponSnapshot as WeaponSave, PlayerSnapshot as PlayerSave } from '../actors/player.ts';
import type { PlayerSnapshot as PlayerSave } from '../actors/player.ts';
export interface ShopSave {
  offers: { kind: 'weapon' | 'item'; id: string; price: number; sold: boolean; pawMark?: number | boolean; meta: Record<string, unknown> }[];
  locked: number[]; rerollCount: number; mateRerolls: [number, number][];
}
export interface WaveStartRulesSave {
  rngState: number; backgroundId: string; lastSpecialWave: number; systems: WaveSystemsSave; specialCache: [number, SpecialWaveKind | null][];
}
export interface RunStateSave {
  seed: number; waveIndex: number; difficulty: DifficultyId; phase: GamePhase;
  rngState: number; waveStartRngState: number; mates: PlayerSave[]; bossChoices: Partial<Record<EnemyId, EnemyId>>;
  endless: boolean; won: boolean; abandoned?: boolean; pilot: boolean; handoverHealth: number | null;
  aiAttempts?: [number, number][];
  retries: number; manualRetries: number; vergilFought: boolean; autoUpgrade: boolean;
  challenge: ChallengeKind | null; challengeChain: boolean; backgroundId: string;
  pendingItemRewards: { id: ItemId; name: string; price: number; sellValue: number; rare: boolean }[];
  pet: PetSave; challengeStartPet?: PetSave;
  afterUpgrade: 'playing' | 'shop'; upgradeOptions: { id: UpgradeId; rarity: RarityId }[];
  challengeStartRngState?: number; aiProfiles: { id: number; skill: AiSkillId; rngState: number }[];
  systems: WaveSystemsSave;
  diffHp: number; diffDmg: number; cometFired: boolean; waveStartRules: WaveStartRulesSave; shop: ShopSave;
}
export type RunSave = RunStateSave & { player: PlayerSave };
export interface GameSaveData {
  format: 'neko-survivors-react'; version: 2; run: RunSave; checkpoint: RunSave | null; meta?: GameMeta;
}
