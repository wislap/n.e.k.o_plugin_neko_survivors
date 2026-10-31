import { PlayerTrailPreparation,type PreparedTrails } from './display-trails.ts';
import { GameFrameBuffer } from './frame-buffer.ts';
import { RenderStream, type RenderStreamData } from './render-stream.ts';
import type { GameFrame } from './views.ts';
import type { Bullet, EnemyBullet } from './actors/bullet.ts';
import type { Pickup } from './actors/pickup.ts';
import { writeDisplayBody } from './display-body.ts';
export { DISPLAY_BODY_STRIDE,writeDisplayBody } from './display-body.ts';
export interface DisplayAppearance {style:number;radius:number;color:string}
export interface DisplayBodies {
 groups:readonly Float32Array[];ids:Float64Array;
 counts:readonly[number,number,number,number];appearances:readonly DisplayAppearance[];appearanceCounts:readonly number[];bodyParts:number;
}
/** Explicit scene + compact transient projection. This is not GameFrame: players
 * live in bodies; raw player rows contain eligible trails only. */
export interface DisplayFrame {scene:Omit<GameFrame,'transients'>;bodies:DisplayBodies;transients:RenderStreamData;trails?:PreparedTrails}
interface AppearanceEntry {value:DisplayAppearance;revision:number;index:number}
class CompactStream {
 readonly raw=new RenderStream();readonly trails=new PlayerTrailPreparation();prepareTrails=false;
 readonly groups:Float32Array[]=Array.from({length:4},()=>new Float32Array(64*16));
 ids:Float64Array=new Float64Array(64);
 private readonly styleIds=Array.from({length:4},()=>new Float64Array(64));
 readonly counts:[number,number,number,number]=[0,0,0,0];
 readonly appearances:DisplayAppearance[]=[];readonly appearanceCounts:number[]=[];
 private readonly cache=new Map<string,Map<number,AppearanceEntry[]>>();private revision=0;
 bodyParts=0;
 reset(){this.raw.reset();this.trails.begin();this.counts.fill(0);this.appearances.length=this.appearanceCounts.length=0;this.bodyParts=0;this.revision++;}
 player(bullet:Bullet){
  const c=bullet.componentColumns,row=bullet.componentRow;
  const x=c?c.x[row]:bullet.x,y=c?c.y[row]:bullet.y,r=c?c.radius[row]:bullet.radius,angle=c?c.angle[row]:bullet.angle,age=c?c.age[row]:bullet.age;
  const style=bullet.behavior==='bounce'?1:bullet.kind==='element'?2:bullet.kind==='turret'?3:0,color=bullet.color??'#ffaaaa';
  let radii=this.cache.get(color);if(!radii){radii=new Map();this.cache.set(color,radii);}let styles=radii.get(r);if(!styles){styles=[];radii.set(r,styles);}
  let entry=styles[style];if(!entry){entry={value:{style,radius:r,color},revision:0,index:0};styles[style]=entry;}
  if(entry.revision!==this.revision){entry.revision=this.revision;entry.index=this.appearances.length;this.appearances.push(entry.value);this.appearanceCounts.push(0);}this.appearanceCounts[entry.index]++;
  const n=this.counts[style]++,offset=n*16;
  if(offset+16>this.groups[style].length){const a=new Float32Array(this.groups[style].length*2);a.set(this.groups[style]);this.groups[style]=a;const ids=new Float64Array(a.length/16);ids.set(this.styleIds[style]);this.styleIds[style]=ids;}
  this.styleIds[style][n]=bullet.id;
  this.bodyParts+=writeDisplayBody(this.groups[style],offset,style,x,y,r,angle,age,1,entry.index,bullet.trail.length,bullet.trail.values,bullet.trail.offset(0),true);
  // Preserve source doubles for curve decisions and Graphics exceptions. Coin
  // and orb do not consume this stream; no full duplicate player projection.
  if((style===0||style===3)&&bullet.trail.length>1){if(!this.prepareTrails||this.trails.appendValues(x,y,r,style===3,bullet.trail.length,bullet.trail.values,bullet.trail.offset(0),this.raw.color(color),this.raw.playerCount,bullet.id)===-1)this.raw.player(bullet);}
 }
 enemy(bullet:EnemyBullet){this.raw.enemy(bullet);}
 pickup(pickup:Pickup){this.raw.pickup(pickup);}
 finish():DisplayBodies {
  const count=this.counts.reduce((a,b)=>a+b,0);if(count>this.ids.length)this.ids=new Float64Array(Math.max(count,this.ids.length*2));
  let offset=0;for(let i=0;i<4;i++){this.ids.set(this.styleIds[i].subarray(0,this.counts[i]),offset);offset+=this.counts[i];}
  return{groups:this.groups,ids:this.ids,counts:this.counts,appearances:this.appearances,appearanceCounts:this.appearanceCounts,bodyParts:this.bodyParts};
 }
}
/** Caller-owned display lease; contains no renderer IDs or live rule references. */
export class GameDisplayBuffer {
 readonly frame=new GameFrameBuffer();readonly stream=new CompactStream();
 reset(){this.stream.reset();}
 restore(groups:readonly Float32Array[],ids:Float64Array,trails?:Float32Array){for(let i=0;i<4;i++)this.stream.groups[i]=groups[i];this.stream.ids=ids;if(trails)this.stream.trails.data=trails;}
}
// Same raw readers apply to the exceptional-trail subset and hostile/pickup rows.
export function displayRawData(buffer:GameDisplayBuffer):RenderStreamData {
 const s=buffer.stream.raw;return{players:s.players,enemies:s.enemies,pickups:s.pickups,playerIds:s.playerIds,enemyIds:s.enemyIds,pickupIds:s.pickupIds,
 colors:s.colors,playerCount:s.playerCount,enemyCount:s.enemyCount,pickupCount:s.pickupCount};
}
