import type { Player } from './player.ts';
import type { PhantomClone } from './phantom.ts';
import type { EnemyBody } from './enemy.ts';
import type { Chest } from './chest.ts';
import type { World } from '../world/world.ts';
import type { WeaponDefinition } from '../content/definitions.ts';
import type { Point } from '../views.ts';
export type WeaponOwner = Player | PhantomClone;
type WeaponTarget = EnemyBody | Chest;
import { weaponEquipment } from '../abilities/equipment.ts';
import { weaponLevelModifiers } from '../progression/weapon-growth.ts';
// 武器实例拥有冷却与攻击行为，弹丸和命中事务交给世界。

import { angleTo, TAU } from '../math/geometry.ts';

// 定向攻击先锁最近目标；范围和环绕行为不要求单一目标。
const AIMED_BEHAVIORS = new Set([
  'sweep', 'thrust', 'shot', 'spread', 'homing', 'bounce', 'chain', 'beam',
  'quake', 'flurry',
]);

// 近战救援使用独立0.2秒全局冷却，避免被武器单目标命中冷却拖慢。
function rescueDownedAllies(player: WeaponOwner, world: World, x: number, y: number, range: number) {
  for (const ally of (world.players?.() ?? [])) {
    if (!ally || ally === player || !ally.downed) continue;
    const dx = ally.x - x, dy = ally.y - y;
    const rr = range + 40;   // 与弹道救援同款 +40 容差
    if (dx * dx + dy * dy > rr * rr) continue;
    const revived = ally.rescueHit();
    // gate 刚置位（=0.2）说明这一刀真的计了数，不是 0.2s 内的重复命中
    if (revived) {
      world.fx?.nova?.(ally.x, ally.y, 26, '#7cf3c4');
      world.fx?.damageText?.(ally.x, ally.y - ally.radius - 10, '救援成功！', false, '#7cf3c4');
    } else if (!ally._rescueGate || ally._rescueGate >= 0.19) {
      world.fx?.sparkle?.(ally.x, ally.y, '#7cf3c4');
      // 第一百七十八轮：进度取整显示（救援计数已整数化，这里兜底取整）
      world.fx?.damageText?.(ally.x, ally.y - ally.radius - 10,
        `救援 +1（${Math.round(ally.rescueNeed - ally.rescueProgress)}/${ally.rescueNeed}）`, false, '#7cf3c4');
    }
  }
}

export class WeaponInstance {
  declare def: WeaponDefinition;
  declare level: number;
  declare cooldown: number;
  declare angle: number;
  declare instanceId?: number;
  declare _orbitHits?: Map<number, number | undefined>;
  declare orbitPositions?: Point[];
  declare orbitRadius?: number;
  declare _trailLen?: number;
  declare _trail?: Point[][];
  declare _trailT?: number;
  constructor(def: WeaponDefinition, level = 1) {
    this.def = def;
    this.level = level;
    this.cooldown = 0;
    this.angle = 0;       // 环绕类武器的当前角度
  }

  get id() { return this.def.id; }
  get tier() { return this.def.tier; }

  /** 等级带来的数值成长：每级 +12% 伤害，微降冷却 */
  get levelDamageMul() { return weaponLevelModifiers(this.level).damage; }
  get levelCooldownMul() { return weaponLevelModifiers(this.level).cooldown; }

  /** 计算本次攻击的实际伤害（不含暴击） */
  computeDamage(player: WeaponOwner) {
    const s = player.stats.values;
    let base = (this.def.damage ?? 5) * this.levelDamageMul;

    // 专精加成
    let kindBonus = 0;
    if (this.def.kind === 'melee') kindBonus += s.meleeDamage;
    else if (this.def.kind === 'ranged') kindBonus += s.rangedDamage;
    else if (this.def.kind === 'element') kindBonus += s.elemDamage;

    const global = s.damage;
    const mul = 1 + (global + kindBonus) / 100;
    let out = base * mul;

    // 角色最终倍率与道具修正相乘，不能混入StatSheet的加法百分点。
    if ('mulFor' in player && player.mulFor) {
      if (this.def.kind === 'melee') out *= player.mulFor('meleeDamage');
      else if (this.def.kind === 'ranged') out *= player.mulFor('rangedDamage');
      else if (this.def.kind === 'element') out *= player.mulFor('elemDamage');
      // 本体武器的"其他伤害"（Neon（原"neon宴会"）的 -20%）
      out *= player.mulFor('damage');
    }

    // M博士叠层的伤害和移速在消费时读取，持续时间结束即失效。
    const md = ('charRt' in player ? player.charRt?.mdDamageBonus : undefined) ?? 0;
    if (md > 0) out *= 1 + md / 100;

    // 最终伤害使用角色/装备独立乘区，避免被普通百分比属性守卫拒绝。
    if ((player.dealtFinalMul ?? 1) !== 1) out *= player.dealtFinalMul;

    // 分身攻速为本体35%，单发补正使三个分身总DPS保持本体25%；本体不设此字段。
    if ('cloneDmgScale' in player && player.cloneDmgScale != null) out *= player.cloneDmgScale;

    if ('hasItem' in player) out = weaponEquipment.damage(player, out, player.stats.values.lifesteal ?? 0);

    return out;
  }

