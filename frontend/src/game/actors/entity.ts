// Shared logical identity allocation and ordinary actor/spatial collections.
// Dense transient component stores live in game/ecs.

let NEXT_ID = 1;
export function nextEntityId(): number { return NEXT_ID++; }

export interface SpatialEntity { id: number; x: number; y: number; radius: number; dead: boolean }
export class Entity<Context extends unknown[] = []> {
  id: number; x: number; y: number; vx: number; vy: number; radius: number; dead: boolean; age: number;
  constructor() {
    this.id = nextEntityId();
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.radius = 10;
    this.dead = false;
    this.age = 0;
  }

  update(dt: number, ..._context: Context) { this.age += dt; }

}

/**
 * 实体列表：支持 O(1) 删除（交换到末尾）
 */
export class EntityList<T extends { dead: boolean }> {
  items: T[];
  constructor() {
    this.items = [];
  }

  add(e: T) { this.items.push(e); return e; }

  /** 就地移除所有 dead 的实体，并回调 */
  sweep(onRemove?: (entity: T) => void) {
    const arr = this.items;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].dead) {
        const e = arr[i];
        const last = arr.pop()!; // The current index guarantees a nonempty array.
        if (i < arr.length) arr[i] = last;
        if (onRemove) onRemove(e);
      }
    }
  }

  clear() { this.items.length = 0; }

  get length() { return this.items.length; }

}

/** 空间网格：加速大量实体的邻近查询 */
interface SpatialBucket<T> { items:T[]; minX:number; minY:number; maxX:number; maxY:number; radius:number; bounded:boolean }
export class SpatialGrid<T extends SpatialEntity> {
  cellSize: number;
  private readonly cells = new Map<number, SpatialBucket<T>>();
  private readonly free: SpatialBucket<T>[] = [];
  private readonly queries: T[][] = [];
  private readonly membership = new WeakMap<T,{generation:number;cx:number;cy:number}>();
  private generation = 0;
  borrowQuery(x:number,y:number,radius:number):T[]{return this.query(x,y,radius,this.queries.pop()??[]);}
  releaseQuery(out:T[]):void{out.length=0;this.queries.push(out);}
  /** Call only at a phase where the selected bodies cannot move/resize until
   * rebuilding. Unselected bodies (e.g. teleporting bosses) disable pruning. */
  sealPositions(stable:(entity:T)=>boolean):void {
    for(const bucket of this.cells.values()){
      bucket.minX=bucket.minY=Infinity;bucket.maxX=bucket.maxY=-Infinity;bucket.radius=0;bucket.bounded=true;
      for(const entity of bucket.items){
        if(!stable(entity)||!Number.isFinite(entity.x)||!Number.isFinite(entity.y)||!Number.isFinite(entity.radius)||entity.radius<0){bucket.bounded=false;break;}
        bucket.minX=Math.min(bucket.minX,entity.x);bucket.minY=Math.min(bucket.minY,entity.y);
        bucket.maxX=Math.max(bucket.maxX,entity.x);bucket.maxY=Math.max(bucket.maxY,entity.y);bucket.radius=Math.max(bucket.radius,entity.radius||0);
      }
    }
  }
  private distance(bucket:SpatialBucket<T>,x:number,y:number):number {
    const dx=x<bucket.minX?bucket.minX-x:x>bucket.maxX?x-bucket.maxX:0;
    const dy=y<bucket.minY?bucket.minY-y:y>bucket.maxY?y-bucket.maxY:0;return dx*dx+dy*dy;
  }
  constructor(cellSize = 64) {
    this.cellSize = cellSize;
  }

  _key(cx: number, cy: number) { return cx * 73856093 ^ cy * 19349663; }

  clear() { for(const bucket of this.cells.values()){bucket.items.length=0;bucket.bounded=false;this.free.push(bucket);}this.cells.clear();this.generation++; }

