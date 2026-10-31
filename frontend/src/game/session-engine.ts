import type { GameDisplayBuffer } from './display-frame.ts';
import type { GameFrameBuffer } from './frame-buffer.ts';
import { Battle, BATTLE_STEP } from './battle/battle.ts';
import { RunProgression } from './run/run-progression.ts';
import type { SessionOptions } from './session.ts';
import { ruleBudget, type GamePlatform } from './platform.ts';
import type { GameMeta } from './save/meta.ts';
import type { GameUiSnapshot } from './views.ts';
import type { GameEvent, StepResult } from './events.ts';
import type { GameCommand, CommandResult, InputFrame, RunOptions, DifficultyId } from './commands.ts';
import type { ChallengeKind, ChallengeResult } from './encounters/types.ts';
import type { GameSaveData } from './save/types.ts';
import type { RuleEffects } from './world/effects-port.ts';
import type { NarrativeContext, NarrativeEvent } from './narration.ts';
import { RunEconomy } from './progression/run-economy.ts';
export type ActiveSession = SessionEngine & { battle: Battle; economy: RunEconomy & { market: Shop } };
import { ENCOUNTER_ARENAS } from './encounters/arenas.ts';
import { RNG } from './math/random.ts';
import type { Player } from './actors/player.ts';
import type { Shop } from './progression/shop.ts';
import { CHARACTERS } from './content/characters.ts';
import { rollUpgrades } from './content/upgrades.ts';
import { DIFFICULTY_ORDER, getDifficulty } from './content/difficulty.ts';
import { getEnemy } from './content/enemies.ts';
import { chooseUpgrade } from './ai/decisions.ts';
import { RunControl } from './control.ts';
import { projectFrame, projectDisplay, projectUi } from './projection.ts';
import { settleWave } from './progression/wave-settlement.ts';
import { RunArchive, type RunSnapshotContext } from './save/run-archive.ts';
import { isCombatPhase } from './phases.ts';
import { decodeSave } from './save/schema.ts';
import { createEmptyMeta, decodeMeta } from './save/meta.ts';
import { GameNarration } from './narration.ts';
import { settleChallenge } from './progression/challenge-settlement.ts';

/** Owns one rule session. Rendering and external adapters only use its public facade. */
export class SessionEngine {
  private readonly displayIds=new WeakMap<object,number>();
  private nextDisplayId=1;
  displayIdentity(entity:object):string {
    let id=this.displayIds.get(entity);
    if(id===undefined){id=this.nextDisplayId++;this.displayIds.set(entity,id);}
    return `phantom-display-${id}`;
  }
  readonly platform: GamePlatform;
  readonly run = new RunProgression();
  battle: Battle | null = null;
  readonly economy = new RunEconomy();
  difficulty: DifficultyId = 'normal';
  private readonly hasExternalMeta: boolean;
  meta: GameMeta;
  lastWaveIncome: ReturnType<typeof settleWave> | null = null;
  rng = new RNG(1);
  events: GameEvent[] = [];
  readonly archive = new RunArchive();
  readonly control = new RunControl();
  uiCache: GameUiSnapshot | null = null;
  effects: RuleEffects;
  narration: GameNarration;
  revision = 0;
  get pilotEnabled() { return this.control.enabled; }
  private viewSize = { width: 1280, height: 720 };

  requireRun(): asserts this is ActiveSession {
    if (!this.battle || !this.economy.market) throw new TypeError('An active run is required');
  }

  constructor({ save, meta, platform = 'desktop' }: SessionOptions = {}) {
    ruleBudget(platform);
    this.platform = platform;
    this.hasExternalMeta = meta != null;
    this.meta = meta == null ? createEmptyMeta() : decodeMeta(meta);
    this.effects = { emit: event => {
      if (event.type === 'camera-shake') this.battle?.shake(event.strength);
      else this.events.push(event);
    } };
    this.narration = new GameNarration(event => this.events.push(event), this.rng.fork(0x6e617272));
    if (save != null) this.restore(decodeSave(save));
    else this.events.push({ type: 'music', scene: 'title' });
  }

