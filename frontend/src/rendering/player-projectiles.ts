import type { RenderStreamView } from '../game';
import { Color, Container, Graphics, type Texture } from 'pixi.js';
import type { ProjectileView } from '../game';
import { PLAYER_STRIDE, PLAYER_STYLES, RenderStream } from '../game';
import type { GameAssets } from './assets';
import { type BakedPart, type PlayerArt } from './player-art';
import { paintPlayerTrail, projectileColor } from './projectile-art';
import { DisplayObjectIndex } from './object-index';
import { InstanceMesh } from './instance-mesh';
import type { PreparedTrails } from '../game';
import type { BodyPacket } from '../render-data/player-bodies';
import { PlayerBodyTemplates } from './player-body-templates';
import { GpuTrails } from './gpu-trails';
import {PlayerSoftLayer}from './player-soft-layer';
import type {PlayerSoftQuality}from '../presentation/profile';
import type {CameraTransform}from './camera';

interface PreparedPart { source: BakedPart; mesh?: InstanceMesh; material?: number }
interface PreparedAppearance { body: PreparedPart; detail: PreparedPart; core?: PreparedPart; star?: PreparedPart; flame?: PreparedPart; trail?: PreparedPart; discs?: PreparedPart[][] }
interface PreparedColor { value: string; number: number; radii: Map<number, PreparedAppearance[]>; halo?: PreparedPart; haloFrame: number }


/** Additive desktop instances may share atlas draws. Normal-alpha/mobile retains
 * the reference ordered renderer. The common path never expands CPU vertices. */
