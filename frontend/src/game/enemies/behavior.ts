import type { Player } from '../actors/player.ts';
import type { World } from '../world/world.ts';
import type { EnemyBody, EnemyBehavior, BehaviorOverride } from '../actors/enemy.ts';
import { clamp, dist, TAU } from '../math/geometry.ts';
import { EnemyLocomotion } from './locomotion.ts';
import { OrdinaryBossBehavior, type AttackClock } from './boss-behavior.ts';
import { BossPhaseState } from './boss-phases.ts';
import { ENEMY_FIRE_RATE_BUFF, ENEMY_BULLET_SPEED_BUFF } from '../content/difficulty.ts';

const MIMIC_BOOST_MUL = 1.2;
const MIMIC_BOOST_DURATION = 3;
const MIMIC_SLOW_MUL = 0.9;
const MIMIC_SLOW_DURATION = 5;

export class OrdinaryEnemyBehavior implements EnemyBehavior {
  private aiOverride: 'melee' | 'ranged' | 'idle' | 'flee' | null;
  private readonly attack: AttackClock;
  private readonly locomotion: EnemyLocomotion;
  private readonly boss: OrdinaryBossBehavior | null;
  private wobblePhase: number;
  private healTick: number;
  private wanderAngle: number;
  private wanderTimer: number;
  private fleeTimer: number;
  declare private mimicBoostTimer?: number;
  declare private mimicSlowTimer?: number;
  declare private _chaosHitCd?: number;
  declare private _foeCache?: EnemyBody | null;
  declare private _foeCacheT?: number;
  declare private spiralAngle?: number;
  private readonly body: EnemyBody;
  constructor(body: EnemyBody, bossPhase: BossPhaseState | null) {
    this.body = body;
    const { rng, def } = body;
    this.aiOverride = null;
    this.attack = { left: rng.range(0, def.attackCooldown ?? 1) };
    this.locomotion = new EnemyLocomotion(body);
    this.boss = bossPhase ? new OrdinaryBossBehavior(body, bossPhase, this.locomotion, this.attack) : null;
    this.wobblePhase = rng.range(0, TAU);
    this.healTick = 0;
    this.wanderAngle = this.body.rng.next() * TAU;
    this.wanderTimer = 0;
    this.fleeTimer = 0;
    if (def.behavior === 'flee') {
      this.mimicBoostTimer = 0;
      this.mimicSlowTimer = 0;
    }
  }

  setOverride(value: BehaviorOverride) { this.aiOverride = value; }
  onDamage() {
    if (this.aiOverride === 'idle') this.aiOverride = this.body.rng.next() < 0.5 ? null : 'flee';
    if (this.body.def.behavior === 'flee') {
      this.alert(3.5);
      this.mimicBoostTimer = MIMIC_BOOST_DURATION;
      this.mimicSlowTimer = 0;
    }
  }

