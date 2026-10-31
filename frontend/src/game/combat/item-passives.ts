import type { World } from '../world/world.ts';
import type { RNG } from '../math/random.ts';
export interface YamatoBlade { x1: number; y1: number; x2: number; y2: number; seed: number; t: number; life: number }
export interface YamatoUltimate { t: number; launched: number; acc: number; blades: YamatoBlade[] }
export interface CombatViewport { cx: number; cy: number; viewW: number; viewH: number }
import { PhantomClone } from '../actors/phantom.ts';

/** Persistent item mechanics. Presentation geometry never owns damage or timing. */
export class ItemPassives {
  declare rng: RNG;
  declare visualRng: RNG;
  declare phantomTimer: number;
  declare usedUltimates: Map<number, number>;
  declare ultimate: YamatoUltimate | null;
  constructor(rng: RNG) {
    this.rng = rng;
    this.visualRng = rng.fork(0x79616d61);
    this.phantomTimer = 5;
    this.usedUltimates = new Map();
    this.ultimate = null;
  }
  beginWave() { this.ultimate = null; this.phantomTimer = 5; }

  beforeActors(dt: number, world: World, waveIndex: number, viewport: CombatViewport) {
    if (this.ultimate) {
      const ultimate = this.ultimate;
      ultimate.t += dt;
      if (ultimate.t >= 0.3 && ultimate.launched < 10) {
        ultimate.acc += dt;
        while (ultimate.acc >= 0.18 && ultimate.launched < 10) {
          ultimate.acc -= 0.18; ultimate.launched++;
          const halfLength = Math.hypot(viewport.viewW, viewport.viewH) * 0.62;
          let shown = 0;
          for (const enemy of world.enemies.items) {
            if (enemy.dead || Math.abs(enemy.x - viewport.cx) >= viewport.viewW
              || Math.abs(enemy.y - viewport.cy) >= viewport.viewH) continue;
            // Same 500 true damage per combo, without feeding player crit/lifesteal.
            enemy.takeDamage(500, { pierceArmor: true });
            if (shown++ < 24) this.addBlade(enemy.x, enemy.y, halfLength);
          }
          for (let i = 0; i < 4; i++) this.addBlade(
            viewport.cx + (this.visualRng.next() - 0.5) * viewport.viewW,
            viewport.cy + (this.visualRng.next() - 0.5) * viewport.viewH, halfLength);
        }
      }
      for (const blade of ultimate.blades) blade.t += dt;
      ultimate.blades = ultimate.blades.filter(blade => blade.t < blade.life);
      if (ultimate.t >= 0.3 + 10 * 0.18 + 0.4) this.ultimate = null;
    } else if (world.enemies.items.some(enemy => !enemy.dead)) {
      const actor = world.players().find(player => !player.dead && !player.downed
        && player.hasItem('yamato') && player.hp < player.maxHp * 0.5
        && this.usedUltimates.get(player.id) !== waveIndex);
      if (actor) {
        this.usedUltimates.set(actor.id, waveIndex);
        this.ultimate = { t: 0, launched: 0, acc: 0, blades: [] };
        world.effects.emit({ type: 'sound', name: 'vergil_ult', volume: 0.7 });
        world.effects.emit({ type: 'notice', text: '阎魔刀 · 次元斩！', tone: 'good' });
      }
    }
    return this.ultimate ? 0.05 : 1;
  }

  addBlade(x: number, y: number, halfLength: number) {
    const angle = this.visualRng.next() * Math.PI * 2;
    const ultimate = this.ultimate;
    if (!ultimate) throw new TypeError('Blade creation requires an active ultimate');
    ultimate.blades.push({ x1: x - Math.cos(angle) * halfLength, y1: y - Math.sin(angle) * halfLength,
      x2: x + Math.cos(angle) * halfLength, y2: y + Math.sin(angle) * halfLength,
      seed: (this.visualRng.next() * 1e9) | 0, t: 0, life: 0.2 });
  }

  afterActors(dt: number, world: World) {
    const player = world.player;
    if (!player) throw new TypeError('Item passives require an active player');
    if (world.challenge?.rules.disablesPhantoms || this.ultimate || player.dead || !player.hasItem('laevatein')) {
      world.phantoms.length = 0; this.phantomTimer = 5; return;
    }
    this.phantomTimer -= dt;
    if (this.phantomTimer <= 0) {
      this.phantomTimer = 5;
      if (world.phantoms.length < 3 && this.rng.next() < 0.2) {
        while (world.phantoms.length < 3) {
          const angle = this.rng.next() * Math.PI * 2;
          const phantom = new PhantomClone(player, world, player.x + Math.cos(angle) * 46,
            player.y + Math.sin(angle) * 46);
          phantom.spawnT = 0.45; world.phantoms.push(phantom);
          world.fx.ring(player.x, player.y, 64, '#ffb3d4', 0.5, { player: true });
        }
      }
    }
    for (const phantom of world.phantoms) phantom.update(dt, world, player);
    for (let i = world.phantoms.length - 1; i >= 0; i--) if (world.phantoms[i].dead) world.phantoms.splice(i, 1);
  }
}
