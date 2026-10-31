import { DISPLAY_BODY_STRIDE,writeDisplayBody, type DisplayBodies, PLAYER_STRIDE, type RenderStreamView } from '../game/index.ts';

export const BODY_STRIDE = DISPLAY_BODY_STRIDE;
export type BodyPacket = PreparedBodies | DisplayBodies;
export interface BodyAppearance { style: number; radius: number; color: string }
export interface PreparedBodies {
  data: Float32Array;
  ids?:Float64Array;
  counts: readonly [number, number, number, number];
  appearances: readonly BodyAppearance[];
  appearanceCounts: readonly number[];
  bodyParts: number;
}
interface Entry { appearance: BodyAppearance; seen: number; index: number }
/** Slot-owned, borrowed presentation data. The rule stream remains Float64;
 * only the final GPU bases are quantized. No texture or renderer ID crosses in. */
export class PlayerBodyPreparation {
  data: Float32Array = new Float32Array(BODY_STRIDE * 64);
  private ids=new Float64Array(64);
  private indices = new Uint32Array(64);
  private readonly colors = new Map<string, Map<number, Entry[]>>();
  private readonly palette: (Map<number, Entry[]> | undefined)[] = [];
  private readonly appearances: BodyAppearance[] = [];
  private readonly appearanceCounts: number[] = [];
  private readonly counts: [number, number, number, number] = [0, 0, 0, 0];
  private readonly cursors = new Uint32Array(4);
  private revision = 0;
  prepare(stream: RenderStreamView,withIds=false): PreparedBodies {
    if (!this.data.byteLength) throw new Error('Body preparation buffer has not been returned');
    const size = stream.playerCount;
    if (size * BODY_STRIDE > this.data.length) {
      let capacity = this.data.length; while (size * BODY_STRIDE > capacity) capacity *= 2;
      this.data = new Float32Array(capacity);
    }
    if (size > this.indices.length) this.indices = new Uint32Array(this.data.length / BODY_STRIDE);
    if(withIds&&size>this.ids.length)this.ids=new Float64Array(Math.max(size,this.ids.length*2));
    this.revision++; this.counts.fill(0); this.appearances.length = 0; this.appearanceCounts.length = 0;
    this.palette.length = stream.colors.length;
    for (let i = 0; i < stream.colors.length; i++) this.palette[i] = this.colors.get(stream.colors[i]);
    const a = stream.players;
    for (let i = 0; i < size; i++) {
      const k = i * PLAYER_STRIDE, style = a[k + 7], radius = a[k + 2], colorId = a[k + 6];
      let radii = this.palette[colorId];
      if (!radii) { radii = new Map(); this.colors.set(stream.colors[colorId], radii); this.palette[colorId] = radii; }
      let styles = radii.get(radius); if (!styles) { styles = []; radii.set(radius, styles); }
      let entry = styles[style];
      if (!entry) { entry = { appearance: { style, radius, color: stream.colors[colorId] }, seen: 0, index: 0 }; styles[style] = entry; }
      if (entry.seen !== this.revision) { entry.seen = this.revision; entry.index = this.appearances.length; this.appearances.push(entry.appearance); this.appearanceCounts.push(0); }
      this.indices[i] = entry.index; this.counts[style]++; this.appearanceCounts[entry.index]++;
    }
    let offset = 0;
    for (let style = 0; style < 4; style++) { this.cursors[style] = offset; offset += this.counts[style]; }
    let bodyParts = 0;
    for (let i = 0; i < size; i++) {
      const k = i * PLAYER_STRIDE, style = a[k + 7], out = this.cursors[style]++ * BODY_STRIDE, target = this.data;
      if(withIds){const id=stream.playerIds[i];if(typeof id!=='number')throw new TypeError('Interpolated transient identities must be numeric');this.ids[out/BODY_STRIDE]=id;}
      bodyParts+=writeDisplayBody(target,out,style,a[k],a[k+1],a[k+2],a[k+3],a[k+4],a[k+5],this.indices[i],a[k+8],a,k+10);
    }
    return { data: this.data,...(withIds?{ids:this.ids}:{}), counts: this.counts, appearances: this.appearances, appearanceCounts: this.appearanceCounts, bodyParts };
  }
}