  update(dt: number, player: Player, world: World, completeStatus: (dt: number, world: World, stunned?: boolean) => void) {
    if (this.mimicBoostTimer !== undefined && this.mimicBoostTimer > 0) {
      this.mimicBoostTimer -= dt;
      if (this.mimicBoostTimer <= 0) {
        this.mimicBoostTimer = 0;
        this.mimicSlowTimer = MIMIC_SLOW_DURATION;
      }
    } else if (this.mimicSlowTimer !== undefined && this.mimicSlowTimer > 0) {
      this.mimicSlowTimer -= dt;
      if (this.mimicSlowTimer <= 0) this.mimicSlowTimer = 0;
    }

    const toPlayerX = player.x - this.body.x;
    const toPlayerY = player.y - this.body.y;
    const distToPlayer = Math.hypot(toPlayerX, toPlayerY) || 1;
    this.body.facing = Math.atan2(toPlayerY, toPlayerX);

    let aimX = toPlayerX;
    let aimY = toPlayerY;
    let aimDist = distToPlayer;
    let aimFoe = null;
    if (world?.waves.read().current?.special === 'chaos' && !this.body.mutant && !this.body.boss
      && !this.body.isChest && this.body.behavior !== 'flee' && this.body.behavior !== 'healer'
      && this.body.behavior !== 'exploder') {
      aimFoe = this._nearestFoe(world);
      if (aimFoe) {
        aimX = aimFoe.x - this.body.x;
        aimY = aimFoe.y - this.body.y;
        aimDist = Math.hypot(aimX, aimY) || 1;
      }
    }

    if (this.body.stun > 0) {
      completeStatus(dt, world, true);
      return;
    }

    this.locomotion.beginStep(dt);
    const frameStartX = this.body.x;
    const frameStartY = this.body.y;

    switch (this.aiOverride === 'idle' ? '_idle' : (this.aiOverride ?? this.body.behavior)) {

      case '_idle':     break;

      case 'melee':     this._chase(dt, aimDist, aimX, aimY); break;
      case 'ranged':    this._shooter(dt, aimDist, aimX, aimY, world); break;
      case 'chase':     this._chase(dt, aimDist, aimX, aimY); break;
      case 'tank':      this._chase(dt, aimDist, aimX, aimY); break;
      case 'zigzag':    this._zigzag(dt, aimDist, aimX, aimY); break;
      case 'orbit':     this._orbit(dt, aimDist, aimX, aimY); break;
      case 'shooter':   this._shooter(dt, aimDist, aimX, aimY, world); break;

      case 'chaseShooter': this._chaseShooter(dt, aimDist, aimX, aimY, world); break;
      case 'charger':   this._charger(dt, aimDist, aimX, aimY); break;
      case 'exploder':  this._exploder(dt, player, aimDist, aimX, aimY, world); break;
      case 'splitter':  this._chase(dt, aimDist, aimX, aimY); break;
      case 'boss':
      case 'meleeBoss':
        if (!this.boss) throw new Error('Ordinary Boss behavior is required');
        this.boss.update(dt, player, distToPlayer, toPlayerX, toPlayerY, world); break;

      case 'healer':    this._healer(dt, distToPlayer, toPlayerX, toPlayerY, world); break;
      case 'flee':      this._flee(dt, distToPlayer, toPlayerX, toPlayerY, world); break;
      default:          this._chase(dt, aimDist, aimX, aimY); break;
    }

    this.locomotion.checkStuck(dt, frameStartX, frameStartY);

    completeStatus(dt, world);

    if (!this.body.boss) {
      const half = world.halfSize - this.body.radius;
      this.body.x = clamp(this.body.x, -half, half);
      this.body.y = clamp(this.body.y, -half, half);
    }

    this.locomotion.resolveTerrain(world);

    if (this.body.damage > 0 && this.body.behavior !== 'exploder'
      && this.body.applyContact(player, world, distToPlayer)) return;

    if (aimFoe && this.body.damage > 0 && this.body.behavior !== 'exploder') {
      this._chaosHitCd = Math.max(0, (this._chaosHitCd ?? 0) - dt);
      const rrFoe = this.body.radius + aimFoe.radius;
      if (this._chaosHitCd <= 0 && aimDist < rrFoe) {
        aimFoe.takeDamage(this.body.damage, {});
        this._chaosHitCd = 0.5;
        world?.fx?.nova?.(aimFoe.x, aimFoe.y, 14, '#ffb0a0');
      }
    }
  }

