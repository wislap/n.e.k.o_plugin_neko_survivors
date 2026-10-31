import type { EntityId,RenderStreamView } from '../game';
import { gl2Program } from './gl-program';
import { Buffer, BufferUsage, Container, Mesh, MeshGeometry, Shader, Texture,
  localUniformBitGl, roundPixelsBitGl, UniformGroup } from 'pixi.js';
import type { PreparedTrails } from '../game';
import { TrailPreparation } from '../game';

function template(count: number, segments: number): MeshGeometry {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const v = (kind: number, point: number, parameter: number, layer: number) => {
    const n = positions.length / 2; positions.push(kind, point); uvs.push(parameter, layer); return n;
  };
  for (let layer = 0; layer < 2; layer++) {
    if (!segments) {
      let left = v(-1, 0, 0, layer), right = v(-1, 0, 1, layer);
      for (let i = 1; i < count; i++) {
        const l = v(-1, i, 0, layer), r = v(-1, i, 1, layer);
        indices.push(left, right, l, l, right, r); left = l; right = r;
      }
    } else {
    for (let i = 0; i < count - 1; i++) {
      const a = v(0, i, 2, layer), b = v(0, i, 3, layer), c = v(0, i + 1, 0, layer), d = v(0, i + 1, 1, layer);
      indices.push(a, b, c, c, b, d);
    }
    for (let i = 1; i < count - 1; i++) {
      const inner = v(1, i, -1, layer);
      let prior = v(1, i, 0, layer);
      for (let j = 1; j <= segments; j++) { const next = v(1, i, j, layer); indices.push(inner, prior, next); prior = next; }
    }
    }
    for (const point of [0, count - 1]) {
      const a = v(2, point, 0, layer), b = v(2, point, 1, layer), c = v(2, point, 2, layer), d = v(2, point, 3, layer);
      indices.push(a, b, c, a, c, d);
    }
  }
  return new MeshGeometry({ positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) });
}
const gl = { name: 'gpu-six-point-trail', vertex: { header: `
  in vec4 aI0; in vec4 aI1; in vec4 aI2; in vec4 aI3; in vec4 aI4; in vec4 aI5; in vec4 aI6;
  out vec3 vCap; uniform float uOpacity;uniform float uInterpolation;
`, main: `
  vec2 pts[7]=vec2[7](aI3.xy,aI3.zw,aI4.xy,aI4.zw,aI5.xy,aI5.zw,aI6.xy);
  int i=int(aPosition.y),count=int(aI2.y); vec2 p=pts[i];
  vec2 before=p-pts[max(0,i-1)],after=pts[min(count-1,i+1)]-p;
  if(i==0) before=after; if(i==count-1) after=before;
  vec2 n1=normalize(vec2(-before.y,before.x)),n2=normalize(vec2(-after.y,after.x));
  float dotn=clamp(dot(n1,n2),-1.,1.),turn=n1.x*n2.y-n1.y*n2.x;
  float radius=aI0.z*.5,layer=aUV.y;
  if(layer>.5) radius*=aI0.w;
  vec2 m=(n1+n2)*radius/(1.+dotn);
  vCap=vec3(0.); vec2 offset=vec2(0.);
  if(aPosition.x<.5){
    float side=mod(aUV.x,2.)<.5?1.:-1.; vec2 normal=aUV.x<2.?n1:n2;
    if(aPosition.x<-.5||abs(turn)<.001) offset=m*side;
    else if(side*turn>0.) offset=m*side;
    else offset=normal*radius*side;
  }else if(aPosition.x<1.5){
    if(abs(turn)<.001) offset=m;
    else if(aUV.x<0.) offset=m*(turn>0.?1.:-1.);
    else{
      float angle=atan(turn,dotn),steps=floor(15.*abs(angle)*sqrt(aI0.z*.5)/3.141592653589793)+1.;
      float a=angle*min(aUV.x,steps)/steps,sgn=turn>0.?-1.:1.;
      offset=sgn*radius*vec2(n1.x*cos(a)-n1.y*sin(a),n1.x*sin(a)+n1.y*cos(a));
    }
  }else{
    vec2 d=normalize(i==0?-after:before);
    float u=(aUV.x==0.||aUV.x==3.)?0.:1.,v=aUV.x<2.?-1.:1.;
    offset=radius*vec2(u*d.x-v*d.y,u*d.y+v*d.x);vCap=vec3(u,v,1.);
  }
  position=aI0.xy+aI1.yz*(1.-uInterpolation)+p+offset;
  uint tint=uint(aI1.x);vec3 rgb=vec3(float((tint>>16u)&255u),float((tint>>8u)&255u),float(tint&255u))/255.;
  vColor=layer>.5?vec4(1.,1.,1.,aI2.x):vec4(rgb,aI1.w);
  vColor.a*=uOpacity;vColor.rgb*=vColor.a;
` }, fragment: { header: 'in vec3 vCap;', main: 'if(vCap.z>.5&&dot(vCap.xy,vCap.xy)>1.){discard;} outColor=vec4(1.);' } };
class TrailMesh extends Mesh<MeshGeometry> {
  private data = new Float32Array(28 * 64);
  private readonly buffer = new Buffer({ data: this.data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST, shrinkToFit: false });
  count = 0;
  private readonly fullIndices:Uint32Array;
  private readonly coreIndices:Uint32Array;private readonly outerIndices:Uint32Array;
  private outer?:Mesh<MeshGeometry>;
  private outerOwnBuffers:Buffer[]=[];
  private readonly sharedOpacity:UniformGroup;
  setOuterLayer(layer:Container|undefined):void{
    if(layer&&!this.outer){
      const geometry=new MeshGeometry({positions:this.geometry.positions,uvs:this.geometry.uvs,indices:this.outerIndices});
      this.outerOwnBuffers=[...geometry.buffers];
      for(let i=0;i<7;i++)geometry.addAttribute('aI'+i,{buffer:this.buffer,format:'float32x4',stride:112,offset:i*16,instance:true});
      this.outer=new Mesh({geometry,shader:Object.assign(new Shader({glProgram:gl2Program('gpu-trail',[gl,localUniformBitGl,roundPixelsBitGl]),resources:{opacity:this.sharedOpacity}}),{texture:Texture.WHITE}),texture:Texture.WHITE});
      this.outer.blendMode='add';layer.addChild(this.outer);
    }
    const indices=layer?this.coreIndices:this.fullIndices;
    if(this.geometry.indices!==indices)this.geometry.indices=indices;
    if(this.outer){this.outer.visible=!!layer&&this.count>0;this.outer.geometry.instanceCount=this.outer.visible?this.count:0;}
  }
  get allocatedMeshes():number{return this.outer?2:1;}
  get uploadBytes(): number { return this.count * 112; }
  constructor(points: number, steps: number, opacity: UniformGroup) {
    const geometry = template(points, steps);
    const shader = new Shader({
      glProgram: gl2Program('gpu-trail', [gl, localUniformBitGl, roundPixelsBitGl]), resources: { opacity },
    });
    super({ geometry, shader: Object.assign(shader, { texture: Texture.WHITE }), texture: Texture.WHITE });
    for (let i = 0; i < 7; i++) geometry.addAttribute('aI' + i, { buffer: this.buffer, format: 'float32x4', stride: 112, offset: i * 16, instance: true });
    this.fullIndices=geometry.indices;this.coreIndices=this.fullIndices.subarray(this.fullIndices.length/2);this.outerIndices=this.fullIndices.subarray(0,this.fullIndices.length/2);this.sharedOpacity=opacity;this.blendMode = 'add'; this.visible = false;
  }
  append(data: Float32Array): void {
    const k = this.count++ * 28;
    if (k + 28 > this.data.length) { const next = new Float32Array(this.data.length * 2); next.set(this.data); this.data = next; }
    this.data.set(data, k);
  }
  assign(packet: PreparedTrails, offset: number, count: number, palette: readonly number[],motion?:MotionResolver): void {
    const size = count * 28;
    if (size > this.data.length) { let capacity = this.data.length; while (capacity < size) capacity *= 2; this.data = new Float32Array(capacity); }
    this.data.set(packet.data.subarray(offset * 28, offset * 28 + size));
    for (let i = 0; i < count; i++) this.data[i * 28 + 4] = palette[this.data[i * 28 + 4]];
    if(motion&&packet.ids)for(let i=0;i<count;i++){const delta=motion(packet.ids[offset+i]);this.data[i*28+5]=delta.x;this.data[i*28+6]=delta.y;}
    this.count = count;
  }
  upload(): void { this.visible = this.count > 0; this.geometry.instanceCount = this.count; if (this.visible) this.buffer.setDataWithSize(this.data, this.count * 28, true); }
  override destroy(): void {
    if(this.outer){const g=this.outer.geometry,s=this.outer.shader;this.outer.destroy();g.destroy(false);for(const b of this.outerOwnBuffers)b.destroy();s?.destroy();}
    const g = this.geometry, s = this.shader; super.destroy(); g.destroy(true); s?.destroy();
  }
}
/** Fixed topology buckets; positions, miter edges, round joins and caps are built
 * by the vertex shader. Sharp/short reversals retain the reference renderer. */
