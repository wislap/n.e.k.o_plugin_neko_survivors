import { MotionHistory,type MotionUniforms } from './motion';
import { Container,Texture } from 'pixi.js';
import type { ActorView, EntityId } from '../game';
import type { GameAssets } from './assets';
import type { BakedPart, PlayerArt } from './player-art';
import { ActorDisplay } from './actor-display';
import { enemyEyePlacement } from './enemy-eyes';
import { InstanceRuns } from './instance-mesh';
interface Entry { view:ActorView; flip:number; fallback?:ActorDisplay;dx:number;dy:number }
/** Stable y-order across actors and exceptional displays. Common enemies carry
 * no individual scene nodes; shields/bosses/missing art retain full presentation. */
export class ActorBatch extends Container {
  hasMotion=false;
  private motion?:MotionUniforms;private readonly history=new MotionHistory();
  enableMotion(motion:MotionUniforms):void{this.motion=motion;}
  resetMotion():void{this.history.clear();}
  interpolate(alpha:number):void{for(const entry of this.entries.values())if(entry.fallback)entry.fallback.position.set(entry.view.x+entry.dx*(1-alpha),entry.view.y+entry.dy*(1-alpha));}
  private readonly entries = new Map<EntityId,Entry>();
  private order: Entry[] = [];
  private readonly groups: InstanceRuns[] = [];
  private readonly seen = new Set<EntityId>();
  private readonly requested = new Set<string>();
  private white?: BakedPart;
  private batched = 0;
  get size(){return this.entries.size;}
  get diagnostics(){return{actors:this.size,batched:this.batched,fallback:this.size-this.batched,meshes:this.groups.reduce((n,g)=>n+g.diagnostics.meshes,0)};}
  sync(views:readonly ActorView[],time:number,assets:GameAssets,art:PlayerArt,adoptMotion=true):void {
    this.hasMotion=false;this.seen.clear();this.batched=0;if(this.motion&&adoptMotion)this.history.begin();
    for(const view of views){this.seen.add(view.id);let entry=this.entries.get(view.id);if(!entry){entry={view,flip:1,dx:0,dy:0};this.entries.set(view.id,entry);this.order.push(entry);}entry.view=view;if(this.motion&&adoptMotion){this.history.sample(view.id,view.x,view.y);entry.dx=this.history.dx;entry.dy=this.history.dy;}this.hasMotion||=entry.dx!==0||entry.dy!==0;}
    if(this.motion&&adoptMotion)this.history.end();
    for(const[id,entry]of this.entries)if(!this.seen.has(id)){entry.fallback?.destroy();this.entries.delete(id);}
    this.order=this.order.filter(entry=>this.seen.has(entry.view.id));this.order.sort((a,b)=>a.view.y-b.view.y);
    let group:InstanceRuns|undefined,groupIndex=0,childIndex=0;
    const place=(child:Container)=>{if(child.parent!==this)this.addChild(child);if(this.getChildIndex(child)!==childIndex)this.setChildIndex(child,childIndex);childIndex++;};
    for(const entry of this.order){
      const v=entry.view,id=v.spriteId!==undefined?v.spriteId:v.definitionId;
      if(v.kind==='enemy'&&id!==null&&!this.requested.has(id)){this.requested.add(id);void assets.request('enemy',id);}
      const texture=v.kind==='enemy'&&id!==null?assets.get('enemy',id):undefined;
      const supported=v.kind==='enemy'&&!v.boss&&texture&&!v.downed&&!(v.shield??0)&&!(v.wallFlash??0)&&!(v.invulnerability??0);
      if(!supported){if(group){group.finish();group=undefined;}entry.fallback??=new ActorDisplay();entry.fallback.sync(v,time,assets);place(entry.fallback);continue;}
      if(entry.fallback){entry.fallback.destroy();entry.fallback=undefined;}
      if(!group){group=this.groups[groupIndex]??=new InstanceRuns(true,this.motion);groupIndex++;group.begin();place(group);}
      if(!this.batched){const p=art.image(Texture.WHITE);if(this.white?.texture!==p.texture)this.white={texture:p.texture,anchorX:.5,anchorY:.5};}
      this.batched++;group.setMotion(entry.dx,entry.dy);
      const r=v.radius*(v.scale??1),alpha=v.alpha??1,bob=v.moving?Math.sin(v.walkPhase??time*10)*2:Math.sin((v.age??time)*2)*1.2;
      const emit=(x:number,y:number,w:number,h:number,color:number,a:number,shape=1,rx=0,ry=0)=>group!.quad(this.white!,'normal',x,y,0,w/this.white!.texture.width,h/this.white!.texture.height,alpha*a,color,shape,rx,ry);
      emit(v.x,v.y+r*.85,r*.92*2,r*.36*2,0,.32);
      if(v.facePlayer&&!v.faceRotate)entry.flip=Math.cos(v.facing??v.angle)<0?-1:1;
      const rotation=v.facePlayer&&v.faceRotate?(v.facing??v.angle)+Math.PI/2:0,size=r*2.6;
      const x=v.x+Math.sin(rotation)*size*.1,y=v.y+bob*.5-Math.cos(rotation)*size*.1;
      const image=art.image(texture),tint=v.mutant?0x9e2941:0xffffff;
      group.quad(image,'normal',x,y,rotation,size/texture.width*entry.flip,size/texture.height,alpha,tint);
      if((v.hurtFlash??0)>0)group.quad(image,'add',x,y,rotation,size/texture.width*entry.flip,size/texture.height,alpha*Math.min(.7,(v.hurtFlash??0)*4));
      const placement=!v.noEyes?enemyEyePlacement(v.definitionId,r,v.angle):undefined;
      if(placement){for(const eye of placement.eyes){const radius=placement.eyeRadius,ey=v.y+bob*.5+eye.y;emit(v.x+eye.x,ey,radius*2,radius*2,0x0a0a0e,.92);emit(v.x+eye.x-radius*.25,ey-radius*.3,radius*.5,radius*.5,0xffffff,.85);}}
      const ratio=v.maxHp?Math.max(0,Math.min(1,(v.hp??0)/v.maxHp)):1;
      if(ratio<1){const width=r*2,cy=v.y-r*2.6+2;emit(v.x,cy,width,4,0,.7,7,Math.min(1,4/width),1);const fill=width*ratio;emit(v.x-r+fill*.5,cy,fill,4,0xff5f6d,1,7,Math.min(1,4/fill),Math.min(1,fill/4));}
    }
    group?.finish();
    for(let i=groupIndex;i<this.groups.length;i++){const g=this.groups[i];g.begin();g.finish();if(g.parent===this)this.removeChild(g);}
  }
  override destroy():void{for(const group of this.groups)group.destroy();for(const entry of this.entries.values())entry.fallback?.destroy();this.history.clear();this.entries.clear();this.order.length=0;super.destroy({children:true});}
}
