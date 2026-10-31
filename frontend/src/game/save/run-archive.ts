import type { Battle } from '../battle/battle.ts';
import type { RunProgression } from '../run/run-progression.ts';
import type { RunEconomy } from '../progression/run-economy.ts';
import type { RNG } from '../math/random.ts';
import type { DifficultyId } from '../commands.ts';
import type { GamePhase } from '../run/run-progression.ts';
import type { ChallengeKind } from '../encounters/types.ts';
import type { ScaledUpgrade } from '../content/definitions.ts';
import type { GameMeta } from './meta.ts';
import type { GameSaveData, RunSave, WaveStartRulesSave } from './types.ts';
import type { PetSave } from './pet-state.ts';
import { getUpgrade, scaleUpgrade } from '../content/upgrades.ts';
import { decodeSave, isSupportedSave } from './schema.ts';
import type { RunControl } from '../control.ts';

interface ReplayOwners { battle: Battle; run: RunProgression; economy: RunEconomy; rng: RNG }
export interface RunSnapshotContext extends ReplayOwners {
  difficulty: DifficultyId;
  control: RunControl;
}
export type ReplayTarget = { phase: 'shop'; preserve: boolean }
  | { phase: 'challenge'; kind: ChallengeKind; chain: boolean }
  | { phase: 'upgrade'; options: readonly ScaledUpgrade[]; after: 'playing' | 'shop' }
  | { phase: 'playing' | 'endless-prompt' | 'result' };

/** Owns entry snapshots and checkpoints, and reconstructs v2 entries through real subsystem owners. */
export class RunArchive {
  private wave: WaveStartRulesSave | undefined;
  private challenge: { pet: PetSave; rngState: number } | undefined;
  private checkpointData: RunSave | null = null;
  private titleSave: GameSaveData | null = null;
  get checkpoint(): RunSave | null { return this.checkpointData; }
  recordWave(entry: WaveStartRulesSave) { this.wave = entry; }
  recordChallenge(entry: { pet: PetSave; rngState: number }) { this.challenge = entry; }
  markCheckpoint(context: RunSnapshotContext, phase: GamePhase) { this.checkpointData = this.capture(context, phase); }
  archive(save: GameSaveData | null) { this.titleSave = save; }
  readArchived(): GameSaveData | null { return this.titleSave == null ? null : decodeSave(this.titleSave); }
  export(context: RunSnapshotContext, meta: GameMeta): GameSaveData {
    const snapshot: GameSaveData = { format: 'neko-survivors-react', version: 2,
      run: this.capture(context, context.run.savePhase), checkpoint: this.checkpointData, meta };
    if (!isSupportedSave(snapshot)) throw new TypeError('游戏内部进度状态不一致，无法生成保存数据');
    return structuredClone(snapshot);
  }
  private capture({ battle, run: progress, economy, rng, difficulty, control }: RunSnapshotContext, phase: GamePhase): RunSave {
    if (!this.wave || !economy.market) throw new TypeError('Run snapshot requires an initialized entry and market');
    const run = progress.read();
    return {
      seed: rng.seed, rngState: rng.state,
      waveStartRngState: this.wave.rngState, waveStartRules: structuredClone(this.wave),
      pet: battle.world.pet.captureState(), challengeStartPet: structuredClone(this.challenge?.pet),
      afterUpgrade: run.upgrade.after,
      upgradeOptions: run.upgrade.options.map(option => ({ id: option.id, rarity: option.rarity })),
      challengeStartRngState: this.challenge?.rngState, aiProfiles: battle.captureAiProfiles(),
      waveIndex: battle.waveIndex, difficulty, phase,
      player: battle.player.captureState(), mates: battle.world.partners().map(player => player.captureState()),
      ...battle.world.captureProgress(), endless: run.endless, won: run.outcome.won,
      ...(run.outcome.abandoned ? { abandoned: true } : {}),
      ...control.capture(),
      retries: run.retries.total, manualRetries: run.retries.manual, aiAttempts: run.aiAttempts.map(([wave, count]) => [wave, count]),
      vergilFought: run.vergilFought, autoUpgrade: run.autoUpgrade,
      challenge: battle.encounter?.kind ?? null, challengeChain: run.challenge.chain,
      backgroundId: battle.backgroundId,
      systems: { weather: battle.weather.captureState(), comet: battle.comet.captureState() }, cometFired: battle.comet.fired,
      shop: economy.market.captureState(),
    };
  }

  /** Called after the retained wave-zero bootstrap; presentation resumes the returned stage. */
  replayWave(data: RunSave, { battle, run, economy, rng }: ReplayOwners): ReplayTarget {
    if (!economy.market) throw new TypeError('Replay requires an initialized market');
    run.setAutoUpgrade(data.autoUpgrade);
    battle.player.restoreState(data.player);
    for (const [index, mate] of data.mates.entries()) battle.restoreTeammate(mate, index + 2);
    const players = battle.world.players();
    for (const player of players) player.duoMode = data.mates.length > 0;
    battle.world.restoreProgress(data);
    run.restoreHistory({ ...run.read(), endless: data.endless,
      outcome: { won: data.won, abandoned: !!data.abandoned },
      retries: { total: data.retries, manual: data.manualRetries }, aiAttempts: data.aiAttempts, vergilFought: data.vergilFought });
    economy.market.setBuyers(players);
    battle.bindPilots(data.aiProfiles);
    battle.backgroundId = data.waveStartRules.backgroundId;
    battle.world.waves.restoreRules(data.waveStartRules);
    battle.weather.restoreState(data.waveStartRules.systems.weather, players);
    battle.comet.restoreState(data.waveStartRules.systems.comet);
    rng.state = data.waveStartRngState;
    this.recordWave(battle.enterWave(data.waveIndex, data.endless).rules);
    run.beginWave(); economy.ensureWeaponIds();
    economy.market.restoreState(data.shop);
    if (data.phase === 'shop') return { phase: 'shop', preserve: data.shop.offers.length > 0 };
    if (data.challenge !== null) {
      if (data.challengeStartRngState !== undefined && Number.isInteger(data.challengeStartRngState)) rng.state = data.challengeStartRngState;
      battle.world.pet.restoreState(data.challengeStartPet ?? data.pet);
      return { phase: 'challenge', kind: data.challenge, chain: data.challengeChain };
    }
    if (data.phase === 'endless-prompt' || data.phase === 'result') return { phase: data.phase };
    if (battle.player.pendingLevelUps > 0) return { phase: 'upgrade', after: data.afterUpgrade,
      options: data.upgradeOptions.map(option => scaleUpgrade(getUpgrade(option.id)!, option.rarity)) };
    return { phase: 'playing' };
  }
  /** Live shop state is restored after menu effects; combat continues from entry state. */
  finishReplay(saved: Pick<GameSaveData, 'run' | 'checkpoint'>, context: RunSnapshotContext) {
    const data = saved.run, { battle, rng } = context;
    if (!data.challenge) battle.world.pet.restoreState(data.pet);
    if (data.phase === 'shop') {
      battle.weather.restoreState(data.systems.weather, battle.world.players());
      battle.comet.restoreState(data.systems.comet);
    }
    if (data.phase === 'shop' || data.phase === 'upgrade') rng.state = data.rngState;
    this.checkpointData = saved.checkpoint ?? this.capture(context, 'playing');
  }
}
