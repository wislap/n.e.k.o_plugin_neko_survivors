import { WaveDirector, type WaveProgress } from './wave-director.ts';
import { guidedProjectile } from '../abilities/equipment.ts';
import type { CombatTarget } from '../combat/types.ts';
import type { PendingItemReward } from '../combat/death.ts';
import { DeathSettlement } from '../combat/death.ts';
import { OutgoingCombat, type DamageOptions, type DamageWeapon } from '../combat/outgoing.ts';
import type { CometDisaster } from '../encounters/comet.ts';
import type { WeaponOwner } from '../actors/weapon.ts';
import type { RNG } from '../math/random.ts';
import type { Player } from '../actors/player.ts';
import type { Pet, PetSpeechKind } from '../actors/pet.ts';
import type { PhantomClone } from '../actors/phantom.ts';
import type { WeaponInstance } from '../actors/weapon.ts';
import type { RuleEffects } from './effects-port.ts';
import type { ChallengeSession } from '../encounters/types.ts';
import type { WeatherSystem } from '../encounters/weather.ts';
import type { Terrain } from './terrain.ts';
import type { WeaponDefinition } from '../content/definitions.ts';
export interface WorldProgress extends WaveProgress { pendingItemRewards: PendingItemReward[] }
interface WorldOptions { effects?: RuleEffects; enemyLimit?: number; effectLimit?: number }

import { ComponentList } from '../ecs/entity-store.ts';
import { PLAYER_SHOT_FIELDS, ENEMY_SHOT_FIELDS, PICKUP_FIELDS } from '../ecs/components.ts';
import { updatePlayerProjectiles, updateEnemyProjectiles, updatePickups } from '../ecs/transient-systems.ts';
import { EntityList, SpatialGrid } from '../actors/entity.ts';

import type { EnemyBody } from '../actors/enemy.ts';
import { Bullet, EnemyBullet } from '../actors/bullet.ts';
import { Pickup, PICKUP_TYPE } from '../actors/pickup.ts';
import { TurretManager } from '../actors/turret.ts';
import { FXSystem } from './effects.ts';
import { angleTo, TAU } from '../math/geometry.ts';
import { expandTerrain } from './terrain.ts';

import { WORLD_SIZE } from './config.ts';

/** Owns live entities, spatial queries, terrain and combat/death transactions. */
export class World {
  readonly waves: WaveDirector;
  private readonly deaths: DeathSettlement;
  private readonly combat: OutgoingCombat;

  declare pendingItemRewards: PendingItemReward[];
  declare rng: RNG;
  declare challenge: ChallengeSession | null;
  declare effects: RuleEffects;
  readonly halfSize: number;
  declare enemies: EntityList<CombatTarget>;
  declare bullets: ComponentList<Bullet>;
  declare enemyBullets: ComponentList<EnemyBullet>;
  declare pickups: ComponentList<Pickup>;
  declare fx: FXSystem;
  declare grid: SpatialGrid<CombatTarget>;
  declare turrets: TurretManager;
  declare pet: Pet | null;
  declare terrain: Terrain;
  declare player: Player | null;
  declare player2: Player | null;
  declare player3: Player | null;
  declare player4: Player | null;
  declare partners: () => Player[];
  declare players: () => Player[];
  declare nearestPlayerTo: (x: number, y: number) => Player | null;
  declare phantoms: PhantomClone[];
  declare onEnemyKilled: ((enemy: CombatTarget) => void) | null;
  declare onPickup: ((pickup: Pickup) => void) | null;
  declare onPlayerHit: ((amount: number) => void) | null;
  declare onBossKilled: ((boss: EnemyBody) => void) | null;
  declare onBossSettled: ((boss: EnemyBody) => void) | null;
  declare onBossPhase: ((boss: EnemyBody, phase: number) => void) | null;
  declare onPetSay: ((pet: Pet, text: string, kind: PetSpeechKind) => void) | null | undefined;
  declare onPetHeal: ((pet: Pet, amount: number) => void) | null;
  declare onWeaponFire: ((weapon: WeaponDefinition, heavy: boolean) => void) | null;
  declare weather: WeatherSystem | null | undefined;
  declare noSpawn: boolean | undefined;
  declare spawnPaused: boolean | undefined;
  declare comet: CometDisaster | undefined;
  declare enemyFrozen: boolean | undefined;
  declare camera: { shake(strength: number, duration: number): void } | undefined;
  declare t: number;
  declare lastCleanupBonus: number;
  captureProgress(): WorldProgress {
    return { ...this.waves.captureProgress(), pendingItemRewards: structuredClone(this.pendingItemRewards) };
  }
  restoreProgress(snapshot: WorldProgress) {
    this.pendingItemRewards = structuredClone(snapshot.pendingItemRewards);
    this.waves.restoreProgress(snapshot);
  }

