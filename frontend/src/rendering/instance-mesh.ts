import type { MotionUniforms } from './motion';
import { analyticFragment } from './analytic-fragment';
import { gl2Program } from './gl-program';
import { Buffer, BufferUsage, BufferImageSource, Color, Container, Matrix, Mesh, MeshGeometry, Shader, Texture,
  localUniformBitGl, roundPixelsBitGl, textureBitGl } from 'pixi.js';
import type { BakedPart } from './player-art';

/** Static material descriptors are integer texels containing float bits. Integer
 * vertex fetch uses WebGL2 integer texels without float filtering. */
class Materials {
  private values = new Float32Array(256 * 4);
  readonly source = new BufferImageSource({ resource: new Uint32Array(this.values.buffer), width: 256, height: 1, format: 'rgba32uint', scaleMode: 'nearest', autoGenerateMipmaps: false });
  private readonly ids = new Map<BakedPart, number>();
  private count = 0;
  private dirty = false;
  get(part: BakedPart): number {
    const cached = this.ids.get(part); if (cached !== undefined) return cached;
    const id = this.count++, k = id * 8, t = part.texture, uv = t.uvs, scale = part.scale ?? 1;
    if (k + 8 > this.values.length) {
      const larger = new Float32Array(this.values.length * 2); larger.set(this.values); this.values = larger;
      this.source.resource = new Uint32Array(larger.buffer); this.source.resize(256, larger.length / 1024);
    }
    this.values[k] = -part.anchorX * t.width * scale; this.values[k + 1] = -part.anchorY * t.height * scale;
    this.values[k + 2] = t.width * scale; this.values[k + 3] = t.height * scale;
    this.values[k + 4] = uv.x0; this.values[k + 5] = uv.y0; this.values[k + 6] = uv.x2; this.values[k + 7] = uv.y2;
    this.ids.set(part, id); this.dirty = true; return id;
  }
  upload(): void { if (this.dirty) { this.source.update(0, this.count * 2); this.dirty = false; } }
  destroy(): void { this.source.destroy(); this.ids.clear(); }
}
const gl = {
  name: 'compact-instance', vertex: { header: `
    in vec4 aInstance0; in vec4 aInstance1; in vec4 aInstance2; out float vAdditive; out vec2 vLocal; out vec4 vShape;
    uniform highp usampler2D uMaterials;
    vec4 material(int i){return uintBitsToFloat(texelFetch(uMaterials,ivec2(i%256,i/256),0));}
  `, main: `
    int id=int(aInstance1.w)*2;
    vec4 bounds=material(id), region=material(id+1);
    vec2 p=(bounds.xy+aPosition*bounds.zw)*aInstance1.xy;
    float ca=cos(aInstance0.z),sa=sin(aInstance0.z);
    position=aInstance0.xy+vec2(p.x*ca-p.y*sa,p.x*sa+p.y*ca);
    uv=mix(region.xy,region.zw,aUV);
    uint tint=uint(aInstance1.z);
    vColor=vec4(float((tint>>16u)&255u),float((tint>>8u)&255u),float(tint&255u),255.)/255.;
    vColor*=abs(aInstance0.w); vAdditive=aInstance0.w<0.?1.:0.; vLocal=aPosition*2.-1.; vShape=aInstance2;
  ` }, fragment: analyticFragment
};
const spriteGl = { name: 'sprite-instance', vertex: {
  header: gl.vertex.header.replace('in vec4 aInstance2; ', '').replace('out vec2 vLocal; out vec4 vShape;', ''),
  main: gl.vertex.main.replace(' vLocal=aPosition*2.-1.; vShape=aInstance2;', ''),
}, fragment: { header: 'in float vAdditive;', end: 'finalColor.a*=1.-vAdditive;' } };
// Pixi's compiler strongly caches shader bits by object identity. These fixed
// variants must reuse their bits when short-lived FX meshes are recreated.
const instanceBits = [spriteGl, gl].flatMap(bits => [false,true].map(motion=>[
  { name: bits.name+(motion?'-motion':''), vertex: motion?{header:bits.vertex.header+'\nin vec2 aMotion;uniform float uInterpolation;',main:bits.vertex.main+'\nposition+=aMotion*(1.-uInterpolation);'}:bits.vertex }, localUniformBitGl, textureBitGl, roundPixelsBitGl,
  { name: 'analytic-shapes', fragment: bits.fragment },
]));
/** 32 bytes per sprite part, 48 per analytic primitive. Fixed quad/index buffers. */
export class InstanceMesh extends Mesh<MeshGeometry> {
  private data: Float32Array;
  private readonly instances: Buffer;
  private readonly stride: number;
  private readonly materials: Materials;
  private motionData=new Float32Array(512);private motionBuffer?:Buffer;
  count = 0;
  get uploadBytes(): number { return this.count * (this.stride * 4+(this.motionBuffer?8:0)); }
  constructor(texture: Texture, blend: 'add' | 'normal' | 'mixed', analytic = false,motion?:MotionUniforms) {
    const geometry = new MeshGeometry({}), materials = new Materials();
    const stride = analytic ? 12 : 8, data = new Float32Array(stride * 256);
    const instances = new Buffer({ data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST, shrinkToFit: false });
    const shader = new Shader({
      glProgram: gl2Program('compact-instances', instanceBits[(analytic?2:0)+(motion?1:0)]),
      resources: { uMaterials: materials.source, uTexture: texture.source,
        ...(motion?{motionUniforms:motion.group}:{}),textureUniforms: { uTextureMatrix: { value: new Matrix(), type: 'mat3x3<f32>' } } },
    });
    super({ geometry, shader: Object.assign(shader, { texture }), texture });
    this.materials = materials; this.instances = instances; this.data = data; this.stride = stride;
    for (let i = 0; i < stride / 4; i++) geometry.addAttribute('aInstance' + i, { buffer: this.instances, format: 'float32x4', stride: stride * 4, offset: i * 16, instance: true });
    if(motion){this.motionBuffer=new Buffer({data:this.motionData,usage:BufferUsage.VERTEX|BufferUsage.COPY_DST,shrinkToFit:false});geometry.addAttribute('aMotion',{buffer:this.motionBuffer,format:'float32x2',stride:8,offset:0,instance:true});}
    this.blendMode = blend === 'mixed' ? 'normal' : blend; this.visible = false;
  }
  reset(): void { this.count = 0; }
  quad(part: BakedPart, x: number, y: number, angle = 0, sx = 1, sy = 1, alpha = 1, tint = 0xffffff, mode = 0, inner = 0, start = 0, span = 0,dx=0,dy=0): void {
    this.quadMaterial(this.registerMaterial(part), x, y, angle, sx, sy, alpha, tint, mode, inner, start, span,dx,dy);
  }
  registerMaterial(part: BakedPart): number { return this.materials.get(part); }
  /** Registered descriptors stay valid for this mesh's lifetime. */
  quadMaterial(material: number, x: number, y: number, angle = 0, sx = 1, sy = 1, alpha = 1, tint = 0xffffff, mode = 0, inner = 0, start = 0, span = 0,dx=0,dy=0): void {
    const k = this.count++ * this.stride;
    if(this.motionBuffer){const m=(this.count-1)*2;if(m+2>this.motionData.length){const larger=new Float32Array(this.motionData.length*2);larger.set(this.motionData);this.motionData=larger;}this.motionData[m]=dx;this.motionData[m+1]=dy;}
    if (k + this.stride > this.data.length) { const next = new Float32Array(this.data.length * 2); next.set(this.data); this.data = next; }
    this.data[k] = x; this.data[k + 1] = y; this.data[k + 2] = angle; this.data[k + 3] = alpha;
    this.data[k + 4] = sx; this.data[k + 5] = sy; this.data[k + 6] = tint; this.data[k + 7] = material;
    if (this.stride === 12) { this.data[k + 8] = mode; this.data[k + 9] = inner; this.data[k + 10] = start; this.data[k + 11] = span; }
  }
  upload(): void {
    this.visible = this.count > 0; this.geometry.instanceCount = this.count;
    if (!this.visible) return;
    if(this.motionBuffer)this.motionBuffer.setDataWithSize(this.motionData,this.count*2,true);
    this.materials.upload(); this.instances.setDataWithSize(this.data, this.count * this.stride, true);
  }
  override destroy(): void { const g = this.geometry, s = this.shader; super.destroy(); g.destroy(true); s?.destroy(); this.materials.destroy(); }
}
/** For the opaque game-content target, alpha-zero additive RGB and ordinary
 * premultiplied alpha share one blend pipeline while retaining entity order.
 * Ordered runs preserve normal-alpha composition, including add/normal transitions.
 * Additive-only callers may group by atlas source instead. */
