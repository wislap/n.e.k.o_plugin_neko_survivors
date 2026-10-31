import type { CombatTarget } from '../combat/types.ts';
import type { IncomingHitProfile } from '../combat/incoming-hit.ts';
import type { World } from '../world/world.ts';
import type { Player } from './player.ts';
import type { WeaponInstance, WeaponOwner } from './weapon.ts';
import type { WeaponDefinition } from '../content/definitions.ts';
export type BulletShape = 'orb' | 'longball' | 'crystal' | 'jade' | 'rice' | 'star' | 'petal' | 'drop' | 'shard' | 'ring' | 'blade';
export interface BulletWall { minX: number; maxX: number; minY: number }
interface BulletMotion { x: number; y: number; angle: number; speed: number; damage: number; radius?: number; color?: string; range?: number }
export interface BulletConfig extends BulletMotion {
  owner?: WeaponInstance | null;
  ownerPlayer?: WeaponOwner | null;
  kind?: WeaponDefinition['kind'];
  behavior?: WeaponDefinition['behavior'];
  pierce?: number; itemPierce?: number; homing?: number; bounces?: number; bounced?: number; explosionRadius?: number;
}
export interface EnemyBulletConfig extends BulletMotion {
  hitProfile?: IncomingHitProfile;
  hwKind?: string; hwPhase?: number; trueTier?: 0 | 1 | 2 | 3;
  shape?: BulletShape; hitRadius?: number; jadeColor?: string; tag?: string;
  laser?: boolean; laserLength?: number; wall?: BulletWall | null; decel?: number; floorSpeed?: number;
}

/** Motion and display parameters shared by encounter emission primitives. */
export type EnemyShot = Omit<EnemyBulletConfig, 'damage' | 'hitProfile' | 'trueTier'>;

// 子弹：玩家子弹与敌人子弹
// 支持 直线 / 追踪 / 弹跳 三种行为

import { ComponentEntity, defineComponents } from '../ecs/entity-store.ts';
import { PLAYER_SHOT_FIELDS, ENEMY_SHOT_FIELDS, MOTION_FIELDS } from '../ecs/components.ts';
import { TrailBuffer } from '../ecs/trail-buffer.ts';
import { advancePlayerProjectile, explodeProjectile, resolvePlayerHit, advanceEnemyProjectile } from '../ecs/transient-systems.ts';

// 第一百三十二轮：波次真伤档位随弹携带（命中时按当前波结算）

export class Bullet extends ComponentEntity {
  declare angle: number;
  declare speed: number;
  declare damage: number;
  color: string;
  owner: WeaponInstance | null;
  ownerPlayer: WeaponOwner | null;
  kind: WeaponDefinition['kind'];
  behavior: WeaponDefinition['behavior'];
  declare pierce: number;
  declare itemPierce: number;
  declare innatePierce: number;
  declare itemUsed: number;
  declare homing: number;
  declare bounces: number;
  declare bounced: number;
  declare explosionRadius: number;
  isEnemyBullet: false;
  declare maxRange: number;
  declare traveled: number;
  hitIds: Set<number>;
  homingTarget?: CombatTarget;
  trail: TrailBuffer;
  declare trailTimer: number;

  requireAttacker(): WeaponOwner {
    if (!this.ownerPlayer) throw new TypeError('Player projectile has no damage owner');
    return this.ownerPlayer;
  }

  constructor(cfg: BulletConfig) {
    super();
    const pierce = cfg.pierce ?? 0, itemPierce = cfg.itemPierce ?? 0;
    this.initializeComponents({ x: cfg.x, y: cfg.y, vx: 0, vy: 0, radius: cfg.radius ?? 6, age: 0, dead: 0,
      angle: cfg.angle, speed: cfg.speed, damage: cfg.damage,
      pierce, itemPierce, innatePierce: pierce - itemPierce, itemUsed: 0,
      homing: cfg.homing ?? 0, bounces: cfg.bounces ?? 0, bounced: cfg.bounced ?? 0,
      explosionRadius: cfg.explosionRadius ?? 0, maxRange: cfg.range ?? 400, traveled: 0, trailTimer: 0 });
    this.color = cfg.color ?? '#ffffff';
    this.owner = cfg.owner ?? null;      // 武器实例
    // 弹丸保留真实发射者，命中时使用其角色修正并正确归属伤害与奖励。
    this.ownerPlayer = cfg.ownerPlayer ?? null;
    this.kind = cfg.kind ?? 'ranged';
    this.behavior = cfg.behavior ?? 'shot';
    this.isEnemyBullet = false;

    this.hitIds = new Set();
    this.trail = new TrailBuffer();
  }

