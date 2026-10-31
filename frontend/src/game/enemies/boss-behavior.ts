import type { Player } from '../actors/player.ts';
import type { World } from '../world/world.ts';
import type { EnemyBody, EnemySpawnDefinition } from '../actors/enemy.ts';
import type { EnemyDefinition } from '../content/definitions.ts';
import type { BulletShape } from '../actors/bullet.ts';
import type { BossSignatureState } from './boss-signatures.ts';
import { clamp, TAU } from '../math/geometry.ts';
import { BossPhaseState } from './boss-phases.ts';
import { runBossSignature } from './boss-signatures.ts';
import { EnemyLocomotion } from './locomotion.ts';
type BossModifiers = BossPhaseState['mods'];
export interface AttackClock { left: number }
const BOSS_RAINBOW = ['#ff4060', '#ff9f43', '#ffe066', '#7bed9f', '#4cd7d0', '#70a1ff', '#c56cf0'];

/** Standard Boss phases, attacks and summons; special challenges never construct this module. */
export class OrdinaryBossBehavior {
  private readonly body: EnemyBody;
  private readonly bossPhase: BossPhaseState;
  private readonly locomotion: EnemyLocomotion;
  private readonly attack: AttackClock;
  private summonTimer: number;
  private chargeTimer = 3;
  private _chargeRepeatsLeft = 0;
  private jetPhase: 'retreat' | 'windup' | null = null;
  private jetTimer = 0;
  private jetCd = 0;
  private jetDirX = 0;
  private jetDirY = 0;
  private signature: { state?: BossSignatureState } = {};
  constructor(body: EnemyBody, bossPhase: BossPhaseState, locomotion: EnemyLocomotion, attack: AttackClock) {
    this.body = body; this.bossPhase = bossPhase; this.locomotion = locomotion; this.attack = attack;
    this.summonTimer = body.def.summonCooldown ? body.def.summonCooldown * 0.6 : 0;
  }
  update(dt: number, player: Player, d: number, dx: number, dy: number, world: World) {
    if (this.body.behavior === 'meleeBoss') this._meleeBoss(dt, d, dx, dy, world);
    else this._boss(dt, player, d, dx, dy, world);
  }

  private advancePhase(world: World, melee: boolean) {
    const phaseUp = this.bossPhase.update(this.body.hpPercent, world.waves.read().bossTimeRatio ?? 1);
    if (!phaseUp) return;
    const color = this.bossPhase.mods.color || this.body.def.color;
    world.fx.nova(this.body.x, this.body.y, melee ? 280 : 260, color);
    world.fx.explosion(this.body.x, this.body.y, melee ? 190 : 180, color);
    world.shake(melee ? 20 : 18, melee ? 0.8 : 0.7);
    world.onBossPhase?.(this.body, phaseUp);
  }

  private _bulletJitter(def: EnemySpawnDefinition) {
    const j = def.bulletJitterDeg;
    if (!j) return 0;
    const [lo, hi] = Array.isArray(j) ? j : [j, j];
    const mag = lo + this.body.rng.next() * (hi - lo);
    const sign = this.body.rng.next() < 0.5 ? -1 : 1;
    return sign * mag * Math.PI / 180;
  }

  private _fireWaterJet(world: World, jet: NonNullable<EnemyDefinition['phaseWaterJet']>, pm: BossModifiers | null) {
    const speedMul = pm?.bulletSpeed ?? 1;
    const count = Math.max(1, jet.jetCount ?? 1);

    const spreadDeg = count > 1 ? 12 : 0;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const off = (t - 0.5) * spreadDeg * Math.PI / 180;
      const a = Math.atan2(this.jetDirY, this.jetDirX) + off;
      world.spawnEnemyBullet({ trueTier: this.body.trueTier,
        x: this.body.x, y: this.body.y, angle: a,

        speed: jet.jetSpeed * speedMul,
        damage: jet.jetDamage * this.body.dmgScale,
        radius: jet.jetWidth * 0.5,
        color: '#8fe3ff',
        range: jet.jetLength,
        laser: true,
        laserLength: jet.jetLength * 0.35,
      });
    }

