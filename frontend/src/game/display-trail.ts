import { PLAYER_STRIDE, type RenderStreamView } from './render-stream.ts';

/** Borrowed pure display preparation. -2 is empty, -1 requires reference geometry;
 * otherwise the return value is the fixed topology bucket for data (28 floats).
 * No renderer resources or live rule entities enter this module. */
export class TrailPreparation {
  readonly data = new Float32Array(28);
  private readonly points = new Float64Array(14);
  private readonly lengths = new Float64Array(6);
  prepare(stream: RenderStreamView, index: number, color: number, opacity: number): number {
    const k = index * PLAYER_STRIDE, a = stream.players, x = a[k], y = a[k + 1], r = a[k + 2], tracer = a[k + 7] === 3;
    return this.prepareValues(x,y,r,tracer,a[k+5]*opacity,a[k+8],a,k+10,false,color);
  }
  prepareValues(x:number,y:number,r:number,tracer:boolean,alpha:number,length:number,history:Float64Array,start:number,ring:boolean,color:number):number {
    const points = this.points, lengths = this.lengths;
    let count = 0;
    for (let i = 0; i < length; i++) {
      const j = ring?(start+i*3)%18:start+i*3; if (history[j + 2] <= 0) continue;
      const px = history[j] - x, py = history[j + 1] - y;
      if (count) {
        const length = Math.hypot(px - points[(count - 1) * 2], py - points[(count - 1) * 2 + 1]);
        if (length < .0001) continue;
        lengths[count - 1] = length;
      }
      points[count * 2] = px; points[count * 2 + 1] = py; count++;
    }
    if (count < 2) return -2;
    const lastLength = Math.hypot(points[(count - 1) * 2], points[(count - 1) * 2 + 1]);
    if (lastLength > .0001) { lengths[count - 1] = lastLength; points[count * 2] = points[count * 2 + 1] = 0; count++; }
    const width = r * (tracer ? 2.1 : 1.7), radius = width / 2;
    let maxSteps = 1, straight = true, root: number | undefined;
    for (let i = 1; i < count - 1; i++) {
      const dx = points[i * 2] - points[i * 2 - 2], dy = points[i * 2 + 1] - points[i * 2 - 1];
      const ex = points[i * 2 + 2] - points[i * 2], ey = points[i * 2 + 3] - points[i * 2 + 1];
      const length = lengths[i - 1], nextLength = lengths[i], product = length * nextLength;
      const dot = (dx * ex + dy * ey) / product, turn = (dx * ey - dy * ex) / product;
      if (dot < .25 || radius * Math.sqrt(Math.max(0, (1 - dot) / (1 + dot))) > Math.min(length, nextLength) * .9) return -1;
      if (Math.abs(turn) >= .001) {
        straight = false; root ??= Math.sqrt(radius);
        maxSteps = Math.max(maxSteps, Math.floor(15 * Math.abs(Math.atan2(turn, dot)) * root / Math.PI + .001) + 1);
      }
    }
    if (maxSteps > 64 || !Number.isFinite(width) || width <= 0) return -1;
    let steps = 1; while (steps < maxSteps) steps *= 2; if (straight) steps = 0;
    const out = this.data;
    out[0] = x; out[1] = y; out[2] = width; out[3] = (tracer ? .75 : .55) / (tracer ? 2.1 : 1.7);
    out[4] = color; out[5] = out[6] = 0;
    out[7] = alpha * (tracer ? .4 : .34); out[8] = alpha * .5; out[9] = count;
    for (let i = 0; i < count * 2; i++) out[12 + i] = points[i];
    out.fill(0, 12 + count * 2);
    return count * 128 + steps;
  }
}
