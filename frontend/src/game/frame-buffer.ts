import { RenderStream } from './render-stream.ts';
import type { PickupView, ProjectileView } from './views';
import type { TrailBuffer } from './ecs/trail-buffer.ts';

export function emptyProjectileView(hostile: boolean): ProjectileView {
  return { id: 0, x: 0, y: 0, hostile, radius: 0, angle: 0, color: '', age: undefined,
    ...(!hostile ? { playerStyle: 'shot' as const, trail: [] } : {}),
    shape: undefined, hitRadius: undefined, anchor: 'center', length: undefined, width: undefined };
}
/** Caller-owned render scratch. Returned transient views are valid until the next
 * readFrame(buffer); readFrame() without a buffer remains a detached snapshot.
 * Pools contain display values only, never references to mutable rule entities. */
export class GameFrameBuffer {
  readonly packed?: RenderStream;
  readonly stableActorIds:boolean;
  constructor(options: { packed?: boolean;stableActorIds?:boolean } = {}) { this.stableActorIds=!!options.stableActorIds; if (options.packed) this.packed = new RenderStream(); }
  readonly projectiles: ProjectileView[] = [];
  readonly pickups: PickupView[] = [];
  private readonly playerPool: ProjectileView[] = [];
  private readonly enemyPool: ProjectileView[] = [];
  private readonly pickupPool: PickupView[] = [];
  private readonly trails = new WeakMap<ProjectileView, { x: number; y: number; alpha: number }[]>();
  private playerCount = 0;
  private enemyCount = 0;
  reset(): void { this.packed?.reset(); this.projectiles.length = this.pickups.length = this.playerCount = this.enemyCount = 0; }
  projectile(hostile: boolean): ProjectileView {
    const pool = hostile ? this.enemyPool : this.playerPool, index = hostile ? this.enemyCount++ : this.playerCount++;
    let view = pool[index];
    if (!view) {
      view = pool[index] = emptyProjectileView(hostile);
      if (!hostile) this.trails.set(view, Array.from({ length: 6 }, () => ({ x: 0, y: 0, alpha: 0 })));
    }
    this.projectiles.push(view); return view;
  }
  writeTrail(view: ProjectileView, history: TrailBuffer): void {
    const points = this.trails.get(view)!, trail = view.trail as { x: number; y: number; alpha: number }[];
    trail.length = history.length;
    for (let i = 0; i < history.length; i++) {
      const offset = history.offset(i), point = points[i];
      point.x = history.values[offset]; point.y = history.values[offset + 1]; point.alpha = history.values[offset + 2];
      trail[i] = point;
    }
  }
  pickup(): PickupView {
    const index = this.pickups.length;
    const view = this.pickupPool[index] ??= { id: 0, x: 0, y: 0, kind: 'xp', variant: 1, bobPhase: 0 };
    this.pickups.push(view); return view;
  }
  get capacity() { return { players: this.playerPool.length, enemies: this.enemyPool.length, pickups: this.pickupPool.length }; }
}
