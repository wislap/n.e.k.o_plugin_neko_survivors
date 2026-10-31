import type { GamePhase } from './run/run-progression.ts';
const combat = new Set<GamePhase>(['playing', 'flandre', 'vergil', 'remilia', 'halloween']);
export function isCombatPhase(phase: GamePhase) { return combat.has(phase); }
