import type { EntityId, ProjectileView, PickupView } from './views.ts';
import type { Bullet } from './actors/bullet.ts';
import type { EnemyBullet } from './actors/bullet.ts';
import type { Pickup } from './actors/pickup.ts';

// Players: x,y,radius,angle,age,alpha,colorId,style,historyCount,pad,
//          six (x,y,alpha) history triples. Enemies: x,y,radius,angle,alpha,
//          colorId,shape,hitRadius,length,width,headAnchor,hostile.
// Pickups: x,y,kind,variant,bobPhase + three reserved slots.
export const PLAYER_STRIDE = 28, ENEMY_STRIDE = 12, PICKUP_STRIDE = 8;
export const PLAYER_STYLES = ['shot', 'coin', 'orb', 'tracer'] as const;
export const BULLET_SHAPES = ['circle', 'needle', 'orb', 'laser', 'star', 'rice', 'drop', 'shard', 'petal', 'ring', 'blade', 'jade', 'paw', 'bead'] as const;
export const PICKUP_KINDS = ['xp', 'material', 'heal'] as const;
/** Serializable presentation values. Consumers receive readers, not producer mutators. */
export interface RenderStreamData {
  readonly players: Float64Array; readonly enemies: Float64Array; readonly pickups: Float64Array;
  readonly playerIds: readonly EntityId[]; readonly enemyIds: readonly EntityId[]; readonly pickupIds: readonly EntityId[];
  readonly colors: readonly string[];
  readonly playerCount: number; readonly enemyCount: number; readonly pickupCount: number;
}
export interface RenderStreamView extends RenderStreamData {
  readPlayer(index: number, target: ProjectileView): ProjectileView;
  readEnemy(index: number, target: ProjectileView): ProjectileView;
  readPickup(index: number, target: PickupView): PickupView;
}
/** Borrowed, presentation-only stream. Float64 preserves the reference projection;
 * only GPU upload buffers quantize values. Never contains a live entity reference. */
export class RenderStream implements RenderStreamView {
  players = new Float64Array(PLAYER_STRIDE * 64);
  enemies = new Float64Array(ENEMY_STRIDE * 64);
  pickups = new Float64Array(PICKUP_STRIDE * 64);
  readonly playerIds: EntityId[] = [];
  readonly enemyIds: EntityId[] = [];
  readonly pickupIds: EntityId[] = [];
  readonly colors: string[] = [];
  private readonly colorIds = new Map<string, number>();
  playerCount = 0; enemyCount = 0; pickupCount = 0;
  reset(): void { this.playerCount = this.enemyCount = this.pickupCount = 0; this.playerIds.length = this.enemyIds.length = this.pickupIds.length = 0; }
  color(value: string): number {
    let id = this.colorIds.get(value);
    if (id === undefined) { id = this.colors.length; this.colors.push(value); this.colorIds.set(value, id); }
    return id;
  }
  private reserve(kind: 'players' | 'enemies' | 'pickups', end: number): Float64Array {
    let data = this[kind];
    if (end > data.length) { let n = data.length; while (end > n) n *= 2; const next = new Float64Array(n); next.set(data); this[kind] = data = next; }
    return data;
  }
  player(bullet: Bullet): void {
    const index = this.playerCount++, k = index * PLAYER_STRIDE, a = this.reserve('players', k + PLAYER_STRIDE), c = bullet.componentColumns, row = bullet.componentRow;
    this.playerIds.push(bullet.id);
    a[k] = c ? c.x[row] : bullet.x; a[k + 1] = c ? c.y[row] : bullet.y; a[k + 2] = c ? c.radius[row] : bullet.radius;
    a[k + 3] = c ? c.angle[row] : bullet.angle; a[k + 4] = c ? c.age[row] : bullet.age; a[k + 5] = 1;
    a[k + 6] = this.color(bullet.color ?? '#ffaaaa');
    a[k + 7] = bullet.behavior === 'bounce' ? 1 : bullet.kind === 'element' ? 2 : bullet.kind === 'turret' ? 3 : 0;
    a[k + 8] = bullet.trail.length;
    for (let i = 0; i < bullet.trail.length; i++) {
      const p = bullet.trail.offset(i), j = k + 10 + i * 3;
      a[j] = bullet.trail.values[p]; a[j + 1] = bullet.trail.values[p + 1]; a[j + 2] = bullet.trail.values[p + 2];
    }
  }
  enemy(bullet: EnemyBullet): void {
    const index = this.enemyCount++, k = index * ENEMY_STRIDE, a = this.reserve('enemies', k + ENEMY_STRIDE), c = bullet.componentColumns, row = bullet.componentRow;
    this.enemyIds.push(bullet.id);
    const shape = bullet.laser ? 'laser' : 'hwKind' in bullet && bullet.hwKind === 'bead' ? 'bead' : bullet.shape === 'longball' ? 'rice' : bullet.shape === 'crystal' ? 'shard' : bullet.shape ?? 'circle';
    a[k] = c ? c.x[row] : bullet.x; a[k + 1] = c ? c.y[row] : bullet.y; a[k + 2] = c ? c.radius[row] : bullet.radius;
    a[k + 3] = c ? c.angle[row] : bullet.angle; a[k + 4] = 1; a[k + 5] = this.color(bullet.color ?? '#ffaaaa');
    a[k + 6] = BULLET_SHAPES.indexOf(shape); a[k + 7] = bullet.hitRadius ?? 0; a[k + 8] = bullet.laserLength ?? -1;
    a[k + 9] = -1; a[k + 10] = bullet.laser ? 1 : 0; a[k + 11] = 1;
  }
  pickup(entity: Pickup): void {
    const index = this.pickupCount++, k = index * PICKUP_STRIDE, a = this.reserve('pickups', k + PICKUP_STRIDE), c = entity.componentColumns, row = entity.componentRow;
    this.pickupIds.push(entity.id); a[k] = c ? c.x[row] : entity.x; a[k + 1] = c ? c.y[row] : entity.y;
    a[k + 2] = PICKUP_KINDS.indexOf(entity.type); a[k + 3] = entity.variant; a[k + 4] = c ? c.bobPhase[row] : entity.bobPhase;
  }
  /** Compatibility adapters for fixtures, encounter views and external snapshots. */
  playerView(view: ProjectileView): void {
    const k = this.playerCount++ * PLAYER_STRIDE, a = this.reserve('players', k + PLAYER_STRIDE);
    this.playerIds.push(view.id); a[k] = view.x; a[k + 1] = view.y; a[k + 2] = view.radius; a[k + 3] = view.angle;
    a[k + 4] = view.age ?? 0; a[k + 5] = view.alpha ?? 1; a[k + 6] = this.color(view.color); a[k + 7] = PLAYER_STYLES.indexOf(view.playerStyle!);
    if ((view.trail?.length ?? 0) > 6) throw new RangeError('Packed player histories have six slots');
    a[k + 8] = view.trail?.length ?? 0;
    for (let i = 0; i < a[k + 8]; i++) { const p = view.trail![i], j = k + 10 + i * 3; a[j] = p.x; a[j + 1] = p.y; a[j + 2] = p.alpha; }
  }
  readPlayer(index: number, target: ProjectileView): ProjectileView { return readPlayerView(this, index, target); }
  readEnemy(index: number, target: ProjectileView): ProjectileView { return readEnemyView(this, index, target); }
  readPickup(index: number, target: PickupView): PickupView { return readPickupView(this, index, target); }
}


