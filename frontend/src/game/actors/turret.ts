import type { Player } from './player.ts';
import type { PhantomClone } from './phantom.ts';
import type { WeaponInstance } from './weapon.ts';
import type { World } from '../world/world.ts';
import type { CombatTarget } from '../combat/types.ts';
import type { WeaponDefinition } from '../content/definitions.ts';
type TurretOwner = Player | PhantomClone;

// 炮台自行索敌开火、不吃接触伤害；超出放置上限时替换最早炮台。

import { weaponEquipment } from '../abilities/equipment.ts';
import { Entity } from './entity.ts';
import { angleTo } from '../math/geometry.ts';

export class Turret extends Entity<[World]> {
  def: WeaponDefinition;
  weapon: WeaponInstance;
  damageMul: number;
  range: number;
  rateMul: number;
  ownerPlayer: TurretOwner;
  cooldown: number;
  angle: number;
  recoil: number;
  spawnAnim: number;
  life: number;

  constructor(def: WeaponDefinition, x: number, y: number, ownerWeapon: WeaponInstance, player: TurretOwner) {
    super();
    this.def = def;
    this.weapon = ownerWeapon;   // 记录是哪把武器放出来的（用于统计与伤害归属）
    this.radius = 13;

    this.x = x;
    this.y = y;

    // 放置时快照炮台属性及角色倍率；动态受伤叠层在每次开火时读取。
    const s = player.stats.values;
    // 近战/远程/元素伤害按50%折入炮台伤害，攻击距离按25%折入炮台射程。
    const kindDmg = (s.meleeDamage + s.rangedDamage + s.elemDamage) * 0.5;
    this.damageMul = 1 + (s.damage + s.turretDamage + kindDmg) / 100;
    this.damageMul *= 'mulFor' in player ? player.mulFor('turretDamage') : 1;
    this.range = (def.range ?? 260) * (1 + (s.turretRange + Number(s.range)) / 100);
    // 智慧型魔棒也最终增加炮台射程；追踪在生成子弹时注入。
    if ('hasItem' in player) this.range = weaponEquipment.range(player, this.range, false);
    this.rateMul = 1 + (s.turretRate + s.attackSpeed * 0.5) / 100;
    this.rateMul *= 'mulFor' in player ? player.mulFor('turretRate') : 1;
    // 记住放它的玩家：炮台每帧要问"这个角色的技能有没有给目标叠层"
    this.ownerPlayer = player;

    this.cooldown = 0.35;        // 落地后短暂延迟，避免瞬间齐射
    this.angle = 0;
    this.recoil = 0;
    this.spawnAnim = 0.3;
    this.life = def.turretLife ?? 0;  // 0 = 永久
  }

  update(dt: number, world: World) {
    this.age += dt;
    if (this.spawnAnim > 0) this.spawnAnim -= dt;
    if (this.recoil > 0) this.recoil -= dt;

    // 限时炮台（当前武器都是永久，保留给以后用）
    if (this.life > 0) {
      this.life -= dt;
      if (this.life <= 0) { this.dead = true; return; }
    }

    // 索敌
    const target = world.grid.nearest(this.x, this.y, this.range, (e: CombatTarget) => e.isEnemy && !e.dead);
    if (!target) return;
    this.angle = angleTo(this.x, this.y, target.x, target.y);

    this.cooldown -= dt * this.rateMul;
    if (this.cooldown > 0) return;

    // 炮台基础与等级倍率可缓存；M博士临时叠层须每次开火现读。
    const md = ('charRt' in this.ownerPlayer ? this.ownerPlayer.charRt?.mdDamageBonus : 0) ?? 0;
    const base = (this.def.damage ?? 5) * (this.weapon?.levelDamageMul ?? 1);
    const dmg = base * this.damageMul * (1 + md / 100);

    const def = this.def;
    const n = def.shots ?? 1;
    const spread = ((def.spreadAngle ?? 0) * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const a = this.angle - spread / 2 + spread * t;
      world.spawnBullet({
        x: this.x, y: this.y, angle: a,
        speed: def.speed ?? 400,
        damage: dmg,
        range: this.range * 1.15,
        // 炮台弹享受道具穿透，其追加穿透衰减由Bullet统一记账。
        pierce: (def.pierce ?? 0) + (('apPierce' in this.ownerPlayer ? this.ownerPlayer.apPierce : 0) ?? 0),
        itemPierce: ('apPierce' in this.ownerPlayer ? this.ownerPlayer.apPierce : 0) ?? 0,
        radius: 5,
        color: def.color,
        owner: this.weapon,          // 归属到放它的那把武器
        // 炮台弹归放置者，避免队友伤害与救援被错误记到P1。
        ownerPlayer: this.ownerPlayer,
        kind: 'turret',
        behavior: 'shot',
      });
    }

    this.cooldown = Math.max(0.1, (def.turretCooldown ?? def.cooldown ?? 3) / Math.max(0.2, this.rateMul));
    this.recoil = 0.16;
    world.fx?.ring(this.x, this.y, 16, def.color, 0.22);

    // 炮台不经过Weapon.update，须在自身发射路径发武器音效事件。
    world.onWeaponFire?.(def, false);
  }
}

/**
 * 炮台管理器：负责「最多 N 座、放满替换最早的一座」。
 * 放在 World 里，随波次清理。
 */
export class TurretManager {
  items: Turret[];
  constructor() {
    this.items = [];
  }

  get count() { return this.items.length; }

  /**
   * 放置一座炮台。
   */
  deploy(def: WeaponDefinition, x: number, y: number, weapon: WeaponInstance, player: TurretOwner, maxCount: number) {
    let replaced: Turret | null = null;
    if (this.items.length >= maxCount) {
      // 放满了：替换最早放的那一座（玩家不用先手动拆）
      replaced = this.items.shift() ?? null;
      if (replaced) replaced.dead = true;
    }
    const t = new Turret(def, x, y, weapon, player);
    this.items.push(t);
    return { placed: true, replaced, turret: t };
  }

  update(dt: number, world: World) {
    for (const t of this.items) {
      if (!t.dead) t.update(dt, world);
    }
    // 清理已死的
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].dead) this.items.splice(i, 1);
    }
  }

  clear() {
    for (const t of this.items) t.dead = true;
    this.items.length = 0;
  }
}
