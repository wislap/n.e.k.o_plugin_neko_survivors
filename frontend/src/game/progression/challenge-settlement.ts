import type { World } from '../world/world.ts';
import type { PendingItemReward } from '../combat/death.ts';
import type { Player } from '../actors/player.ts';
import type { GameMeta } from '../save/meta.ts';
import type { ChallengeKind, ChallengeOutcome } from '../encounters/types.ts';
import { getEnemy } from '../content/enemies.ts';

/** Settlement owns rewards and unlocks; RunProgression owns the next stage. */
export function settleChallenge({ kind, outcome, world, player, meta }: { kind: ChallengeKind; outcome: ChallengeOutcome; world: World; player: Player; meta: GameMeta }) {
  const survived = outcome !== 'death';
  const rewarded = kind === 'vergil' ? outcome === 'beat' : survived;
  if (rewarded) {
    const definition = getEnemy('boss_void_lord')!;
    const scaling = world.waves.read().current?.scaling ?? { xp: 1, materials: 1 };
    const multiplier = kind === 'halloween' ? 4 : 3;
    player.gainXp(Math.round(definition.xp * multiplier * (scaling.xp ?? 1)));
    player.gainMaterials(Math.round(definition.materials * multiplier * (scaling.materials ?? 1)));
    world.effects.emit({ type: 'sound', name: 'bossKill' });
  }
  const reward: (PendingItemReward & { pity: number }) | null = kind === 'vergil' && outcome === 'beat'
    ? { id: 'yamato', name: '阎魔刀', price: 88, rare: true, sellValue: 66, pity: 120 }
    : kind === 'flandre' && outcome === 'beat'
      ? { id: 'laevatein', name: '莱万汀', price: 99, rare: true, sellValue: 60, pity: 160 } : null;
  if (reward) {
    if (player.hasItem(reward.id)) player.gainMaterials(reward.pity);
    else { const { pity, ...pending } = reward; world.pendingItemRewards.push(pending); }
  }
  if (kind === 'flandre' && outcome === 'beat') meta.flandreUnlocked = true;
  if (kind === 'remilia' && survived) meta.remiliaUnlocked = true;
  if (kind === 'halloween' && survived) meta.halloweenUnlocked = true;
}