  /** 实际冷却（秒） */
  computeCooldown(player: WeaponOwner) {
    const s = player.stats.values;
    // 攻速最终乘区作用于冷却倍率，不改基础属性。
    const charAs = 'mulFor' in player && player.mulFor ? player.mulFor('attackSpeed') : 1;
    // 第一百零八轮：血月 —— 全场攻速 +10% 起步、每 5 秒再 +10%（敌我）。
    // cooldownDiv = 1/(1+加成)：它是冷却比例，除入攻速后才会缩短冷却。
    const wxAtk = player.world?.weather?.cooldownDiv ?? 1;
    const asMul = (1 + s.attackSpeed / 100) * charAs / wxAtk;
    const base = (this.def.cooldown ?? 1) * this.levelCooldownMul;
    return Math.max(0.06, base / Math.max(0.2, asMul));
  }

  /** 实际射程 */
  computeRange(player: WeaponOwner) {
    const s = player.stats.values;
    let r = this.def.range ?? 60;
    const rangeStat = s.range ?? 0;
    if (this.def.kind !== 'melee') {
      r *= 1 + rangeStat / 100;
    } else {
      // 定向近战享受50%距离成长；360度范围武器按150%折算扩大范围。
      const rate = (this.def.behavior === 'spin' || this.def.behavior === 'orbit') ? 0.85 : 0.5;
      let mul = 1 + (rangeStat / 100) * rate;
      if ('charRt' in player && player.charRt) mul = player.charRt.modifyMeleeRange(mul);
      r *= mul;
    }
    if ('hasItem' in player) r = weaponEquipment.range(player, r, this.def.kind === 'melee');
    return r;
  }

  /**
   */
  update(dt: number, player: WeaponOwner, world: World) {

    // 环绕类武器持续旋转
    if (this.def.behavior === 'orbit') {
      this.angle += (this.def.orbitSpeed ?? 2.4) * dt * (1 + player.stats.values.attackSpeed / 200);
      // 环绕武器也有命中冷却，逐帧判定
      this._updateOrbit(player, world);
      return;
    }

    this.cooldown -= dt;
    if (this.cooldown > 0) return;

    // 找最近目标（环绕/光环/新星这类纯范围武器不需要）
    const needsTarget = AIMED_BEHAVIORS.has(this.def.behavior);
    const range = this.computeRange(player);
    let target: WeaponTarget | null = null;
    if (needsTarget) {
      const searchRange = this.def.behavior === 'beam' ? range : range * 1.25;
      target = world.grid.nearest(player.x, player.y, searchRange, (e) => e.isEnemy && !e.dead);
      if (!target) return; // 没有目标就不开火，不浪费冷却
    }

    this._fire(player, world, target);
    this.cooldown = this.computeCooldown(player);

    // 每次开火只发出声音事件，播放限流由音频层负责，规则不依赖音频实现。
    world.onWeaponFire?.(this.def, false);

    // 视觉动画时长
  }

  // 手动瞄准优先；松开后恢复自动索敌，没有目标时保留朝向。
  _aim(player: WeaponOwner, target: WeaponTarget | null) {
    if ('aimAt' in player && player.aimAt) return angleTo(player.x, player.y, player.aimAt.x, player.aimAt.y);
    return target ? angleTo(player.x, player.y, target.x, target.y) : player.facing;
  }

