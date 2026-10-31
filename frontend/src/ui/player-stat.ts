import type { PlayerSummary } from '../game';

/** Presentation consumes the rule projection verbatim; missing required rows are a contract error. */
export function playerStat(player: PlayerSummary, statId: string) {
  const detail = player.statDetails.find(row => row.statId === statId);
  if (!detail) throw new Error(`Missing projected stat ${statId} for player ${player.id}`);
  return detail;
}
