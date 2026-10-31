import { World } from '../world/world.ts';
import { Player } from '../actors/player.ts';
import { Pet } from '../actors/pet.ts';
import { WeatherSystem } from '../encounters/weather.ts';
import { CometDisaster } from '../encounters/comet.ts';
import { ItemPassives } from '../combat/item-passives.ts';
import { MovementPilot } from '../ai/movement.ts';
import { applyAiWaveGrowth, applyTeammateLevel } from '../ai/assistance.ts';
import { rollSkill, type AiSkillId } from '../ai/skills.ts';
import { createRetaliation } from '../abilities/retaliation.ts';
import { CHARACTERS } from '../content/characters.ts';
import { backgroundForWave, backgroundForBossWave } from '../content/backgrounds.ts';
import { BOSS_BANNED_BACKGROUNDS } from '../content/terrain.ts';
import { BOSS_VARIANTS, pickBossForWave } from '../content/enemies.ts';
import { enterChallenge, leaveChallenge } from './challenge-entry.ts';
import { ENCOUNTER_ARENAS } from '../encounters/arenas.ts';
import { ruleBudget, type GamePlatform } from '../platform.ts';
import type { RNG } from '../math/random.ts';
import type { InputFrame, RunOptions } from '../commands.ts';
import type { RuleEffects } from '../world/effects-port.ts';
import type { ChallengeKind, ChallengeResult, ChallengeSession } from '../encounters/types.ts';
import type { WaveStartRulesSave } from '../save/types.ts';
import type { Point } from '../views.ts';
import type { RunControl } from '../control.ts';

export const BATTLE_STEP = 1 / 60;
export interface BattleOptions {
  rng: RNG;
  backgroundId?: string;
  options: RunOptions;
  platform: GamePlatform;
  effects: RuleEffects;
  control: RunControl;
}
export type BattleAdvance =
  | { kind: 'challenge'; result: ChallengeResult | null; refresh: boolean }
  | { kind: 'defeat' | 'upgrade' | 'wave-finished' }
  | { kind: 'running'; refresh: boolean };
export interface AiProfile { id: number; skill: AiSkillId; rngState: number }

const axis = (x: number, y: number): Point => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const length = Math.max(1, Math.hypot(x, y));
  return { x: x / length, y: y / length };
};
const adapter = (move: Point, slow: boolean) => ({
  moveAxis: () => move,
  isDown: (code: string) => slow && ['ShiftLeft', 'ShiftRight'].includes(code),
  p2SkillSlow: () => slow,
});

/** Owns combat time, combatants and the complete ordered simulation step. */
export class Battle {
  readonly world: World & { pet: Pet };
  readonly player: Player;
  readonly weather: WeatherSystem;
  readonly comet: CometDisaster;
  readonly itemPassives: ItemPassives;
  readonly pilots = new Map<number, MovementPilot>();
  readonly viewport = { viewW: 1280, viewH: 720, cx: 0, cy: 0 };
  tick = 0;
  time = 0;
  waveIndex = 0;
  waveElapsed = 0;
  waveDuration = 30;
  shakeStrength = 0;
  backgroundId: string;
  private challenge: ChallengeSession | null = null;
  private pendingChallenge: ChallengeResult | null = null;
  private bossKillPending = false;
  private readonly rng: RNG;
  private readonly effects: RuleEffects;
  private readonly platform: GamePlatform;
  private readonly control: RunControl;

  constructor({ rng, options, platform, effects, control, backgroundId = 'plaza' }: BattleOptions) {
    this.rng = rng;
    this.backgroundId = backgroundId;
    this.effects = effects;
    this.platform = platform;
    this.control = control;
    this.itemPassives = new ItemPassives(rng);
    const budget = ruleBudget(platform);
    const world = new World(rng, { effects, enemyLimit: budget.enemyLimit, effectLimit: budget.effectLimit });
    world.waves.setDifficulty(options.difficulty);
    this.weather = new WeatherSystem(rng, { platform }); world.weather = this.weather;
    this.comet = new CometDisaster({ rng, effects }); world.comet = this.comet;
    const characterId = options.randomParty ? rng.pick(CHARACTERS)!.id : options.characterId;
    this.player = this.buildPlayer(characterId, 1, world);
    world.player = this.player;
    const positions = [[60, 40], [-60, 40], [60, -40]];
    for (let slot = 2; slot <= options.partySize; slot++) {
      const taken = world.players().map(player => player.characterId);
      const definition = rng.pick(CHARACTERS.filter(character => !taken.includes(character.id)))!;
      const teammate = this.buildPlayer(definition.id, slot, world);
      [teammate.x, teammate.y] = positions[slot - 2];
      this.attachTeammate(teammate, world);
    }
    for (const player of world.players()) player.duoMode = options.partySize > 1;
    const pet = new Pet('kitten', this.player);
    world.pet = pet;
    this.world = Object.assign(world, { pet });
    world.onBossSettled = () => {
      this.bossKillPending = !world.enemies.items.some(enemy => enemy.boss && !enemy.dead);
    };
  }

