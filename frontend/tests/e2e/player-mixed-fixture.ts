import type { World } from '../../src/game/world/world';
import type { Player } from '../../src/game/actors/player';
import type { Bullet } from '../../src/game/actors/bullet';

export const mixedPresets = {
  mixed: { enemies: 600, bullets: 1000, playerBullets: 2000, pickups: 600, bosses: 0 },
  'mixed-heavy': { enemies: 600, bullets: 1000, playerBullets: 6000, pickups: 600, bosses: 0 },
} as const;
export const playerStyles = ['shot', 'coin', 'orb', 'tracer'] as const;
export interface MixedBullet {
  bullet: Bullet;
  x: number;
  y: number;
  angle: number;
  phase: number;
}

/** Genuine Bullet -> production projection -> production display. Motion is a render fixture;
 * no AI/collision/damage runs, and the fixed six-point history is not a natural-game replay. */
export function populatePlayerMix(world: World, player: Player, count: number, random: () => number): MixedBullet[] {
  const result: MixedBullet[] = [];
  for (let i = 0; i < count; i++) {
    const style = playerStyles[i % playerStyles.length];
    const x = (random() - .5) * 1700, y = (random() - .5) * 860;
    const angle = random() * Math.PI * 2;
    const bullet = world.spawnBullet({ x, y, angle, speed: 180, range: 10000, damage: 1,
      ownerPlayer: player, radius: 4 + i % 3,
      kind: style === 'orb' ? 'element' : style === 'tracer' ? 'turret' : 'ranged',
      behavior: style === 'coin' ? 'bounce' : 'shot', color: ['#ff4d94', '#ffc857', '#5fd3e8', '#b794f6'][i % 4] });
    for (let point = 0; point < 6; point++) bullet.trail.push({ x, y, a: 1 });
    result.push({ bullet, x, y, angle, phase: random() * Math.PI * 2 });
  }
  movePlayerMix(result, 0);
  return result;
}

export function movePlayerMix(items: readonly MixedBullet[], time: number): void {
  for (const { bullet, x, y, angle, phase } of items) {
    const heading = angle + Math.sin(time * .8 + phase) * .3;
    const px = x + Math.sin(time + phase) * 4, py = y + Math.cos(time * .7 + phase) * 4;
    const columns = bullet.componentColumns, row = bullet.componentRow;
    if (columns) { columns.x[row] = px; columns.y[row] = py; columns.angle[row] = heading; columns.age[row] = 1 + time + phase; }
    else { bullet.x = px; bullet.y = py; bullet.angle = heading; bullet.age = 1 + time + phase; }
    const speed = columns ? columns.speed[row] : bullet.speed;
    for (let point = 0; point < 6; point++) {
      const ago = (6 - point) * .03;
      const distance = speed * ago;
      const bend = Math.sin(time * 1.7 + phase - ago * 3) * 7;
      const x = px - Math.cos(heading) * distance - Math.sin(heading) * bend;
      const y = py - Math.sin(heading) * distance + Math.cos(heading) * bend;
      // Same prescribed pose, written through the representation's native path.
      // The pre-ECS reference has ordinary point objects instead of this buffer.
      if (bullet.trail.values instanceof Float64Array) {
        const offset = bullet.trail.offset(point), values = bullet.trail.values;
        values[offset] = x; values[offset + 1] = y; values[offset + 2] = 1 - ago * 3.5;
      } else {
        const p = bullet.trail[point]; p.x = x; p.y = y; p.a = 1 - ago * 3.5;
      }
    }
  }
}
