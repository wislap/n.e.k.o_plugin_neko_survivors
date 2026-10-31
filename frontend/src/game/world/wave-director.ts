import type { CombatTarget } from '../combat/types.ts';
import type { DeathSettlement } from '../combat/death.ts';
import type { RNG } from '../math/random.ts';
import type { Player } from '../actors/player.ts';
import type { EnemyBody, EnemyScaling } from '../actors/enemy.ts';
import type { EntityList } from '../actors/entity.ts';
import type { FXSystem } from './effects.ts';
import type { Terrain } from './terrain.ts';
import type { DifficultyDefinition, DifficultyId, EnemyId, WaveDefinition } from '../content/definitions.ts';
import type { SpecialWaveKind } from '../content/waves.ts';
import { createEnemy } from '../enemies/create-enemy.ts';
import { getEnemy, getEliteEnemies, getTreasureEnemies } from '../content/enemies.ts';
import { Chest, rollChestReward, chestColors } from '../actors/chest.ts';
import { getWaveConfig, getWaveDuration, waveScaling, spawnRateMul, bossAddProgress,
  SPECIAL_WAVE_FROM, SPECIAL_WAVE_COOLDOWN, SPECIAL_WAVE_CHANCE, SPECIAL_WAVE_POOLS,
  ENEMY_ALIVE_CAP } from '../content/waves.ts';
import { getDifficulty, DEFAULT_DIFFICULTY, WAVE11_HP_BUFF, WAVE11_HP_BUFF_FROM, WAVE11_HP_BUFF_ALL } from '../content/difficulty.ts';
import { clamp, TAU } from '../math/geometry.ts';
import { findFreeSpot } from './terrain.ts';
import { luckBenefits } from '../progression/luck-rules.ts';

export interface WaveRules { lastSpecialWave: number; specialCache: [number, SpecialWaveKind | null][] }
export interface WaveProgress { bossChoices: Partial<Record<EnemyId, EnemyId>>; diffHp: number; diffDmg: number }
export interface SpawnWarning { x: number; y: number; t: number; entryId: EnemyId; elite: boolean }
type SpawnOptions = { rare?: boolean } & ({ x: number; y: number } | { x?: undefined; y?: undefined });
export interface CurrentWave {
  readonly index: number;
  readonly config: WaveDefinition;
  readonly scaling: Readonly<EnemyScaling>;
  readonly special: SpecialWaveKind | null | undefined;
  readonly duration: number;
  readonly durationDamp: number;
}
interface WaveObservation {
  readonly current: CurrentWave | undefined;
  readonly warnings: readonly Readonly<SpawnWarning>[];
  readonly elapsed: number;
  readonly bossTimeRatio: number | undefined;
  readonly totalSpawned: number;
  readonly bossSpawned: boolean;
}
interface WaveState {
  current: CurrentWave | undefined;
  warnings: SpawnWarning[];
  elapsed: number;
  bossTimeRatio: number | undefined;
  totalSpawned: number;
  bossSpawned: boolean;
}
interface WaveDependencies {
  rng: RNG;
  enemies: EntityList<CombatTarget>;
  fx: FXSystem;
  deaths: DeathSettlement;
  halfSize: number;
  enemyLimit: number;
  players(): Player[];
  primaryPlayer(): Player | null;
  terrain(): Terrain;
  attachEnemy(enemy: EnemyBody): void;
  shake(strength: number, duration: number): void;
}

