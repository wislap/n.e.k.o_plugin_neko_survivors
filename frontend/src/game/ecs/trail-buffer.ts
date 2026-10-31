interface TrailPoint { x: number; y: number; a: number }
class TrailPointView implements TrailPoint {
  private readonly history: TrailBuffer; private readonly offset: number;
  constructor(history: TrailBuffer, offset: number) { this.history = history; this.offset = offset; }
  get x() { return this.history.values[this.offset]; } set x(v: number) { this.history.values[this.offset] = v; }
  get y() { return this.history.values[this.offset + 1]; } set y(v: number) { this.history.values[this.offset + 1] = v; }
  get a() { return this.history.values[this.offset + 2]; } set a(v: number) { this.history.values[this.offset + 2] = v; }
}
/** Fixed-size buffer component: six Float64 points, no per-tick point allocation. */
export class TrailBuffer implements Iterable<TrailPoint> {
  readonly values = new Float64Array(18);
  private start = 0;
  private count = 0;
  private readonly views: (TrailPointView | undefined)[] = [];
  readonly [index: number]: TrailPoint;
  get length() { return this.count; }
  offset(index: number): number { return ((this.start + index) % 6) * 3; }
  point(index: number): TrailPoint | undefined {
    if (index >= this.count || index < 0) return undefined;
    const offset = this.offset(index);
    return this.views[offset / 3] ??= new TrailPointView(this, offset);
  }
  push(...points: TrailPoint[]): number {
    for (const point of points) this.append(point.x, point.y, point.a);
    return this.count;
  }
  append(x: number, y: number, alpha = 1): void {
    const offset = this.count < 6 ? this.offset(this.count++) : this.offset(0);
    if (this.count === 6 && this.countWasFull) this.start = (this.start + 1) % 6;
    this.values[offset] = x; this.values[offset + 1] = y; this.values[offset + 2] = alpha;
    this.countWasFull = this.count === 6;
  }
  private countWasFull = false;
  fade(dt: number): void { for (let i = 2; i < this.count * 3; i += 3) this.values[i] -= dt * 3.5; }
  map<T>(fn: (point: TrailPoint, index: number) => T): T[] { return Array.from(this, fn); }
  every(fn: (point: TrailPoint, index: number) => boolean): boolean { for (let i = 0; i < this.count; i++) if (!fn(this.point(i)!, i)) return false; return true; }
  *[Symbol.iterator](): Iterator<TrailPoint> { for (let i = 0; i < this.count; i++) yield this.point(i)!; }
}
for (let i = 0; i < 6; i++) Object.defineProperty(TrailBuffer.prototype, i, { get(this: TrailBuffer) { return this.point(i); } });
