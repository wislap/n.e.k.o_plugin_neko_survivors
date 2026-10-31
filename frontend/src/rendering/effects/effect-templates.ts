import { Buffer, BufferUsage, Color, Mesh, MeshGeometry, Shader, Texture, localUniformBitGl, roundPixelsBitGl } from 'pixi.js';
import type { EffectView } from '../../game';
import { gl2Program } from '../gl-program';
import { analyticFragment } from '../analytic-fragment';
const kinds = ['sparkle','shard','hit','impact','shockwave','explosion','ring','beam','trail'] as const;
const index = new Map<string,number>(kinds.map((name,i)=>[name,i]));
const vertex = {name:'effect-templates',vertex:{header:`
in vec4 aFx0;in vec4 aFx1;in vec4 aFx2;in vec4 aFx3;in float aRole;
out float vAdditive;out vec2 vLocal;out vec4 vShape;
`,main:`
float role=aRole,k=clamp(aFx0.w,0.,1.),fade=1.-k,r=aFx0.z;
int kind=int(aFx1.w);float rotation=aFx3.w>.5?0.:aFx1.x;
vec2 offset=vec2(0.),size=vec2(0.);float localAngle=0.,shape=1.,inner=0.,start=0.,span=0.,a=1.;
uint tint=uint(aFx1.z);vec3 color=vec3(float((tint>>16u)&255u),float((tint>>8u)&255u),float(tint&255u))/255.;
float radius=0.,width=0.;bool ring=false,hidden=false;
if(kind==0){radius=max(.1,r*fade);hidden=role>0.;size=vec2(radius*2.);}
else if(kind==1){float s=r*(.5+fade*.7);offset.y=-s*.1;size=vec2(s*1.8);shape=5.;hidden=role>0.;}
else if(kind==2){if(role==0.){size=vec2((3.+k*4.)*2.);color=vec3(1.);}else{float ang=(role-1.)/6.*6.28318530718+.4;float lo=4.+k*8.,hi=8.+k*16.;offset=vec2(cos(ang),sin(ang))*(lo+hi)*.5;size=vec2(hi-lo,(mod(role-1.,2.)>0.?1.6:3.)*fade+.6);localAngle=ang;shape=4.;hidden=role>6.;}}
else if(kind==3){float rays=aFx3.x,power=aFx2.w;if(role==12.){size=vec2((power*10.+5.)*(.4+k*1.2)*2.);a=.32;}else{float ang=role/rays*6.28318530718;bool longRay=mod(role,2.)==0.;float lo=(6.+power*8.)*(.5+k*.9),len=(longRay?20.:11.)*(.6+power*.9)*(.4+fade*.8);offset=vec2(cos(ang),sin(ang))*(lo+len*.5);size=vec2(len,(longRay?2.6:1.6)*(.5+fade*.6)*2.);localAngle=ang;color=vec3(1.);shape=6.;hidden=role>=rays;}}
else if(kind==4){radius=r*(.35+k*1.15);if(role==0.){width=14.*fade+2.;a=.85;}else{radius+=6.*fade;width=3.*fade+.5;color=vec3(1.);a=.7;}ring=true;hidden=role>1.;}
else if(kind==5){radius=r*(.35+k*.85);if(role==0.){radius*=.92;width=7.*fade+1.5;a=.55;ring=true;}else if(role==11.){size=vec2(radius*(.46-k*.16)*2.);color=vec3(1.);a=.65;}else{float j=11.-role;size=vec2(radius*j/10.*2.);a=.045*(1.-j/11.);}hidden=role>11.;}
else if(kind==6){radius=aFx3.z>.5?r*(.4+k*.8):r;width=aFx3.z>.5?3.*fade+1.:2.;ring=true;if(aFx3.z>.5){shape=3.;start=mod(role/12.*6.28318530718+aFx3.y,6.28318530718);span=6.28318530718/12.*.63;float crack=(1.-k)/.45;a=k>.55?crack*crack:.7;hidden=role>11.;}else hidden=role>0.;}
else if(kind==7){vec2 end=aFx2.xy;float len=length(end);size=vec2(len,role==0.?aFx2.z*(.4+fade*.6):max(.5,aFx2.z*.3*fade));offset=end*.5;localAngle=atan(end.y,end.x);shape=4.;if(role>0.){color=vec3(1.);a=.9;}hidden=role>1.;}
else{size=vec2(r*2.,r*.5);hidden=role>0.;}
if(ring){float outer=radius+width*.5;size=vec2(outer*2.);inner=max(0.,radius-width*.5)/outer;if(shape!=3.)shape=2.;}
float ca=cos(rotation),sa=sin(rotation),ang=rotation+localAngle,c=cos(ang),s=sin(ang);
vec2 p=(aPosition*2.-1.)*size*.5;if(hidden)p=vec2(0.);
position=aFx0.xy+vec2(offset.x*ca-offset.y*sa,offset.x*sa+offset.y*ca)+vec2(p.x*c-p.y*s,p.x*s+p.y*c);
float alpha=aFx1.y*a;vColor=vec4(color*alpha,alpha);vAdditive=kind==1?0.:1.;vLocal=aPosition*2.-1.;vShape=vec4(shape,inner,start,span);
`}};
const bits=[vertex,localUniformBitGl,roundPixelsBitGl,{name:'analytic-shapes',fragment:analyticFragment}];
/** One compact record per effect; fixed roles retain primitive order. Hidden
 * roles degenerate before rasterization, never truncate visible effects. */