  private _nearestFoe(world: World) {
    const now = world?.t ?? this.body.age;
    if (this._foeCache && !this._foeCache.dead
      && now - (this._foeCacheT ?? -Infinity) < 0.25) {
      return this._foeCache;
    }
    let best = null;
    let bd = Infinity;
    for (const e of world.enemies.items) {
      if (e === this.body || e.dead || e.isChest || e.mutant || e.boss) continue;
      if (e.melee === this.body.melee) continue;
      if (e.def?.behavior === 'flee' || e.def?.behavior === 'healer') continue;
      const d = (e.x - this.body.x) ** 2 + (e.y - this.body.y) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    this._foeCache = best;
    this._foeCacheT = now;
    return best;
  }

  private _chase(dt: number, d: number, dx: number, dy: number) {
    this.locomotion.move(dt, dx / d, dy / d);
  }

  private _zigzag(dt: number, d: number, dx: number, dy: number) {

    this.wobblePhase += dt * 6;
    const nx = dx / d, ny = dy / d;
    const px = -ny, py = nx;
    const wob = Math.sin(this.wobblePhase) * 0.75;
    this.locomotion.move(dt, nx + px * wob, ny + py * wob);
  }

  private _orbit(dt: number, d: number, dx: number, dy: number) {

    const desired = 90;
    const nx = dx / d, ny = dy / d;
    const px = -ny, py = nx;
    let radial = 0;
    if (d > desired + 12) radial = 1;
    else if (d < desired - 12) radial = -1;
    const tangent = 0.9;
    this.locomotion.move(dt, nx * radial + px * tangent, ny * radial + py * tangent);
  }

  private _firePattern(world: World, baseAngle: number) {
    const def = this.body.def;
    const pattern = def.bulletPattern ?? 'aimed';
    const count = Math.max(1, def.projectileCount ?? 1);

    const speed = (def.projectileSpeed ?? 220) * ENEMY_BULLET_SPEED_BUFF;

    const damage = (def.projectileDamage ?? (def.damage ?? 3)) * this.body.dmgScale
      * (1 + this.body.buffDamagePct / 100) * this.body.curseDamageMul;
    const radius = def.projectileRadius ?? 7;
    const color = def.projectileColor ?? this.body.color;
    const range = (def.projectileRange ?? 520) * this.body.rangeScale;

    if (pattern === 'spiral') {
      this.spiralAngle = (this.spiralAngle ?? baseAngle) + (def.spiralStep ?? 0.5);
    }

    for (let i = 0; i < count; i++) {
      let a;
      switch (pattern) {
        case 'ring':

          a = baseAngle + (i / count) * TAU;
          break;
        case 'random': {

          const spreadRad = (def.randomSpread ?? 360) * Math.PI / 180;
          a = baseAngle + (this.body.rng.next() - 0.5) * spreadRad;
          break;
        }
        case 'spiral':
          a = (this.spiralAngle ?? baseAngle) + (i / count) * TAU;
          break;
        case 'spread':
        default: {
          const spread = (def.projectileSpread ?? 0) * Math.PI / 180;
          const t = count === 1 ? 0.5 : i / (count - 1);
          a = baseAngle - spread / 2 + spread * t;
          break;
        }
      }
      world.spawnEnemyBullet({ trueTier: this.body.trueTier,
        x: this.body.x, y: this.body.y, angle: a,
        speed, damage, radius, color, range,
        shape: def.projectileShape,
      });
    }
  }

  private _shooter(dt: number, d: number, dx: number, dy: number, world: World) {

    const range = (this.body.def.attackRange ?? 240) * this.body.rangeScale;
    const nx = dx / d, ny = dy / d;
    if (d > range * 0.85) {
      this.locomotion.move(dt, nx, ny);
    } else if (d < range * 0.55) {
      this.locomotion.move(dt, -nx, -ny);
    } else {

      this.locomotion.move(dt, -ny * 0.5, nx * 0.5);
    }

    this.attack.left -= dt;
    if (this.attack.left <= 0 && d < range) {

      const fireRate = (world?.waves.getDifficulty()?.enemyFireRate ?? 1) * ENEMY_FIRE_RATE_BUFF
        * (world?.weather?.enemyFireMul ?? 1)
        * (world?.waves.read().current?.special === 'slack' ? 0.5 : 1)
        * (world?.waves.read().current?.special === 'payday' ? 1.2 : 1);

      this.attack.left = (this.body.def.attackCooldown ?? 2) / fireRate * this.body.curseCooldownMul;
      this._firePattern(world, Math.atan2(dy, dx));
    }
  }

  private _healer(dt: number, d: number, dx: number, dy: number, world: World) {
    const def = this.body.def;
    const dist = def.keepDistance ?? 260;
    const nx = dx / d, ny = dy / d;

    if (d > dist * 1.05) {
      this.locomotion.move(dt, nx, ny);
    } else if (d < dist * 0.7) {
      this.locomotion.move(dt, -nx, -ny);
    } else {
      this.locomotion.move(dt, -ny * 0.6, nx * 0.6);
    }

    this.healTick -= dt;
    if (this.healTick > 0) return;
    this.healTick = def.healInterval ?? 5;

    const radius = def.healRadius ?? 190;

    const pctTable = def.healPct ?? { normal: 0.15, elite: 0.05, boss: 0.005 };

    let healedCount = 0;
    for (const e of world.enemies.items) {
      if (e === this.body || e.dead) continue;
      if (e.isChest) continue;
      if (e.hp >= e.maxHp) continue;
      const dx2 = e.x - this.body.x, dy2 = e.y - this.body.y;
      if (dx2 * dx2 + dy2 * dy2 > radius * radius) continue;

      const pct = e.boss ? pctTable.boss : e.elite ? pctTable.elite : pctTable.normal;
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * pct);

      const b = def.healBuff;
      e.buffDamagePct = b?.damagePct ?? 0;
      e.buffDamageReduction = b?.damageReduction ?? 0;
      e.buffTimer = def.healBuffDuration ?? 4;
      e.healFlash = 1;
      healedCount++;
    }

    if (healedCount > 0) {
      world.fx.ring(this.body.x, this.body.y, radius, def.color);
    }
  }