export function readPlayerView(stream: RenderStreamData, index: number, target: ProjectileView): ProjectileView {
    const k = index * PLAYER_STRIDE, a = stream.players;
    Object.assign(target, { id: stream.playerIds[index], x: a[k], y: a[k + 1], radius: a[k + 2], angle: a[k + 3], age: a[k + 4], alpha: a[k + 5], color: stream.colors[a[k + 6]], playerStyle: PLAYER_STYLES[a[k + 7]], hostile: false });
    const trail = target.trail as { x: number; y: number; alpha: number }[];
    trail.length = a[k + 8];
    for (let i = 0; i < trail.length; i++) { const j = k + 10 + i * 3; (trail[i] ??= { x: 0, y: 0, alpha: 0 }); trail[i].x = a[j]; trail[i].y = a[j + 1]; trail[i].alpha = a[j + 2]; }
    return target;
}
export function readEnemyView(stream: RenderStreamData, index: number, target: ProjectileView): ProjectileView {
    const k = index * ENEMY_STRIDE, a = stream.enemies;
    target.id = stream.enemyIds[index]; target.x = a[k]; target.y = a[k + 1]; target.radius = a[k + 2]; target.angle = a[k + 3];
    target.alpha = a[k + 4]; target.color = stream.colors[a[k + 5]]; target.shape = BULLET_SHAPES[a[k + 6]];
    target.hitRadius = a[k + 7]; target.length = a[k + 8] < 0 ? undefined : a[k + 8]; target.width = a[k + 9] < 0 ? undefined : a[k + 9];
    target.anchor = a[k + 10] ? 'head' : 'center'; target.hostile = !!a[k + 11]; target.playerStyle = undefined;
    return target;
}
export function readPickupView(stream: RenderStreamData, index: number, target: PickupView): PickupView {
    const k = index * PICKUP_STRIDE, a = stream.pickups;
    target.id = stream.pickupIds[index]; target.x = a[k]; target.y = a[k + 1]; target.kind = PICKUP_KINDS[a[k + 2]];
    target.variant = a[k + 3] as 1 | 2; target.bobPhase = a[k + 4]; return target;
}
