import type { ChallengePlayerRules } from './player-policy.ts';
import type { World } from '../world/world.ts';
import type { Player } from '../actors/player.ts';
import type { RNG } from '../math/random.ts';
import type { RuleEffects } from '../world/effects-port.ts';
import type { GamePlatform } from '../platform.ts';
import type { ActorView, EffectView, EntityId, EncounterView, ProjectileView, TelegraphView } from '../views.ts';
export type ChallengeKind = 'flandre' | 'vergil' | 'remilia' | 'halloween';
export type ChallengeOutcome = 'death' | 'beat' | 'partial' | 'extraDeath' | 'timeout' | 'done';
export interface Arena { readonly cx: number; readonly cy: number; readonly hw: number; readonly hh: number }
export interface ChallengeResult { kind: ChallengeKind; outcome: ChallengeOutcome }
export interface ControllerContext {
  world: World; player: Player; rng: RNG; effects: RuleEffects; platform: GamePlatform;
  viewport: { cx: number; cy: number; viewW: number; viewH: number; shake(strength: number, duration: number): void };
  shake(strength: number, duration: number): void;
  notice(text: string, tone?: 'info' | 'good' | 'bad', duration?: number): void;
  speak(text: string, options?: { key?: string }): void;
}
export interface ControllerOptions { chain?: boolean; onDone(outcome: ChallengeOutcome): void }
export interface EncounterContext {
  world: World; player: Player; rng?: RNG; effects?: RuleEffects; platform?: GamePlatform;
  viewport?: Partial<ControllerContext['viewport']>; chain?: boolean; onDone?(result: ChallengeResult): void;
}
export interface LaserHazard { x: number; y: number; angle: number; angularVelocity: number; activeAfter: number; activeFor: number; length: number; halfWidth: number; sweepAngle?: number }
export interface CrossHazard { x: number; y: number; activeAfter: number; activeFor: number; halfWidth: number; radius: number }
export interface ChallengeObservation {
  bodyId: EntityId | null; target: { id: EntityId; x: number; y: number; dead: boolean } | null;
  guarding: boolean; movement: 'survival' | 'teaching' | 'duel'; purgeReady: boolean;
  lasers: LaserHazard[]; crosses: CrossHazard[];
}
export interface ChallengeFrame { encounter?: EncounterView; actors: ActorView[]; projectiles: ProjectileView[]; effects: EffectView[]; telegraphs: TelegraphView[] }
export interface AttackInterception { targetId: EntityId; melee: boolean; x: number; y: number }
export interface DamageObservation { targetId: EntityId; melee: boolean; dealt: number }
export interface ChallengeClock { left: number; total: number; label: string }
export interface ChallengeSession {
  readonly kind: ChallengeKind; readonly arena: Arena; readonly timeScale: number;
  readonly rules: Readonly<{ blocksWeather: boolean; disablesPetAttack: boolean; suppressesTrueDamage: boolean; disablesPhantoms: boolean }>;
  playerRules(player: Player): ChallengePlayerRules;
  readCombat(): ChallengeObservation; readFrame(): ChallengeFrame;
  readClock(): { overridden: boolean; timer: ChallengeClock | null };
  readonly guard: Readonly<{ intercept(hit: AttackInterception): boolean; onDamage(hit: DamageObservation): void }> | null;
  readonly purge: Readonly<{ manual(): boolean }> | null;
  readonly displayTiming: Readonly<{ sample(seconds: number): void }> | null;
  advance(dt: number): void; dispose(): void;
}

/** Internal mechanism contract; concrete spell state never reaches the session adapter. */
export interface ChallengeController {
  readonly kind: ChallengeKind;
  readonly arena: Arena;
  readonly rules: ChallengeSession['rules'];
  readonly capabilities: Pick<ChallengeSession, 'guard' | 'purge' | 'displayTiming'>;
  readonly playerPolicy: { rulesFor(player: Player): ChallengePlayerRules };
  readonly timeScale: number | undefined;
  readonly over: boolean;
  readCombat(): ChallengeObservation;
  readFrame(): ChallengeFrame;
  readClock(): ReturnType<ChallengeSession['readClock']>;
  advance(dt: number): void;
  dispose(): void;
}
