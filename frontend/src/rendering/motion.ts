import type { EntityId } from '../game';
import { UniformGroup } from 'pixi.js';
export class MotionUniforms {
 hasMotion=false;
 readonly group=new UniformGroup({uInterpolation:{value:1,type:'f32'}});
 set(alpha:number):void{this.group.uniforms.uInterpolation=alpha;this.group.update();}
}
/** Presentation-only positions. IDs disappear at packet boundaries; births and
 * jumps snap, and a retired ID never lends its position to a different entity. */
export class MotionHistory {
 private readonly poses=new Map<EntityId,{x:number;y:number;seen:number;dx:number;dy:number}>();private revision=0;
 dx=0;dy=0;
 begin():void{this.revision++;}
 sample(id:EntityId,x:number,y:number,adopt=true):void {
  const old=this.poses.get(id);this.dx=this.dy=0;
  if(old&&!adopt){this.dx=old.dx;this.dy=old.dy;return;}
  if(old){if((old.x-x)**2+(old.y-y)**2<256**2){this.dx=old.x-x;this.dy=old.y-y;}old.x=x;old.y=y;old.seen=this.revision;old.dx=this.dx;old.dy=this.dy;}
  else this.poses.set(id,{x,y,seen:this.revision,dx:0,dy:0});
 }
 end():void{for(const[id,pose]of this.poses)if(pose.seen!==this.revision)this.poses.delete(id);}
 clear():void{this.poses.clear();this.dx=this.dy=0;}
}
