import { Buffer, BufferImageSource, BufferUsage, Container, Matrix, Mesh, MeshGeometry, Shader, Texture, UniformGroup,
  localUniformBitGl, roundPixelsBitGl, textureBitGl, type TextureSource } from 'pixi.js';
import { BODY_STRIDE, type BodyAppearance, type BodyPacket } from '../render-data/player-bodies';
import { PLAYER_STYLES } from '../game';
import type { GameAssets } from './assets';
import type { BakedPart, PlayerArt } from './player-art';
import { gl2Program } from './gl-program';

const MAX_PARTS = 10;
const ROLES = [[0, 6, 7], [0, 1, 6, 7, 8], [0, 2, 3, 4, 5, 6, 7, 9, 10, 11], [0, 6, 7, 12, 13]];
const gl = { name: 'player-body-templates', vertex: { header: `
  in vec4 aPrevious; in vec4 aBase0; in vec4 aBase1; in vec4 aHistory0; in vec4 aHistory1; in vec2 aPart;
  uniform highp usampler2D uMaterials; uniform float uStyle; uniform float uOpacity; uniform float uInterpolation;
  vec4 material(int i){return uintBitsToFloat(texelFetch(uMaterials,ivec2(i%256,i/256),0));}
`, main: `
  int role=int(aPart.x),slot=int(aPart.y),n=int(aBase1.y),style=int(uStyle);
  int variant=role>=2&&role<=5?(n>1?n-1:0):0;
  int id=(int(aBase1.w)*10+slot)*8+variant*2;
  vec4 bounds=material(id),region=material(id+1);
  vec2 p=bounds.xy+aPosition*bounds.zw,base=mix(aPrevious.xy,aBase0.xy,uInterpolation);
  float rotation=mix(aPrevious.z,aBase0.z,uInterpolation),phase=mix(aPrevious.w,aBase0.w,uInterpolation),alpha=aBase1.x*uOpacity,r=aBase1.z;
  bool hidden=bounds.z<=0.;
  if(role==0){p*=r*.1;rotation=0.;alpha*=.34;}
  else if(role==1){hidden=hidden||n==0;}
  else if(role>=2&&role<=5){
    int j=role-2;hidden=hidden||n<2||j>=n;
    base=j==0?aHistory0.xy:j==1?aHistory0.zw:j==2?aHistory1.xy:aHistory1.zw;
    base+=mix(aPrevious.xy,aBase0.xy,uInterpolation)-aBase0.xy;rotation=0.;float fraction=1.-float(j+1)/float(n+1);alpha*=.34*(.4+fraction*.6);
  }else if(role>=9&&role<=11){
    float a=phase+float(role-9)/3.*6.283185307179586;
    base+=vec2(cos(a),sin(a))*r*1.9;rotation=a*2.;
  }else if(role==12){base-=vec2(cos(rotation),sin(rotation))*r*1.2;p.x*=2.6+sin(phase)*.5;}
  else if(style==1){rotation=phase;}else if(style==2){rotation=0.;}
  if(hidden)p=vec2(0.);
  float ca=cos(rotation),sa=sin(rotation);position=base+vec2(p.x*ca-p.y*sa,p.x*sa+p.y*ca);
  uv=mix(region.xy,region.zw,aUV);vColor=vec4(alpha);
` } };
const bits = [gl, localUniformBitGl, textureBitGl, roundPixelsBitGl];
type Appearance = ReturnType<PlayerArt['appearance']>;
function parts(role: number, appearance: Appearance, halo?: BakedPart): (BakedPart | undefined)[] {
  if (role === 0) return [halo];
  if (role === 1) return [appearance.trail];
  if (role >= 2 && role <= 5) {
    const index = role - 2;
    return [undefined, appearance.discs?.[2]?.[index], appearance.discs?.[3]?.[index], appearance.discs?.[4]?.[index]];
  }
  return [role === 6 ? appearance.body : role === 7 ? appearance.detail : role === 8 ? appearance.core
    : role <= 11 ? appearance.star : role === 12 ? appearance.flame : appearance.star];
}
class StyleBuffer {
  data = new Float32Array(BODY_STRIDE * 64);
  readonly buffer = new Buffer({ data: this.data, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST, shrinkToFit: false });
  previous=new Float32Array(4*64);
  readonly previousBuffer=new Buffer({data:this.previous,usage:BufferUsage.VERTEX|BufferUsage.COPY_DST,shrinkToFit:false});
  readonly opacity: UniformGroup;
  count = 0;
  constructor(readonly style: number) { this.opacity = new UniformGroup({ uStyle: { value: style, type: 'f32' }, uOpacity: { value: 1, type: 'f32' },uInterpolation:{value:1,type:'f32'} }); }
  upload(packet: BodyPacket, offset: number, opacity: number): void {
    this.count = packet.counts[this.style]; const size = this.count * BODY_STRIDE;
    if (size > this.data.length) { let capacity = this.data.length; while (capacity < size) capacity *= 2; this.data = new Float32Array(capacity); }
    // The renderer owns this staging array. Returning the transferred packet must
    // never detach the CPU source needed for a later WebGL context restoration.
    if (size) { const source = 'groups' in packet ? packet.groups[this.style] : packet.data;
      const start = 'groups' in packet ? 0 : offset * BODY_STRIDE; this.data.set(source.subarray(start, start + size)); this.buffer.setDataWithSize(this.data, size, true); }
    this.opacity.uniforms.uOpacity = opacity; this.opacity.update();
  }
  destroy(): void { this.buffer.destroy();this.previousBuffer.destroy(); }
}
class BodyMesh extends Mesh<MeshGeometry> {
  private readonly ownBuffers: Buffer[];
  private readonly fullIndices: Uint32Array;
  private readonly sharpIndices:Uint32Array;
  setHaloSeparated(value:boolean):void { const next=value?this.sharpIndices:this.fullIndices;if(this.geometry.indices!==next)this.geometry.indices=next; }
  constructor(style: StyleBuffer, materials: BufferImageSource, texture: Texture, haloOnly=false) {
    const positions: number[] = [], uvs: number[] = [], roles: number[] = [], indices: number[] = [];
    ROLES[style.style].forEach((role, slot) => {
      if(haloOnly&&role!==0)return;
      const base = positions.length / 2; positions.push(0,0,1,0,1,1,0,1); uvs.push(0,0,1,0,1,1,0,1);
      for (let i = 0; i < 4; i++) roles.push(role, slot);
      indices.push(base,base+1,base+2,base,base+2,base+3);
    });
    const geometry = new MeshGeometry({ positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices: new Uint32Array(indices) });
    geometry.addAttribute('aPart', { buffer: new Buffer({ data: new Float32Array(roles), usage: BufferUsage.VERTEX }), format: 'float32x2', stride: 8, offset: 0 });
    const ownBuffers = [...geometry.buffers];
    for (let i = 0; i < 4; i++) geometry.addAttribute(['aBase0', 'aBase1', 'aHistory0', 'aHistory1'][i],
      { buffer: style.buffer, format: 'float32x4', stride: BODY_STRIDE * 4, offset: i * 16, instance: true });
    geometry.addAttribute('aPrevious',{buffer:style.previousBuffer,format:'float32x4',stride:16,offset:0,instance:true});
    const shader = new Shader({ glProgram: gl2Program('player-bodies', bits), resources: {
      uMaterials: materials, uTexture: texture.source, styleUniforms: style.opacity,
      textureUniforms: { uTextureMatrix: { value: new Matrix(), type: 'mat3x3<f32>' } },
    } });
    super({ geometry, shader: Object.assign(shader, { texture }), texture });
    this.fullIndices=geometry.indices;this.sharpIndices=this.fullIndices.subarray(6);this.ownBuffers = ownBuffers; this.blendMode = 'add'; this.visible = false;
  }
  override destroy(): void {
    const geometry = this.geometry, shader = this.shader; super.destroy();
    geometry.destroy(false); for (const buffer of this.ownBuffers) buffer.destroy(); shader?.destroy();
  }
}
class MaterialPage {
  usedStyles = 0;haloStyles=0;sharpStyles=0;
  readonly halos:BodyMesh[]=[];
  values = new Float32Array(1024);
  readonly source = new BufferImageSource({ resource: new Uint32Array(this.values.buffer), width: 256, height: 1,
    format: 'rgba32uint', scaleMode: 'nearest', autoGenerateMipmaps: false });
  readonly texture: Texture;
  readonly meshes: BodyMesh[];
  constructor(parent: Container, textureSource: TextureSource, private readonly styles: StyleBuffer[]) {
    this.texture = new Texture({ source: textureSource });
    this.meshes = styles.map(style => parent.addChild(new BodyMesh(style, this.source, this.texture)));
  }
  separateHalo(layer:Container|undefined):void {
    if(layer&&this.haloStyles&&!this.halos.length)for(const style of this.styles)this.halos.push(layer.addChild(new BodyMesh(style,this.source,this.texture,true)));
    this.meshes.forEach((m,i)=>{m.setHaloSeparated(!!layer);m.visible=!!((layer?this.sharpStyles:this.usedStyles)&1<<i)&&this.styles[i].count>0;m.geometry.instanceCount=m.visible?this.styles[i].count:0;});
    this.halos.forEach((m,i)=>{m.visible=!!layer&&!!(this.haloStyles&1<<i)&&this.styles[i].count>0;m.geometry.instanceCount=m.visible?this.styles[i].count:0;});
  }
  reserve(size: number): void {
    if (size > this.values.length) { let capacity = this.values.length; while (capacity < size) capacity *= 2; this.values = new Float32Array(capacity); this.source.resource = new Uint32Array(this.values.buffer); this.source.resize(256, capacity / 1024); }
    this.values.fill(0);
  }
  write(index: number, part: BakedPart, style: number,halo=false): void {
    if(halo)this.haloStyles|=1<<style;else this.sharpStyles|=1<<style;
    this.usedStyles |= 1 << style;
    const texture = part.texture, scale = part.scale ?? 1;
    this.values.set([-part.anchorX * texture.width * scale, -part.anchorY * texture.height * scale,
      texture.width * scale, texture.height * scale, texture.uvs.x0, texture.uvs.y0, texture.uvs.x2, texture.uvs.y2], index);
  }
  destroy(): void { for (const mesh of [...this.meshes,...this.halos]) mesh.destroy(); this.source.destroy(); this.texture.destroy(); }
}
/** GPU resource ownership stays here; the transferred data contains logical
 * appearances only. Work scales with appearances/pages, not bullets/parts. */
