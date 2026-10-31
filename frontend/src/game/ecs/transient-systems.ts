import type { Bullet, EnemyBullet } from '../actors/bullet.ts';
import type { Pickup } from '../actors/pickup.ts';
import type { CombatTarget } from '../combat/types.ts';
import type { ComponentColumns } from './components.ts';
import { PICKUP_TYPE } from './components.ts';
import type { Player } from '../actors/player.ts';
import type { World } from '../world/world.ts';
import type { ComponentList } from './entity-store.ts';
import { PLAYER_SHOT_FIELDS, ENEMY_SHOT_FIELDS, PICKUP_FIELDS } from './components.ts';
import { angleTo, angleDiff, clamp } from '../math/geometry.ts';
import { trueDamageBonus } from '../content/difficulty.ts';

const enemyTarget = (entity: CombatTarget) => entity.isEnemy;

export function advancePlayerProjectile(entity: Bullet, dt: number, world: World): boolean {
  const { columns, row } = entity.numericComponents(PLAYER_SHOT_FIELDS);
  return advancePlayerProjectileRow(entity, dt, world, columns, row);
}
function advancePlayerProjectileRow(entity: Bullet, dt: number, world: World, c: ComponentColumns, row: number): boolean {
    c.age[row] += dt;

    // ---- 追踪 ----
    if (entity.behavior === 'homing' && c.homing[row] > 0) {
      const target = entity.homingTarget = world.grid.nearest(c.x[row], c.y[row], 260, enemyTarget, entity.hitIds, entity.homingTarget) ?? undefined;
      if (target) {
        const desired = angleTo(c.x[row], c.y[row], target.x, target.y);
        const diff = angleDiff(c.angle[row], desired);
        const maxTurn = c.homing[row] * dt;
        c.angle[row] += Math.max(-maxTurn, Math.min(maxTurn, diff));
      }
    }

    const dx = Math.cos(c.angle[row]) * c.speed[row] * dt;
    const dy = Math.sin(c.angle[row]) * c.speed[row] * dt;
    c.x[row] += dx;
    c.y[row] += dy;
    c.traveled[row] += Math.hypot(dx, dy);

    // ---- 拖尾 ----
    c.trailTimer[row] -= dt;
    if (c.trailTimer[row] <= 0) {
      c.trailTimer[row] = 0.03;
      entity.trail.append(c.x[row], c.y[row]);
    }
    entity.trail.fade(dt);

    // ---- 超出射程 ----
    if (c.traveled[row] > c.maxRange[row]) {
      if (c.explosionRadius[row] > 0) entity._explode(world);
      entity.dead = true;
      return false;
    }

    // ---- 超出世界边界 ----
    const half = world.halfSize + 60;
    if (Math.abs(c.x[row]) > half || Math.abs(c.y[row]) > half) {
      entity.dead = true;
      return false;
    }
    return true;
}

export function explodeProjectile(entity: Bullet, world: World): void {
    const hits = world.grid.borrowQuery(entity.x, entity.y, entity.explosionRadius);
    try {
    for (const e of hits) {
      if (!e.isEnemy || e.dead) continue;
      world.dealDamage(entity.requireAttacker(), entity.owner, e, entity.damage * 0.7, {
        knockback: 60, fromX: entity.x, fromY: entity.y,
      });
    }
    } finally { world.grid.releaseQuery(hits); }
    world.fx.explosion(entity.x, entity.y, entity.explosionRadius, entity.color,
        entity.isEnemyBullet ? null : { player: true });

}

