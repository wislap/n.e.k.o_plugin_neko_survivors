import type { DifficultyId } from '../content/definitions.ts';
import type { SpecialWaveKind } from '../content/waves.ts';
import { EnemyBody, type EnemyScaling, type EnemySpawnDefinition, type EnemyDamageGate } from '../actors/enemy.ts';
import type { RNG } from '../math/random.ts';
import { BossPhaseState } from './boss-phases.ts';
import { OrdinaryEnemyBehavior } from './behavior.ts';

export interface EnemySpawnModifiers {
  extraPlayers: number;
  difficulty: DifficultyId;
  mutate: boolean;
  specialWave: SpecialWaveKind | null | undefined;
  spawnAnimation: number;
}

/** Return a fully initialized ordinary actor; callers never finish its stat construction. */
export function createEnemy(def: EnemySpawnDefinition, x: number, y: number, scaling: EnemyScaling, rng: RNG,
  modifiers?: EnemySpawnModifiers): EnemyBody {
  const phase = def.boss ? new BossPhaseState() : null;
  const damageGate: EnemyDamageGate | undefined = phase ? {
    filter(body, amount) {
      const lock = phase.applyDamageLock(body.hp, body.maxHp, amount);
      if (lock.blocked || lock.gated) phase.lastBlocked = 0.1;
      return { blocked: lock.blocked, amount: lock.dmg, reason: lock.reason, gated: !!lock.gated };
    },
    advance(dt) { phase.tick(dt); },
    read() {
      return { phase: phase.phase, color: phase.mods.color, changeFx: phase.changeFx,
        invulnerable: phase.invulnerable, blocked: phase.lastBlocked, invulnLeft: phase.invulnLeft };
    },
  } : undefined;
  const body = new EnemyBody(def, x, y, scaling, rng, {
    damageGate, behavior: body => new OrdinaryEnemyBehavior(body, phase),
  });
  if (modifiers) {
    // Preserve each original rounding stage, and the overload threshold's base-HP origin.
    // The actor is not published until all spawn modifiers have been applied.
    if (modifiers.extraPlayers > 0) {
      body.maxHp = Math.round(body.maxHp * (1 + (def.boss ? .45 : def.elite ? .3 : .15) * modifiers.extraPlayers));
      body.hp = body.maxHp;
    }
    body.spawnAnimation = modifiers.spawnAnimation;
    if (def.hpNightmare != null && modifiers.difficulty === 'nightmare') {
      body.maxHp = Math.round(body.maxHp * (def.hpNightmare / (def.hp ?? 10)));
      body.hp = body.maxHp;
    }
    if (modifiers.mutate && !def.boss) {
      body.mutant = true;
      body.maxHp = Math.round(body.maxHp * 2.5);
      body.hp = body.maxHp;
      body.speed *= 1.2;
      body.damage *= 1.5;
      body.dmgScale *= 1.5;
      body.xpValue = Math.round(body.xpValue * 3);
      body.materialValue = Math.round(body.materialValue * 3);
    }
    if (modifiers.specialWave === 'slack' && !def.boss) body.speed *= .7;
    if (modifiers.specialWave === 'payday' && !def.boss) { body.damage *= 1.2; body.dmgScale *= 1.2; }
  }
  return body;
}