  constructor(rng: RNG, options: WorldOptions = {}) {
    this.rng = rng; this.challenge = null;
    this.t = 0;
    this.effects = options.effects ?? { emit() {} };
    this.halfSize = WORLD_SIZE / 2;

    this.enemies = new EntityList();
    this.bullets = new ComponentList(PLAYER_SHOT_FIELDS);
    this.enemyBullets = new ComponentList(ENEMY_SHOT_FIELDS);
    this.pickups = new ComponentList(PICKUP_FIELDS);
    this.fx = new FXSystem(rng.fork(0x6678), options.effectLimit ?? 240);
    this.grid = new SpatialGrid(72);

    this.turrets = new TurretManager();

    this.pet = null;

    this.terrain = { rects: [], circles: [] };

    this.lastCleanupBonus = 0;

    this.pendingItemRewards = [];

    this.onEnemyKilled = null;
    this.onPickup = null;
    this.onPlayerHit = null;
    this.onBossKilled = null;
    this.onBossSettled = null;
    this.onBossPhase = null;
    this.onPetHeal = null;

    this.onWeaponFire = null;

    this.player = null;

    this.player2 = null;
    this.player3 = null;
    this.player4 = null;

    this.partners = () => [this.player2, this.player3, this.player4].filter((value): value is Player => value !== null);
    this.players = () => {
      const ps: Player[] = this.player ? [this.player] : [];
      for (const p of this.partners()) ps.push(p);
      return ps;
    };

    this.nearestPlayerTo = (x: number, y: number) => {
      let best = null, bestD = Infinity;
      for (const p of this.players()) {
        if (!p || p.dead || p.downed) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) { bestD = d; best = p; }
      }
      return best ?? this.player;
    };

    this.phantoms = [];

