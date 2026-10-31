import { MotionHistory } from './motion';
import type { RenderStreamView } from '../game';
import type { EntityId, PickupView, ProjectileView } from '../game';
import { InstanceRuns } from './instance-mesh';
import type { GameAssets } from './assets';
import type { ProjectileTextures } from './battle-displays';
import { projectileColor } from './projectile-art';

/** Match DisplayObjectIndex's stable insertion order even when ECS swap-removes
 * rows. Reused maps contain indices/views, never per-entity display nodes. */
export class OrderedTransients<T extends { id: EntityId }> {
  readonly entries = new Map<EntityId, number | T>();
  private readonly seen = new Set<EntityId>();
  sync(ids: readonly EntityId[], count: number, values: readonly T[]): void {
    this.seen.clear();
    for (let i = 0; i < count; i++) this.put(ids[i], i);
    for (const view of values) this.put(view.id, view);
    for (const id of this.entries.keys()) if (!this.seen.has(id)) this.entries.delete(id);
  }
  private put(id: EntityId, value: number | T): void {
    if (this.seen.has(id)) throw new Error(`Duplicate display identity: ${id}`);
    this.seen.add(id); this.entries.set(id, value);
  }
  clear(): void { this.entries.clear(); this.seen.clear(); }
}
export class EnemyProjectiles extends InstanceRuns {
  private readonly history=new MotionHistory();
  resetMotion():void{this.history.clear();}
  private readonly order = new OrderedTransients<ProjectileView>();
  private readonly scratch: ProjectileView = { id: 0, x: 0, y: 0, radius: 0, color: '', angle: 0, hostile: true };
  get size(): number { return this.order.entries.size; }
  sync(views: readonly ProjectileView[], packed: RenderStreamView | undefined, textures: ProjectileTextures, mobile: boolean, opacity = 1,adoptMotion=true): void {
    this.order.sync(packed?.enemyIds ?? [], packed?.enemyCount ?? 0, views);
    this.begin();if(this.motion&&adoptMotion)this.history.begin();
    for (const value of this.order.entries.values()) {
      const view = typeof value === 'number' ? packed!.readEnemy(value, this.scratch) : value;
      if(this.motion){this.history.sample(view.id,view.x,view.y,adoptMotion);this.setMotion(this.history.dx,this.history.dy);}
      const { x, y, angle, radius, shape } = view, alpha = (view.alpha ?? 1) * (view.hostile ? 1 : opacity), art = textures.player;
      if(alpha<=0)continue;
      const elongated = ['needle', 'rice', 'shard', 'drop', 'petal', 'blade'].includes(shape ?? '');
      const width = shape === 'laser' ? view.length ?? radius * 8 : elongated ? view.length ?? radius * 3.2 : radius * 2;
      const height = shape === 'laser' ? view.width ?? radius * 2 : elongated ? view.width ?? radius * 1.3 : radius * 2;
      const body = textures.get(shape), halo = textures.get('halo'), tint = this.colorNumber(projectileColor(view.color));
      const bodyPart = art.image(body), haloPart = art.image(halo);
      // All three anchors use the source texture's unpadded bounds.
      const shift = view.anchor === 'head' ? -.5 : 0;
      const emit = (part: typeof bodyPart, source: typeof body, w: number, h: number, a: number, color: number, blend: 'add' | 'normal') => {
        const d = shift * w; a = Math.floor(Math.max(0, Math.min(1, a)) * 255) / 255; this.quad(part, blend, x + Math.cos(angle) * d, y + Math.sin(angle) * d, angle, w / source.width, h / source.height, a, color);
      };
      if (view.hostile) emit(haloPart, halo, width * 2.6, height * 2.6, alpha * .14, tint, mobile ? 'normal' : 'add');
      emit(bodyPart, body, width, height, alpha, tint, 'normal');
      if (shape !== 'ring') emit(bodyPart, body, width * .45, height * .45, alpha * .9, shape === 'jade' ? 0x8d6a1b : 0xffffff, 'normal');
      if (shape === 'jade' && view.hitRadius) {
        const p = art.image(art.vector('jade-hit:' + view.hitRadius, g => g.circle(0, 0, view.hitRadius!).stroke({ color: 0xff3f4f, width: 1.5, alpha: .9 })).texture);
        this.quad(p, 'normal', x, y, angle, 1, 1, alpha);
      }
    }
    this.finish();if(this.motion&&adoptMotion)this.history.end();
  }
  override destroy(): void { this.history.clear();this.order.clear(); super.destroy(); }
}
export class PickupBatch extends InstanceRuns {
  private readonly history=new MotionHistory();
  resetMotion():void{this.history.clear();}
  private readonly order = new OrderedTransients<PickupView>();
  private readonly scratch: PickupView = { id: 0, x: 0, y: 0, kind: 'xp', variant: 1, bobPhase: 0 };
  get size(): number { return this.order.entries.size; }
  sync(views: readonly PickupView[], packed: RenderStreamView | undefined, textures: ProjectileTextures, assets: GameAssets,adoptMotion=true): void {
    this.order.sync(packed?.pickupIds ?? [], packed?.pickupCount ?? 0, views); this.begin();if(this.motion&&adoptMotion)this.history.begin();
    for (const value of this.order.entries.values()) {
      const v = typeof value === 'number' ? packed!.readPickup(value, this.scratch) : value;
      if(this.motion){this.history.sample(v.id,v.x,v.y,adoptMotion);this.setMotion(this.history.dx,this.history.dy);}
      const id = v.kind === 'xp' ? 'xp' : v.kind === 'heal' ? 'heal' : v.variant === 2 ? 'coin_2' : 'coin_1';
      void assets.request('pickup', id); const texture = assets.get('pickup', id), x = v.x, y = v.y + Math.sin(v.bobPhase) * 2;
      if (texture) {
        const s = v.kind === 'heal' ? 45 * (1 + Math.sin(v.bobPhase * 1.6) * .06) : v.kind === 'xp' ? 16 : 18;
        const scale = s / Math.max(texture.width, texture.height); this.quad(textures.player.image(texture), 'normal', x, y, 0, scale, scale);
      } else {
        const part = textures.player.vector('pickup:' + v.kind, g => {
          if (v.kind === 'heal') g.rect(-6, -2, 12, 4).rect(-2, -6, 4, 12).fill(0xff5f6d);
          else g.poly([0, -5, 5, 0, 0, 5, -5, 0]).fill(v.kind === 'xp' ? 0x6ee7a8 : 0xffc857);
        });
        this.quad(part, 'normal', x, y);
      }
    }
    this.finish();if(this.motion&&adoptMotion)this.history.end();
  }
  override destroy(): void { this.history.clear();this.order.clear(); super.destroy(); }
}
