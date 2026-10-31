/** Observes native fault injections; synthetic unit tests do not prove driver recovery. */
export interface ContextSnapshot {
  contextLost: boolean; recoveries: number;
  generatedTextures: { cached: number; generated: number; released: number };
}
export class ContextProbe {
  readonly records: { sequence: number; at: number; event: string; snapshot: ContextSnapshot }[] = [];
  state: 'idle' | 'requested' | 'lost' | 'restored-awaiting-textures' | 'regenerated' = 'idle';
  private initialGeneration = 0; private initialRecovery = 0; private sequence = 0;
  private previousLost = false; private previousRecovery = 0;
  constructor(private readonly now = () => performance.now()) {}
  record(event: string, snapshot: ContextSnapshot): void {
    this.records.push({ sequence: ++this.sequence, at: this.now(), event, snapshot: { ...snapshot, generatedTextures: { ...snapshot.generatedTextures } } });
    if (this.records.length > 80) this.records.shift();
  }
  request(snapshot: ContextSnapshot): void {
    this.initialGeneration = snapshot.generatedTextures.generated; this.initialRecovery = snapshot.recoveries;
    this.state = 'requested'; this.record('fault-requested', snapshot);
  }
  nativeLoss(snapshot: ContextSnapshot): void { this.state = 'lost'; this.record('native-loss', snapshot); }
  observe(snapshot: ContextSnapshot): void {
    if (snapshot.contextLost && !this.previousLost) { this.state = 'lost'; this.record('renderer-loss-observed', snapshot); }
    if (snapshot.recoveries > this.previousRecovery) {
      this.state = 'restored-awaiting-textures'; this.record('renderer-restored', snapshot);
    }
    if ((this.state === 'restored-awaiting-textures' || this.state === 'lost') && snapshot.recoveries > this.initialRecovery
      && snapshot.generatedTextures.generated > this.initialGeneration && snapshot.generatedTextures.cached > 0 && !snapshot.contextLost) {
      this.state = 'regenerated'; this.record('projectile-textures-regenerated', snapshot);
    }
    this.previousLost = snapshot.contextLost; this.previousRecovery = snapshot.recoveries;
  }
}
export class FiniteFixtureLoop {
  running = false; completed = 0;
  private since = 0;
  constructor(readonly total: number, readonly dwellMs = 1200) {}
  start(now: number): void { this.running = true; this.completed = 0; this.since = now - this.dwellMs; }
  stop(): void { this.running = false; }
  /** Advance only once per displayed interval, never claim unrendered background steps. */
  advance(now: number): number | undefined {
    if (!this.running || now - this.since < this.dwellMs) return undefined;
    if (this.completed >= this.total) { this.running = false; return undefined; }
    this.since = now; return this.completed++;
  }
}