/** Owns the complete wave population schedule and its seeded entry/retry rules. */
export class WaveDirector {
  private readonly state: WaveState = { current: undefined, warnings: [], elapsed: 0,
    bossTimeRatio: undefined, totalSpawned: 0, bossSpawned: false };
  private difficulty = getDifficulty(DEFAULT_DIFFICULTY);
  private bossChoices: WaveProgress['bossChoices'] = {};
  private diffHp = 1;
  private diffDmg = 1;
  private lastSpecialWave = -999;
  private specialCache = new Map<number, SpecialWaveKind | null>();
  private maxContactDamage = 0;
  private spawnTimer = 0;
  private spawnInterval = .5;
  private budgetUsed = 0;
  private budgetTotal = 0;
  private elitesToSpawn = 0;
  private elitesTotal = 0;
  private bossWaveAdds = false;
  private endless = false;
  private chestTimer = 0;
  private chestInterval = 0;
  private mimicTimer = 0;
  private mimicInterval = 0;
  private mimicsTotal = 0;
  private mimicsSpawned = 0;
  private readonly deps: WaveDependencies;
  constructor(deps: WaveDependencies) { this.deps = deps; }
  read(): WaveObservation { return this.state; }
  requireCurrent(): CurrentWave {
    if (!this.state.current) throw new TypeError('Wave rules must be initialized before combat advances');
    return this.state.current;
  }
  setDifficulty(id: DifficultyId): DifficultyDefinition { this.difficulty = getDifficulty(id); return this.difficulty; }
  getDifficulty(): DifficultyDefinition { return this.difficulty; }
  setBossChoice(base: EnemyId, selected: EnemyId) { this.bossChoices[base] = selected; }
  resolveBoss(id: EnemyId): EnemyId { return this.bossChoices[id] ?? id; }
  captureProgress(): WaveProgress { return structuredClone({ bossChoices: this.bossChoices, diffHp: this.diffHp, diffDmg: this.diffDmg }); }
  restoreProgress(snapshot: WaveProgress) {
    this.bossChoices = structuredClone(snapshot.bossChoices);
    this.diffHp = snapshot.diffHp; this.diffDmg = snapshot.diffDmg;
  }
  captureRules(): WaveRules { return { lastSpecialWave: this.lastSpecialWave, specialCache: structuredClone([...this.specialCache]) }; }
  restoreRules(snapshot: WaveRules) {
    this.lastSpecialWave = snapshot.lastSpecialWave;
    this.specialCache = new Map(structuredClone(snapshot.specialCache));
  }
  begin(waveIndex: number, endless = false): CurrentWave {
    const cfg = getWaveConfig(waveIndex), base = waveScaling(waveIndex), d = this.difficulty;
    const hpWave11 = (WAVE11_HP_BUFF_ALL || d.id === 'nightmare')
      && waveIndex >= WAVE11_HP_BUFF_FROM ? WAVE11_HP_BUFF : 1;
    const scaling = {
      hp: base.hp * d.enemyHp * hpWave11,
      bossHp: (base.bossHp ?? base.hp) * d.enemyHp * hpWave11,
      damage: base.damage * d.enemyDamage,
      speed: base.speed * d.enemySpeed,
      speedMelee: base.speed * (d.enemySpeedMelee ?? d.enemySpeed),
      bulletRange: base.bulletRange ?? 1,
      xp: base.xp * d.xpMul, materials: base.materials * d.materialMul,
      bossGrowth: base.bossGrowth ?? 1,
    };
    const special = this.rollSpecialWave(waveIndex, cfg);
    scaling.hp *= this.diffHp; scaling.damage *= this.diffDmg;
    this.deps.deaths.beginWave(); this.state.elapsed = 0; this.maxContactDamage = 0;
    const duration = getWaveDuration(waveIndex, cfg);
    let rate = spawnRateMul(waveIndex);
    if (special === 'egg') rate *= .5;
    this.budgetTotal = Math.max(3, Math.round(cfg.budget * d.enemyCount * rate));
    this.budgetUsed = 0;
    this.elitesToSpawn = Math.max(0, Math.round((cfg.elites ?? 0) * (d.enemyCount > 1 ? 1 + (d.enemyCount - 1) * .5 : 1)));
    this.elitesTotal = this.elitesToSpawn; this.state.bossSpawned = false; this.spawnTimer = .4;
    // A new wave discards prior warnings; rewards and run-wide spawn count survive.
    this.state.warnings.length = 0;
    this.spawnInterval = duration / Math.max(6, this.budgetTotal * 1.15);
    this.bossWaveAdds = !!cfg.isBoss;
    // Entry RNG order is special-wave roll, chest interval/delay, mimic count/delay.
    this.chestInterval = duration / (2 + this.deps.rng.next() * 1.5);
    this.chestTimer = 4 + this.deps.rng.next() * 6;
    this.mimicsTotal = cfg.isBoss ? 0 : (1 + Math.floor(this.deps.rng.next() * 5));
    this.mimicsSpawned = 0;
    this.mimicTimer = 3 + this.deps.rng.next() * 5;
    this.mimicInterval = this.mimicsTotal > 0 ? duration / this.mimicsTotal : Infinity;
    const ratio30 = 30 / Math.max(1, duration);
    this.state.current = { index: waveIndex, config: cfg, scaling, special, duration,
      durationDamp: Math.max(.3, Math.min(1, Math.pow(ratio30, 1.4))) };
    this.endless = endless;
    return this.state.current;
  }
  advanceClock(dt: number, waveElapsed: number) {
    this.state.elapsed += (dt || 0);
    this.state.bossTimeRatio = clamp(1 - (waveElapsed || 0) / (this.state.current?.duration || 1), 0, 1);
  }
  advanceSpawning(dt: number, player: Player, waveElapsed: number, paused = false) {
    this.updateSpawning(dt, player, waveElapsed, paused);
    // The established freeze only pauses ordinary spawning; treasure keeps its clock.
    this.updateTreasureSpawning(dt, player);
  }
  private chestPosition(player: Player) {
    const a = this.deps.rng.next() * TAU;
    const d = this.deps.rng.range(260, 620);
    const half = this.deps.halfSize - 60;
    return {
      x: clamp(player.x + Math.cos(a) * d, -half, half),
      y: clamp(player.y + Math.sin(a) * d, -half, half),
    };
  }