  insert(entity: T) {
    const cs = this.cellSize;
    const cx = Math.floor(entity.x / cs);
    const cy = Math.floor(entity.y / cs);
    const k = this._key(cx, cy);
    let bucket = this.cells.get(k);
    if (!bucket) { bucket = this.free.pop() ?? {items:[],minX:0,minY:0,maxX:0,maxY:0,radius:0,bounded:false};this.cells.set(k,bucket); }
    bucket.bounded=false;bucket.items.push(entity);
    const member=this.membership.get(entity);if(member){member.generation=this.generation;member.cx=cx;member.cy=cy;}else this.membership.set(entity,{generation:this.generation,cx,cy});
  }

  /** 查询圆形范围内的实体 */
  query(x: number, y: number, radius: number, out: T[] = []) {
    out.length = 0;
    const cs = this.cellSize;
    const minCx = Math.floor((x - radius) / cs);
    const maxCx = Math.floor((x + radius) / cs);
    const minCy = Math.floor((y - radius) / cs);
    const maxCy = Math.floor((y + radius) / cs);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.cells.get(this._key(cx, cy));
        if (!bucket) continue;
        if(bucket.bounded&&this.distance(bucket,x,y)>(radius+bucket.radius)*(radius+bucket.radius))continue;
        for (let i = 0; i < bucket.items.length; i++) {
          const e = bucket.items[i];
          if (e.dead) continue;
          const dx = e.x - x, dy = e.y - y;
          const rr = radius + (e.radius || 0);
          if (dx * dx + dy * dy <= rr * rr) out.push(e);
        }
      }
    }
    return out;
  }

  /** 找最近的实体 */
  nearest(x: number, y: number, maxRadius: number, filter?: (entity: T) => boolean, excluded?: ReadonlySet<number>, seed?:T) {
    const cs = this.cellSize;
    const maxC = Math.ceil(maxRadius / cs);
    const cx0 = Math.floor(x / cs);
    const cy0 = Math.floor(y / cs);
    let best: T | null = null;
    let bestD2 = maxRadius * maxRadius;
    let seeded=false;
    const member=seed&&this.membership.get(seed);
    if(seed&&member?.generation===this.generation&&member.cx>=cx0-maxC&&member.cx<=cx0+maxC&&member.cy>=cy0-maxC&&member.cy<=cy0+maxC&&!seed.dead&&(!filter||filter(seed))&&!excluded?.has(seed.id)){
      const dx=seed.x-x,dy=seed.y-y,d=dx*dx+dy*dy;if(d<bestD2){best=seed;bestD2=d;seeded=true;}
    }
    for (let cx = cx0 - maxC; cx <= cx0 + maxC; cx++) {
      for (let cy = cy0 - maxC; cy <= cy0 + maxC; cy++) {
        const bucket = this.cells.get(this._key(cx, cy));
        if (!bucket) continue;
        if(bucket.bounded){const bound=this.distance(bucket,x,y);if(seeded?bound>bestD2:bound>=bestD2)continue;}
        for (let i = 0; i < bucket.items.length; i++) {
          const e = bucket.items[i];
          if (e.dead) continue;
          if (filter && !filter(e) || excluded?.has(e.id)) continue;
          const dx = e.x - x, dy = e.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2 || seeded && d2 === bestD2) { bestD2 = d2; best = e; seeded=false; }
        }
      }
    }
    return best;
  }
}

/** 矩形（线段扫掠）范围查询：用于突刺/光束。近似为多个圆 */
export function queryCapsule<T extends SpatialEntity>(grid: SpatialGrid<T>, x1: number, y1: number, x2: number, y2: number, radius: number, out: T[] = []) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (radius * 0.8)));
  const seen = new Set<number>();
  out.length = 0;
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const px = x1 + dx * t;
    const py = y1 + dy * t;
    const hits = grid.query(px, py, radius, []);
    for (const h of hits) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      out.push(h);
    }
  }
  return out;
}