  get encounter(): ChallengeSession | null { return this.challenge; }

  /** Initial run setup calls this after the shop has configured its buyers. */
  prepareBossRoster() {
    for (const [wave, { ranged }] of Object.entries(BOSS_VARIANTS)) {
      const selected = pickBossForWave(Number(wave), this.rng);
      if (selected && selected !== ranged) this.world.waves.setBossChoice(ranged, selected);
    }
  }

  private buildPlayer(characterId: string, id: number, world: World): Player {
    const player = new Player(characterId, this.rng, this.effects);
    player.id = id; player.world = world;
    player.onHurt = createRetaliation(player, {
      nearby: (x, y, radius) => world.grid.query(x, y, radius, []),
      damage: (target, amount) => { world.dealDamage(player, null, target, amount, { thorns: true }); },
      ring: (x, y, radius, color, duration) => world.fx.ring(x, y, radius, color, duration, { player: true }),
    });
    return player;
  }

  private attachTeammate(player: Player, world: World = this.world) {
    if (player.id === 2) world.player2 = player;
    else if (player.id === 3) world.player3 = player;
    else if (player.id === 4) world.player4 = player;
    else throw new RangeError('A teammate must occupy slot 2, 3 or 4');
  }

  /** Restored parties are assembled before profiles and wave-entry state are restored. */
  restoreTeammate(state: ReturnType<Player['captureState']>, id: number): Player {
    const player = this.buildPlayer(state.characterId, id, this.world);
    player.restoreState(state);
    this.attachTeammate(player);
    return player;
  }

  bindPilots(profiles: readonly AiProfile[] = []) {
    this.pilots.clear();
    for (const player of this.world.players()) {
      const teammate = player !== this.player;
      const rng = this.rng.fork(player.id + 100);
      const profile = profiles.find(entry => entry.id === player.id);
      const skill = profile?.skill ?? (teammate ? rollSkill(() => rng.next()) : 'pro');
      if (profile && Number.isInteger(profile.rngState)) rng.state = profile.rngState;
      this.pilots.set(player.id, new MovementPilot(rng, { skill, teammate }));
    }
  }

  captureAiProfiles(): AiProfile[] {
    return [...this.pilots].map(([id, pilot]) => pilot.captureState(id));
  }

  enterWave(index: number, endless: boolean) {
    this.waveIndex = index; this.waveElapsed = 0; this.bossKillPending = false;
    const entry: WaveStartRulesSave = {
      systems: { weather: this.weather.captureState(), comet: this.comet.captureState() },
      rngState: this.rng.state, backgroundId: this.backgroundId, ...this.world.waves.captureRules(),
    };
    this.comet.roll(index + 1, this.rng);
    this.itemPassives.beginWave();
    const rewards = this.world.pendingItemRewards;
    if (rewards.length > 12) {
      const sold = rewards.splice(0, rewards.length - 12);
      this.player.gainMaterials(sold.reduce((sum, item) => sum + (item.sellValue ?? 4), 0));
    }
    const world: World = this.world;
    const current = world.waves.begin(index, endless);
    this.waveDuration = current.duration;
    for (const player of world.players()) player.charRt.onRoundStart();
    const config = current.config;
    const bossWave = !!(config.boss || config.bosses?.length);
    const backgroundId = bossWave
      ? backgroundForBossWave(index, this.backgroundId, BOSS_BANNED_BACKGROUNDS)
      : backgroundForWave(index, this.backgroundId);
    if (backgroundId === null) throw new TypeError('Background catalog must contain a playable scene');
    this.backgroundId = backgroundId;
    world.setTerrain(backgroundId);
    if (world.terrain.maze) {
      const chest = world.terrain.maze.chest;
      world.waves.spawnChest(this.player, { x: chest.x, y: chest.y });
    }
    this.world.pet.x = this.player.x + 40; this.world.pet.y = this.player.y + 20;
    return { rules: entry, bossWave };
  }

  enterChallenge(kind: ChallengeKind, chain: boolean) {
    if (this.challenge) this.leaveChallenge();
    this.pendingChallenge = null;
    this.comet.onWaveEnd();
    const arena = ENCOUNTER_ARENAS[kind];
    this.viewport.cx = arena.cx; this.viewport.cy = arena.cy;
    const players = this.world.players();
    for (const [index, player] of players.entries()) {
      player.x = arena.cx + (index - (players.length - 1) / 2) * 50;
      player.y = arena.cy + arena.hh * 0.55;
    }
    const entry = { pet: this.world.pet.captureState(), rngState: this.rng.state };
    this.challenge = enterChallenge(kind, {
      world: this.world, player: this.player, rng: this.rng, effects: this.effects,
      chain, platform: this.platform, viewport: this.viewport,
      onDone: result => { this.pendingChallenge = result; },
    });
    return entry;
  }

  leaveChallenge() {
    if (!this.challenge) return;
    leaveChallenge(this.challenge, this.world);
    this.challenge = null;
  }

