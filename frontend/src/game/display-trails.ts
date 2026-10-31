import type { EntityId } from './views.ts';
import { PLAYER_STRIDE, type RenderStreamView } from './render-stream.ts';
import { TrailPreparation } from './display-trail.ts';
export interface TrailRun { key: number; offset: number; count: number }
export interface PreparedTrails {
  data: Float32Array;
  ids?:readonly EntityId[];
  runs: readonly TrailRun[];
  referenceIndices: readonly number[];
}
/** Slot-owned GPU descriptions grouped by topology. Field 4 holds a palette
 * index until the renderer resolves it; exceptional paths retain raw row indices. */
export class PlayerTrailPreparation {
  data: Float32Array = new Float32Array(28 * 64);
  private working = new Float32Array(28 * 64);
  private groups = new Uint32Array(64);
  private readonly preparation = new TrailPreparation();
  private readonly runs: TrailRun[] = [];
  private readonly keys = new Map<number, number>();
  private readonly cursors: number[] = [];
  private readonly referenceIndices: number[] = [];
  prepare(stream: RenderStreamView): PreparedTrails {
    if (!this.data.byteLength) throw new Error('Trail preparation buffer has not been returned');
    const size = stream.playerCount;
    if (size * 28 > this.data.length) { let capacity = this.data.length; while (capacity < size * 28) capacity *= 2; this.data = new Float32Array(capacity); }
    if (size * 28 > this.working.length) { this.working = new Float32Array(this.data.length); this.groups = new Uint32Array(this.data.length / 28); }
    this.begin();
    for(let i=0;i<size;i++){
      const k=i*PLAYER_STRIDE,style=stream.players[k+7];if(style!==0&&style!==3)continue;
      this.append(this.preparation.prepare(stream,i,stream.players[k+6],1),i,stream.playerIds[i]);
    }
    return this.finish();
  }
  private count=0;private workingIds:EntityId[]=[];private ids:EntityId[]=[];
  begin():void {this.runs.length=this.referenceIndices.length=0;this.keys.clear();this.count=0;this.workingIds.length=this.ids.length=0;}
  appendValues(x:number,y:number,r:number,tracer:boolean,length:number,history:Float64Array,start:number,color:number,referenceIndex:number,id:EntityId):number {
    const key=this.preparation.prepareValues(x,y,r,tracer,1,length,history,start,true,color);this.append(key,referenceIndex,id);return key;
  }
  private append(key:number,referenceIndex:number,id:EntityId):void {
    if(key===-1){this.referenceIndices.push(referenceIndex);return;}if(key===-2)return;
    let group=this.keys.get(key);if(group===undefined){group=this.runs.length;this.keys.set(key,group);this.runs.push({key,offset:0,count:0});}
    const size=this.count+1;
    if(size*28>this.data.length){const larger=new Float32Array(this.data.length*2);larger.set(this.data);this.data=larger;}
    if(size*28>this.working.length){const working=new Float32Array(this.data.length);working.set(this.working);this.working=working;const groups=new Uint32Array(this.data.length/28);groups.set(this.groups);this.groups=groups;}
    this.runs[group].count++;this.groups[this.count]=group;this.workingIds[this.count]=id;this.working.set(this.preparation.data,this.count++*28);
  }
  finish():PreparedTrails {
    let offset = 0;
    this.runs.forEach((run, i) => { run.offset = this.cursors[i] = offset; offset += run.count; });
    for (let i = 0; i < this.count; i++) {
      const target = this.cursors[this.groups[i]]++ * 28, source = i * 28;
      this.ids[target/28]=this.workingIds[i];
      for (let j = 0; j < 28; j++) this.data[target + j] = this.working[source + j];
    }
    return { data: this.data, ids:this.ids, runs: this.runs, referenceIndices: this.referenceIndices };
  }
}