  changed() { this.revision++; this.uiCache = null; }
  sound(name: string) { this.events.push({ type: 'sound', name }); }
  notice(text: string, tone: 'info' | 'good' | 'bad' = 'info') { this.events.push({ type: 'notice', text, tone }); }
  start(options: RunOptions, { restoring = false } = {}): CommandResult {
    if (!CHARACTERS.some(c => c.id === options.characterId)
      || !DIFFICULTY_ORDER.includes(options.difficulty)
      || ![1, 2, 3, 4].includes(options.partySize)
      || (options.randomParty != null && typeof options.randomParty !== 'boolean')
      || (options.seed != null && !Number.isFinite(options.seed))) return { ok: false, reason: '无效的开局选项' };
    if (this.battle) this.control.endAttempt(this.battle.player, false);
    this.battle?.leaveChallenge();
    this.events = [];
    this.rng = new RNG(options.seed ?? 1);
    this.narration.beginAttempt(this.rng.fork(0x6e617272));
    this.run.start(); this.meta.retries = 0; this.meta.manualRetries = 0;
    this.lastWaveIncome = null; this.difficulty = options.difficulty;
    const previousShake = this.battle?.shakeStrength ?? 0;
    const previousCenter = { x: this.battle?.viewport.cx ?? 0, y: this.battle?.viewport.cy ?? 0 };
    this.battle = new Battle({ rng: this.rng, options, platform: this.platform,
      effects: this.effects, backgroundId: this.battle?.backgroundId, control: this.control });
    this.battle.shakeStrength = previousShake;
    this.battle.viewport.cx = previousCenter.x; this.battle.viewport.cy = previousCenter.y;
    this.battle.setViewport(this.viewSize.width, this.viewSize.height);
    const world = this.battle.world;
    this.economy.beginAttempt(this.rng, this.difficulty, {
      players: () => world.players(), rewards: () => world.pendingItemRewards,
    });
    this.battle.prepareBossRoster();
    this.control.begin(!!options.pilot);
    this.requireRun();
    this.bindWorld(); this.battle.bindPilots(); this.beginWave(0, { silentNarrative: restoring });
    if (!restoring) {
      this.sound('gameStart');
      this.report('run_start', {}, 'run-start');
      if (options.partySize > 1) {
        const names = this.battle.world.partners().map(player => player.char.name);
        const text = options.partySize === 2
          ? this.pilotEnabled ? `两只猫娘上场：${this.battle.player.char.name} 和 ${names[0]}，看戏吧喵～` : ` duo 开局！${names[0]} 也来帮忙了喵～`
          : `${options.partySize} 人小队开局！猫娘阵容：${names.join('、')}，看我们的喵～`;
        this.narration.speak(text, 'party:start');
      }
      if (this.pilotEnabled) this.narration.pilot(true);
    }
    return { ok: true };
  }

  bindWorld() {
    this.requireRun();
    const world = this.battle.world;
    world.onWeaponFire = (definition, heavy) => this.events.push({ type: 'weapon-sound', kind: definition.kind, behavior: definition.behavior, tier: definition.tier, heavy: !!heavy });
    world.onEnemyKilled = enemy => { if (!enemy.boss) this.sound(enemy.elite ? 'explode' : 'kill'); };
    world.onPickup = pickup => this.sound(pickup.type === 'xp' ? 'pickupXp' : pickup.type === 'heal' ? 'heal' : 'pickupMat');
    world.onPlayerHit = () => this.sound('hurt');
    world.onPetHeal = () => this.sound('heal');
    world.onPetSay = (_pet, text, kind) => this.narration.pet(text, kind);
    world.onBossPhase = (boss, phase) => {
      this.notice(`${boss.def.name}进入第${phase}阶段`, 'bad');
      this.report('boss_phase', { bossName: boss.def.name, phase }, `wave:${this.battle.waveIndex}:boss:${boss.id}:phase:${phase}`);
    };
    world.onBossKilled = boss => {
      this.report('boss_kill', { bossName: boss.def?.name }, `wave:${this.battle.waveIndex}:boss:${boss.id}:killed`);
      this.sound('bossKill');
    };
  }