  shake(strength: number) { this.shakeStrength = Math.max(this.shakeStrength, strength); }

  setViewport(width: number, height: number) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    this.viewport.viewW = width; this.viewport.viewH = height;
  }

  advance(input: InputFrame): BattleAdvance {
    this.tick++; this.time += BATTLE_STEP;
    const challenge = this.challenge;
    if (input.displaySeconds !== undefined) challenge?.displayTiming?.sample(input.displaySeconds);
    const dt = BATTLE_STEP * (challenge?.timeScale ?? 1);
    const cometFreeze = !challenge && this.comet.update(BATTLE_STEP, {
      world: this.world, rng: this.rng,
      speak: text => this.effects.emit({ type: 'speech', text, key: 'comet-warning' }),
    });
    this.world.spawnPaused = !!cometFreeze; this.world.enemyFrozen = !!cometFreeze;
    if (!challenge && !cometFreeze) this.waveElapsed += BATTLE_STEP;
    const arena = challenge?.arena;
    this.viewport.cx = arena?.cx ?? this.player.x;
    this.viewport.cy = arena?.cy ?? this.player.y;
    const worldScale = challenge ? 1 : this.itemPassives.beforeActors(BATTLE_STEP, this.world, this.waveIndex, this.viewport);
    if ((input.clear || input.p2Clear) && challenge) challenge.purge?.manual();
    this.shakeStrength *= 0.9;
    this.control.applyAssistance(this.player, this.world.players().length === 1, this.waveIndex, BATTLE_STEP);
    for (const player of this.world.players()) {
      const main = player === this.player;
      const secondHuman = player.id === 2 && (input.p2MoveX || input.p2MoveY);
      const ai = main ? this.control.enabled : !secondHuman;
      if (ai) {
        if (!player.dead && !player.downed) {
          applyAiWaveGrowth(player, this.waveIndex);
        }
        const pilot = this.pilots.get(player.id);
        if (!pilot) throw new TypeError('Combat requires a pilot for each player');
        const intent = pilot.decide({ world: this.world, player, party: this.world.players().length > 1 });
        if (intent.clear) challenge?.purge?.manual();
        player.agentMoveTarget = intent.target;
        if (intent.rescueTargetId != null) {
          const target = this.world.players().find(actor => actor.id === intent.rescueTargetId);
          if (target?.downed && Math.hypot(target.x - player.x, target.y - player.y) < 60) target.rescueHit();
        }
      } else player.agentMoveTarget = null;
      if (!main && !player.dead && !player.downed) while (player.pendingLevelUps > 0) applyTeammateLevel(player);
      player.aimAt = main && input.manualAim && Number.isFinite(input.aimX) && Number.isFinite(input.aimY)
        ? { x: input.aimX, y: input.aimY } : null;
      const move = main ? axis(input.moveX, input.moveY) : secondHuman ? axis(input.p2MoveX, input.p2MoveY) : { x: 0, y: 0 };
      player.update(cometFreeze ? 0 : dt, adapter(move, main ? input.slow : input.p2Slow), this.world);
    }
    if (!challenge) this.itemPassives.afterActors(BATTLE_STEP, this.world);
    this.weather.update(dt, this.world, this.player);
    if (this.weather.justStarted) {
      this.weather.justStarted = false;
      if (this.weather.def?.say) this.effects.emit({ type: 'speech', text: this.weather.def.say, key: `weather:${this.weather.id}` });
    }
    this.world.update(dt * worldScale, this.player, challenge ? 0 : this.waveElapsed);
    if (challenge) {
      for (const player of this.world.players()) {
        const minX = challenge.arena.cx - challenge.arena.hw, maxX = challenge.arena.cx + challenge.arena.hw;
        const minY = challenge.arena.cy - challenge.arena.hh, maxY = challenge.arena.cy + challenge.arena.hh;
        const x = Math.max(minX, Math.min(maxX, player.x)), y = Math.max(minY, Math.min(maxY, player.y));
        if (challenge.kind === 'flandre' && player === this.player) {
          player.wallFlash = Math.max(0, (player.wallFlash ?? 0) - dt);
          if (x !== player.x || y !== player.y || player.x <= minX + .5 || player.x >= maxX - .5
            || player.y <= minY + .5 || player.y >= maxY - .5) player.wallFlash = .45;
        }
        player.x = x; player.y = y;
      }
      challenge.advance(BATTLE_STEP);
      const result = this.pendingChallenge;
      this.pendingChallenge = null;
      return { kind: 'challenge', result, refresh: this.tick % 6 === 0 };
    }
    if (this.world.players().every(player => player.dead || player.downed)) return { kind: 'defeat' };
    if (this.player.pendingLevelUps > 0) return { kind: 'upgrade' };
    if (this.bossKillPending || this.waveElapsed >= this.waveDuration) return { kind: 'wave-finished' };
    return { kind: 'running', refresh: this.tick % 6 === 0 };
  }
}
