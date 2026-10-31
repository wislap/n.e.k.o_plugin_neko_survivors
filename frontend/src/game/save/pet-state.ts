import type { PetSnapshot } from '../actors/pet.ts';
export type { PetSnapshot as PetSave } from '../actors/pet.ts';
const FIELDS = ['state', 'x', 'y', 'vx', 'vy', 'facing', 'attackCd', 'healCd', 'healsGiven', 'pickedUp', 'kills', 'damageDealt', 'vacuumCd', 'vacuumsUsed', 'vacuumAnim', 'bobPhase', 'walkPhase', 'attackAnim', 'healAnim', 'stealAnim', 'emote', 'line', 'lineTimer', '_pickupLineCd', 'age'] as const;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function isPetSave(value: unknown): value is PetSnapshot {
  if (!record(value) || typeof value.rngState !== 'number' || !Number.isSafeInteger(value.rngState) || !record(value.fields)) return false;
  const fields = value.fields;
  return Object.keys(fields).length === FIELDS.length && FIELDS.every(key =>
    ['state', 'emote', 'line'].includes(key) ? typeof fields[key] === 'string'
      : typeof fields[key] === 'number' && Number.isFinite(fields[key]))
    && ['follow', 'attack', 'fetch', 'heal'].includes(String(fields.state));
}
