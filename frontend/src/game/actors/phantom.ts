import type { Player } from './player.ts';
import type { World } from '../world/world.ts';
import type { CombatTarget } from '../combat/types.ts';
import type { StatValues, StatModifiers } from '../progression/stats.ts';
import type { CharacterId } from '../content/definitions.ts';
import type { SpatialEntity } from './entity.ts';

type PhantomStats = StatModifiers & Pick<StatValues, 'maxHp' | 'hpRegen' | 'armor' | 'moveSpeed' | 'attackSpeed' | 'damage' | 'meleeDamage' | 'rangedDamage' | 'elemDamage' | 'critChance' | 'critDamage' | 'lifesteal' | 'pickupRange' | 'luck' | 'harvesting' | 'turretDamage' | 'turretRate' | 'turretRange' | 'turretMax'>;

// 莱万汀分身复用玩家武器和成长，只拥有移动与攻击临时状态；奖励归本体。
import { WeaponInstance as Weapon } from './weapon.ts';

/** 分身攻速比例（= 玩家攻速 × PHANTOM_APS） */
const PHANTOM_APS = 0.35;

export class PhantomClone {
  world: World;
  ownerPlayer: Player;
  isPhantom: true;
  isEnemy: false;
  dead: boolean;
  kills: number;
  damageDealt: number;
  x: number;
  y: number;
  facing: number;
  radius: number;
  characterId: CharacterId;
  color: string;
  accent: string;
  blinkPhase: number;
  hurtFlash: number;
  invuln: number;
  shield: number;
  maxShield: number;
  isMoving: boolean;
  walkPhase: number;
  spawnT: number;
  hitFlash: number;
  stats: { values: PhantomStats };
  maxHp: number;
  hp: number;
  weapons: Weapon[];
  dealtFinalMul: number;
  cloneDmgScale: number;
  declare age?: number;

  // 分身读取本体属性与武器模板，出生位置由调用方指定。
  constructor(player: Player, world: World, x: number, y: number) {
    this.world = world;
    this.ownerPlayer = player; // Keep projectile rewards with the original player, not the clone.
    this.isPhantom = true;
    this.isEnemy = false;
    this.dead = false;
    this.kills = 0;
    this.damageDealt = 0;
    // 击杀与伤害累加字段必须初始化，避免共享结算写出NaN。
    this.x = x; this.y = y;
    this.facing = player.facing ?? 0;
    this.radius = Math.max(10, (player.radius ?? 14) * 0.8);
    // 分身提供玩家外观投影所需字段，复用本体素材与动画语义。
    this.characterId = player.characterId;
    this.color = player.color;
    this.accent = player.accent;
    this.blinkPhase = 0;
    this.hurtFlash = 0;
    this.invuln = 0;
    this.shield = 0; this.maxShield = 0;
    this.isMoving = false;
    this.walkPhase = 0;
    this.spawnT = 0;                     // 出场特效计时
    this.hitFlash = 0;

    // ---- 属性副本：25% ----
    // 血/甲/移速线性 ×0.25；攻速按"攻速 = 1 + attackSpeed/100"的公式
    // 反解出 35% 攻速对应的加数；伤害走 cloneDmgScale 补正（见下）。
    const s = player.stats.values;
    const asClone = (PHANTOM_APS * (1 + (s.attackSpeed ?? 0) / 100) - 1) * 100;
    this.stats = {
      values: {
        maxHp: Math.max(1, Math.round((s.maxHp ?? 20) * 0.25)),
        hpRegen: (s.hpRegen ?? 0) * 0.25,
        armor: (s.armor ?? 0) * 0.25,
        moveSpeed: (s.moveSpeed ?? 0) * 0.25 + 40,   // 底速保底，别慢成爬行
        attackSpeed: asClone,
        damage: (s.damage ?? 0) * 0.25,
        meleeDamage: (s.meleeDamage ?? 0) * 0.25,
        rangedDamage: (s.rangedDamage ?? 0) * 0.25,
        elemDamage: (s.elemDamage ?? 0) * 0.25,
        critChance: (s.critChance ?? 0) * 0.25,
        critDamage: (s.critDamage ?? 0) * 0.25,
        lifesteal: 0,                    // 分身不吸血（避免刷血永动）
        pickupRange: 0, luck: 0, harvesting: 0,
        turretDamage: (s.turretDamage ?? 0) * 0.25,
        turretRate: (s.turretRate ?? 0) * 0.25,
        turretRange: (s.turretRange ?? 0) * 0.25,
        // 炮台上限 25% 取整、至少 1 座：炮台流全场 = 玩家 N 座 + 分身 ≤3 座
        turretMax: Math.max(1, Math.round((s.turretMax ?? 1) * 0.25)),
      },
    };
    this.maxHp = this.stats.values.maxHp;
    this.hp = this.maxHp;

    // ---- 武器：与玩家同款同级 ----
    this.weapons = player.weapons.map((w) => new Weapon(w.def, w.level));

    // ---- 伤害补正通道（weapon.computeDamage 末尾读取）----
    // 口径校准：damage 等通道是"加数百分比"，25% 属性并不等于每发 25%
    //（damage=50 的玩家 → 分身 12.5，每发自然比是 1.125/1.5 = 0.75）。
    // 所以在构造时用主武器**实测标定**：把每发比钉死在 0.25/0.35 = 71.4%，
    // 配 35% 攻速 ⇒ 总 DPS 恒为玩家的 25%，任意玩家 build 都成立。
    this.dealtFinalMul = 1;   // 莱万汀的最终乘区只属于本体，分身不吃
    this.cloneDmgScale = 1;
    const w0 = this.weapons[0];
    if (w0) {
      const dP = w0.computeDamage(player) || 1;
      const dC = w0.computeDamage(this) || 1;
      this.cloneDmgScale = (0.25 / PHANTOM_APS) / (dC / dP);
    }
  }

