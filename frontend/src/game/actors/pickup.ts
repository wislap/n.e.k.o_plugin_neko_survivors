import type { Player } from './player.ts';
import type { World } from '../world/world.ts';
import { RNG } from '../math/random.ts';
// 掉落物：经验宝石 / 材料 / 生命
// 材料会被玩家的拾取范围自动吸引。

import { ComponentEntity, defineComponents } from '../ecs/entity-store.ts';
import { PICKUP_FIELDS, MOTION_FIELDS } from '../ecs/components.ts';
import { advancePickup, collectPickup } from '../ecs/transient-systems.ts';
import { TAU } from '../math/geometry.ts';

import { PICKUP_TYPE } from '../ecs/components.ts';
export { PICKUP_TYPE } from '../ecs/components.ts';
export type PickupType = typeof PICKUP_TYPE[keyof typeof PICKUP_TYPE];

export class Pickup extends ComponentEntity {
  type: PickupType;
  declare value: number;
  declare attracted: boolean;
  declare bobPhase: number;
  declare life: number;
  declare variant: 1 | 2;

  constructor(type: PickupType, x: number, y: number, value = 1, rng = new RNG(((x * 73856093) ^ (y * 19349663) ^ value) >>> 0)) {
    super();
    this.type = type;
    const a = rng.next() * TAU, speed = 40 + rng.next() * 50;
    const vx = Math.cos(a) * speed, vy = Math.sin(a) * speed;
    const bobPhase = rng.next() * TAU, variant = rng.next() < .5 ? 1 : 2;
    this.initializeComponents({ x, y, vx, vy, radius: type === PICKUP_TYPE.XP ? 6 : 7,
      age: 0, dead: 0, value, attracted: 0, bobPhase, life: 0, variant });
  }

  update(dt: number, world: World, player: Player) { advancePickup(this, dt, world, player); }

  _collect(world: World, player: Player) { collectPickup(this, world, player); }
}

defineComponents(Pickup.prototype, PICKUP_FIELDS, ['attracted'], MOTION_FIELDS.length);