  spawnChest(player: Player, opts: SpawnOptions = {}) {
    const luck = player?.stats?.values?.luck ?? 0;

    const luckMul = player?.stats?.luckEffectMul ?? 1;
    const rare = !!opts.rare;
    const reward = rollChestReward(this.deps.rng, luck, rare, luckMul);
    const col = chestColors(reward);
    // Preserve the initial position draw before terrain retries in the seeded RNG stream.
    let pos = opts.x !== undefined ? { x: opts.x, y: opts.y } : this.chestPosition(player);

    if (opts.x === undefined) {
      const spot = findFreeSpot(this.deps.terrain(), () => this.chestPosition(player), 20, 16);
      if (spot) pos = spot; else return null;
    }
    const chest = new Chest(pos.x, pos.y, {
      hp: rare ? 90 : 45,
      tier: rare ? 2 : 1,
      rare,
      reward,
      color: col.color,
      accent: col.accent,
    });
    this.deps.enemies.add(chest);
    this.deps.fx?.ring(pos.x, pos.y, 40, col.color, 0.6);
    return chest;
  }

  spawnTreasureMimic(player: Player, opts: SpawnOptions = {}) {
    const pool = getTreasureEnemies();
    if (pool.length === 0) return null;

    let def = pool[0];
    if (pool.length > 1) {

      const rareChance = 0.22 + luckBenefits('luckEff' in player.stats ? player.stats.luckEff : Number.NaN).mimicRareBonus;
      def = this.deps.rng.next() < rareChance ? pool[1] : pool[0];
    }
    const pos = opts.x !== undefined ? { x: opts.x, y: opts.y } : this.spawnPosition(player, 420, 700);
    if (!pos) throw new TypeError('Treasure mimic requires an available spawn position');
    const e = this.spawnEnemyById(def.id, pos.x, pos.y);
    if (e) {
      this.deps.fx?.nova(pos.x, pos.y, 90, def.color);
    }
    return e;
  }