  update(dt: number, world: World, player: Player) {
    if (this.dead) return;
    this.age = (this.age ?? 0) + dt;
    this.spawnT = Math.max(0, this.spawnT - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.hp = Math.min(this.maxHp, this.hp + (this.stats.values.hpRegen ?? 0) * dt);

    // 分身沿用玩家当前实际移速；其他属性仍按既有25%继承。
    const SP = player.curSpeed ?? player.baseSpeed ?? 215;
    const x0 = this.x, y0 = this.y;
    // ---- AI：有怪打怪（自由索敌），没怪松弛跟随玩家 ----
    let target: SpatialEntity | null = null;
    try {
      target = world.grid.nearest(this.x, this.y, 420, (e: CombatTarget) => e.isEnemy && !e.dead) || null;
    } catch { /* grid 未就绪 */ }

    let tx: number | undefined; let ty: number | undefined;
    if (target) {
      const d = Math.hypot(target.x - this.x, target.y - this.y);
      // 近战主武器贴脸，其余在射程七成处站桩
      const mainKind = this.weapons[0]?.def?.kind ?? 'ranged';
      const want = mainKind === 'melee' ? Math.max(30, (target.radius ?? 12) + 24)
        : Math.max(120, (this.weapons[0]?.def?.range ?? 260) * 0.7);
      if (d > want) {
        const step = Math.min(SP * dt, d - want);   // 不越过站位点，避免在站位附近抖动
        this.x += ((target.x - this.x) / d) * step;
        this.y += ((target.y - this.y) / d) * step;
      }
      tx = target.x; ty = target.y;
    } else {
      const d = Math.hypot(player.x - this.x, player.y - this.y);
      if (d > 150) {
        const step = Math.min(SP * dt, d - 150);
        this.x += ((player.x - this.x) / d) * step;
        this.y += ((player.y - this.y) / d) * step;
      }
    }

    // 走路动画（_drawPlayer 读 isMoving / walkPhase）+ 受击闪 + 出场闪烁
    const moved = Math.hypot(this.x - x0, this.y - y0) > 0.01;
    this.isMoving = moved;
    this.walkPhase = moved ? this.walkPhase + dt * 11 : 0;
    this.hurtFlash = this.hitFlash;
    this.invuln = this.spawnT;       // 出场 0.45s 半透明闪烁（_drawPlayer 的无敌闪烁通道）
    // 面向目标（武器瞄准用）
    if (tx != null && ty != null) this.facing = Math.atan2(ty - this.y, tx - this.x);
    else if (d2(player, this) > 40) this.facing = Math.atan2(player.y - this.y, player.x - this.x);

    // ---- 武器开火（与玩家同款同级；坐标 owner=分身，奖励归属=玩家）----
    for (const w of this.weapons) {
      w.update(dt, this, world);
    }

    // ---- 接触磨损：敌人顺路撞上会磨分身血（AI 不追分身）----
    let touch = 0;
    try {
      for (const e of world.grid.query(this.x, this.y, this.radius + 26, [])) {
        if (!e.isEnemy || e.dead) continue;
        const d = Math.hypot(e.x - this.x, e.y - this.y);
        if (d < (e.radius ?? 12) + this.radius) touch += ('damage' in e ? e.damage : 5) * 1.5;
      }
    } catch { /* */ }
    if (touch > 0) {
      this.hp -= touch * dt;
      this.hitFlash = 0.12;
    }

    // （不越界：分身只朝敌人/玩家移动，二者都在场内，无需额外边界裁剪）

    if (this.hp <= 0) {
      this.dead = true;
      world.fx.explosion(this.x, this.y, 46, '#ffb3d4');
      world.fx.sparkle(this.x, this.y, '#ff7bac', 10);
    }
  }
}

function d2(a: { x: number; y: number }, b: { x: number; y: number }) { return Math.hypot(a.x - b.x, a.y - b.y); }