  beginWave(index: number, { snapshot = true, silentNarrative = false } = {}) {
    this.requireRun();
    const { rules, bossWave } = this.battle.enterWave(index, this.run.read().endless);
    this.archive.recordWave(rules);
    this.run.beginWave();
    this.economy.ensureWeaponIds();
    if (snapshot) this.archive.markCheckpoint(this.snapshotContext(), 'playing');
    this.events.push({ type: 'music', scene: bossWave ? 'boss' : 'stage', wave: index + 1 });
    this.events.push({ type: 'checkpoint' });
    if (!silentNarrative) this.announceWave();
    this.changed();
  }

  openUpgrade(after: 'playing' | 'shop' = 'playing') {
    this.requireRun();
    const options = rollUpgrades(this.rng, this.battle.player.upgradesTaken, 3, {
      level: this.battle.player.level, luck: this.battle.player.stats.values.luck,
      luckEffectMul: this.battle.player.stats.luckEffectMul ?? 1,
    });
    const phase = this.run.openUpgrade(options, after);
    if (phase !== 'upgrade') {
      this.battle.player.pendingLevelUps = 0;
      if (phase === 'shop') this.openShop();
      return;
    }
    this.changed();
  }

  openShop({ preserve = false } = {}) {
    this.requireRun();
    if (this.battle.player.pendingLevelUps > 0) { this.openUpgrade('shop'); return; }
    this.run.openShop();
    const stolen = this.economy.open(this.battle.waveIndex, preserve);
    if (stolen) {
      this.battle.world.pet.stealAnim = 4; this.battle.world.pet.sayFreeItem(this.battle.world);
      this.sound('buy'); this.notice(`小小猫娘帮你拿了${stolen}道具`, 'good');
    }
    this.events.push({ type: 'music', scene: 'shop' }, { type: 'checkpoint' });
    this.changed();
    // Teammates use exactly the purchase validation used by the UI.
    if (!preserve) this.battle.world.partners().forEach((mate, index) => this.shopAi(mate, index + 1));
  }

  shopAi(player: Player, slotIndex: number) {
    this.requireRun();
    this.economy.runAi(player, slotIndex, this.battle.waveIndex, command => this.dispatch({ ...command, revision: this.revision }));
  }

  finishWave() {
    this.requireRun();
    this.battle.comet.onWaveEnd();
    this.lastWaveIncome = settleWave(this.battle.world, this.battle.waveIndex, this.battle.world.enemies.items.some(enemy => enemy.boss && !enemy.dead));
    this.sound('waveClear');
    this.events.push({ type: 'report', event: 'wave_clear', text: `完成第${this.battle.waveIndex + 1}波` });
    const next = this.run.nextAfterWave(this.battle.waveIndex, this.difficulty);
    if (next === 'shop') this.openShop();
    else if (next === 'flandre' || next === 'vergil') this.startChallenge(next);
    else if (next === 'endless-prompt') this.enterEndlessPrompt();
  }

  endRun(won: boolean, quit = false) {
    this.requireRun();
    if (this.run.phase === 'result') return;
    this.battle.leaveChallenge(); this.battle.comet.stopBgm();
    this.meta.bestWave = Math.max(this.meta.bestWave, this.battle.waveIndex + 1);
    this.meta.totalKills += this.battle.player.kills; this.meta.runs++;
    if (won) this.meta.wins++;
    this.run.end(won, quit);
    if (!quit) { this.sound(won ? 'win' : 'death'); this.report(won ? 'win' : 'death', {}, 'run-result'); }
    this.control.endAttempt(this.battle.player, this.pilotEnabled && !won && !quit);
    this.events.push({ type: 'run-ended', won, wave: this.battle.waveIndex + 1 }, { type: 'music', scene: 'result' });
    this.changed();
  }