  private aliveEnemyCount() {
    let n = 0;
    for (const e of this.deps.enemies.items) {
      if (!e.dead && !e.isChest) n++;
    }
    return n;
  }

  private updateTreasureSpawning(dt: number, player: Player) {
    const alive = this.deps.enemies.items.filter((e) => !e.dead && e.isChest).length;

    if (this.chestTimer !== Infinity) {
      this.chestTimer -= dt;
      if (this.chestTimer <= 0) {
        if (alive < 3) this.spawnChest(player);
        this.chestTimer = this.chestInterval * (0.7 + this.deps.rng.next() * 0.6);
      }
    }

    if (this.mimicTimer !== Infinity && this.mimicsSpawned < this.mimicsTotal) {
      this.mimicTimer -= dt;
      if (this.mimicTimer <= 0) {
        this.spawnTreasureMimic(player);
        this.mimicsSpawned++;
        this.mimicTimer = this.mimicInterval * (0.7 + this.deps.rng.next() * 0.6);
      }
    }
  }

  private rollSpecialWave(waveIndex: number, cfg: WaveDefinition) {
    if (waveIndex + 1 < SPECIAL_WAVE_FROM) return null;
    if (cfg.isBoss) return null;
    const last = this.lastSpecialWave;
    if (last != null && waveIndex - last <= SPECIAL_WAVE_COOLDOWN) return null;

    if (this.specialCache.has(waveIndex)) {
      const cached = this.specialCache.get(waveIndex);
      if (cached) this.lastSpecialWave = waveIndex;
      return cached;
    }

    const SPW_TYPES: SpecialWaveKind[] = ['charge', 'bullet', 'tank', 'chaos', 'slack', 'payday', 'egg'];
    const r = this.deps.rng.next();
    let type = null;
    const total = SPECIAL_WAVE_CHANCE * 3;
    if (r < total) {
      type = SPW_TYPES[Math.min(SPW_TYPES.length - 1, Math.floor(r / (total / SPW_TYPES.length)))];
    }

    this.specialCache.set(waveIndex, type);
    if (type) this.lastSpecialWave = waveIndex;
    return type;
  }

  private pickSpawnEntry() {

    if (this.state.current?.special) {
      const pool = SPECIAL_WAVE_POOLS[this.state.current?.special];

      if (pool.ids && pool.ids.length > 0) {
        let r = this.deps.rng.next() * pool.ids.length;
        for (const id of pool.ids) {
          r -= 1;
          if (r <= 0) return { id };
        }
        return { id: pool.ids[pool.ids.length - 1] };
      }
    }
    const cfg = this.requireCurrent().config;
    const pool = cfg.spawns;
    let total = 0;
    for (const s of pool) total += s.weight;
    let r = this.deps.rng.next() * total;
    for (const s of pool) {
      r -= s.weight;
      if (r <= 0) return s;
    }
    return pool[pool.length - 1];
  }

  private spawnPosition(player: Player, minDist = 480, maxDist = 760) {
    const pick = () => {
      const a = this.deps.rng.next() * TAU;
      const d = this.deps.rng.range(minDist, maxDist);
      const half = this.deps.halfSize - 40;
      return {
        x: clamp(player.x + Math.cos(a) * d, -half, half),
        y: clamp(player.y + Math.sin(a) * d, -half, half),
      };
    };

    return findFreeSpot(this.deps.terrain(), pick, 26, 24);
  }

