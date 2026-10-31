import { Container,Filter,GlProgram,Rectangle } from 'pixi.js';
import type { CameraTransform } from './camera';
import { filterVertex } from './shaders/filter-vertex';

const fragment=`in vec2 vTextureCoord;out vec4 finalColor;uniform sampler2D uTexture;
void main(){finalColor=texture(uTexture,vTextureCoord);}`;
/** One additive light segment at the player's original scene position. The
 * viewport is explicit: shader-generated positions have no useful CPU bounds. */
export class PlayerSoftLayer extends Container {
  private filter?:Filter;
  private readonly area=new Rectangle();
  private pixels=0;
  private pooledWidth=0;private pooledHeight=0;
  private readonly chain:Filter[]=[];
  constructor(){super({label:'player-soft'});this.visible=false;}
  update(camera:CameraTransform,resolution:number,enabled:boolean):void {
    this.visible=enabled&&this.children.some(c=>c.visible);
    if(!this.visible){if(this.filters?.length)this.filters=[];this.pixels=0;return;}
    if(!this.filter){
      this.filter=new Filter({glProgram:GlProgram.from({name:'player-soft',preferredFragmentPrecision:'highp',vertex:filterVertex,fragment}),blendMode:'add',padding:0,antialias:false,clipToViewport:true});
      const apply=this.filter.apply.bind(this.filter);
      this.filter.apply=(manager,input,output,clear)=>{this.pooledWidth=input.source.pixelWidth;this.pooledHeight=input.source.pixelHeight;apply(manager,input,output,clear);};
      this.chain.push(this.filter);
    }
    this.filter.resolution=resolution*.5;if(this.filters!==this.chain)this.filters=this.chain;
    // Pixi transforms filterArea by this container's worldTransform.
    this.area.x=camera.x-camera.width/(2*camera.zoom);this.area.y=camera.y-camera.height/(2*camera.zoom);
    this.area.width=camera.width/camera.zoom;this.area.height=camera.height/camera.zoom;this.filterArea=this.area;
    this.pixels=Math.ceil(camera.width*resolution*.5)*Math.ceil(camera.height*resolution*.5);
  }
  get diagnostics(){return{active:this.visible,passes:Number(this.visible),requestedPixels:this.pixels,lastPooledWidth:this.pooledWidth,lastPooledHeight:this.pooledHeight,lastPooledBytes:this.pooledWidth*this.pooledHeight*4};}
  override destroy():void{this.filters=[];this.filter?.destroy();super.destroy();}
}