  dispatch(command: GameCommand): CommandResult {
    if (command.type === 'start-run') return this.start(command.options);
    if (command.type === 'start-challenge') {
      if (typeof command.challenge !== 'string' || !Object.hasOwn(ENCOUNTER_ARENAS, command.challenge)) return { ok: false, reason: '未知挑战' };
      const result = this.start(command.options);
      if (!result.ok) return result;
      this.requireRun();
      for (let i = 0; i < (command.challenge === 'vergil' ? 1 : 3); i++) this.battle.player.addWeapon('meow_cannon');
      if (command.challenge === 'vergil') this.battle.player.addWeapon('star_wand');
      else {
        this.battle.player.charMul = { ...this.battle.player.charMul, damage: 5 };
        for (const item of ['cat_taffy', 'warm_milk', 'warm_milk'] as const) this.battle.player.addItem(item);
      }
      this.economy.ensureWeaponIds(); this.startChallenge(command.challenge, false, true);
      return { ok: true };
    }
    if (command.type === 'abandon-run') {
      if (!this.battle || !this.run.canAbandon()) return { ok: false, reason: '当前没有可放弃的对局' };
      this.endRun(false, true); return { ok: true };
    }
    if (command.type === 'return-title') {
      if (this.battle) { this.archive.archive(this.exportSave()); this.control.endAttempt(this.battle.player, false); }
      this.battle?.leaveChallenge(); this.battle?.comet.stopBgm();
      this.events.push({ type: 'music', scene: 'title' });
      this.run.returnTitle(); this.changed(); return { ok: true };
    }
    if (command.type === 'pause' && this.battle && this.run.pause()) {
      this.changed(); return { ok: true };
    }
    if (command.type === 'resume' && this.run.resume()) {
      this.changed(); return { ok: true };
    }
    if (command.type === 'retry-wave' && !this.run.read().outcome.abandoned && this.archive.checkpoint && this.battle) return this.retryWave(false);
    if (!this.battle || this.run.phase === 'title') return { ok: false, reason: '当前没有对局' };
    this.requireRun();
    if (command.type === 'auto-upgrade' && this.run.phase === 'upgrade') {
      const best = Math.max(...this.run.read().upgrade.options.map(option => option.mult ?? 1));
      const choice = this.rng.pick(this.run.read().upgrade.options.filter(option => (option.mult ?? 1) === best));
      return this.dispatch({ type: 'choose-upgrade', optionId: choice!.id, revision: this.revision });
    }
    if (command.type === 'set-auto-upgrade') {
      this.run.setAutoUpgrade(command.enabled); this.changed(); return { ok: true };
    }
    if (command.type === 'set-pilot') {
      if (!this.run.canAbandon()) return { ok: false, reason: '当前阶段不能切换代打' };
      if (this.control.change(command.enabled, this.battle.player)) {
        this.narration.pilot(command.enabled);
        this.events.push({ type: 'checkpoint' });
        this.changed();
      }
      return { ok: true };
    }
    if (command.type === 'finish-run' && this.run.phase === 'endless-prompt') {
      this.endRun(true); return { ok: true };
    }
    if (command.type === 'continue-endless' && this.run.phase === 'endless-prompt') {
      this.run.continueEndless(); this.openShop(); return { ok: true };
    }
    if (command.type === 'next-wave' && this.run.phase === 'shop') {
      this.sound('click'); this.beginWave(this.battle.waveIndex + 1); return { ok: true };
    }
    if ('revision' in command && command.revision !== this.revision) { this.sound('error'); return { ok: false, reason: '界面数据已过期，请重试' }; }
    if (command.type === 'choose-upgrade' && this.run.phase === 'upgrade') {
      const choice = this.run.read().upgrade.options.find(option => option.id === command.optionId);
      if (!choice) return { ok: false, reason: '升级选项不存在' };
      this.battle.player.applyUpgrade(choice); this.battle.player.pendingLevelUps--;
      this.sound('levelUp');
      this.report('level_up', { upgradeName: choice.rarity !== 'common' ? `${choice.rarityName}·${choice.name}` : choice.name });
      if (this.battle.player.pendingLevelUps > 0) this.openUpgrade(this.run.read().upgrade.after);
      else if (this.run.completeUpgrade() === 'shop') this.openShop();
      else this.changed();
      return { ok: true };
    }
    if (this.run.phase !== 'shop') return { ok: false, reason: '当前阶段不允许此操作' };
    const receipt = this.economy.execute(command);
    if (!receipt.ok) { this.sound('error'); return receipt; }
    if (receipt.combo) this.report('weapon_combo', { weaponName: receipt.weaponName }, undefined, receipt.player);
    this.economy.ensureWeaponIds(); this.changed();
    this.sound(command.type === 'combine' || receipt.combined ? 'combine' : command.type === 'reroll' ? 'reroll' : command.type === 'toggle-lock' ? 'lock' : 'buy');
    if (receipt.autoReroll) this.sound('reroll');
    this.events.push({ type: 'checkpoint' });
    return { ok: true };
  }