  spawnEnemyById(id: EnemyId, x: number, y: number, mutate = false) {
    const def = getEnemy(id);
    if (!def) return null;

    if (!def.boss && this.deps.enemies.items.length >= this.deps.enemyLimit) {
      return null;
    }
    const e = createEnemy(def, x, y,
      this.state.current?.scaling ?? { hp: 1, damage: 1, speed: 1, xp: 1, materials: 1 }, this.deps.rng, {
        extraPlayers: this.deps.players().length - 1,
        difficulty: this.difficulty.id,
        mutate,
        specialWave: this.state.current?.special,
        spawnAnimation: .2,
      });
    this.deps.attachEnemy(e);
    this.deps.enemies.add(e);
    this.state.totalSpawned++;

    e._bornWaveT = this.state.elapsed;
    if (e.damage > this.maxContactDamage && !def.boss) this.maxContactDamage = e.damage;
    return e;
  }

  tuneDiffScale() {
    const STEP = 0.06;
    const HP_MIN = 0.75, HP_MAX = 1.45, DMG_MIN = 0.8, DMG_MAX = 1.3;

    // Introductory, boss and special populations do not inform ordinary adaptive growth.
    if ((this.state.current?.index ?? 0) < 3 || this.state.bossSpawned || this.state.current?.special) {
      this.deps.deaths.takeKillAges();
      return;
    }
    this.requireCurrent();
    const ages = this.deps.deaths.takeKillAges();
    const n = ages.length;

    const timedOut = this.state.elapsed >= this.requireCurrent().duration - 0.5;
    let delta = 0;
    if (!timedOut && n >= 8) {
      let fast = 0;
      for (const a of ages) if (a < 1.5) fast++;
      if (fast / n >= 0.7) delta = STEP;
    }
    if (delta === 0 && timedOut) {
      let sum = 0;
      for (const a of ages) sum += a;
      const avg = n ? sum / n : Infinity;
      if (n < 5 || avg > 7) delta = -STEP;
    }
    if (delta !== 0) {

      this.diffHp = Math.min(HP_MAX, Math.max(HP_MIN, this.diffHp + delta));

      if (delta > 0) {
        const p = this.deps.primaryPlayer();
        const armor = p?.stats?.values?.armor ?? 0;
        // Never raise attack past the primary player's full-health one-hit threshold.
        const peak = this.maxContactDamage * ((this.diffDmg + STEP) / Math.max(0.01, this.diffDmg));
        if (p && Math.max(1, peak - armor) >= p.maxHp) {

          this.diffDmg = Math.max(DMG_MIN, this.diffDmg);
        } else {
          this.diffDmg = Math.min(DMG_MAX, Math.max(DMG_MIN, this.diffDmg + STEP));
        }
      } else {
        this.diffDmg = Math.min(DMG_MAX, Math.max(DMG_MIN, this.diffDmg + delta));
      }
    }
  }

  private queueSpawnOne(player: Player) {
    const entry = this.pickSpawnEntry();
    const pos = this.spawnPosition(player);

    if (!pos) return null;
    this.state.warnings.push({ x: pos.x, y: pos.y, t: 1.0, entryId: entry.id, elite: false });
    return null;
  }

  private queueSpawnElite(player: Player) {
    const def = this.deps.rng.pick(getEliteEnemies());
    if (!def) return;
    const pos = this.spawnPosition(player, 520, 720);
    if (!pos) return;
    this.state.warnings.push({ x: pos.x, y: pos.y, t: 1.4, entryId: def.id, elite: true });
  }

  private settleSpawnWarnings(dt: number) {
    let spawnedAny = false;
    // Reverse settlement preserves the seeded mutation/quirk sequence of simultaneous arrivals.
    for (let i = this.state.warnings.length - 1; i >= 0; i--) {
      const w = this.state.warnings[i];
      w.t -= dt;
      if (w.t > 0) continue;
      this.state.warnings.splice(i, 1);

      const mutChance = this.endless ? 0.20 : 0.10;
      const mutate = (this.state.current?.index ?? 0) >= 5 && this.deps.rng.next() < mutChance;
      const e = this.spawnEnemyById(w.entryId, w.x, w.y, mutate);
      if (e && !e.mutant) this.rollQuirk(e);
      spawnedAny = spawnedAny || !!e;
    }
    return spawnedAny;
  }

