import { Container,Graphics,Sprite,Texture } from 'pixi.js';
import type { PixiRenderer } from './create-renderer';
/** Compose the invariant source image and battle shade once at source resolution.
 * Linear texture filtering commutes with this affine color transform; only the
 * intermediate 8-bit rounding may differ slightly in channel values. No frame-sized
 * intermediate target or extra shade pass is needed during play. */
export class BattleBackground {
 private original?:Texture;private baked?:Texture;
 texture(source:Texture,renderer:PixiRenderer):Texture {
  if(this.original===source&&this.baked)return this.baked;
  this.clear();
  const target=new Container(),base=new Graphics().rect(0,0,source.width,source.height).fill(0x162131),image=new Sprite(source),shade=new Graphics().rect(0,0,source.width,source.height).fill({color:0x0a0c12,alpha:.42});
  target.addChild(base,image,shade);
  try{this.baked=renderer.generateTexture({target,resolution:source.source.resolution,antialias:false});this.original=source;return this.baked;}
  finally{target.destroy({children:true});}
 }
 clear():void{this.baked?.destroy(true);this.baked=undefined;this.original=undefined;}
 get diagnostics(){return{textures:Number(!!this.baked),estimatedBytes:this.baked?this.baked.source.pixelWidth*this.baked.source.pixelHeight*4:0};}
}
