import type { World } from '../world/world.ts';
import { waveClearBonus } from '../content/waves.ts';

/** Settlement runs once, after world iteration completes. It never touches UI. */
export function settleWave(world: World, waveIndex: number, removeBosses = false) {
  const player = world.player;
  if (!player) throw new TypeError('Wave settlement requires an active player');
  world.waves.tuneDiffScale();
  world.endWaveCleanup({ removeBosses });
  const harvest = Math.round(player.stats.values.harvesting);
  if (harvest > 0) player.gainMaterials(harvest);
  let skillHarvest = 0, luckHarvest = 0;
  for (const actor of world.players()) {
    if (!actor || actor.dead) continue;
    actor.resetDownCount();
    actor.downed = false;
    skillHarvest += actor.charRt.onRoundEnd() ?? 0;
    const luck = actor.charRt.luckHarvest();
    if (luck > 0) actor.gainMaterials(luck);
    luckHarvest += luck;
    actor.hp = actor.maxHp;
    actor.invuln = 1.5;
  }
  const clearBonus = waveClearBonus(waveIndex);
  player.gainMaterials(clearBonus);
  const cleanup = world.lastCleanupBonus || 0;
  const harvested = harvest + skillHarvest + luckHarvest;
  return { cleanup, harvest: harvested, clear: clearBonus, total: cleanup + harvested + clearBonus };
}