export class EffectTemplates extends Mesh<MeshGeometry> {
  private data = new Float32Array(64*16);
  private readonly instances: Buffer;
  private count = 0;
  private primitives = 0;
  private readonly colors = new Map<string,number>();
  constructor(){
    const p:number[]=[],uv:number[]=[],roles:number[]=[],ix:number[]=[];
    for(let role=0;role<13;role++){const n=p.length/2;p.push(0,0,1,0,1,1,0,1);uv.push(0,0,1,0,1,1,0,1);roles.push(role,role,role,role);ix.push(n,n+1,n+2,n,n+2,n+3);}
    const geometry=new MeshGeometry({positions:new Float32Array(p),uvs:new Float32Array(uv),indices:new Uint32Array(ix)});
    const data=new Float32Array(64*16),instances=new Buffer({data,usage:BufferUsage.VERTEX|BufferUsage.COPY_DST,shrinkToFit:false});
    geometry.addAttribute('aRole',{buffer:new Buffer({data:new Float32Array(roles),usage:BufferUsage.VERTEX}),format:'float32',stride:4,offset:0});
    for(let i=0;i<4;i++)geometry.addAttribute('aFx'+i,{buffer:instances,format:'float32x4',stride:64,offset:i*16,instance:true});
    super({geometry,shader:Object.assign(new Shader({glProgram:gl2Program('effect-templates',bits)}),{texture:Texture.WHITE})});this.instances=instances;this.data=data;this.blendMode='normal';this.visible=false;
  }
  static supports(v:EffectView):boolean {return index.has(v.kind)&&!(v.kind==='sparkle'&&v.end)&&v.variant!=='glass'&&v.variant!=='crack'&&!(v.kind==='impact'&&((v.rays??9)>12||!Number.isInteger(v.rays??9)||(v.rays??9)<1));}
  begin():void{this.count=this.primitives=0;}
  append(v:EffectView,opacity:number):number{
    const k=this.count++*16;if(k+16>this.data.length){const a=new Float32Array(this.data.length*2);a.set(this.data);this.data=a;}
    let color=this.colors.get(v.color);if(color===undefined){color=Color.shared.setValue(v.color).toNumber();this.colors.set(v.color,color);}
    this.data.set([v.x,v.y,v.radius,v.progress??0,v.angle??0,v.alpha*(v.playerOwned?opacity:1),color,index.get(v.kind)!,v.end?v.end.x-v.x:v.radius,v.end?v.end.y-v.y:0,v.width??8,v.power??.5,v.rays??9,v.seed??0,Number(v.progress!==undefined),Number(!!v.end)],k);
    const primitives=v.kind==='hit'?7:v.kind==='impact'?(v.rays??9)+1:v.kind==='shockwave'||v.kind==='beam'?2:v.kind==='explosion'?12:v.kind==='ring'&&v.progress!==undefined?12:1;
    this.primitives+=primitives;return primitives;
  }
  finish():void{this.visible=!!this.count;this.geometry.instanceCount=this.count;if(this.count)this.instances.setDataWithSize(this.data,this.count*16,true);}
  get diagnostics(){return{meshes:this.visible?1:0,effects:this.count,primitives:this.primitives,uploadBytes:this.count*64,templateVertices:this.count*13*4};}
  override destroy():void{const geometry=this.geometry,shader=this.shader;super.destroy();geometry.destroy(true);shader?.destroy();this.colors.clear();}
}