export class InstanceRuns extends Container {
  constructor(private readonly analytic = false,protected motion?:MotionUniforms) { super(); }
  protected motionX=0;protected motionY=0;
  enableMotion(motion:MotionUniforms):void{if(this.runs.length)throw new Error('Enable interpolation before the first instance upload');this.motion=motion;}
  setMotion(x:number,y:number):void{this.motionX=x;this.motionY=y;if(this.motion&&(x!==0||y!==0))this.motion.hasMotion=true;}
  private readonly runs: InstanceMesh[] = [];
  private runIndex = 0;
  private current?: InstanceMesh;
  private readonly tints = new Map<string, number>();
  get diagnostics() { return { meshes: this.runs.length, instances: this.runs.reduce((n, r) => n + r.count, 0), uploadBytes: this.runs.reduce((n, r) => n + r.uploadBytes, 0) }; }
  colorNumber(value: string | number): number { if (typeof value === 'number') return value; let n = this.tints.get(value); if (n === undefined) { n = Color.shared.setValue(value).toNumber(); this.tints.set(value, n); } return n; }
  begin(): void { this.motionX=this.motionY=0;this.runIndex = 0; this.current = undefined; for (const r of this.runs) r.reset(); }
  quad(part: BakedPart, blend: 'add' | 'normal' | 'mixed', x: number, y: number, angle = 0, sx = 1, sy = 1, alpha = 1, tint = 0xffffff, mode = 0, inner = 0, start = 0, span = 0): void {
    if (!this.current || this.current.texture.source !== part.texture.source) {
      let run = this.runs[this.runIndex];
      if (!run || run.texture.source !== part.texture.source) {
        if (run) { run.destroy(); this.runs.splice(this.runIndex, 1); }
        run = new InstanceMesh(part.texture, 'mixed', this.analytic,this.motion); this.runs.splice(this.runIndex, 0, run); this.addChildAt(run, this.runIndex);
      }
      this.current = run; this.runIndex++;
    }
    this.current.quad(part, x, y, angle, sx, sy, blend === 'add' ? -alpha : alpha, tint, mode, inner, start, span,this.motionX,this.motionY);
  }
  finish(): void { for (const r of this.runs) r.upload(); while (this.runs.length > this.runIndex) this.runs.pop()!.destroy(); }
  override destroy(): void { for (const r of this.runs) r.destroy(); this.runs.length = 0; this.tints.clear(); super.destroy({ children: true }); }
}
