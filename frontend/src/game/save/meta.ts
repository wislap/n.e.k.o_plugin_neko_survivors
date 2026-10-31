export interface GameMeta {
  unlocked: string[];
  bestWave: number;
  totalKills: number;
  runs: number;
  wins: number;
  retries: number;
  manualRetries: number;
  flandreUnlocked: boolean;
  halloweenUnlocked: boolean;
  remiliaUnlocked: boolean;
}
const COUNTERS = ['bestWave', 'totalKills', 'runs', 'wins', 'retries', 'manualRetries'] as const;
const FLAGS = ['flandreUnlocked', 'halloweenUnlocked', 'remiliaUnlocked'] as const;
const FIELDS = [...COUNTERS, ...FLAGS, 'unlocked'];
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const validCounter = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Current metadata has a complete, explicit shape. Legacy records have a separate import converter. */
export function isGameMeta(value: unknown): value is GameMeta {
  return record(value) && Object.keys(value).length === FIELDS.length && FIELDS.every(key => Object.hasOwn(value, key))
    && COUNTERS.every(key => validCounter(value[key])) && FLAGS.every(key => typeof value[key] === 'boolean')
    && Array.isArray(value.unlocked) && value.unlocked.every(id => typeof id === 'string');
}

/** Absence of a stored record creates a new profile; this never repairs a damaged record. */
export function createEmptyMeta(): GameMeta {
  return { unlocked: [], bestWave: 0, totalKills: 0, runs: 0, wins: 0, retries: 0, manualRetries: 0,
    flandreUnlocked: false, halloweenUnlocked: false, remiliaUnlocked: false };
}
export function decodeMeta(value: unknown): GameMeta {
  if (!isGameMeta(value)) throw new TypeError('成长记录格式或内容无效');
  return structuredClone(value);
}
export function unlockedChallenges(meta: Readonly<GameMeta>): readonly string[] {
  // The baseline's final title menu always exposes Flandre directly.
  return ['flandre', ...(meta.remiliaUnlocked ? ['remilia'] : []), ...(meta.halloweenUnlocked ? ['halloween'] : [])];
}