    const primaryPlayer = () => { if (!this.player) throw new TypeError('Combat requires a primary player'); return this.player; };
    this.deaths = new DeathSettlement({
      rng: this.rng, fx: this.fx, pickups: this.pickups,
      pendingRewards: () => this.pendingItemRewards,
      rules: () => { const rules = this.waves.requireCurrent(); return { wave: rules.index, elapsed: this.waves.read().elapsed,
        durationDamp: rules.durationDamp, special: rules.special }; },
      primaryPlayer,
      spawn: (id, x, y) => this.waves.spawnEnemyById(id, x, y),
      shake: (strength, duration) => this.shake(strength, duration),
      notifyKilled: enemy => this.onEnemyKilled?.(enemy),
      notifyBossKilled: enemy => {
        try { this.onBossKilled?.(enemy); }
        catch (error) { console.error('[world] onBossKilled 回调异常（已隔离）:', error); }
      },
      notifyBossSettled: enemy => this.onBossSettled?.(enemy),
    });
    this.waves = new WaveDirector({ rng, enemies: this.enemies, fx: this.fx, deaths: this.deaths,
      halfSize: this.halfSize, enemyLimit: options.enemyLimit ?? Infinity, players: this.players,
      primaryPlayer: () => this.player, terrain: () => this.terrain,
      attachEnemy: enemy => { enemy.world = this; }, shake: (strength, duration) => this.shake(strength, duration) });
    this.combat = new OutgoingCombat({ rng: this.rng, fx: this.fx, deaths: this.deaths,
      weather: () => this.weather, guard: () => this.challenge?.guard, primaryPlayer,
    });
  }

  shake(strength: number, duration: number) {
    this.effects.emit({ type: 'camera-shake', strength, duration });
  }

  setTerrain(bgId: string) {
    this.terrain = bgId ? expandTerrain(bgId, WORLD_SIZE) : { rects: [], circles: [] };
  }

  dealDamage(player: WeaponOwner, weapon: DamageWeapon | null, target: CombatTarget, baseDamage: number, opts: DamageOptions = {}) {
    return this.combat.hit(player, weapon, target, baseDamage, opts);
  }
  petDealDamage(_pet: Pet, target: CombatTarget, baseDamage: number) {
    return this.combat.petHit(target, baseDamage);
  }

  deployTurret(player: WeaponOwner, weapon: WeaponInstance) {
    const def = weapon.def;
    const bonus = Math.max(0, Math.round(player.stats.values.turretMax ?? 0));
    const max = Math.max(1, (def.turretMax ?? 3) + bonus);

    const a = player.facing;
    const x = player.x + Math.cos(a) * 26;
    const y = player.y + Math.sin(a) * 26;

    const res = this.turrets.deploy(def, x, y, weapon, player, max);
    this.fx?.ring(x, y, 34, def.color, 0.45);
    return res;
  }

  spawnBullet(cfg: ConstructorParameters<typeof Bullet>[0]) {
    const owner = cfg.ownerPlayer ?? this.player;
    if (owner && 'hasItem' in owner) cfg = guidedProjectile(owner, cfg);
    const b = new Bullet(cfg);

    b.ownerPlayer = cfg.ownerPlayer ?? this.player;
    this.bullets.add(b);
    return b;
  }

  spawnEnemyBullet(cfg: ConstructorParameters<typeof EnemyBullet>[0]) {
    const b = new EnemyBullet(cfg);

    if (this.waves.read().current?.special === 'chaos') b.hostileToEnemies = true;
    this.enemyBullets.add(b);
    return b;
  }

  queryArc(x: number, y: number, facing: number, halfAngle: number, radius: number) {
    const out = [];
    const candidates = this.grid.query(x, y, radius, []);
    for (const e of candidates) {
      if (!e.isEnemy || e.dead) continue;
      const a = angleTo(x, y, e.x, e.y);
      let diff = (a - facing) % TAU;
      if (diff > Math.PI) diff -= TAU;
      if (diff < -Math.PI) diff += TAU;
      if (Math.abs(diff) <= halfAngle) out.push(e);
    }
    return out;
  }

  queryCapsule(x1: number, y1: number, x2: number, y2: number, radius: number) {
    const out = [];
    const seen = new Set();
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / Math.max(8, radius)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x1 + dx * t;
      const py = y1 + dy * t;
      const hits = this.grid.query(px, py, radius, []);
      for (const h of hits) {
        if (!h.isEnemy || h.dead || seen.has(h.id)) continue;
        seen.add(h.id);
        out.push(h);
      }
    }
    return out;
  }

  update(dt: number, player: Player, waveElapsed: number) {
    this.t += dt;
    this.player = player;

    this.waves.advanceClock(dt, waveElapsed);

    // Build before spawning: newly arrived bodies enter the grid on the next update.
    this.grid.clear();
    for (const e of this.enemies.items) {
      if (!e.dead) this.grid.insert(e);
    }

    // Challenge suppression stops ordinary and treasure schedules together.
    if (!this.noSpawn) {
      this.waves.advanceSpawning(dt, player, waveElapsed, this.spawnPaused);
    }

    // Enemy freeze leaves projectiles, pickups, turrets and pet time unchanged.
    for (const e of this.enemies.items) {
      if (e.dead) continue;
      if (e.isChest) e.update(this.enemyFrozen ? 0 : dt);
      else e.update(this.enemyFrozen ? 0 : dt, this.nearestPlayerTo(e.x, e.y)!, this);
    }

    // Ordinary body positions now stay fixed through projectile settlement.
    // Boss callbacks may teleport, so their buckets keep live unpruned queries.
    this.grid.sealPositions(e => e.isEnemy && !e.boss);
    updatePlayerProjectiles(this.bullets, dt, this);

    this.turrets.update(dt, this);

    if (this.pet && !this.pet.dead) {
      this.pet.update(dt, player, this);
      this.pet.clampToWorld(this);
    }

    const livePlayers = this.players();
    updateEnemyProjectiles(this.enemyBullets, dt, this, livePlayers);
    updatePickups(this.pickups, dt, this);

    this.fx.update(dt);

    this.enemies.sweep();
    this.bullets.sweep();
    this.enemyBullets.sweep();
    this.pickups.sweep();
  }

  /** Timeout removal of surviving bosses bypasses kill rewards and callbacks. */
  endWaveCleanup(opts: { removeBosses?: boolean } = {}) {
    let cleaned = 0;
    let bonus = 0;

    const removeBosses = !!opts.removeBosses;

    const w = this.waves.read().current?.index ?? 0;
    const ratio = w < 8 ? 0.5 : w < 14 ? 0.35 : 0.22;

    const damp = this.waves.read().current?.durationDamp ?? 1;
    for (const e of this.enemies.items) {
      if (e.dead) continue;
      if (e.boss) {

        if (!removeBosses) continue;
        e.dead = true;
        continue;
      }

      if (e.isChest) { e.dead = true; continue; }
      e.dead = true;
      cleaned++;
      const v = Math.max(1, Math.round(e.materialValue * ratio * damp));
      this.pickups.add(new Pickup(PICKUP_TYPE.MATERIAL, e.x, e.y, v));
      bonus += v;
    }
    this.enemies.sweep();
    this.bullets.clear();
    this.enemyBullets.clear();

    this.turrets.clear();
    this.lastCleanupBonus = bonus;
    return cleaned;
  }


}