  update(dt: number, world: World) { advancePlayerProjectile(this, dt, world); }

  _explode(world: World) { explodeProjectile(this, world); }

  /** 与敌人碰撞检测（由 World 调用） */
  checkEnemyHit(world: World) { resolvePlayerHit(this, world); }
}

/** 敌人子弹：命中玩家 */
export class EnemyBullet extends ComponentEntity {
  declare angle: number;
  declare speed: number;
  declare damage: number;
  color: string;
  declare maxRange: number;
  declare traveled: number;
  isEnemyBullet: true;
  isEnemy: false;
  hitProfile: IncomingHitProfile | null;
  hwKind: string;
  declare hwPhase: number;
  declare trueTier: 0 | 1 | 2 | 3;
  declare rotation: number;
  shape: BulletShape;
  declare hitRadius: number;
  jadeColor: string | undefined;
  tag: string;
  laser: boolean;
  declare laserLength: number;
  wall: BulletWall | null;
  wallCount: { top: number; left: number; right: number };
  declare decel: number;
  declare floorSpeed: number;
  declare hostileToEnemies?: boolean;

  constructor(cfg: EnemyBulletConfig) {
    super();
    this.initializeComponents({ x: cfg.x, y: cfg.y, vx: 0, vy: 0, radius: cfg.radius ?? 7, age: 0, dead: 0,
      angle: cfg.angle, speed: cfg.speed, damage: cfg.damage, maxRange: cfg.range ?? 500, traveled: 0,
      rotation: 0, hitRadius: cfg.hitRadius ?? cfg.radius ?? 7, laserLength: cfg.laserLength ?? 120,
      decel: cfg.decel ?? 0, floorSpeed: cfg.floorSpeed ?? 0, trueTier: cfg.trueTier ?? 0, hwPhase: cfg.hwPhase ?? 0 });
    this.color = cfg.color ?? '#ff5f6d';
    this.isEnemyBullet = true;
    this.isEnemy = false;
    this.hitProfile = cfg.hitProfile ?? null;
    // Display-only metadata; damage dispatch belongs to the projectile's profile.
    this.hwKind = cfg.hwKind ?? '';
    // 真伤档位随弹保存，命中时按当前波结算；无来源的挑战弹不附加。
    // 弹型影响显示与命中半径；longball、crystal的hitRadius默认沿用radius。
    this.shape = cfg.shape ?? 'orb';
    // radius用于显示，hitRadius用于碰撞；大玉白圈无判定，只有中心核心命中。
    // 大玉显示基色；未指定时使用默认黄盘。
    this.jadeColor = cfg.jadeColor;
    // 来源标记让符卡只认领自己产生的弹丸。
    this.tag = cfg.tag ?? '';
    // 激光保留长度，不能只用高速圆形弹丸代替光束显示。
    this.laser = !!cfg.laser;
    // 光束长度（仅 laser 用）；表示"这一束有多长"
    // 墙反弹只配置上/左/右边界，故意不含底边。
    this.wall = cfg.wall ?? null;
    this.wallCount = { top: 0, left: 0, right: 0 };
    // 减速弹按px/s²线性降速，到floorSpeed后保持。
  }

  update(dt: number, world: World, players: Player | readonly Player[]) { advanceEnemyProjectile(this, dt, world, players); }
}

defineComponents(Bullet.prototype, PLAYER_SHOT_FIELDS, [], MOTION_FIELDS.length);
defineComponents(EnemyBullet.prototype, ENEMY_SHOT_FIELDS, [], MOTION_FIELDS.length);
