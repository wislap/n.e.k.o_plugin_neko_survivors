import type { World } from '../world/world.ts';
import type { EnemyBody } from '../actors/enemy.ts';
import type { Player } from '../actors/player.ts';
import type { BulletShape } from '../actors/bullet.ts';
export interface PandoraSignatureState { drop: number; side: number; spiral: number; rot: number }
export interface NonoSignatureState { rain: number; pillar: number; k: number }
export type BossSignatureState = PandoraSignatureState | NonoSignatureState;
interface SignatureContext { world: World; player: Player; phase: number }
// 普通Boss招牌攻击由独立策略推进，弹幕进入世界统一实体与伤害路径。

const TAU = Math.PI * 2;
const SIG_BULLET_CAP = 260;

/** 本 Boss 一发弹的伤害（口径与 enemy.js _firePattern 一致） */
function dmgOf(e: EnemyBody) {
  const def = e.def;
  return (def.projectileDamage ?? (def.damage ?? 3)) * e.dmgScale
    * (1 + e.buffDamagePct / 100) * e.curseDamageMul;
}

/** 发一颗弹（统一加判定缩小 + 同屏上限）。返回是否真的发了 */
function put(e: EnemyBody, world: World, x: number, y: number, angle: number, speed: number, shape: BulletShape, color: string, r: number, range = 900) {
  const list = world.enemyBullets?.items;
  if (list && list.length >= SIG_BULLET_CAP) return false;
  world.spawnEnemyBullet({
    trueTier: e.trueTier, x, y, angle, speed, damage: dmgOf(e),
    radius: r, hitRadius: r * 0.6, color, range, shape,
  });
  return true;
}

// 潘多拉：格镜落弹。
const GRID = 64;
function pandora(e: EnemyBody, signature: { state?: BossSignatureState }, dt: number, ctx: SignatureContext) {
  const { world, player, phase } = ctx;
  const S = signature.state ??= { drop: 1.6, side: 3.0, spiral: 0, rot: 0 };
  if (!('drop' in S)) throw new TypeError('Pandora signature state required');
  const rnd = () => world.rng.next();
  const px = player.x, py = player.y;

  S.drop -= dt;
  if (S.drop <= 0) {
    S.drop = phase >= 3 ? 2.4 : phase === 2 ? 3.0 : 3.4;
    const cols = phase >= 3 ? 11 : phase === 2 ? 9 : 7;           // 单侧最多几列
    // 镜像轴 = 安全缝的中心：放在玩家侧方 2~4 格处（左右随机）。
    // 模拟器教训：缝若正对玩家脚下，站桩玩家一次都不会被打（1 阶段形同虚设）；
    // 现在必须横移 128~256px 才能进缝，落弹 2 秒到达，走得过去。
    const axis = px + (rnd() < 0.5 ? -1 : 1) * GRID * (2 + Math.floor(rnd() * 3)) + (Math.floor(rnd() * 3) - 1) * (GRID / 2);
    const top = py - 430;
    for (let c = 2; c <= cols + 1; c++) {                          // c = 1 的两侧(|col|≤1)是 3 列宽的安全缝，直接不发
      if (rnd() < 0.34) continue;                                  // 随机挑一部分列，避免整面墙
      for (const sgn of [-1, 1]) {                                 // 以缝为轴左右镜像：同一列号两侧同时落
        const x = axis + sgn * c * GRID;
        const n = 4 + Math.floor(rnd() * 2);                       // 每列 4~5 颗，纵向间距 52px
        for (let k = 0; k < n; k++) {
          put(e, world, x, top - k * 52, Math.PI / 2, phase >= 3 ? 250 : 215, 'drop', '#c56cf0', 7.5);
        }
      }
    }
  }
  if (phase >= 2) {
    S.side -= dt;
    if (S.side <= 0) {
      S.side = phase >= 3 ? 3.4 : 4.6;
      const gapRow = Math.floor(rnd() * 5) - 2;                    // 缝在第几行（相对玩家，±2 格）
      for (let r = -4; r <= 4; r++) {
        if (r === gapRow) continue;
        const y = py + r * GRID;
        // 左右镜像：两侧同时向中间压
        for (const sgn of [-1, 1]) {
          for (let k = 0; k < 3; k++) {
            put(e, world, px + sgn * (520 + k * 54), y, sgn < 0 ? 0 : Math.PI, 205, 'rice', '#ff9fe0', 6);
          }
        }
      }
    }
  }

  if (phase >= 3) {
    S.rot += dt * 0.9;
    S.spiral += dt;
    while (S.spiral >= 0.22) {
      S.spiral -= 0.22;
      for (let a = 0; a < 3; a++) put(e, world, e.x, e.y, S.rot + (a * TAU) / 3, 120, 'star', '#ffd6f5', 6, 800);
    }
  }
}

// 诺诺：天幕横雨与三向落柱。
function nono(e: EnemyBody, signature: { state?: BossSignatureState }, dt: number, ctx: SignatureContext) {
  const { world, player, phase } = ctx;
  const S = signature.state ??= { rain: 0.8, pillar: 3.5, k: 0 };
  if (!('rain' in S)) throw new TypeError('Nono signature state required');
  const rnd = () => world.rng.next();
  const px = player.x, py = player.y;

  S.rain -= dt;
  if (S.rain <= 0) {
    S.rain = phase >= 3 ? 0.42 : phase === 2 ? 0.55 : 0.7;
    S.k++;
    const slant = 1.15;                                             // 斜落角（弧度，≈66°）
    const n = phase >= 3 ? 9 : 6;
    const span = 780;
    const x0 = px - span / 2 + rnd() * 140 - 70;
    for (let i = 0; i < n; i++) {
      const x = x0 + (i / (n - 1)) * span + (S.k % 2 ? 35 : 0);
      if ((i + S.k) % 5 === 0) continue;                           // 稀疏带：每批固定缺几颗
      put(e, world, x - 320, py - 420, slant, 235, 'rice', '#7fe8ff', 5.4, 1100);
    }
  }

  if (phase >= 2) {
    S.pillar -= dt;
    if (S.pillar <= 0) {
      S.pillar = phase >= 3 ? 3.4 : 4.6;
      const lead = phase >= 3 ? 0.35 : 0;                          // 3 阶段：落点向玩家移动方向预判
      const cx = px + (player.vx ?? 0) * lead;
      const cy = py + (player.vy ?? 0) * lead;
      const SP = 26, N = 8, SPEED = 210, COL = '#4ab8ff';
      // 向下的柱：从上方 cy-430 起，竖直 N 颗排成一条线，一起往下压
      for (let k = 0; k < N; k++) put(e, world, cx, cy - 430 - k * SP, Math.PI / 2, SPEED, 'orb', COL, 6.5);
      // 向右的柱（从左侧来）与向左的柱（从右侧来），错开半个玩家身位
      for (let k = 0; k < N; k++) {
        put(e, world, cx - 520 - k * SP, cy - 96, 0, SPEED, 'orb', COL, 6.5);
        put(e, world, cx + 520 + k * SP, cy + 96, Math.PI, SPEED, 'orb', COL, 6.5);
      }
    }
  }
}

const TABLE = { pandora, nono };

/** 普通Boss进攻末尾调用；name来自def.signature。 */
export function runBossSignature(name: string | undefined, e: EnemyBody, signature: { state?: BossSignatureState }, dt: number, player: Player | null, world: World, phase: number) {
  const fn = name === 'pandora' || name === 'nono' ? TABLE[name] : null;
  if (!fn || !player || !world) return;
  fn(e, signature, dt, { player, world, phase: phase || 1 });
}
