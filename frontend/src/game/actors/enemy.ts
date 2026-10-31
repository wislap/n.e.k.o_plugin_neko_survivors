import type { Player } from './player.ts';
import type { World } from '../world/world.ts';
import type { RNG } from '../math/random.ts';
import type { EnemyDefinition } from '../content/definitions.ts';
import type { EnemyDamageOptions, EnemyDamageResult } from '../combat/types.ts';
import { Entity } from './entity.ts';
import { angleTo, clamp } from '../math/geometry.ts';
import { isMeleeEnemy } from '../content/enemies.ts';
import { ENEMY_MELEE_HP_BUFF, trueDamageBonus } from '../content/difficulty.ts';
import { ELITE_DAMAGE_MUL, BOSS_DAMAGE_MUL } from '../content/waves.ts';
import { OverloadGuard } from '../combat/overload.ts';
import { resolveTerrain } from '../world/terrain.ts';

export type EnemySpawnDefinition = Pick<EnemyDefinition, 'name' | 'hp' | 'radius' | 'speed' | 'damage' | 'xp' | 'materials'>
  & Partial<Omit<EnemyDefinition, 'id' | 'name' | 'hp' | 'radius' | 'speed' | 'damage' | 'xp' | 'materials'>>
  & { id: string };

export interface EnemyScaling {
  hp: number; damage: number; speed: number; xp: number; materials: number;
  bossHp?: number; bossGrowth?: number; bulletRange?: number; speedMelee?: number; speedOwn?: number;
}
export type BehaviorOverride = 'melee' | 'ranged' | 'idle' | 'flee' | null;
export interface EnemyGuardView {
  phase: 1 | 2 | 3; color: string | null; changeFx: number;
  invulnerable: boolean; blocked: number; invulnLeft: number;
}
export interface EnemyHealthView { readonly hp: number; readonly maxHp: number }
export interface EnemyDamageGate {
  filter(body: EnemyHealthView, amount: number): { blocked: boolean; amount: number; reason?: string; gated?: boolean };
  advance?(dt: number): void;
  read?(): EnemyGuardView;
}
/** Internal composition seam; ordinary AI owns its state and status completion order. */
export interface EnemyBehavior {
  update(dt: number, player: Player, world: World, completeStatus: (dt: number, world: World, stunned?: boolean) => void): void;
  onDamage(): void;
  setOverride(value: BehaviorOverride): void;
}
export interface EnemyBodyOptions {
  damageGate?: EnemyDamageGate;
  behavior?: (body: EnemyBody) => EnemyBehavior;
}

/** Targetable body, with no ordinary AI constructed for challenge controllers. */
export class EnemyBody extends Entity<[Player, World]> {
  def: EnemySpawnDefinition;
  isEnemy: true;
  rng: RNG;
  boss: boolean;
  melee: boolean;
  maxHp: number;
  hp: number;
  speed: number;
  dmgScale: number;
  damage: number;
  rangeScale: number;
  armor: number;
  xpValue: number;
  materialValue: number;
  color: string | undefined;
  shape: EnemyDefinition['shape'];
  behavior: EnemyDefinition['behavior'];
  elite: boolean;
  mutant: boolean;
  facing: number;
  hurtFlash: number;
  hurtExpr: number;
  knockbackX: number;
  knockbackY: number;
  splitDone: boolean;
  spawnAnimation: number;
  scale: number;
  stun: number;
  armorShred: number;
  buffTimer: number;
  buffDamagePct: number;
  buffDamageReduction: number;
  healFlash: number;
  overload: OverloadGuard | null;
  overloadNow: number;
  overloadFlash: number;
  curseTimer: number;
  curseDamageMul: number;
  curseSpeedMul: number;
  curseRateMul: number;
  declare isChest?: false;
  declare _bornWaveT?: number;
  declare flandreHidden?: boolean;
  declare spriteId?: string;
  declare world?: World;
  declare debuffTakenPct?: number;
  declare exploded?: boolean;
  private readonly damageGate: EnemyDamageGate | undefined;
  private readonly driver: EnemyBehavior | undefined;