  _fire(player: WeaponOwner, world: World, target: WeaponTarget | null) {
    const dmg = this.computeDamage(player);
    const range = this.computeRange(player);
    const def = this.def;

    switch (def.behavior) {
      // ---------------- 近战 ----------------
      case 'sweep': {
        const facing = this._aim(player, target);
        const half = ((def.arc ?? 120) / 2) * Math.PI / 180;
        const hits = world.queryArc(player.x, player.y, facing, half, range);
        for (const e of hits) {
          world.dealDamage(player, this, e, dmg, { knockback: def.knockback ?? 80, fromX: player.x, fromY: player.y });
        }
        rescueDownedAllies(player, world, player.x, player.y, range);   // 第一百七十五轮：近战救援
        world.fx.slash(player.x, player.y, facing, range, def.arc ?? 120, def.color, { player: true });
        break;
      }

      case 'thrust': {
        const facing = this._aim(player, target);
        const w = def.width ?? 22;
        const ex = player.x + Math.cos(facing) * range;
        const ey = player.y + Math.sin(facing) * range;
        const hits = world.queryCapsule(player.x, player.y, ex, ey, w / 2);
        for (const e of hits) {
          world.dealDamage(player, this, e, dmg, { knockback: def.knockback ?? 60, fromX: player.x, fromY: player.y });
        }
        rescueDownedAllies(player, world, player.x, player.y, range);   // 第一百七十五轮：近战救援
        world.fx.thrust(player.x, player.y, ex, ey, w, def.color, { player: true });
        // 第一百三十九轮 E：顿帧感 —— 命中时轻微震屏（幅度 2 / 0.1s），
        // 配合枪影"停留 0.05s 再缩回"，落空不震。
        if (hits.length > 0) world.camera?.shake(2, 0.1);
        break;
      }

      // ---------------- 近战重击（大范围冲击波） ----------------
      case 'quake': {
        const facing = this._aim(player, target);
        // 主判定：以落点为中心的圆形冲击波，比横扫更"重"
        const cx = player.x + Math.cos(facing) * range * 0.45;
        const cy = player.y + Math.sin(facing) * range * 0.45;
        const hits = world.queryArc(player.x, player.y, facing, Math.PI, range);
        for (const e of hits) {
          world.dealDamage(player, this, e, dmg, {
            knockback: def.knockback ?? 300, fromX: player.x, fromY: player.y,
          });
          // 眩晕和破甲分开结算；Boss不受武器眩晕，避免贴身攻击无限刷新其阶段硬直。
          if (def.stun && !e.boss) e.stun = Math.max(e.stun ?? 0, def.stun);
          if (def.armorShred) e.armorShred = Math.max(e.armorShred ?? 0, def.armorShred);
        }
        world.fx.explosion(cx, cy, range * 0.8, def.color, { player: true });
        world.fx.ring(cx, cy, range, def.color, 0.4, { player: true });
        rescueDownedAllies(player, world, cx, cy, range);   // 第一百七十五轮：近战救援
        world.camera?.shake(6, 0.22);
        break;
      }

      // ---------------- 多段突刺（暴击流） ----------------
      case 'flurry': {
        const facing = this._aim(player, target);
        const n = def.thrusts ?? 5;
        const spread = ((def.spreadAngle ?? 50) * Math.PI) / 180;
        const w = def.width ?? 22;
        for (let i = 0; i < n; i++) {
          const t = n === 1 ? 0.5 : i / (n - 1);
          const a = facing - spread / 2 + spread * t;
          const ex = player.x + Math.cos(a) * range;
          const ey = player.y + Math.sin(a) * range;
          const hits = world.queryCapsule(player.x, player.y, ex, ey, w / 2);
          for (const e of hits) {
            world.dealDamage(player, this, e, dmg, {
              knockback: def.knockback ?? 60, fromX: player.x, fromY: player.y,
            });
          }
          world.fx.thrust(player.x, player.y, ex, ey, w, def.color, { player: true });
        }
        rescueDownedAllies(player, world, player.x, player.y, range);   // 第一百七十五轮：近战救援
        break;
      }

      // ---------------- 部署炮台 ----------------
      case 'deploy': {
        const res = world.deployTurret(player, this);
        if (res?.replaced) {
          world.fx?.sparkle(res.replaced.x, res.replaced.y, def.color, 3);
        }
        break;
      }

      case 'spin': {
        // 短时间内多次判定贴身敌人
        const hits = world.grid.query(player.x, player.y, range, []);
        for (const e of hits) {
          if (!e.isEnemy || e.dead) continue;
          world.dealDamage(player, this, e, dmg, { knockback: 40, fromX: player.x, fromY: player.y });
        }
        rescueDownedAllies(player, world, player.x, player.y, range);   // 第一百七十五轮：近战救援
        world.fx.spin(player.x, player.y, range, def.color, { player: true });
        break;
      }

      // ---------------- 远程 ----------------
      case 'shot': {
        const facing = this._aim(player, target);
        world.spawnBullet({
          ownerPlayer: ('ownerPlayer' in player ? player.ownerPlayer ?? player : player),
          x: player.x, y: player.y, angle: facing,
          speed: def.speed ?? 420, damage: dmg, range,
          // 第一百一十五轮：穿甲弹（player.apPierce）叠在武器自带穿透上
          pierce: (def.pierce ?? 0) + (('apPierce' in player ? player.apPierce ?? 0 : 0)),
          itemPierce: ('apPierce' in player ? player.apPierce ?? 0 : 0), radius: 6,
          color: def.color, owner: this, kind: def.kind,
          behavior: 'shot',
        });
        break;
      }

      case 'spread': {
        const facing = this._aim(player, target);
        const n = def.shots ?? 3;
        const spread = (def.spreadAngle ?? 20) * Math.PI / 180;
        for (let i = 0; i < n; i++) {
          const t = n === 1 ? 0.5 : i / (n - 1);
          const a = facing - spread / 2 + spread * t;
          world.spawnBullet({
            ownerPlayer: ('ownerPlayer' in player ? player.ownerPlayer ?? player : player),
            x: player.x, y: player.y, angle: a,
            speed: def.speed ?? 400, damage: dmg, range,
            pierce: (def.pierce ?? 0) + (('apPierce' in player ? player.apPierce ?? 0 : 0)),
            itemPierce: ('apPierce' in player ? player.apPierce ?? 0 : 0), radius: 6,
            color: def.color, owner: this, kind: def.kind,
            behavior: 'shot',
          });
        }
        break;
      }

      case 'homing': {
        const facing = this._aim(player, target);
        world.spawnBullet({
          ownerPlayer: ('ownerPlayer' in player ? player.ownerPlayer ?? player : player),
          x: player.x, y: player.y, angle: facing,
          speed: def.speed ?? 300, damage: dmg, range,
          pierce: (def.pierce ?? 0) + (('apPierce' in player ? player.apPierce ?? 0 : 0)),
          itemPierce: ('apPierce' in player ? player.apPierce ?? 0 : 0), radius: 7,
          color: def.color, owner: this, kind: def.kind,
          behavior: 'homing', homing: def.homing ?? 3,
          explosionRadius: def.explosionRadius ?? 0,
        });
        break;
      }

      case 'bounce': {
        const facing = this._aim(player, target);
        world.spawnBullet({
          ownerPlayer: ('ownerPlayer' in player ? player.ownerPlayer ?? player : player),
          x: player.x, y: player.y, angle: facing,
          speed: def.speed ?? 420, damage: dmg, range: range * 1.8,
          // 弹跳自带 0 穿透 —— 但穿甲弹照样给（用户：远程攻击可穿透）
          pierce: ('apPierce' in player ? player.apPierce ?? 0 : 0),
          itemPierce: ('apPierce' in player ? player.apPierce ?? 0 : 0), radius: 6,
          color: def.color, owner: this, kind: def.kind,
          behavior: 'bounce', bounces: def.bounces ?? 3, bounced: 0,
        });
        break;
      }

      case 'beam': {
        const facing = this._aim(player, target);
        const ex = player.x + Math.cos(facing) * range;
        const ey = player.y + Math.sin(facing) * range;
        const hits = world.queryCapsule(player.x, player.y, ex, ey, (def.width ?? 12) / 2);
        for (const e of hits) {
          world.dealDamage(player, this, e, dmg, { knockback: 20, fromX: player.x, fromY: player.y, pierceArmor: true });
        }
        world.fx.beam(player.x, player.y, ex, ey, def.width ?? 12, def.color, { player: true });
        break;
      }

      case 'chain': {
        // 闪电链：从最近目标开始，逐跳找最近的未命中敌人
        let current = target;
        let fromX = player.x, fromY = player.y;
        const hitIds = new Set<number>();
        const chainRange = def.chainRange ?? 150;
        const maxChains = def.chains ?? 4;
        const points = [{ x: player.x, y: player.y }];
        for (let i = 0; i < maxChains && current; i++) {
          if (hitIds.has(current.id)) break;
          hitIds.add(current.id);
          points.push({ x: current.x, y: current.y });
          world.dealDamage(player, this, current, dmg, { knockback: 30, fromX, fromY });
          fromX = current.x; fromY = current.y;
          current = world.grid.nearest(fromX, fromY, chainRange, (e) => e.isEnemy && !e.dead && !hitIds.has(e.id));
        }
        world.fx.chain(points, def.color, { player: true });
        break;
      }

      // ---------------- 范围 ----------------
      case 'nova': {
        const hits = world.grid.query(player.x, player.y, range, []);
        for (const e of hits) {
          if (!e.isEnemy || e.dead) continue;
          world.dealDamage(player, this, e, dmg, { knockback: def.knockback ?? 140, fromX: player.x, fromY: player.y });
        }
        world.fx.nova(player.x, player.y, range, def.color, { player: true });
        break;
      }

      // ---------------- 持续型 ----------------
      case 'aura': {
        const hits = world.grid.query(player.x, player.y, range, []);
        for (const e of hits) {
          if (!e.isEnemy || e.dead) continue;
          world.dealDamage(player, this, e, dmg, { knockback: 0, fromX: player.x, fromY: player.y });
        }
        break;
      }

      default:
        break;
    }
  }