    world.effects.emit({ type: 'sound', name: 'shoot2' });
    world.fx?.nova?.(this.body.x, this.body.y, 90, '#8fe3ff');
    world.camera?.shake?.(8, 0.2);
  }

  private _boss(dt: number, player: Player, d: number, dx: number, dy: number, world: World) {
    const def = this.body.def;

    this.advancePhase(world, false);
    const pm = this.bossPhase.mods;

    const desired = 200;
    const nx = dx / d, ny = dy / d;
    const moveMul = pm?.moveSpeed ?? 1;

    if (def.kite === 'flee') {

      const fleeMul = moveMul
        * (this.bossPhase.phase >= 3 ? (def.phase3SpeedMul ?? 1) : 1);

      let fx = -nx, fy = -ny;

      const tx = -ny, ty = nx;

      const orbit = clamp((d - (desired - 60)) / 260, 0, 1);
      fx += tx * orbit * 0.9;
      fy += ty * orbit * 0.9;

      const half = world.halfSize - this.body.radius - 40;
      if (Math.abs(this.body.x) > half || Math.abs(this.body.y) > half) {
        fx += (-this.body.x / world.halfSize) * 1.8;
        fy += (-this.body.y / world.halfSize) * 1.8;
      }
      const fl = Math.hypot(fx, fy) || 1;

      const esc = this.locomotion.escapeDir();
      if (esc) this.locomotion.move(dt, esc.x * fleeMul, esc.y * fleeMul);
      else this.locomotion.move(dt, (fx / fl) * fleeMul, (fy / fl) * fleeMul);
    } else if (d > desired + 40) this.locomotion.move(dt, nx * moveMul, ny * moveMul);
    else if (d < desired - 60) this.locomotion.move(dt, -nx * moveMul, -ny * moveMul);
    else this.locomotion.move(dt, -ny * 0.4 * moveMul, nx * 0.4 * moveMul);

    if (pm?.shake) world.shake(pm.shake, 0.12);

    this.attack.left -= dt;
    if (this.attack.left <= 0) {
      const diff = world.waves.getDifficulty() ?? { bulletCount: 1, bulletSpeed: 1 };
      const fireRate = pm?.fireRate ?? 1;
      const bulletMul = pm?.bulletMul ?? 1;
      const speedMul = pm?.bulletSpeed ?? 1;

      this.attack.left = (def.attackCooldown ?? 2.4) * fireRate * this.body.curseCooldownMul;
      const count = Math.max(1, Math.round((def.projectileCount ?? 8) * diff.bulletCount * bulletMul));
      const spread = def.projectileSpread ?? 360;
      const baseAngle = Math.atan2(dy, dx);
      const isFullCircle = spread >= 360;
      const bulletSpeed = (def.projectileSpeed ?? 240) * diff.bulletSpeed * speedMul;

      const ce = def.crystalEvery ?? 0;
      const cc = def.crystalColor ?? def.color;
      for (let i = 0; i < count; i++) {
        let a;
        if (isFullCircle) {
          a = (i / count) * TAU + this.body.age * 0.6;
        } else {
          const t = count === 1 ? 0.5 : i / (count - 1);
          a = baseAngle - (spread * Math.PI / 180) / 2 + (spread * Math.PI / 180) * t;
        }

        a += this._bulletJitter(def);
        const crystal = ce > 0 && i % ce === ce - 1;
        world.spawnEnemyBullet({ trueTier: this.body.trueTier,
          x: this.body.x, y: this.body.y, angle: a,
          speed: bulletSpeed,
          damage: (def.projectileDamage ?? 10) * this.body.dmgScale,
          radius: 9,
          color: crystal ? cc : def.color,
          shape: crystal ? 'crystal' : undefined,
          range: 900 * this.body.rangeScale,
        });
      }

      world.effects.emit({ type: 'sound', name: 'shoot1' });
      world.fx.nova(this.body.x, this.body.y, 40, pm?.color || def.color);

      const rings: { mul: number; speed: number; color?: string; radius: number; reverse?: boolean; rainbow?: boolean; shape?: BulletShape }[] = [];
      if (diff.bulletCount >= 1.6) rings.push({ mul: 0.6, speed: 0.72, color: '#ffd6e7', radius: 8 });
      if (this.bossPhase.phase >= 2) {
        rings.push({
          mul: 0.5, speed: 0.9,
          color: pm?.color || '#ffffff', radius: 8,
          shape: (def.phase3CrystalRings && this.bossPhase.phase >= 3) ? 'crystal' : undefined,
        });
      }
      if (this.bossPhase.phase >= 3) {
        if (def.phase3RainbowRing) {

          rings.push({ mul: 0.7, speed: 0.62, rainbow: true, radius: 7, reverse: true, shape: 'crystal' });
        } else {

          rings.push({
            mul: 0.7, speed: 0.62, color: '#ffffff', radius: 7, reverse: true,
            shape: def.phase3CrystalRings ? 'crystal' : undefined,
          });
        }
      }
      for (const r of rings) {
        const n2 = Math.max(4, Math.round(count * r.mul));
        const offset = this.body.age * (r.reverse ? -1.1 : 0.9) + Math.PI / n2;
        for (let i = 0; i < n2; i++) {

          const a = (i / n2) * TAU + offset + this._bulletJitter(def);
          world.spawnEnemyBullet({ trueTier: this.body.trueTier,
            x: this.body.x, y: this.body.y, angle: a,
            speed: bulletSpeed * r.speed,
            damage: Math.round((def.projectileDamage ?? 10) * this.body.dmgScale * 0.75),
            radius: r.radius,
            color: r.rainbow ? BOSS_RAINBOW[i % BOSS_RAINBOW.length] : r.color,
            shape: r.shape,
            range: 900 * this.body.rangeScale,
          });
        }
      }

      const fan = def.crystalFan;
      if (fan && this.bossPhase.phase >= (fan.fromPhase ?? 2)) {
        const n = fan.count ?? 3;
        const halfSpread = (fan.spreadDeg ?? 36) * Math.PI / 360;
        for (let i = 0; i < n; i++) {
          const t = n === 1 ? 0.5 : i / (n - 1);
          const a = baseAngle - halfSpread + halfSpread * 2 * t;
          world.spawnEnemyBullet({ trueTier: this.body.trueTier,
            x: this.body.x, y: this.body.y, angle: a,
            speed: bulletSpeed * (fan.speedMul ?? 1),
            damage: Math.round((def.projectileDamage ?? 10) * this.body.dmgScale * 0.8),
            radius: 8, range: 900 * this.body.rangeScale,
            color: fan.colors[i % fan.colors.length],
            shape: 'crystal',
          });
        }
      }
    }

    if (def.summonCount && def.summonCooldown) {
      this.summonTimer -= dt;
      if (this.summonTimer <= 0) {
        const summonRate = pm?.summonRate ?? 1;
        this.summonTimer = def.summonCooldown * summonRate;
        const diff = world.waves.getDifficulty() ?? { enemyCount: 1 };
        const n = Math.max(1, Math.round(def.summonCount * Math.min(1.6, diff.enemyCount) * (pm?.bulletMul ?? 1) * 0.8));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + this.body.age;
          world.waves.spawnEnemyById('slime', this.body.x + Math.cos(a) * 70, this.body.y + Math.sin(a) * 70);
        }
        world.fx.nova(this.body.x, this.body.y, 90, '#ffffff');
      }
    }

    if (pm?.charge && def.chargeSpeed) {
      this.chargeTimer = (this.chargeTimer ?? 3) - dt;
      if (this.chargeTimer <= 0 && this.locomotion.state === 'idle') {
        const fast = this.bossPhase.phase >= 3;
        this.chargeTimer = fast ? 2.2 : 3.4;
        this.locomotion.beginCharge(nx, ny, fast ? 0.34 : 0.5);
        this.locomotion.chargeSpeed = def.chargeSpeed * (fast ? 1.25 : 1);
      }

      if (this.locomotion.state !== 'idle') this.locomotion.runChargeStates(dt, nx, ny);
    }

    if (def.signature) runBossSignature(def.signature, this.body, this.signature, dt, player, world, this.bossPhase.phase);
  }

  private _meleeBoss(dt: number, d: number, dx: number, dy: number, world: World) {
    const def = this.body.def;
    const nx = dx / d, ny = dy / d;

    this.advancePhase(world, true);
    const pm = this.bossPhase.mods;
    const phase = this.bossPhase.phase;

    if (pm?.shake) world.shake(pm.shake, 0.12);

    const jet = def.phaseWaterJet;
    if (jet && phase >= 3) {
      if (this.jetCd > 0) this.jetCd -= dt;

      if (this.jetPhase === 'retreat') {
        this.jetTimer -= dt;

        const spd = jet.retreatDistance / Math.max(0.05, jet.retreatDuration);
        this.locomotion.move(dt, this.jetDirX, this.jetDirY, spd);
        if (this.jetTimer <= 0) {
          this.jetPhase = 'windup';
          this.jetTimer = jet.windup;

          world.fx?.ring?.(this.body.x, this.body.y, 120, '#8fe3ff', 0.4);
        }
        return;
      }

      if (this.jetPhase === 'windup') {
        this.jetTimer -= dt;

        const aimLen = Math.hypot(dx, dy) || 1;
        this.jetDirX = dx / aimLen;
        this.jetDirY = dy / aimLen;
        if (this.jetTimer <= 0) {
          this._fireWaterJet(world, jet, pm);
          this.jetPhase = null;
          this.jetCd = jet.cooldown;
        }
        return;
      }

      if (this.jetCd <= 0 && this.locomotion.state === 'idle') {
        this.jetPhase = 'retreat';
        this.jetTimer = jet.retreatDuration;

        const backLen = Math.hypot(dx, dy) || 1;
        this.jetDirX = -dx / backLen;
        this.jetDirY = -dy / backLen;

        this.attack.left = Math.max(this.attack.left, jet.retreatDuration + jet.windup + 0.1);
        return;
      }
    }

    if (this.locomotion.state === 'idle') {

      const moveMul = (pm?.moveSpeed ?? 1) * (def.chaseSpeedMul ?? 1);
      this.locomotion.move(dt, nx * moveMul, ny * moveMul);
    }

    const sudden = !!def.phaseCharge && phase >= 2;
    const windup = sudden ? 0.24 : (def.chargeWindup ?? 0.55);
    const chargeEnabled = phase >= 2 || this.locomotion.state !== 'idle';
    if (chargeEnabled && def.chargeSpeed) {
      this.chargeTimer = (this.chargeTimer ?? 3) - dt;
      if (this.chargeTimer <= 0 && this.locomotion.state === 'idle') {

        let gap = phase >= 3 ? 1.7 : phase >= 2 ? 2.6 : 3.4;
        if (sudden) gap *= 0.75;

        this.chargeTimer = gap * (0.85 + world.rng.next() * 0.3);
        const speedMul = phase >= 3 ? 1.3 : phase >= 2 ? 1.15 : 1;
        this.locomotion.chargeSpeed = def.chargeSpeed * speedMul * (sudden ? 1.1 : 1);

        this.locomotion.beginCharge(nx, ny, windup);

        this._chargeRepeatsLeft = (def.chargeRepeats ?? 1) - 1;
      }
      if (this.locomotion.state !== 'idle') {

        const wasCharging = this.locomotion.state;
        this.locomotion.runChargeStates(dt, nx, ny, false);

        if (wasCharging === 'charge' && this.locomotion.state === 'recover'
            && this._chargeRepeatsLeft > 0) {
          this._chargeRepeatsLeft--;
          this.locomotion.beginCharge(nx, ny, (def.chargeWindup ?? 0.55) * 0.55);
        }
      }
    }

    this.attack.left -= dt;
    if (this.attack.left <= 0) {
      const diff = world.waves.getDifficulty() ?? { bulletCount: 1, bulletSpeed: 1 };
      const fireRate = pm?.fireRate ?? 1;
      const bulletMul = pm?.bulletMul ?? 1;
      const speedMul = pm?.bulletSpeed ?? 1;

      this.attack.left = (def.attackCooldown ?? 2.2) * fireRate * this.body.curseCooldownMul;
      const count = Math.max(1, Math.round((def.projectileCount ?? 5) * diff.bulletCount * bulletMul));
      const spread = def.projectileSpread ?? 70;
      const baseAngle = Math.atan2(dy, dx);
      const bulletSpeed = (def.projectileSpeed ?? 210) * diff.bulletSpeed * speedMul;

      const ce = def.crystalEvery ?? 0;
      const cc = def.crystalColor ?? def.color;
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : i / (count - 1);
        let a = baseAngle - (spread * Math.PI / 180) / 2 + (spread * Math.PI / 180) * t;
        a += this._bulletJitter(def);
        const crystal = ce > 0 && i % ce === ce - 1;
        world.spawnEnemyBullet({ trueTier: this.body.trueTier,
          x: this.body.x, y: this.body.y, angle: a,
          speed: bulletSpeed,
          damage: (def.projectileDamage ?? 10) * this.body.dmgScale,
          radius: 10,
          color: crystal ? cc : def.color,
          shape: crystal ? 'crystal' : undefined,

          range: 1140 * this.body.rangeScale,
        });
      }

      world.effects.emit({ type: 'sound', name: 'shoot1' });
      world.fx.nova(this.body.x, this.body.y, 46, pm?.color || def.color);

      if (phase >= 3) {
        const apple = def.phase3AppleCrystals;
        const n2 = Math.max(4, Math.round(count * 0.8));
        for (let i = 0; i < n2; i++) {
          const a = (i / n2) * TAU + this.body.age * 0.8 + this._bulletJitter(def);
          const crystal = !!apple && i % 2 === 0;
          world.spawnEnemyBullet({ trueTier: this.body.trueTier,
            x: this.body.x, y: this.body.y, angle: a,
            speed: bulletSpeed * 0.55,
            damage: Math.round((def.projectileDamage ?? 10) * this.body.dmgScale * 0.7),
            radius: 12,
            color: crystal ? apple.color : (pm?.color || def.color),
            shape: crystal ? 'crystal' : undefined,
            range: 930,
          });
        }
      }
    }

    if (def.summonCount && def.summonCooldown) {
      this.summonTimer -= dt;
      if (this.summonTimer <= 0) {
        const summonRate = pm?.summonRate ?? 1;
        this.summonTimer = def.summonCooldown * summonRate;
        const diff = world.waves.getDifficulty() ?? { enemyCount: 1 };
        const n = Math.max(1, Math.round(def.summonCount * Math.min(1.6, diff.enemyCount) * (pm?.bulletMul ?? 1) * 0.8));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + this.body.age;
          world.waves.spawnEnemyById('slime', this.body.x + Math.cos(a) * 70, this.body.y + Math.sin(a) * 70);
        }
        world.fx.nova(this.body.x, this.body.y, 90, '#ffffff');
      }
    }
  }

}