  /** Output already committed by a command; draining never advances gameplay. */
  drainEvents(): readonly GameEvent[] { const events = this.events; this.events = []; return events; }

  advance(input: InputFrame): StepResult {
    const before = this.revision;
    this.narration.advance(BATTLE_STEP);
    if (this.battle && this.run.phase !== 'title') {
      this.requireRun();
      if (isCombatPhase(this.run.phase)) {
        const result = this.battle.advance(input);
        if (result.kind === 'challenge') {
          if (result.result) this.finishChallenge(result.result);
          if (result.refresh) this.changed();
        } else if (result.kind === 'defeat') this.endRun(false);
        else if (result.kind === 'upgrade') this.openUpgrade();
        else if (result.kind === 'wave-finished') this.finishWave();
        else if (result.kind === 'running') {
          this.narration.health(this.narrativeContext(), this.pilotEnabled);
          if (result.refresh) this.changed();
        }
      } else {
        const action = this.run.menuAction(this.pilotEnabled, !!this.archive.checkpoint, this.battle.waveIndex);
        if (action === 'auto-upgrade') this.dispatch({ type: 'auto-upgrade' });
        else if (action === 'upgrade') {
          const options = this.run.read().upgrade.options;
          const index = chooseUpgrade(options, this.battle.player, this.battle.waveIndex);
          if (index != null) this.dispatch({ type: 'choose-upgrade', optionId: options[index].id, revision: this.revision });
        } else if (action === 'retry') this.retryWave(true);
        else if (action === 'retire-pilot') {
          this.control.endAttempt(this.battle.player, false); this.narration.pilot(false);
          this.notice('本波已重试5次，猫娘把控制权交还给你', 'bad'); this.changed();
        } else if (action === 'continue-endless') this.dispatch({ type: 'continue-endless' });
        else if (action === 'shop') {
          this.shopAi(this.battle.player, 0); this.dispatch({ type: 'next-wave' });
        }
      }
    }
    const events = this.drainEvents();
    return { events, uiChanged: this.revision !== before };
  }

