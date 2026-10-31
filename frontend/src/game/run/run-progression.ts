import type { DifficultyId, ScaledUpgrade } from '../content/definitions.ts';
import type { ChallengeKind, ChallengeResult } from '../encounters/types.ts';
import { WAVE_COUNT } from '../content/waves.ts';

export type UpgradeReturn = 'playing' | 'shop';
export interface UpgradeRoll {
  readonly options: readonly ScaledUpgrade[];
  readonly after: UpgradeReturn;
}
export interface ChallengeProgress {
  readonly kind: ChallengeKind | null;
  readonly chain: boolean;
}
export interface RunOutcome { readonly won: boolean; readonly abandoned: boolean }
export type ChallengeStage = { readonly phase: ChallengeKind; readonly context: ChallengeProgress };
export type PausableStage = { readonly phase: 'playing' | 'shop' }
  | { readonly phase: 'upgrade'; readonly roll: UpgradeRoll } | ChallengeStage;
export type RunStage = PausableStage | { readonly phase: 'title' | 'endless-prompt' }
  | { readonly phase: 'paused'; readonly resume: PausableStage }
  | { readonly phase: 'result'; readonly outcome: RunOutcome };
export type GamePhase = RunStage['phase'];
export interface RunProgressHistory {
  readonly upgrade: UpgradeRoll;
  readonly challenge: ChallengeProgress;
  readonly outcome: RunOutcome;
  readonly endless: boolean;
  readonly vergilFought: boolean;
  readonly autoUpgrade: boolean;
  readonly retries: { readonly total: number; readonly manual: number };
  readonly aiAttempts?: readonly (readonly [number, number])[];
}
export interface RunProgressSnapshot extends RunProgressHistory {
  readonly stage: RunStage;
  readonly aiAttempts: readonly (readonly [number, number])[];
}
export type ChallengeTransition = { readonly challenge: ChallengeKind; readonly chain: true }
  | { readonly phase: 'shop' | 'endless-prompt' };
export type WaveTransition = 'flandre' | 'vergil' | 'shop' | 'endless-prompt';
export type MenuAction = 'upgrade' | 'auto-upgrade' | 'retry' | 'retire-pilot' | 'continue-endless' | 'shop';

function pausable(stage: RunStage): stage is PausableStage {
  return stage.phase !== 'title' && stage.phase !== 'paused' && stage.phase !== 'result' && stage.phase !== 'endless-prompt';
}

/** Owns run flow and its history; it never mutates combat entities or spends currency. */
export class RunProgression {
  private current: RunStage = { phase: 'title' };
  private upgrade: UpgradeRoll = { options: [], after: 'playing' };
  private challenge: ChallengeProgress = { kind: null, chain: false };
  private outcome: RunOutcome = { won: false, abandoned: false };
  private endless = false;
  private vergilFought = false;
  private autoUpgrade = false;
  private retries = { total: 0, manual: 0 };
  private aiAttempts = new Map<number, number>();
  private aiAttemptSnapshot: readonly (readonly [number, number])[] | null = null;

  get phase(): GamePhase { return this.current.phase; }
  get savePhase(): Exclude<GamePhase, 'paused'> {
    return this.current.phase === 'paused' ? this.current.resume.phase : this.current.phase;
  }
  read(): RunProgressSnapshot {
    return { stage: this.current, upgrade: this.upgrade, challenge: this.challenge, outcome: this.outcome,
      endless: this.endless, vergilFought: this.vergilFought, autoUpgrade: this.autoUpgrade, retries: this.retries,
      aiAttempts: this.aiAttemptSnapshot ??= [...this.aiAttempts] };
  }