  constructor(def: EnemySpawnDefinition, x: number, y: number, scaling: EnemyScaling, rng: RNG, options: EnemyBodyOptions = {}) {
    super();
    this.def = def;
    this.isEnemy = true;
    this.rng = rng;
    this.x = x; this.y = y;
    this.radius = def.radius ?? 12;

    this.boss = !!def.boss;

    this.melee = isMeleeEnemy(def);

    const meleeHpBuff = this.melee ? ENEMY_MELEE_HP_BUFF : 1;

    const hpBase = this.boss ? (scaling.bossHp ?? scaling.hp) : scaling.hp;
    const hpMul = hpBase * meleeHpBuff * (this.boss ? (scaling.bossGrowth ?? 1) : 1);
    this.maxHp = (def.hp ?? 10) * hpMul;
    this.hp = this.maxHp;

    const speedScaling = this.melee ? (scaling.speedMelee ?? scaling.speed) : scaling.speed;

    const ownGrowth = this.boss ? 1 : (scaling.speedOwn ?? 1);

    this.speed = (def.speed ?? 60) * speedScaling * ownGrowth;

    const dmgRoleMul = def.boss ? BOSS_DAMAGE_MUL : def.elite ? ELITE_DAMAGE_MUL : 1;
    this.dmgScale = scaling.damage * dmgRoleMul;
    this.damage = (def.damage ?? 3) * this.dmgScale;

    this.rangeScale = scaling.bulletRange ?? 1;
    this.armor = def.armor ?? 0;
    this.xpValue = Math.max(1, Math.round((def.xp ?? 1) * scaling.xp));
    this.materialValue = Math.max(1, Math.round((def.materials ?? 1) * scaling.materials));

    this.color = def.color;
    this.shape = def.shape ?? 'circle';
    this.behavior = def.behavior ?? 'chase';
    this.elite = !!def.elite;

    this.mutant = false;

    this.facing = 0;
    this.hurtFlash = 0;

    this.hurtExpr = 0;
    this.knockbackX = 0;
    this.knockbackY = 0;
    this.splitDone = false;
    this.spawnAnimation = 0.28;
    this.scale = 0.2;

    this.stun = 0;
    this.armorShred = 0;

    this.buffTimer = 0;
    this.buffDamagePct = 0;
    this.buffDamageReduction = 0;

    this.healFlash = 0;

    // Preserve the initial HP threshold before ordinary spawn modifiers are applied.
    this.overload = this.boss ? new OverloadGuard(this.maxHp) : null;
    this.overloadNow = 0;
    this.overloadFlash = 0;

    this.curseTimer = 0;
    this.curseDamageMul = 1;
    this.curseSpeedMul = 1;
    this.curseRateMul = 1;
    this.damageGate = options.damageGate;
    this.driver = options.behavior?.(this);
  }

  get hpPercent() { return clamp(this.hp / this.maxHp, 0, 1); }

  get curseCooldownMul() {
    const m = this.curseRateMul;
    return m > 0 && m !== 1 ? 1 / m : 1;
  }

  trueBonusFor(world?: World) {
    if (world?.challenge?.rules.suppressesTrueDamage) return 0;
    const tier = this.boss ? 3 : this.elite ? 2 : 1;
    return trueDamageBonus(world?.waves.read().current?.index ?? 0, tier);
  }

  get trueTier() {
    return this.boss ? 3 : this.elite ? 2 : 1;
  }