type MotionResolver=(id:EntityId)=>Readonly<{x:number;y:number}>;
export class GpuTrails extends Container {
  private readonly meshes = new Map<number, TrailMesh>();
  private outerLayer?:Container;
  setOuterLayer(layer:Container|undefined):void{this.outerLayer=layer;for(const mesh of this.meshes.values())mesh.setOuterLayer(layer);}
  private readonly preparation = new TrailPreparation();
  private readonly opacity = new UniformGroup({ uOpacity: { value: 1, type: 'f32' },uInterpolation:{value:1,type:'f32'} });
  interpolate(alpha:number):void{this.opacity.uniforms.uInterpolation=alpha;this.opacity.update();}
  get diagnostics() { return { meshes: [...this.meshes.values()].reduce((n,m)=>n+m.allocatedMeshes,0), trails: [...this.meshes.values()].reduce((n, m) => n + m.count, 0), uploadBytes: [...this.meshes.values()].reduce((n, m) => n + m.uploadBytes, 0) }; }
  begin(opacity = 1): void {
    for (const mesh of this.meshes.values()) mesh.count = 0;
    if (this.opacity.uniforms.uOpacity !== opacity) { this.opacity.uniforms.uOpacity = opacity; this.opacity.update(); }
  }
  accept(packet: PreparedTrails, palette: readonly number[], opacity: number,motion?:MotionResolver): void {
    this.begin(opacity);
    for (const run of packet.runs) this.mesh(run.key).assign(packet, run.offset, run.count, palette,motion);
    this.finish();
  }
  private mesh(key: number): TrailMesh {
    let mesh = this.meshes.get(key);
    if (!mesh) { mesh = new TrailMesh(Math.floor(key / 128), key % 128, this.opacity); this.meshes.set(key, mesh); this.addChild(mesh); }
    return mesh;
  }
  append(stream: RenderStreamView, index: number, color: number, opacity: number,delta?:Readonly<{x:number;y:number}>): boolean {
    const key = this.preparation.prepare(stream, index, color, opacity);
    if (key < 0) return key === -2;
    if(delta){this.preparation.data[5]=delta.x;this.preparation.data[6]=delta.y;}
    this.mesh(key).append(this.preparation.data);
    return true;
  }
  finish(): void { for (const m of this.meshes.values()){m.upload();m.setOuterLayer(this.outerLayer);} }
  override destroy(): void { for (const m of this.meshes.values()) m.destroy(); this.meshes.clear(); super.destroy({ children: true }); }
}