  /** 环绕武器：每帧对接触到的敌人造成伤害（每个敌人有独立冷却） */
  _updateOrbit(player: WeaponOwner, world: World) {
    const def = this.def;
    const count = def.orbitCount ?? 1;
    // 第三十二轮：环绕半径走 computeRange —— 原来这里是裸 def.range，
    // 攻击距离属性完全加不上；360 度档按 150% 结算（见 computeRange）。
    const radius = this.computeRange(player);
    const dmg = this.computeDamage(player);
    // PhantomClone has no timeAlive field in the existing rules. Preserve its
    // undefined timer and the resulting NaN comparisons rather than invent a clock.
    const now = 'timeAlive' in player ? player.timeAlive : undefined;
    // 第三十三轮：球的命中半径数据化（逗猫棒 32，默认 16）——
    // "作为咸鱼盾的上位几乎打不中人"，球小碰到就滑过去了。
    const ballR = def.orbitBallRadius ?? 16;
    if (!this._orbitHits) this._orbitHits = new Map();

    // 清理过期的命中记录
    for (const [id, t] of this._orbitHits) {
      if (Number(now) - Number(t) > 0.4) this._orbitHits.delete(id);
    }

    for (let i = 0; i < count; i++) {
      const a = this.angle + (i / count) * TAU;
      const ox = player.x + Math.cos(a) * radius;
      const oy = player.y + Math.sin(a) * radius;
      const hits = world.grid.query(ox, oy, ballR, []);
      for (const e of hits) {
        if (!e.isEnemy || e.dead) continue;
        const last = this._orbitHits.get(e.id) ?? -99;
        if (Number(now) - last < 0.4) continue;
        this._orbitHits.set(e.id, now);
        world.dealDamage(player, this, e, dmg, { knockback: 30, fromX: ox, fromY: oy });
        // 第一百三十九轮 C：白色十字星光（用户："球击中敌人时，爆出白色
        // 的十字星光，类似猫咪拍打玩具"）—— IMPACT 放射星芒 + 一粒白火花
        world.fx.impact(ox, oy, 0.32, '#ffffff', a);
        world.fx.sparkle(ox, oy, '#ffffff', 1);
      }
    }
    // 第一百七十五轮：环绕球也能救队友（逗猫棒贴身转圈时顺路救援；
    // gate 0.2s 天然限频，不会刷屏）
    rescueDownedAllies(player, world, player.x, player.y, radius);
    this.orbitPositions = [];
    for (let i = 0; i < count; i++) {
      const a = this.angle + (i / count) * TAU;
      this.orbitPositions.push({ x: player.x + Math.cos(a) * radius, y: player.y + Math.sin(a) * radius });
    }
    this.orbitRadius = radius;

    // 第一百三十九轮 C：拖尾残影采样 —— 每 0.035s 记一帧球位（每球一条），
    // renderer 画 4 段渐隐残影，体现高速旋转。
    if (this._trailLen !== count) {
      this._trailLen = count;
      this._trail = Array.from({ length: count }, () => []);
    }
    if (Number(now) - (this._trailT ?? -1) > 0.035) {
      this._trailT = now;
      for (let i = 0; i < count; i++) {
        const t = this._trail![i];
        t.push({ x: this.orbitPositions[i].x, y: this.orbitPositions[i].y });
        if (t.length > 4) t.shift();
      }
    }
  }
}

/** 按行为分类，供 UI 显示 */
export const BEHAVIOR_LABEL = {
  sweep: '横扫', thrust: '突刺', spin: '旋击', shot: '射击',
  spread: '散射', homing: '追踪', bounce: '弹跳', beam: '光束',
  chain: '连锁', nova: '爆发', aura: '光环', orbit: '环绕',
  // 第二轮新增的流派（之前漏了标签，属性面板会显示 undefined）
  quake: '震地', flurry: '连击', deploy: '炮台',
};