  /** A new run resets attempt facts; the last challenge chain remains observable across starts. */
  start() {
    this.current = { phase: 'playing' };
    this.upgrade = { options: [], after: 'playing' };
    this.outcome = { won: false, abandoned: false };
    this.endless = false; this.vergilFought = false; this.autoUpgrade = false;
    this.retries = { total: 0, manual: 0 }; this.aiAttempts = new Map(); this.aiAttemptSnapshot = null;
  }
  beginWave() {
    this.current = { phase: 'playing' };
    this.upgrade = { options: [], after: this.upgrade.after };
  }
  openUpgrade(options: readonly ScaledUpgrade[], after: UpgradeReturn = 'playing'): UpgradeReturn | 'upgrade' {
    this.upgrade = { options: [...options], after };
    if (!options.length) { this.current = { phase: after }; return after; }
    this.current = { phase: 'upgrade', roll: this.upgrade };
    return 'upgrade';
  }
  completeUpgrade(): UpgradeReturn {
    if (this.current.phase !== 'upgrade') throw new TypeError('Upgrade completion requires the upgrade stage');
    const after = this.current.roll.after;
    if (after === 'playing') this.upgrade = { options: [], after };
    this.current = { phase: after };
    return after;
  }
  openShop() { this.current = { phase: 'shop' }; }
  enterChallenge(kind: ChallengeKind, chain = false) {
    this.challenge = { kind, chain };
    if (kind === 'vergil') this.vergilFought = true;
    this.current = { phase: kind, context: this.challenge };
  }
  nextAfterChallenge(result: ChallengeResult): ChallengeTransition {
    if (this.current.phase !== result.kind) throw new TypeError('Challenge result must match the active challenge');
    const survived = result.outcome !== 'death';
    if (result.kind === 'flandre') return result.outcome === 'beat' ? { challenge: 'remilia', chain: true } : { phase: 'endless-prompt' };
    if (result.kind === 'remilia') return survived ? { challenge: 'halloween', chain: true } : { phase: 'shop' };
    if (result.kind === 'halloween') return { phase: this.challenge.chain ? 'endless-prompt' : 'shop' };
    return { phase: 'shop' };
  }
  nextAfterWave(waveIndex: number, difficulty: DifficultyId): WaveTransition {
    const reached = waveIndex + 1;
    if (reached >= WAVE_COUNT && !this.endless) return difficulty === 'nightmare' ? 'flandre' : 'endless-prompt';
    if (reached === 10 && difficulty === 'nightmare' && !this.vergilFought) return 'vergil';
    return 'shop';
  }
  enterEndlessPrompt(): boolean {
    if (this.current.phase === 'endless-prompt') return false;
    this.current = { phase: 'endless-prompt' }; return true;
  }
  continueEndless(): boolean {
    if (this.current.phase !== 'endless-prompt') return false;
    this.endless = true; return true;
  }
  end(won: boolean, abandoned = false): boolean {
    if (this.current.phase === 'result') return false;
    this.outcome = { won, abandoned };
    this.current = { phase: 'result', outcome: this.outcome }; return true;
  }
  returnTitle() { this.current = { phase: 'title' }; }
  pause(): boolean {
    if (!pausable(this.current)) return false;
    this.current = { phase: 'paused', resume: this.current }; return true;
  }
  resume(): boolean {
    if (this.current.phase !== 'paused') return false;
    this.current = this.current.resume; return true;
  }
  canAbandon(): boolean { return pausable(this.current) || this.current.phase === 'paused'; }
  setAutoUpgrade(enabled: boolean) { this.autoUpgrade = enabled; }

  /** Menu decisions expose intent; selection, economy and external effects remain with their owners. */
  menuAction(pilotEnabled: boolean, hasCheckpoint: boolean, waveIndex: number): MenuAction | null {
    if (this.current.phase === 'upgrade' && (pilotEnabled || this.autoUpgrade)) return this.autoUpgrade ? 'auto-upgrade' : 'upgrade';
    if (!pilotEnabled) return null;
    if (this.current.phase === 'result' && !this.outcome.won && !this.outcome.abandoned) {
      return hasCheckpoint && (this.aiAttempts.get(waveIndex) ?? 0) < 5 ? 'retry' : 'retire-pilot';
    }
    if (this.current.phase === 'endless-prompt') return 'continue-endless';
    return this.current.phase === 'shop' ? 'shop' : null;
  }
  /** Retry history survives checkpoint restoration, including the per-wave automatic retry budget. */
  captureRetry(): { readonly counts: RunProgressHistory['retries']; readonly aiAttempts: ReadonlyMap<number, number> } {
    return { counts: { ...this.retries }, aiAttempts: new Map(this.aiAttempts) };
  }
  retry(fromAi: boolean, waveIndex: number, history = this.captureRetry()) {
    this.retries = { total: history.counts.total + 1, manual: history.counts.manual + (fromAi ? 0 : 1) };
    this.aiAttempts = new Map(history.aiAttempts);
    if (fromAi) this.aiAttempts.set(waveIndex, (this.aiAttempts.get(waveIndex) ?? 0) + 1);
    this.aiAttemptSnapshot = null;
  }

  /** Restore owned facts without selecting an entry. Wire-save replay chooses which history survives. */
  restoreHistory(history: RunProgressHistory) {
    const copied = structuredClone(history);
    this.upgrade = copied.upgrade; this.challenge = copied.challenge; this.outcome = copied.outcome;
    this.endless = copied.endless; this.vergilFought = copied.vergilFought;
    this.autoUpgrade = copied.autoUpgrade; this.retries = copied.retries;
    this.aiAttempts = new Map(copied.aiAttempts ?? []); this.aiAttemptSnapshot = null;
    this.current = this.bindHistory(this.current);
  }
  private bindHistory(stage: RunStage): RunStage {
    if (stage.phase === 'paused') return { phase: 'paused', resume: this.bindPausable(stage.resume) };
    if (stage.phase === 'result') return { phase: 'result', outcome: this.outcome };
    return pausable(stage) ? this.bindPausable(stage) : { ...stage };
  }
  private bindPausable(stage: PausableStage): PausableStage {
    if (stage.phase === 'upgrade') return { phase: 'upgrade', roll: this.upgrade };
    if ('context' in stage) {
      if (this.challenge.kind !== stage.phase) throw new TypeError('Challenge history must match the active stage');
      return { phase: stage.phase, context: this.challenge };
    }
    return { ...stage };
  }
}