  private rollQuirk(e: EnemyBody) {
    if (!e || e.boss) return;
    const b = e.def?.behavior;
    if (b === 'flee' || b === 'healer' || b === 'exploder' || b === 'boss'
      || b === 'meleeBoss' || e.isChest) return;
    if (!(this.deps.rng.next() < 0.20)) return;
    if (e.melee) {

      e.setBehaviorOverride(this.deps.rng.next() < 0.5 ? 'ranged' : 'idle');
    } else {

      e.setBehaviorOverride(this.deps.rng.next() < 0.5 ? 'melee' : 'idle');
    }
  }

  private spawnBoss(player: Player) {
    const cfg = this.requireCurrent().config;

    const ids = cfg.bosses && cfg.bosses.length
      ? [...cfg.bosses]
      : (cfg.boss ? [this.resolveBoss(cfg.boss)] : []);
    if (ids.length === 0) return;

    const baseX = clamp(player.x, -this.deps.halfSize + 200, this.deps.halfSize - 200);
    const baseY = clamp(player.y - 420, -this.deps.halfSize + 100, this.deps.halfSize - 100);

    let spawnedAny = false;
    for (let i = 0; i < ids.length; i++) {

      const spread = ids.length === 1 ? 0 : (i - (ids.length - 1) / 2) * 260;
      const x = clamp(baseX + spread, -this.deps.halfSize + 120, this.deps.halfSize - 120);
      const boss = this.spawnEnemyById(ids[i], x, baseY);
      if (boss) {
        spawnedAny = true;
        this.deps.fx.nova(x, baseY, 120, boss.color);
      }
    }
    if (spawnedAny) {
      this.state.bossSpawned = true;
      this.deps.shake(14, 0.6);
    }
  }

  private updateSpawning(dt: number, player: Player, waveElapsed: number, paused: boolean) {

    if (paused) return;

    this.settleSpawnWarnings(dt);
    if (this.budgetUsed >= this.budgetTotal) return;
    this.requireCurrent();

    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;

    const remainingTime = Math.max(0.5, this.requireCurrent().duration - waveElapsed);
    const remainingBudget = Math.max(0, this.budgetTotal - this.budgetUsed);
    const perTick = Math.max(1, Math.ceil(remainingBudget / (remainingTime / this.spawnInterval)));

    const timeUp = waveElapsed >= this.requireCurrent().duration;
    const addTarget = this.bossWaveAdds
      ? (timeUp
        ? this.budgetTotal
        : Math.round(this.budgetTotal * bossAddProgress(waveElapsed, this.requireCurrent().duration)))
      : this.budgetUsed + perTick;
    const wanted = this.bossWaveAdds
      ? Math.max(0, Math.min(addTarget - this.budgetUsed, remainingBudget))
      : perTick;

    if ((this.requireCurrent().config.boss || this.requireCurrent().config.bosses) && !this.state.bossSpawned) {
      this.spawnBoss(player);
    }

    let spawned = 0;
    const maxPerTick = 6;

    const headroom = Math.max(0, ENEMY_ALIVE_CAP - this.aliveEnemyCount() - this.state.warnings.length);
    while (spawned < Math.min(wanted, maxPerTick)
      && this.budgetUsed < this.budgetTotal
      && spawned < headroom) {
      this.queueSpawnOne(player);
      this.budgetUsed++;
      spawned++;
    }

    if (this.elitesToSpawn > 0) {
      const idx = this.elitesTotal - this.elitesToSpawn;
      const threshold = Math.min(0.95, 0.25 + (idx + 1) * 0.15);
      if (clamp(this.budgetUsed / Math.max(1, this.budgetTotal), 0, 1) > threshold) {
        this.queueSpawnElite(player);
        this.elitesToSpawn--;
      }
    }

    this.spawnTimer = Math.max(0.05,
      this.bossWaveAdds ? this.spawnInterval / 3 : this.spawnInterval);
  }
}
