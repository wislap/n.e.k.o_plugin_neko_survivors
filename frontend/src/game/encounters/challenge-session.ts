import type { Player } from '../actors/player.ts';
import type { ChallengeController, ChallengeSession } from './types.ts';
import type { World } from '../world/world.ts';

/** Uniform lifetime and step validation; each mechanism owns its capabilities and observations. */
export function createChallengeSession(controller: ChallengeController, world: World): ChallengeSession {
  const session: ChallengeSession = Object.freeze({
    kind: controller.kind, arena: controller.arena, rules: controller.rules,
    get timeScale() { return controller.timeScale ?? 1; },
    playerRules: (player: Player) => controller.playerPolicy.rulesFor(player),
    readCombat: () => controller.readCombat(),
    readFrame: () => controller.readFrame(),
    readClock: () => controller.readClock(),
    ...controller.capabilities,
    advance(dt: number) {
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Encounter dt must be finite and nonnegative');
      if (dt === 0 || controller.over) return;
      controller.advance(dt);
    },
    dispose() {
      if (world.challenge === session) world.challenge = null;
      controller.dispose();
    },
  });
  return session;
}