  takeDamage(amount: number, opts: EnemyDamageOptions = {}): EnemyDamageResult {

    if (this.def.dodge && this.rng.next() < this.def.dodge) {
      return { dodged: true, dealt: 0 };
    }

    // Gate first, then armor, overload, vulnerability and healer reduction.
    let blocked = false;
    if (this.damageGate) {
      const lock = this.damageGate.filter(this, amount);
      if (lock.blocked) {
        return { blocked: true, dodged: false, dealt: 0, killed: false, reason: lock.reason };
      }
      amount = lock.amount;
      blocked = !!lock.gated;
    }

    let dmg = amount;
    if (!opts.pierceArmor && this.armor > 0) {

      const effArmor = this.armor * (1 - (this.armorShred || 0));
      dmg = Math.max(1, dmg * (1 / (1 + effArmor / 20)));
    }

    let overloaded = false;
    if (this.overload) {
      this.overload.tick(this.overloadNow);
      dmg = Math.max(1, dmg * this.overload.multiplier);
    }

    const debuffTakenPct = this.debuffTakenPct ?? 0;
    if (debuffTakenPct > 0) {
      dmg *= 1 + debuffTakenPct / 100;
    }

    if (this.buffDamageReduction > 0) {
      const red = Math.min(0.9, this.buffDamageReduction);
      dmg = Math.max(1, dmg * (1 - red));
    }

    this.hp -= dmg;
    this.hurtFlash = 0.12;

    this.driver?.onDamage();

    if (this.overload) {
      if (this.overload.recordDamage(this.overloadNow, dmg)) {
        this.overloadFlash = 0.35;
        overloaded = true;
      }
    }

    this.hurtExpr = 0.5;

    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      return { killed: true, dealt: dmg, gated: blocked, overloaded };
    }
    return { killed: false, dealt: dmg, gated: blocked, overloaded };
  }

  applyKnockback(fromX: number, fromY: number, force: number) {
    const a = angleTo(fromX, fromY, this.x, this.y);
    const mass = this.boss ? 8 : this.elite ? 3 : (this.def.radius ?? 12) / 12;

    const eliteResist = this.elite ? 0.5 : 1;
    this.knockbackX += Math.cos(a) * force * eliteResist / mass;
    this.knockbackY += Math.sin(a) * force * eliteResist / mass;
  }

  readGuard(): EnemyGuardView | null { return this.damageGate?.read?.() ?? null; }
  setBehaviorOverride(value: BehaviorOverride): void {
    if (!this.driver) throw new Error('A controlled body has no ordinary behavior');
    this.driver.setOverride(value);
  }

  update(dt: number, player: Player, world: World) {
    this.age += dt;

    if (this.overloadFlash > 0) this.overloadFlash = Math.max(0, this.overloadFlash - dt);

    if (this.overload) {
      this.overloadNow += dt;
      if (this.overload.update(this.overloadNow)) {
        this.overloadFlash = 0.35;
      }
    }
    if (this.spawnAnimation > 0) {
      this.spawnAnimation -= dt;
      this.scale = clamp(1 - this.spawnAnimation / 0.28, 0.2, 1);
    } else {
      this.scale = 1;
    }
    if (this.hurtFlash > 0) this.hurtFlash -= dt;
    if (this.hurtExpr > 0) this.hurtExpr -= dt;
    if (this.stun > 0) this.stun -= dt;

    const distanceBeforeMovement = Math.hypot(player.x - this.x, player.y - this.y) || 1;
    this.facing = Math.atan2(player.y - this.y, player.x - this.x);
    this.damageGate?.advance?.(dt);
    if (this.driver) {
      this.driver.update(dt, player, world, this.completeStatus);
    } else {
      this.completeStatus(dt, world, this.stun > 0);
      if (this.damage > 0 && this.stun <= 0) this.applyContact(player, world, distanceBeforeMovement);
    }
  }

  /** Returns true when weather cancels contact, preserving the caller's early return. */
  applyContact(player: Player, world: World, distToPlayer: number): boolean {
    const rr = this.radius + player.radius;
    if (distToPlayer < rr && player.invuln <= 0) {

      const wxW = world?.weather;
      let dmg = this.damage * (1 + this.buffDamagePct / 100) * this.curseDamageMul;
      if (wxW) {
        if (wxW.enemyOut !== 1) dmg *= wxW.enemyOut;
        if (wxW.miss > 0) {

          if (wxW.rng.next() * 100 < wxW.miss) return true;
        }
      }

      player.takeDamage(dmg, this.x, this.y, { trueBonus: this.trueBonusFor(world), weatherChecked: (wxW?.miss ?? 0) > 0 });

      if (!(wxW?.noKnockback)) this.applyKnockback(player.x, player.y, 40);
    }
    return false;
  }

  // Ordinary AI completes these timers after movement; stun pauses them but still applies knockback.
  private readonly completeStatus = (dt: number, world: World, stunned = false) => {
    if (stunned) { this._applyKnockback(dt, world); return; }
    if (this.buffTimer > 0) {
      this.buffTimer -= dt;
      if (this.buffTimer <= 0) {

        this.buffTimer = 0;
        this.buffDamagePct = 0;
        this.buffDamageReduction = 0;
      }
    }

    if (this.curseTimer > 0) {
      this.curseTimer -= dt;
      if (this.curseTimer <= 0) {
        this.curseTimer = 0;
        this.curseDamageMul = 1;
        this.curseSpeedMul = 1;
        this.curseRateMul = 1;
      }
    }
    if (this.healFlash > 0) this.healFlash -= dt * 2.5;

    this._applyKnockback(dt, world);
  };

  private _applyKnockback(dt: number, world?: World) {
    if (this.knockbackX === 0 && this.knockbackY === 0) return;
    this.x += this.knockbackX * dt;
    this.y += this.knockbackY * dt;

    if (world) {
      const half = world.halfSize - this.radius;
      this.x = clamp(this.x, -half, half);
      this.y = clamp(this.y, -half, half);
      if (world.terrain) {
        resolveTerrain(world.terrain, this);
      }
    }
    const decay = Math.exp(-8 * dt);
    this.knockbackX *= decay;
    this.knockbackY *= decay;
    if (Math.abs(this.knockbackX) < 1) this.knockbackX = 0;
    if (Math.abs(this.knockbackY) < 1) this.knockbackY = 0;
  }
}