export function resolvePlayerHit(entity: Bullet, world: World): void {
  const { columns, row } = entity.numericComponents(PLAYER_SHOT_FIELDS);
  resolvePlayerHitRow(entity, world, columns, row);
}
function resolvePlayerHitRow(entity: Bullet, world: World, c: ComponentColumns, row: number): void {
    // 倒地队友的弹道救援圈扩大40px；命中转为救援计数，不造成伤害。
    for (const ally of (world.players?.() ?? [])) {
      if (!ally || ally === entity.ownerPlayer || !ally.downed) continue;
      const adx = ally.x - c.x[row], ady = ally.y - c.y[row];
      const arr = c.radius[row] + ally.radius + 40;
      if (adx * adx + ady * ady <= arr * arr) {
        entity.dead = true;
        const revived = ally.rescueHit();
        if (revived) {
          world.fx?.nova?.(ally.x, ally.y, 26, '#7cf3c4');
          world.fx?.damageText?.(ally.x, ally.y - ally.radius - 10, '救援成功！', false, '#7cf3c4');
        } else if (!ally._rescueGate || ally._rescueGate >= 0.19) {
          // 本击刚设置救援门控才显示整数进度；门控内重复命中不刷字。
          world.fx?.sparkle?.(ally.x, ally.y, '#7cf3c4');
          world.fx?.damageText?.(ally.x, ally.y - ally.radius - 10,
            `救援 +1（${Math.round(ally.rescueNeed - ally.rescueProgress)}/${ally.rescueNeed}）`, false, '#7cf3c4');
        }
        return;
      }
    }
    const hits = world.grid.borrowQuery(c.x[row], c.y[row], c.radius[row]);
    try {
    for (const e of hits) {
      if (!e.isEnemy || e.dead) continue;
      if (entity.hitIds.has(e.id)) continue;
      entity.hitIds.add(e.id);

      // 挑战格挡只截远程弹；近战判定不经过弹丸路径。
      const hit = world.dealDamage(entity.requireAttacker(), entity.owner, e, entity.damage * Math.pow(0.6, entity.itemUsed), {
        knockback: 50, fromX: entity.x, fromY: entity.y,
        // 炮台弹显式标记来源，防止玩家普通武器误触炮台专精叠层。
        fromTurret: entity.kind === 'turret', projectile: true,
      });
      if (typeof hit === 'object' && hit.parried) { entity.dead = true; return; }

      if (entity.explosionRadius > 0) {
        entity._explode(world);
        entity.dead = true;
        return;
      }

      if (entity.pierce > 0) {
        entity.pierce--;
        // 先消耗自带的（全额段），再消耗道具的（衰减段）
        if (entity.innatePierce > 0) entity.innatePierce--;
        else { entity.itemPierce--; entity.itemUsed++; }
      } else if (entity.behavior === 'bounce' && entity.bounced < entity.bounces) {
        // 弹跳：转向最近的未命中敌人
        entity.bounced++;
        const next = world.grid.nearest(entity.x, entity.y, 220, enemyTarget, entity.hitIds);
        if (next) {
          entity.angle = angleTo(entity.x, entity.y, next.x, next.y);
          entity.traveled = Math.max(0, entity.traveled - 60);
          return;
        }
        entity.dead = true;
        return;
      } else {
        entity.dead = true;
        return;
      }
    }

    } finally { world.grid.releaseQuery(hits); }
}

export function advanceEnemyProjectile(entity: EnemyBullet, dt: number, world: World, players: Player | readonly Player[]): void {
  const { columns, row } = entity.numericComponents(ENEMY_SHOT_FIELDS);
  advanceEnemyProjectileRow(entity, dt, world, players, columns, row);
}
function advanceEnemyProjectileRow(entity: EnemyBullet, dt: number, world: World, players: Player | readonly Player[], c: ComponentColumns, row: number): void {
    c.age[row] += dt;
    c.rotation[row] += dt * 6;
    if (c.decel[row] > 0 && c.speed[row] > c.floorSpeed[row]) {
      c.speed[row] = Math.max(c.floorSpeed[row], c.speed[row] - c.decel[row] * dt);
    }

    const dx = Math.cos(c.angle[row]) * c.speed[row] * dt;
    const dy = Math.sin(c.angle[row]) * c.speed[row] * dt;
    c.x[row] += dx;
    c.y[row] += dy;
    c.traveled[row] += Math.hypot(dx, dy);

    // 上/左/右墙各反弹一次，底墙不反弹；左右镜像x分量，上墙镜像y分量。
    if (entity.wall) {
      const w = entity.wall;
      if (c.x[row] <= w.minX && entity.wallCount.left < 1) {
        c.x[row] = w.minX;
        c.angle[row] = Math.PI - c.angle[row];
        entity.wallCount.left += 1;
      } else if (c.x[row] >= w.maxX && entity.wallCount.right < 1) {
        c.x[row] = w.maxX;
        c.angle[row] = Math.PI - c.angle[row];
        entity.wallCount.right += 1;
      }
      if (c.y[row] <= w.minY && entity.wallCount.top < 1) {
        c.y[row] = w.minY;
        c.angle[row] = -c.angle[row];
        entity.wallCount.top += 1;
      }
    }

    if (c.traveled[row] > c.maxRange[row]) { entity.dead = true; return; }

    const half = world.halfSize + 80;
    if (Math.abs(c.x[row]) > half || Math.abs(c.y[row]) > half) { entity.dead = true; return; }

    // 按活玩家顺序判命中；弹幕使用hitR，身体碰撞仍使用radius。
    const list = players instanceof Array ? players : 'x' in players ? [players] : players;
    for (const player of list) {
      if (!player || player.dead || player.downed) continue;
      const rr = c.hitRadius[row] + (player.hitR ?? player.radius);
      const ddx = player.x - c.x[row], ddy = player.y - c.y[row];
      if (ddx * ddx + ddy * ddy > rr * rr) continue;
      // 浓雾miss使用天气独立随机流；雾雨的全体伤害增益也作用敌弹。
      const wxW = world?.weather;
      if (wxW && wxW.miss > 0 && wxW.rng.next() * 100 < wxW.miss) {
        entity.dead = true;
        return;
      }
      // Ordinary projectiles retain hit-time wave scaling; custom profiles own their damage rules.
      const trueBonus = c.trueTier[row] ? trueDamageBonus(world?.waves.read().current?.index ?? 0, c.trueTier[row]) : 0;
      if (entity.hitProfile) entity.hitProfile.hit(player, c.x[row], c.y[row]);
      else player.takeDamage(c.damage[row] * (wxW?.enemyOut ?? 1), c.x[row], c.y[row], { projectile: true, trueBonus, weatherChecked: (wxW?.miss ?? 0) > 0 });
      entity.dead = true;
      return;
    }

}

