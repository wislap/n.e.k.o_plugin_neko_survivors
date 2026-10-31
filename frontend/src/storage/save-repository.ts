export type SaveSlot = 'run' | 'meta' | 'settings';
export interface ProgressRecords { readonly run: unknown | null; readonly meta: unknown | null }
export interface MigratedProgress extends ProgressRecords { readonly settings?: { readonly playerEffectOpacity: number } }
export type StorageResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: 'unavailable' | 'invalid' | 'read_failed' | 'write_failed'; readonly reason: string };
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export function createSaveRepository(storage?: StoragePort, namespace = 'neko_survivors_react') {
  const key = (slot: SaveSlot) => `${namespace}:${slot}:${slot === 'settings' ? 'v1' : 'v2'}`;
  const legacySources = [
    { run: `${namespace}:run:v1`, meta: `${namespace}:meta:v1` },
    { run: 'neko_miao_save_v1', meta: 'neko_miao_meta_v1' },
    { run: 'neko_survivors_save_v1', meta: 'neko_survivors_meta_v1' },
  ];
  function readRaw(name: string): StorageResult<unknown | null> {
    if (!storage) return { ok: false, error: 'unavailable', reason: 'browser_storage_unavailable' };
    try {
      const raw = storage.getItem(name);
      if (raw === null) return { ok: true, value: null };
      try { return { ok: true, value: JSON.parse(raw) as unknown }; }
      catch { return { ok: false, error: 'invalid', reason: 'invalid_json' }; }
    } catch (error) { return { ok: false, error: 'read_failed', reason: String(error) }; }
  }
  /** One logical commit with rollback for all records owned by an operation. */
  function commit(records: readonly (readonly [SaveSlot, unknown | null])[]): StorageResult<void> {
    if (!storage) return { ok: false, error: 'unavailable', reason: 'browser_storage_unavailable' };
    const entries: { name: string; encoded: string | null; previous: string | null }[] = [];
    try {
      for (const [slot, value] of records) {
        const encoded = value === null ? null : JSON.stringify(value);
        if (encoded === undefined) return { ok: false, error: 'invalid', reason: 'record_not_serializable' };
        entries.push({ name: key(slot), encoded, previous: null });
      }
    } catch { return { ok: false, error: 'invalid', reason: 'record_not_serializable' }; }
    try { for (const entry of entries) entry.previous = storage.getItem(entry.name); }
    catch (error) { return { ok: false, error: 'read_failed', reason: String(error) }; }
    const attempted: typeof entries = [];
    try {
      for (const entry of entries) {
        if (entry.encoded === entry.previous) continue;
        attempted.push(entry);
        if (entry.encoded === null) storage.removeItem(entry.name);
        else storage.setItem(entry.name, entry.encoded);
      }
      return { ok: true, value: undefined };
    } catch (error) {
      let rollbackFailed = false;
      for (const entry of attempted.reverse()) {
        try {
          // Quota failures ordinarily do not change the rejected key. Avoid
          // rewriting that unchanged key and wasting the remaining quota.
          if (storage.getItem(entry.name) === entry.previous) continue;
          if (entry.previous === null) storage.removeItem(entry.name);
          else storage.setItem(entry.name, entry.previous);
        } catch { rollbackFailed = true; }
      }
      return { ok: false, error: 'write_failed', reason: rollbackFailed ? `progress_rollback_failed: ${String(error)}` : String(error) };
    }
  }
  return {
    read: (slot: SaveSlot) => readRaw(key(slot)),
    writeSettings: (settings: unknown): StorageResult<void> => commit([['settings', settings]]),
    writeProgress: (progress: ProgressRecords): StorageResult<void> => commit([['run', progress.run], ['meta', progress.meta]]),
    /** Read and validate both old records before writing either new record. */
    importLegacyProgress(migrate: (source: ProgressRecords) => MigratedProgress | null): StorageResult<MigratedProgress | null> {
      for (const slot of ['run', 'meta'] as const) {
        const existing = readRaw(key(slot));
        if (!existing.ok) return existing;
        if (existing.value !== null) return { ok: true, value: null };
      }
      let source: ProgressRecords = { run: null, meta: null };
      for (const candidate of legacySources) {
        const run = readRaw(candidate.run), meta = readRaw(candidate.meta);
        if (!run.ok) return run;
        if (!meta.ok) return meta;
        // One source owns both records; never attach another installation's
        // growth to a partially present run.
        if (run.value !== null || meta.value !== null) { source = { run: run.value, meta: meta.value }; break; }
      }
      if (source.run === null && source.meta === null) return { ok: true, value: null };
      let progress: MigratedProgress | null;
      try { progress = migrate(source); } catch { progress = null; }
      if (!progress || typeof progress !== 'object') return { ok: false, error: 'invalid', reason: 'legacy_schema_rejected' };
      const records: [SaveSlot, unknown | null][] = [['run', progress.run], ['meta', progress.meta]];
      if (progress.settings) {
        const existing = readRaw(key('settings'));
        if (!existing.ok) return existing;
        if (existing.value !== null && (typeof existing.value !== 'object' || Array.isArray(existing.value))) {
          return { ok: false, error: 'invalid', reason: 'invalid_settings' };
        }
        // Current preferences win. The explicit migration only fills fields
        // that have never been stored; it never rewrites a user's choice.
        records.push(['settings', { ...progress.settings, ...existing.value }]);
      }
      const committed = commit(records);
      return committed.ok ? { ok: true, value: progress } : committed;
    },

  };
}
export type SaveRepository = ReturnType<typeof createSaveRepository>;