export class PlayerBodyTemplates extends Container {
  private softLayer?:Container;
  setSoftLayer(layer:Container|undefined):void {if(this.softLayer===layer)return;this.softLayer=layer;for(const page of this.pages.values())page.separateHalo(layer);}
  private readonly styles = [0,1,2,3].map(style => new StyleBuffer(style));
  private readonly pages = new Map<number, MaterialPage>();
  private white?: Texture;
  private parts = 0;private previousUploadBytes=0;
  private materialUploadBytes = 0;
  private materialRevision = -1;
  private previousAppearances: readonly BodyAppearance[] = [];
  private haloAppearances: boolean[] = [];
  private readonly glows = new Set<string>();
  private readonly appearanceCache = new Map<string, Map<number, (Appearance | undefined)[]>>();
  hasMotion=false;
  private identities=new Map<number,number>();
  resetInterpolation():void{this.identities.clear();this.hasMotion=false;}
  private readonly delta={x:0,y:0};
  motionDelta(id:number|string):Readonly<{x:number;y:number}> {
    const encoded=typeof id==='number'?this.identities.get(id):undefined;
    this.delta.x=this.delta.y=0;
    if(encoded!==undefined){const style=this.styles[encoded%4],row=Math.floor(encoded/4);this.delta.x=style.previous[row*4]-style.data[row*BODY_STRIDE];this.delta.y=style.previous[row*4+1]-style.data[row*BODY_STRIDE+1];}
    return this.delta;
  }
  interpolate(alpha:number):void{for(const style of this.styles){style.opacity.uniforms.uInterpolation=alpha;style.opacity.update();}}
  accept(packet: BodyPacket, art: PlayerArt, assets: GameAssets, opacity: number,interpolate=false,adoptMotion=true): void {
    const white = art.get('white', 1, '#ffffff').texture;
    if (this.white && this.white !== white) { for (const page of this.pages.values()) page.destroy(); this.pages.clear(); this.appearanceCache.clear(); this.glows.clear(); this.materialRevision = -1; this.previousAppearances = []; }
    this.white = white;
    const size = packet.appearances.length * MAX_PARTS * 4 * 8;
    const stable = this.materialRevision === assets.revision && packet.appearances.length === this.previousAppearances.length
      && packet.appearances.every((v, i) => { const p = this.previousAppearances[i]; return p.style === v.style && p.radius === v.radius && p.color === v.color; });
    this.parts = packet.bodyParts; this.materialUploadBytes = 0;
    if (!stable) {
      for (const page of this.pages.values()) {page.usedStyles = 0;page.haloStyles=page.sharpStyles=0;}
      this.haloAppearances.length = packet.appearances.length;
      packet.appearances.forEach((descriptor: BodyAppearance, appearanceId) => {
        let radii = this.appearanceCache.get(descriptor.color);
        if (!radii) { radii = new Map(); this.appearanceCache.set(descriptor.color, radii); }
        let list = radii.get(descriptor.radius); if (!list) { list = []; radii.set(descriptor.radius, list); }
        const appearance = list[descriptor.style] ??= art.appearance(PLAYER_STYLES[descriptor.style], descriptor.radius, descriptor.color);
        const path = `ordinary/glow_${descriptor.color.slice(1).toLowerCase()}.png`;
        if (!this.glows.has(path)) { this.glows.add(path); void assets.requestFile(path); }
        const glow = assets.getFile(path), halo = glow ? art.glow(descriptor.color, glow) : undefined;
        this.haloAppearances[appearanceId] = !!halo;
        ROLES[descriptor.style].forEach((role, slot) => {
          const variants = parts(role, appearance, halo);
          for (let variant = 0; variant < 4; variant++) {
            const part = variants[variants.length === 1 ? 0 : variant]; if (!part) continue;
            const source = part.texture.source;
            let page = this.pages.get(source.uid);
            if (!page) { page = new MaterialPage(this, source, this.styles); this.pages.set(source.uid, page); }
            if (!page.usedStyles) page.reserve(size);
            page.write(((appearanceId * MAX_PARTS + slot) * 4 + variant) * 8, part, descriptor.style,role===0);
          }
        });
      });
      // Only immutable logical descriptors are retained, never a leased buffer.
      this.previousAppearances = [...packet.appearances]; this.materialRevision = assets.revision;
    }
    this.haloAppearances.forEach((halo, i) => { if (halo) this.parts += packet.appearanceCounts[i]; });
    this.previousUploadBytes=0;
    if(adoptMotion){this.hasMotion=false;const next=new Map<number,number>();let idOffset=0;
    for(const style of this.styles){const count=packet.counts[style.style],source='groups'in packet?packet.groups[style.style]:packet.data,sourceOffset='groups'in packet?0:idOffset*BODY_STRIDE;
      if(count*4>style.previous.length)style.previous=new Float32Array(Math.max(count*4,style.previous.length*2));
      if(!packet.ids){if(style.previousBuffer.data.length<style.previous.length)style.previousBuffer.setDataWithSize(style.previous,style.previous.length,true);idOffset+=count;continue;}
      for(let i=0;i<count;i++){
        const k=sourceOffset+i*BODY_STRIDE,out=i*4,id=packet.ids[idOffset+i],old=id===undefined?undefined:this.identities.get(id);
        const oldStyle=old===undefined?undefined:this.styles[old%4],oldOffset=old===undefined?0:Math.floor(old/4)*BODY_STRIDE;
        const stable=interpolate&&oldStyle?.style===style.style&&(oldStyle.data[oldOffset]-source[k])**2+(oldStyle.data[oldOffset+1]-source[k+1])**2<256**2;
        for(let n=0;n<4;n++)style.previous[out+n]=stable?oldStyle!.data[oldOffset+n]:source[k+n];
        // Resolve angle wrapping once per entity, rather than two atan/sin/cos
        // chains for every vertex of every body part on the GPU.
        if(stable)for(let n=2;n<4;n++){const delta=source[k+n]-style.previous[out+n];style.previous[out+n]+=Math.round(delta/(Math.PI*2))*(Math.PI*2);}
        if(stable)for(let n=0;n<4;n++)this.hasMotion||=Math.abs(style.previous[out+n]-source[k+n])>.00001;
        if(id!==undefined)next.set(id,i*4+style.style);
      }
      if(count){style.previousBuffer.setDataWithSize(style.previous,count*4,true);this.previousUploadBytes+=count*16;}idOffset+=count;
    }
    this.identities=next;
    }
    let offset = 0;
    for (const style of this.styles) { style.upload(packet, offset, opacity); offset += style.count; }
    for (const page of this.pages.values()) {
      if (!stable && size && page.usedStyles) { page.source.update(0, size / 4); this.materialUploadBytes += size * 4; }
      page.separateHalo(this.softLayer);
    }
  }
  get diagnostics() {
    const meshes = [...this.pages.values()].flatMap(page => [...page.meshes,...page.halos]), instanceUploadBytes = this.styles.reduce((n, style) => n + style.count * BODY_STRIDE * 4, 0);
    return { meshes: meshes.length, draws: meshes.filter(mesh => mesh.visible).length,
      bases: this.styles.reduce((n, style) => n + style.count, 0), parts: this.parts,
      templateParts: meshes.reduce((n, mesh) => n + mesh.geometry.indices.length / 6 * mesh.geometry.instanceCount, 0),
      vertices: meshes.reduce((n, mesh) => n + mesh.geometry.indices.length / 6 * 4 * mesh.geometry.instanceCount, 0),
      triangles: meshes.reduce((n, mesh) => n + mesh.geometry.indices.length / 3 * mesh.geometry.instanceCount, 0),
      instanceUploadBytes,previousUploadBytes:this.previousUploadBytes, materialUploadBytes: this.materialUploadBytes, uploadBytes: instanceUploadBytes + this.previousUploadBytes+ this.materialUploadBytes };
  }
  override destroy(): void { for (const page of this.pages.values()) page.destroy(); this.pages.clear(); for (const style of this.styles) style.destroy(); super.destroy({ children: true }); }
}