export function advancePickup(entity: Pickup, dt: number, world: World, player: Player): void {
  const { columns, row } = entity.numericComponents(PICKUP_FIELDS);
  advancePickupRow(entity, dt, world, player, columns, row);
}
function advancePickupRow(entity: Pickup, dt: number, world: World, player: Player, c: ComponentColumns, row: number): void {
    c.age[row] += dt;
    c.life[row] += dt;
    c.bobPhase[row] += dt * 3;

    // 经验与材料90秒后消散并记补偿债，防止无尽模式跨波无限累积。
    if ((entity.type === PICKUP_TYPE.XP || entity.type === PICKUP_TYPE.MATERIAL)
      && c.life[row] > 90) {
      // 过期掉落记为补偿个数，后续对应拾取双倍收益直至额度耗尽。
      if (entity.type === PICKUP_TYPE.XP) player.xpDebt = (player.xpDebt ?? 0) + 1;
      else player.materialDebt = (player.materialDebt ?? 0) + 1;
      entity.dead = true;
      return;
    }

    const dx = player.x - c.x[row];
    const dy = player.y - c.y[row];
    const d = Math.hypot(dx, dy) || 1;

    // 代打磁吸与实际拾取范围取最大值，不能削弱玩家已有成长。
    const pickupRange = Math.max(player.stats.get('pickupRange'), player._pilotMagnet ?? 0);

    // 满血玩家不主动吸医疗包；包留在场上供以后受伤时拾取。
    const fullHp = player.hp >= player.maxHp;
    const noAutoHeal = entity.type === PICKUP_TYPE.HEAL && fullHp;

    // 快晴吸收全部掉落，满血不主动吸医疗包的边界仍保留。
    const vacuum = !noAutoHeal && world.weather?.vacuum === true;
    if (!noAutoHeal && (vacuum || c.attracted[row] || d < pickupRange)) {
      c.attracted[row] = 1;
      // 进入吸取范围后直接按距离调速，不再缓慢加速以免掉落追不上玩家。
      const targetSpeed = clamp(1300 - d, 380, 1300);
      const tvx = (dx / d) * targetSpeed;
      const tvy = (dy / d) * targetSpeed;
      const k = Math.min(1, dt * 14);
      c.vx[row] += (tvx - c.vx[row]) * k;
      c.vy[row] += (tvy - c.vy[row]) * k;
    } else {
      // 摩擦停止
      const decay = Math.exp(-6 * dt);
      c.vx[row] *= decay;
      c.vy[row] *= decay;
    }

    c.x[row] += c.vx[row] * dt;
    c.y[row] += c.vy[row] * dt;

    // 拾取判定
    const rr = c.radius[row] + player.radius + 4;
    if (d < rr) {
      entity._collect(world, player);
      if (entity.componentColumns !== c && entity.componentRow === -1) { clampRetiredPickup(entity, world); return; }
    }

    // 世界边界
    const half = world.halfSize - 4;
    if (c.x[row] < -half) { c.x[row] = -half; c.vx[row] = Math.abs(c.vx[row]) * 0.5; }
    if (c.x[row] > half) { c.x[row] = half; c.vx[row] = -Math.abs(c.vx[row]) * 0.5; }
    if (c.y[row] < -half) { c.y[row] = -half; c.vy[row] = Math.abs(c.vy[row]) * 0.5; }
    if (c.y[row] > half) { c.y[row] = half; c.vy[row] = -Math.abs(c.vy[row]) * 0.5; }

}

