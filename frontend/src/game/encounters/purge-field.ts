import type { World } from '../world/world.ts';
import type { Player } from '../actors/player.ts';
import type { EnemyBullet } from '../actors/bullet.ts';
import type { encounterCues } from './cues.ts';
export interface PurgeNova { x: number; y: number; r: number; hold: number; auto: boolean }
interface PurgeOptions { world: World; player: Player; cues: ReturnType<typeof encounterCues>; shake(strength: number, duration: number): void; accepts(bullet: EnemyBullet): boolean; onReady?(): void; onCooldown?(): void }
export const PURGE_RULES = Object.freeze({ cooldown: 15, radius: 180, speed: 1000,
  manualHold: 2, autoHold: 1, manualInvulnerability: 1 });

/** Shared pet skill; challenge-specific gates and dialogue stay with the challenge. */
export class PurgeField {
  declare world: World; declare player: Player; declare cues: ReturnType<typeof encounterCues>;
  declare shake: PurgeOptions['shake']; declare accepts: PurgeOptions['accepts']; declare onReady: () => void; declare onCooldown: () => void;
  declare cooldown: number; declare nova: PurgeNova | null;
  constructor({ world, player, cues, shake, accepts, onReady = () => {}, onCooldown = () => {} }: PurgeOptions) {
    this.world = world; this.player = player; this.cues = cues; this.shake = shake;
    this.accepts = accepts; this.onReady = onReady; this.onCooldown = onCooldown;
    this.cooldown = 0; this.nova = null;
  }
  manual() {
    if (this.cooldown > 0) { this.onCooldown(); return false; }
    this.start(false); this.cues.play('petPurge'); this.cooldown = PURGE_RULES.cooldown;
    this.player.invuln = Math.max(this.player.invuln, PURGE_RULES.manualInvulnerability);
    return true;
  }
  start(auto: boolean) {
    const point = this.world.pet ?? this.player;
    this.nova = { x: point.x, y: point.y, r: 8,
      hold: auto ? PURGE_RULES.autoHold : PURGE_RULES.manualHold, auto };
    this.world.fx.nova(point.x, point.y, PURGE_RULES.radius * 2, auto ? '#aef3ff' : '#ffe9a8', null);
    if (!auto) this.shake(3, .15);
  }
  advance(dt: number) {
    if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - dt);
      if (this.cooldown === 0) this.onReady();
    }
    const nova = this.nova;
    if (!nova) return;
    if (nova.r < PURGE_RULES.radius) nova.r = Math.min(PURGE_RULES.radius, nova.r + PURGE_RULES.speed * dt);
    else { nova.hold -= dt; if (nova.hold <= 0) { this.nova = null; return; } }
    for (const bullet of this.world.enemyBullets.items) {
      if (bullet.dead || !this.accepts(bullet)) continue;
      const dx = bullet.x - nova.x, dy = bullet.y - nova.y;
      if (dx * dx + dy * dy <= nova.r * nova.r) {
        bullet.dead = true;
        this.world.fx.sparkle(bullet.x, bullet.y, nova.auto ? '#aef3ff' : '#ffe9a8');
      }
    }
  }
}