  private snapshotContext(): RunSnapshotContext {
    this.requireRun();
    return { battle: this.battle, run: this.run, economy: this.economy, rng: this.rng,
      difficulty: this.difficulty, control: this.control };
  }
  exportSave() {
    if (!this.battle || this.run.phase === 'title') return this.archive.readArchived();
    return this.archive.export(this.snapshotContext(), this.getMeta());
  }
  restore(saved: Pick<GameSaveData, 'run' | 'checkpoint' | 'meta'>) {
    const data = saved.run;
    const meta = this.getMeta();
    const main = data.player;
    this.start({ characterId: main.characterId, difficulty: data.difficulty,
      partySize: 1, seed: data.seed, pilot: data.pilot }, { restoring: true });
    this.requireRun();
    this.meta = decodeMeta(this.hasExternalMeta ? meta : saved.meta ?? meta);
    this.control.restore(data);
    const target = this.archive.replayWave(data, this.snapshotContext());
    if (data.abandoned) this.control.endAttempt(this.battle.player, false);
    this.changed();
    if (target.phase === 'shop') this.openShop({ preserve: target.preserve });
    else if (target.phase === 'challenge') this.startChallenge(target.kind, target.chain, false);
    else if (target.phase === 'endless-prompt') this.run.enterEndlessPrompt();
    else if (target.phase === 'result') this.run.end(data.won, !!data.abandoned);
    else if (target.phase === 'upgrade') {
      if (target.options.length) this.run.openUpgrade(target.options, target.after);
      else this.openUpgrade(target.after);
    }
    this.archive.finishReplay(saved, this.snapshotContext());
    this.events = [{ type: 'checkpoint' }, { type: 'music', scene: this.run.phase === 'shop' ? 'shop' : this.run.phase === 'result' ? 'result' : 'stage', wave: this.battle.waveIndex + 1 }];
    if (this.run.phase === 'playing') this.announceWave();
    this.economy.ensureWeaponIds(); this.changed();
  }
  retryWave(fromAi: boolean): CommandResult {
    this.requireRun();
    const checkpoint = this.archive.checkpoint!;
    const history = this.run.captureRetry();
    const wave = this.battle.waveIndex;
    const pilotEnabled = this.pilotEnabled;
    this.restore({ run: checkpoint, checkpoint });
    // Automatic and manual retries both need a new external output lifetime.
    this.events.unshift({ type: 'attempt-restarted' });
    this.control.endAttempt(this.battle.player, pilotEnabled);
    this.run.retry(fromAi, wave, history);
    const retries = this.run.read().retries;
    this.meta.retries = retries.total; this.meta.manualRetries = retries.manual;
    this.report('run_start', {}, 'run-start');
    return { ok: true };
  }
  setViewport(width: number, height: number) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    this.viewSize = { width, height }; this.battle?.setViewport(width, height);
  }
  getMeta() { return structuredClone(this.meta); }
  startChallenge(kind: ChallengeKind, chain = false, snapshot = true) {
    this.requireRun();
    this.run.enterChallenge(kind, chain);
    const entry = this.battle.enterChallenge(kind, chain);
    this.archive.recordChallenge(entry);
    if (snapshot) this.archive.markCheckpoint(this.snapshotContext(), kind);
    this.events.push({ type: 'checkpoint' }); this.changed();
  }
  finishChallenge(result: ChallengeResult) {
    this.requireRun();
    this.battle.leaveChallenge();
    settleChallenge({ ...result, world: this.battle.world, player: this.battle.player, meta: this.meta });
    const next = this.run.nextAfterChallenge(result);
    this.events.push({ type: 'checkpoint' });
    if ('challenge' in next) this.startChallenge(next.challenge, next.chain);
    else if (next.phase === 'shop') this.openShop();
    else if (next.phase === 'endless-prompt') this.enterEndlessPrompt();
  }
  narrativeContext(extra: NarrativeContext = {}, player: Player | null = this.battle?.player ?? null): NarrativeContext {
    if (!player || !this.battle) throw new TypeError('Narrative requires a player');
    return { wave: this.battle.waveIndex + 1, hpRatio: player.hp / Math.max(1, player.maxHp),
      level: player.level, kills: player.kills, characterName: player.char?.name,
      weaponName: player.weapons[0]?.def?.name, difficultyName: getDifficulty(this.difficulty).name, ...extra };
  }
  report(event: NarrativeEvent, extra: NarrativeContext = {}, onceKey?: string, player: Player | null = this.battle?.player ?? null) {
    this.narration.report(event, this.narrativeContext(extra, player), this.pilotEnabled, onceKey);
  }
  announceWave() {
    this.requireRun();
    if (this.battle.waveIndex <= 0) return;
    this.sound('waveStart');
    const config = this.battle.world.waves.read().current?.config!;
    const bosses = config.bosses?.length ? config.bosses : config.boss ? [config.boss] : [];
    if (bosses.length) {
      this.sound('bossSpawn');
      const names = bosses.map(id => getEnemy(this.battle.world.waves.resolveBoss(id))?.name ?? id).join('、');
      this.report('boss_spawn', { bossName: bosses.length > 1 ? `${names}（共 ${bosses.length} 只）` : names }, `wave:${this.battle.waveIndex}:start`);
    }
    else this.report('wave_start', {}, `wave:${this.battle.waveIndex}:start`);
  }
  enterEndlessPrompt() {
    this.requireRun();
    if (!this.run.enterEndlessPrompt()) return;
    this.report('win', {}, 'campaign-win-prompt'); this.changed();
  }
  readDisplay(buffer:GameDisplayBuffer) { return projectDisplay(this,buffer); }
  readFrame(buffer?: GameFrameBuffer) { return projectFrame(this, buffer); }
  readUi() {
    if (!this.uiCache) this.uiCache = projectUi(this);
    return this.uiCache;
  }
}