export function collectPickup(entity: Pickup, world: World, player: Player): void {
    entity.dead = true;
    // 每个补偿额度多发同一收益一次，双份均通过正常经验/材料入口吃角色加成。
    const doubled = entity.type === PICKUP_TYPE.XP
      ? (player.xpDebt ?? 0) > 0
      : entity.type === PICKUP_TYPE.MATERIAL && (player.materialDebt ?? 0) > 0;
    if (doubled) {
      if (entity.type === PICKUP_TYPE.XP) player.xpDebt--;
      else player.materialDebt--;
    }
    switch (entity.type) {
      case PICKUP_TYPE.XP:
        // 经验全队共享，各自升级；补偿额度只消耗吸取者的。
        player.gainXp(entity.value);
        if (doubled) player.gainXp(entity.value);
        for (const other of (world.players?.() ?? [player])) {
          if (other && other !== player && !other.dead) other.gainXp(entity.value);
        }
        world.fx.sparkle(entity.x, entity.y, doubled ? '#a7f3d0' : '#6ee7a8');
        break;
      case PICKUP_TYPE.MATERIAL:
        // 金币独立：谁吃到归谁（world 分发时已把最近的玩家传进来）
        player.gainMaterials(entity.value);
        if (doubled) player.gainMaterials(entity.value);
        world.fx.sparkle(entity.x, entity.y, doubled ? '#ffe08a' : '#ffc857');
        break;
      case PICKUP_TYPE.HEAL:
        // 医疗包由谁拾取都治疗全队，各回value；死亡与倒地成员排除。
        player.heal(entity.value);
        for (const other of (world.players?.() ?? [player])) {
          if (other && other !== player && !other.dead && !other.downed) other.heal(entity.value);
        }
        world.fx.sparkle(entity.x, entity.y, '#ff5f6d');
        break;
    }
    world.onPickup?.(entity);

}

function clampRetiredPickup(entity: Pickup, world: World): void {
 const half = world.halfSize - 4;
 if(entity.x < -half){entity.x = -half; entity.vx = Math.abs(entity.vx) * .5;}
 if(entity.x > half){entity.x = half; entity.vx = -Math.abs(entity.vx) * .5;}
 if(entity.y < -half){entity.y = -half; entity.vy = Math.abs(entity.vy) * .5;}
 if(entity.y > half){entity.y = half; entity.vy = -Math.abs(entity.vy) * .5;}
}
/** Preserve per-entity movement -> collision -> synchronous settlement, including
 * appended entities, before the original end-of-step reverse sweeps. */
export function updatePlayerProjectiles(list: ComponentList<Bullet>, dt: number, world: World): void {
 for(let row = 0; row < list.items.length; row++) {
  if(list.columns.dead[row])continue;
  const entity = list.items[row];
  if(advancePlayerProjectileRow(entity,dt,world,list.columns,row))resolvePlayerHitRow(entity,world,list.columns,row);
 }
}
export function updateEnemyProjectiles(list: ComponentList<EnemyBullet>, dt: number, world: World, players: readonly Player[]): void {
 for(let row = 0; row < list.items.length; row++) {
  if(list.columns.dead[row])continue;
  const entity = list.items[row]; advanceEnemyProjectileRow(entity,dt,world,players,list.columns,row);
  if(entity.hostileToEnemies&&!entity.dead)for(const enemy of world.enemies.items){
   if(enemy.dead||enemy.isChest||!enemy.melee||enemy.mutant||enemy.boss)continue;
   const dx=enemy.x-entity.x,dy=enemy.y-entity.y,rr=enemy.radius+(entity.radius??6);
   if(dx*dx+dy*dy<=rr*rr){enemy.takeDamage(entity.damage??4,{pierceArmor:true});entity.dead=true;world.fx?.nova?.(entity.x,entity.y,12,'#a8b6ff');break;}
  }
 }
}
export function updatePickups(list: ComponentList<Pickup>, dt: number, world: World): void {
 for(let row = 0; row < list.items.length; row++) {
  if(list.columns.dead[row])continue;
  const entity=list.items[row];advancePickupRow(entity,dt,world,world.nearestPlayerTo(list.columns.x[row],list.columns.y[row])!,list.columns,row);
 }
}