  private _chaseShooter(dt: number, d: number, dx: number, dy: number, world: World) {
    const nx = dx / d, ny = dy / d;
    this.locomotion.move(dt, nx, ny);

    this.attack.left -= dt;

    const range = (this.body.def.attackRange ?? 260) * this.body.rangeScale;
    if (this.attack.left <= 0 && d < range) {

      const fireRate = (world?.waves.getDifficulty()?.enemyFireRate ?? 1) * ENEMY_FIRE_RATE_BUFF
        * (world?.weather?.enemyFireMul ?? 1);

      this.attack.left = (this.body.def.attackCooldown ?? 2) / fireRate * this.body.curseCooldownMul;
      this._firePattern(world, Math.atan2(dy, dx));
    }
  }

  private _charger(dt: number, d: number, dx: number, dy: number) {
    const windup = this.body.def.chargeWindup ?? 0.7;
    if (this.locomotion.state === 'idle') {
      this.locomotion.move(dt, dx / d, dy / d);
      if (d < 220) this.locomotion.beginCharge(dx / d, dy / d, windup);
    } else {
      this.locomotion.runChargeStates(dt, dx / d, dy / d);
    }
  }

  private _exploder(dt: number, player: Player, d: number, dx: number, dy: number, world: World) {
    this.locomotion.move(dt, dx / d, dy / d);
    const trigger = this.body.radius + player.radius + 10;
    if (d < trigger) {
      this._explode(world, player);
    }
  }

  private _explode(world: World, player: Player) {
    if (this.body.dead) return;
    this.body.dead = true;
    this.body.exploded = true;
    const radius = this.body.def.explosionRadius ?? 70;

    const dmg = (this.body.def.explosionDamage ?? 12) * this.body.dmgScale;
    const d = dist(this.body.x, this.body.y, player.x, player.y);
    if (d < radius + player.radius) {

      player.takeDamage(dmg, this.body.x, this.body.y, { trueBonus: this.body.trueBonusFor(world) });
    }
    world.fx.explosion(this.body.x, this.body.y, radius, this.body.color);
    world.shake(6, 0.2);
  }

  private alert(seconds = 3.5) {
    this.fleeTimer = Math.max(this.fleeTimer, seconds);
  }

  private _flee(dt: number, d: number, dx: number, dy: number, world: World) {
    const SIGHT = 210;
    const COMFORT = 300;
    const WANDER_SPEED = 0.42;

    if (this.fleeTimer > 0) {
      this.fleeTimer -= dt;
      if (this.fleeTimer <= 0) {

        this.fleeTimer = 0;
        this.wanderAngle = this.body.rng.next() * TAU;
        this.wanderTimer = 1.5 + this.body.rng.next() * 2.5;
      }
    } else if (d < SIGHT) {

      this.alert(3.5 - Math.min(2, COMFORT / Math.max(1, d)) * 0.2);
    }

    let vx, vy;

    if (this.fleeTimer > 0) {

      const nx = dx / d, ny = dy / d;
      vx = -nx; vy = -ny;

      if (d > COMFORT) { vx *= 0.35; vy *= 0.35; }

      const half = world.halfSize - this.body.radius - 30;
      if (Math.abs(this.body.x) > half || Math.abs(this.body.y) > half) {
        const tx = -vy, ty = vx;
        const towardCenter = -(this.body.x * vx + this.body.y * vy) > 0 ? 1 : -1;
        vx = tx * towardCenter + (-this.body.x / world.halfSize) * 0.6;
        vy = ty * towardCenter + (-this.body.y / world.halfSize) * 0.6;
      }
    } else {

      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {

        this.wanderAngle += (this.body.rng.next() - 0.5) * 2.2;
        this.wanderTimer = 1.2 + this.body.rng.next() * 2.8;
      }
      vx = Math.cos(this.wanderAngle) * WANDER_SPEED;
      vy = Math.sin(this.wanderAngle) * WANDER_SPEED;

      const half = world.halfSize - this.body.radius - 60;
      if (Math.abs(this.body.x) > half || Math.abs(this.body.y) > half) {
        vx += (-this.body.x / world.halfSize) * 1.6;
        vy += (-this.body.y / world.halfSize) * 1.6;
      }
    }

    const len = Math.hypot(vx, vy) || 1;

    const buffMul = (this.mimicBoostTimer ?? 0) > 0 ? MIMIC_BOOST_MUL
      : (this.mimicSlowTimer ?? 0) > 0 ? MIMIC_SLOW_MUL
      : 1;

    const esc = this.locomotion.escapeDir();
    if (esc) {
      this.locomotion.move(dt, esc.x * buffMul, esc.y * buffMul);
      this.body.facing = Math.atan2(esc.y, esc.x);
      return;
    }
    this.locomotion.move(dt, (vx / len) * buffMul, (vy / len) * buffMul);
    this.body.facing = Math.atan2(vy, vx);
  }

}
