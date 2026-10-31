import type { WeaponOwner } from '../actors/weapon.ts';
import type { CombatTarget } from '../combat/types.ts';
import type { DamageWeapon } from '../combat/outgoing.ts';
import type { RNG } from '../math/random.ts';
import type { FXSystem } from '../world/effects.ts';
import { luckyCatPawFollows, stackOverloadOnHit } from './equipment.ts';

/** Each lineage consumes only its own followup, preserving cross-ability chaining. */
export interface FollowupEligibility { criticalRepeat: boolean; lobsterFollowup: boolean }
export type FollowupKind = 'critical-repeat' | 'lobster-followup';
export const PRIMARY_ATTACK: Readonly<FollowupEligibility> = Object.freeze({ criticalRepeat: true, lobsterFollowup: true });

/** Character damage modifiers run after criticals and before weather, in this order. */
export function modifyOutgoingDamage(owner: WeaponOwner, target: CombatTarget, damage: number, fromTurret: boolean): number {
  const runtime = 'charRt' in owner ? owner.charRt : undefined;
  if (!runtime) return damage;
  damage *= runtime.rollLuckyHit?.() ?? 1;
  if (runtime.id === 'luna') damage *= runtime.distanceMul(Math.hypot(target.x - owner.x, target.y - owner.y));
  if (runtime.id === 'neon_party' && fromTurret) {
    const bonus = runtime.turretBonusFor(target);
    if (bonus > 0) damage *= 1 + bonus;
    runtime.onTurretHit(target);
  }
  return damage;
}

/** Fixed post-hit ability order: overload, critical repeat, lobster followup. */
export function triggerOffensiveFollowups(
  hit: { owner: WeaponOwner; weapon: DamageWeapon | null; target: CombatTarget; baseDamage: number;
    finalDamage: number; critical: boolean; killed: boolean | undefined },
  eligibility: Readonly<FollowupEligibility>,
  context: { rng: Pick<RNG, 'next'>; fx: Pick<FXSystem, 'damageText' | 'thrust'>; repeat(kind: FollowupKind, damage: number): void },
): void {
  const { owner, weapon, target } = hit;
  if ('hasItem' in owner) {
    stackOverloadOnHit(owner, target, hit.killed);
    if (luckyCatPawFollows(owner, context.rng, hit.critical, eligibility.criticalRepeat)) {
      context.repeat('critical-repeat', hit.baseDamage);
    }
  }
  const runtime = 'charRt' in owner ? owner.charRt : undefined;
  if (runtime && eligibility.lobsterFollowup && !hit.killed && weapon?.def.kind === 'melee' && runtime.rollLobster?.('melee')) {
    if ('heal' in owner) owner.heal(5);
    context.fx.damageText(owner.x, owner.y - 24, '+5', false, '#6ee7a8');
    context.fx.thrust(owner.x, owner.y, target.x, target.y, 16, '#ff6b4a');
    context.fx.damageText(target.x, target.y - target.radius * 1.1, '龙虾突击', false, '#ff6b4a');
    context.repeat('lobster-followup', hit.finalDamage * (runtime.lobsterMul ?? 2));
  }
}
