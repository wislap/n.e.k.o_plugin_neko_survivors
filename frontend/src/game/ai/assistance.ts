import type { Player } from '../actors/player.ts';
import type { StatModifiers } from '../progression/stats.ts';
export type AiAssistance = 'none' | 'full' | 'lite' | 'tough';
/** Baseline hidden AI growth, applied once per entity per wave by the session. */
export function applyAiWaveGrowth(player: Player, waveIndex: number) {
  if (player._armorWave === waveIndex) return;
  player.stats.addFlat('armor', player._armorWave === undefined ? 10 : 2);
  player._armorWave = waveIndex;
}

/** Baseline teammate automatic growth package; session consumes pending levelups. */
export function applyTeammateLevel(player: Player) {
  if (!(player.pendingLevelUps > 0) || player.dead || player.downed) return false;
  // Pick the existing fixed package before level passives change its thresholds.
  let mods: StatModifiers, pct: StatModifiers | undefined, heal = 0;
  if (player.stats.get('hpRegen') < 1) mods = { hpRegen: 0.5 };
  else if (player.stats.get('armor') < 10) mods = { armor: 2 };
  else { mods = { maxHp: 6 }; pct = { damage: 8 }; heal = 6; }
  player.applyUpgrade({ id: 'teammate-level-package', mods, pct }, {
    record: false, preserveHealthRatio: false,
  });
  if (heal) player.heal(heal);
  player.pendingLevelUps--;
  return true;
}

/** Mode is an explicit rule option; old window.__buff* debug globals are removed. */
export function updateAiAssistance(player: Player, mode: AiAssistance, waveIndex: number, dt: number) {
  player.pilotBuff = mode === 'full';
  player.pilotLite = mode === 'lite';
  player.pilotTough = mode === 'tough';
  player._pilotMagnet = mode === 'tough' ? 99999 : mode === 'lite' ? 400 : 0;
  player._pilotIframe = mode === 'tough' ? 2 : 0;
  player._pilotEarly = mode === 'tough' && waveIndex < 3;
  if (mode === 'full' && player.hp > 0) {
    // Old tick added 0.4 each 60Hz step. Keep its actual 24 HP/s time semantics.
    player.hp = Math.min(player.maxHp, player.hp + 24 * dt);
  }
}
