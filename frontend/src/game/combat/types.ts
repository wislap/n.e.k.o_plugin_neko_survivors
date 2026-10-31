import type { EnemyBody } from '../actors/enemy.ts';
import type { Chest } from '../actors/chest.ts';
export type CombatTarget = EnemyBody | Chest;

/** Armor policy for an attack submitted to an enemy body. */
export interface EnemyDamageOptions { pierceArmor?: boolean }

/** Every body returns one explicit damage receipt, including challenge guards. */
export interface EnemyDamageResult {
  dealt: number;
  blocked?: boolean;
  dodged?: boolean;
  killed?: boolean;
  gated?: boolean;
  overloaded?: boolean;
  reason?: string;
}