export class PlayerProjectiles extends Container {
  private soft?:PlayerSoftLayer;
  private quality:PlayerSoftQuality='native';
  setSoftQuality(value:PlayerSoftQuality):void{if(this.quality===value)return;this.quality=value;if(value==='balanced')this.soft??=this.addChildAt(new PlayerSoftLayer(),0);if(this.templates)this.templates.setSoftLayer(value==='balanced'&&this.templates.visible?this.soft:undefined);this.trails.setOuterLayer(value==='balanced'?this.soft:undefined);}
  updateViewport(camera:CameraTransform,resolution:number):void{this.soft?.update(camera,resolution,this.quality==='balanced'&&this.visible);}
  private readonly pages = new Map<number, InstanceMesh>();
  private readonly trails = new GpuTrails();
  private templates?: PlayerBodyTemplates;
  private readonly fallback = new DisplayObjectIndex<Graphics>();
  private readonly compatibility = new RenderStream();
  private readonly exceptional: ProjectileView[] = [];
  private readonly colors = new Map<string, PreparedColor>();
  private readonly parts = new Map<BakedPart, PreparedPart>();
  private readonly palette: (PreparedColor | undefined)[] = [];
  private frame = 0;
  private readonly trailPalette: number[] = [];
  private revisionTexture?: Texture;
  private count = 0;
  private readonly requestedGlows = new Set<string>();
  constructor() { super(); this.addChild(this.trails); }
  get hasMotion():boolean{return this.templates?.hasMotion??false;}
  private interpolationAlpha=1;
  private readonly movingFallback:{display:Graphics;view:ProjectileView}[]=[];
  private readonly resolveMotion=(id:number|string)=>this.templates!.motionDelta(id);
  interpolate(alpha:number):void{this.interpolationAlpha=alpha;this.templates?.interpolate(alpha);this.trails.interpolate(alpha);for(const{display,view}of this.movingFallback){const d=this.templates?.motionDelta(view.id);display.position.set(view.x+(d?.x??0)*(1-alpha),view.y+(d?.y??0)*(1-alpha));}}
  resetInterpolation():void{this.templates?.resetInterpolation();}
  get size(): number { return this.count; }
  get diagnostics() {
    const trail = this.trails.diagnostics;
    const body = this.templates?.visible ? this.templates.diagnostics : undefined;
    return { softQuality:this.quality,effectiveSoftQuality:this.quality==='balanced'?(this.templates?.visible?'balanced':trail.trails?'outer-trails-only':'native'):'native',soft:this.soft?.diagnostics,bullets: this.count, baseInstances: body?.bases, bodyTemplates: body, meshes: (body?.meshes ?? this.pages.size) + trail.meshes, fallbackTrails: this.fallback.size,
      instances: body?.parts ?? [...this.pages.values()].reduce((n, m) => n + m.count, 0), gpuTrails: trail.trails,
      uploadBytes: trail.uploadBytes + (body?.uploadBytes ?? [...this.pages.values()].reduce((n, m) => n + m.uploadBytes, 0)) };
  }
  private page(part: BakedPart): InstanceMesh {
    let mesh = this.pages.get(part.texture.source.uid);
    if (!mesh) { mesh = new InstanceMesh(part.texture, 'add'); this.pages.set(part.texture.source.uid, mesh); this.addChildAt(mesh, this.pages.size+Number(!!this.soft)); }
    return mesh;
  }
  private part(source: BakedPart): PreparedPart {
    let part = this.parts.get(source);
    if (!part) { part = { source }; this.parts.set(source, part); }
    return part;
  }
  private quad(part: PreparedPart, x: number, y: number, angle = 0, sx = 1, sy = 1, alpha = 1): void {
    // Bind lazily, in the original emission order, including atlas pages first
    // encountered by halos/history parts. Later instances perform no Map lookup.
    if (!part.mesh) { part.mesh = this.page(part.source); part.material = part.mesh.registerMaterial(part.source); }
    part.mesh.quadMaterial(part.material!, x, y, angle, sx, sy, alpha);
  }
  private appearance(art: PlayerArt, style: number, radius: number, color: PreparedColor): PreparedAppearance {
    let styles = color.radii.get(radius);
    if (!styles) { styles = []; color.radii.set(radius, styles); }
    let prepared = styles[style];
    if (!prepared) {
      const source = art.appearance(PLAYER_STYLES[style], radius, color.value);
      prepared = { body: this.part(source.body), detail: this.part(source.detail),
        core: source.core && this.part(source.core), star: source.star && this.part(source.star),
        flame: source.flame && this.part(source.flame), trail: source.trail && this.part(source.trail),
        discs: source.discs?.map(row => row.map(part => this.part(part))) };
      styles[style] = prepared;
    }
    return prepared;
  }
  sync(views: readonly ProjectileView[], art: PlayerArt, assets: GameAssets, opacity: number, packed?: RenderStreamView, bodies?: BodyPacket, trails?: PreparedTrails,interpolate=false,adoptMotion=true): void {
    // Keep packet/motion history current for a later opacity change while
    // avoiding every GPU draw in this additive subtree when it contributes zero.
    this.visible = opacity > 0;
    let stream = packed ?? this.compatibility;
    if (!packed) { this.compatibility.reset(); for (const v of views) if (v.playerStyle) this.compatibility.playerView(v); }
    if (packed && views.some(v => v.playerStyle)) {
      this.compatibility.reset();
      const scratch: ProjectileView = { id: 0, x: 0, y: 0, radius: 0, angle: 0, color: '', hostile: false, trail: [] };
      for (let i = 0; i < packed.playerCount; i++) this.compatibility.playerView(packed.readPlayer(i, scratch));
      for (const v of views) if (v.playerStyle) this.compatibility.playerView(v);
      stream = this.compatibility;
    }
    if (bodies && packed && !views.some(v => v.playerStyle)) {
      this.templates ??= this.addChildAt(new PlayerBodyTemplates(), this.soft?2:1);
      this.templates.setSoftLayer(this.quality==='balanced'?this.soft:undefined);
      this.templates.visible = true;
      for (const mesh of this.pages.values()) mesh.visible = false;
      this.templates.accept(bodies, art, assets, opacity,interpolate,adoptMotion); this.count = bodies.counts.reduce((a,b)=>a+b,0);
      let exceptional = 0;
      if (trails) {
        for (const appearance of bodies.appearances) {
          if (!this.colors.has(appearance.color)) this.colors.set(appearance.color, { value: appearance.color,
            number: Color.shared.setValue(projectileColor(appearance.color)).toNumber(), radii: new Map(), haloFrame: 0 });
        }
        this.trailPalette.length = stream.colors.length;
        for (let i = 0; i < stream.colors.length; i++) this.trailPalette[i] = this.colors.get(stream.colors[i])?.number ?? 0;
        this.trails.accept(trails, this.trailPalette, opacity,bodies.ids?this.resolveMotion:undefined);
        for (const index of trails.referenceIndices) {
          const view = this.exceptional[exceptional] ??= { id: 0, x: 0, y: 0, radius: 0, angle: 0, color: '', hostile: false, trail: [] };
          stream.readPlayer(index, view); exceptional++;
        }
      } else {
        this.trails.begin();
        for (let i = 0; i < stream.playerCount; i++) {
          const k = i * PLAYER_STRIDE, style = stream.players[k + 7];
          if (style !== 0 && style !== 3) continue;
          const value = stream.colors[stream.players[k + 6]];
          let color = this.colors.get(value);
          if (!color) { color = { value, number: Color.shared.setValue(projectileColor(value)).toNumber(), radii: new Map(), haloFrame: 0 }; this.colors.set(value, color); }
          if (!this.trails.append(stream, i, color.number, opacity,bodies.ids?this.templates.motionDelta(stream.playerIds[i]):undefined)) {
            const view = this.exceptional[exceptional] ??= { id: 0, x: 0, y: 0, radius: 0, angle: 0, color: '', hostile: false, trail: [] };
            stream.readPlayer(i, view); exceptional++;
          }
        }
        this.trails.finish();
      }
      this.exceptional.length = exceptional; this.syncExceptional(opacity); return;
    }
    if (this.templates) {this.templates.visible = false;this.templates.setSoftLayer(undefined);}
    if (!this.count && !stream.playerCount) return;
    const white = art.get('white', 1, '#ffffff');
    if (this.revisionTexture && this.revisionTexture !== white.texture) {
      for (const mesh of this.pages.values()) mesh.destroy(); this.pages.clear();
      this.requestedGlows.clear(); this.colors.clear(); this.parts.clear(); this.palette.length = 0;
    }
    this.revisionTexture = white.texture;
    for (const mesh of this.pages.values()) mesh.reset();
    this.trails.begin(); this.frame++;
    this.palette.length = stream.colors.length;
    for (let i = 0; i < stream.colors.length; i++) this.palette[i] = this.colors.get(stream.colors[i]);
    const exceptional = this.exceptional; this.count = stream.playerCount;
    let exceptionalCount = 0;
    for (let i = 0; i < stream.playerCount; i++) {
      const k = i * PLAYER_STRIDE, a = stream.players, x = a[k], y = a[k + 1], r = a[k + 2], angle = a[k + 3], age = a[k + 4], alpha = a[k + 5] * opacity;
      const colorId = a[k + 6], styleId = a[k + 7], value = stream.colors[colorId];
      let color = this.palette[colorId];
      if (!color) {
        color = { value, number: Color.shared.setValue(projectileColor(value)).toNumber(), radii: new Map(), haloFrame: 0 };
        this.colors.set(value, color); this.palette[colorId] = color;
      }
      const style = PLAYER_STYLES[styleId], appearance = this.appearance(art, styleId, r, color);
      if (color.haloFrame !== this.frame) {
        const path = `ordinary/glow_${value.slice(1).toLowerCase()}.png`;
        if (!this.requestedGlows.has(path)) { this.requestedGlows.add(path); void assets.requestFile(path); }
        const glow = assets.getFile(path); color.halo = glow ? this.part(art.glow(value, glow)) : undefined;
        color.haloFrame = this.frame;
      }
      if (color.halo) this.quad(color.halo, x, y, 0, r * .1, r * .1, alpha * .34);
      if (style === 'coin') {
        if (a[k + 8]) { const p = appearance.trail!; this.quad(p, x, y, angle, 1, 1, alpha); }
      } else if (style === 'orb') {
        let n = 0; for (let j = 0; j < a[k + 8]; j++) if (a[k + 12 + j * 3] > 0) n++;
        if (n > 1) {
          n = Math.min(4, n); let taken = 0;
          for (let j = a[k + 8] - 1; j >= 0 && taken < n; j--) {
            const t = k + 10 + j * 3; if (a[t + 2] <= 0) continue;
            const fraction = 1 - (++taken) / (n + 1), p = appearance.discs![n][taken - 1];
            this.quad(p, a[t], a[t + 1], 0, 1, 1, alpha * .34 * (.4 + fraction * .6));
          }
        }
      } else if (!this.trails.append(stream, i, color.number, opacity)) {
        const view = exceptional[exceptionalCount] ??= { id: 0, x: 0, y: 0, radius: 0, angle: 0, color: '', hostile: false, trail: [] };
        stream.readPlayer(i, view); exceptionalCount++;
      }
      const rotation = style === 'coin' ? age * 8 : style === 'orb' ? 0 : angle;
      this.quad(appearance.body, x, y, rotation, 1, 1, alpha);
      this.quad(appearance.detail, x, y, rotation, 1, 1, alpha);
      if (style === 'coin') { const p = appearance.core!; this.quad(p, x, y, rotation, 1, 1, alpha); }
      if (style === 'orb') for (let j = 0; j < 3; j++) {
        const a = age * 5 + j / 3 * Math.PI * 2, p = appearance.star!;
        this.quad(p, x + Math.cos(a) * r * 1.9, y + Math.sin(a) * r * 1.9, a * 2, 1, 1, alpha);
      } else if (style === 'tracer') {
        const flame = appearance.flame!, star = appearance.star!;
        this.quad(flame, x - r * 1.2 * Math.cos(angle), y - r * 1.2 * Math.sin(angle), angle, 2.6 + Math.sin(age * 40) * .5, 1, alpha);
        this.quad(star, x, y, angle, 1, 1, alpha);
      }
    }
    for (const mesh of this.pages.values()) mesh.upload(); this.trails.finish();
    exceptional.length = exceptionalCount;
    this.syncExceptional(opacity);
  }
  private syncExceptional(opacity: number): void {
    this.movingFallback.length=0;
    this.fallback.sync(this.exceptional, () => { const g = new Graphics(); g.context.batchMode = 'batch'; g.blendMode = 'add'; return this.addChild(g); }, (g, v) => {
      const d=this.templates?.visible?this.templates.motionDelta(v.id):undefined;this.movingFallback.push({display:g,view:v});g.position.set(v.x+(d?.x??0)*(1-this.interpolationAlpha),v.y+(d?.y??0)*(1-this.interpolationAlpha)); g.alpha = (v.alpha ?? 1) * opacity; paintPlayerTrail(g, v);
    });
  }

  override destroy(): void {
    this.templates?.destroy();this.soft?.destroy(); this.fallback.dispose(); this.trails.destroy(); this.colors.clear(); this.parts.clear(); this.palette.length = 0;
    for (const mesh of this.pages.values()) mesh.destroy(); this.pages.clear(); super.destroy({ children: true });
  }
}
