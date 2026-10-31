export { createSaveRepository } from './save-repository';
export type { SaveRepository, SaveSlot, StoragePort, StorageResult, ProgressRecords, MigratedProgress } from './save-repository';

export function browserStorage(): Storage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; }
  catch { return undefined; }
}
