import type { World } from '../world/world.ts';
import type { ChallengeKind, ChallengeSession, EncounterContext } from '../encounters/types.ts';
import { createEncounter } from '../encounters/index.ts';

/** Entry resets are shared by ordinary unlocks, direct challenges and save restore. */
export function enterChallenge(kind: ChallengeKind, { world, player, rng, effects, onDone, viewport, chain, platform }: EncounterContext & { effects: NonNullable<EncounterContext['effects']> }) {
  world.noSpawn = true; world.grid.clear(); world.enemyBullets.clear(); world.enemies.clear(); world.phantoms.length = 0;
  world.spawnPaused = false; world.enemyFrozen = false; world.terrain = { rects: [], circles: [] };
  effects.emit({ type: 'music', scene: 'boss', track: '', stop: true });
  const controller = createEncounter(kind, { world, player, rng, effects, onDone, viewport, chain, platform });
  return controller;
}

export function leaveChallenge(controller: ChallengeSession | null, world: World) {
  controller?.dispose();
  world.challenge = null;
  world.noSpawn = false; world.enemyBullets.clear(); world.enemies.clear();
  for (const player of world.players()) {
    if (player.dead || player.downed) { player.dead = false; player.downed = false; player.hp = player.maxHp; player.invuln = 1.5; }
    player.resetDownCount();
  }
}
