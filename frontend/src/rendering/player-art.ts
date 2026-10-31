import { Container, Graphics, Matrix, Rectangle, RenderTexture, Sprite, Texture } from 'pixi.js';
import type { ProjectileView } from '../game';
import type { PixiRenderer } from './create-renderer';
import { paintPlayerTrail, projectileColor } from './projectile-art';

export type Part = 'shot' | 'coin' | 'orb' | 'orb-star' | 'tracer' | 'tracer-star' | 'flame' | 'coin-trail' | 'disc' | 'white' | 'shot-core' | 'coin-line' | 'coin-core' | 'orb-core' | 'tracer-fill';
interface Appearance { body: BakedPart; detail: BakedPart; core?: BakedPart; star?: BakedPart; flame?: BakedPart; trail?: BakedPart; discs?: BakedPart[][] }
export interface BakedPart { texture: Texture; anchorX: number; anchorY: number; /** Native image texels to source display units. */ scale?: number }
class PartAtlas {
  readonly pages: RenderTexture[] = [];
  private pageX = 0; private pageY = 0; private rowHeight = 0;
  private readonly spaces = new Map<RenderTexture, Rectangle[]>();
  constructor(private readonly renderer: PixiRenderer, private readonly size: number, private readonly resolution: number, private readonly raster = false) {}
  bake(g: Container): BakedPart {
    const bounds = g.getLocalBounds();
    // Vector parts retain their reference integer bounds. Raster copies align
    // native texel centers, including odd-sized source images, without resampling.
    const x = (this.raster ? bounds.minX : Math.floor(bounds.minX)) - 1;
    const y = (this.raster ? bounds.minY : Math.floor(bounds.minY)) - 1;
    const width = this.raster ? Math.ceil(bounds.width) + 2 : Math.ceil(bounds.maxX) - x + 1;
    const height = this.raster ? Math.ceil(bounds.height) + 2 : Math.ceil(bounds.maxY) - y + 1;
    let page: RenderTexture | undefined, px = 0, py = 0, clear = false;
    if (this.raster) {
      let score = Infinity, waste = Infinity;
      for (const p of this.pages) for (const rect of this.spaces.get(p)!) {
        if (width > rect.width || height > rect.height) continue;
        const fit = Math.min(rect.width - width, rect.height - height), area = rect.width * rect.height - width * height;
        if (fit < score || fit === score && area < waste) { page = p; px = rect.x; py = rect.y; score = fit; waste = area; }
      }
      if (!page) {
        page = RenderTexture.create({ width: Math.max(this.size, width), height: Math.max(this.size, height), resolution: this.resolution, autoGarbageCollect: false });
        this.pages.push(page); this.spaces.set(page, [new Rectangle(0, 0, page.width, page.height)]); clear = true;
      }
      this.occupy(page, new Rectangle(px, py, width, height));
    } else {
      page = this.pages.at(-1);
      if (page && this.pageX + width > page.width) { this.pageX = 0; this.pageY += this.rowHeight; this.rowHeight = 0; }
      if (!page || this.pageY + height > page.height || width > page.width) {
        page = RenderTexture.create({ width: Math.max(this.size, width), height: Math.max(this.size, height), resolution: this.resolution, autoGarbageCollect: false });
        this.pages.push(page); this.pageX = this.pageY = this.rowHeight = 0; clear = true;
      }
      px = this.pageX; py = this.pageY; this.pageX += width; this.rowHeight = Math.max(this.rowHeight, height);
    }
    this.renderer.render({ container: g, target: page, clear, clearColor: [0, 0, 0, 0], transform: new Matrix().translate(px - x, py - y) });
    return { texture: new Texture({ source: page.source, frame: new Rectangle(px, py, width, height) }), anchorX: -x / width, anchorY: -y / height };
  }
  private occupy(page: RenderTexture, used: Rectangle): void {
    const split: Rectangle[] = [];
    for (const r of this.spaces.get(page)!) {
      if (used.x >= r.right || used.right <= r.x || used.y >= r.bottom || used.bottom <= r.y) { split.push(r); continue; }
      if (used.x > r.x) split.push(new Rectangle(r.x, r.y, used.x - r.x, r.height));
      if (used.right < r.right) split.push(new Rectangle(used.right, r.y, r.right - used.right, r.height));
      if (used.y > r.y) split.push(new Rectangle(r.x, r.y, r.width, used.y - r.y));
      if (used.bottom < r.bottom) split.push(new Rectangle(r.x, used.bottom, r.width, r.bottom - used.bottom));
    }
    this.spaces.set(page, split.filter((r, i) => !split.some((other, j) => i !== j && r.x >= other.x && r.y >= other.y && r.right <= other.right && r.bottom <= other.bottom && (r.width !== other.width || r.height !== other.height || j < i))));
  }
  dispose(): void { for (const p of this.pages) p.destroy(true); this.pages.length = 0; this.spaces.clear(); this.pageX = this.pageY = this.rowHeight = 0; }
}
/** Shared GPU-baked vector parts. Animation stays in transforms, not atlas frames.
 * The renderer owns this cache and invalidates it after context/device restoration. */
export class PlayerArt {
  private readonly parts = new Map<string, BakedPart>();
  private readonly appearances = new Map<string, Appearance>();
  private readonly vectorAtlas: PartAtlas;
  private readonly imageAtlas: PartAtlas;
  constructor(renderer: PixiRenderer) { this.vectorAtlas = new PartAtlas(renderer, 512, 4); this.imageAtlas = new PartAtlas(renderer, 2048, 1, true); }
  get statistics() {
    const pages = [...this.vectorAtlas.pages, ...this.imageAtlas.pages];
    return { parts: this.parts.size, imageParts: this.images.size, pages: pages.length,
      estimatedBytes: pages.reduce((n, p) => n + p.source.pixelWidth * p.source.pixelHeight * 4, 0) };
  }
  get(part: Part, radius: number, color: string): BakedPart {
    const key = `${part}:${radius}:${color}`;
    const cached = this.parts.get(key);
    if (cached) return cached;
    const g = new Graphics(), r = radius, tint = projectileColor(color);
    const view: ProjectileView = { id: 0, x: 0, y: 0, radius: r, color, angle: 0, hostile: false, playerStyle: part === 'coin' ? 'coin' : 'shot' };
    // Bake single primitives; flattening overlapping additive parts would clamp
    // their energy before the user's opacity is applied.
    if (part === 'shot') g.ellipse(0, 0, r * 1.5, r).fill(tint);
    else if (part === 'shot-core') g.circle(r * .25, 0, r * .42).fill({ color: 0xffffff, alpha: .95 });
    else if (part === 'coin') g.ellipse(0, 0, r * 1.4, r * .8).fill(tint);
    else if (part === 'coin-line') g.moveTo(0, -r * .8).lineTo(0, r * .8).stroke({ color: 0x7a500a, alpha: .9, width: Math.max(1, r * .22) });
    else if (part === 'coin-core') g.circle(-r * .45, -r * .25, r * .2).fill({ color: 0xffffff, alpha: .85 });
    else if (part === 'orb') g.circle(0, 0, r * 1.15).fill(tint);
    else if (part === 'orb-core') g.circle(0, 0, r * .5).fill({ color: 0xffffff, alpha: .95 });
    else if (part === 'orb-star') g.star(0, 0, 4, r * .4, r * .16).fill('#ffe08a');
    else if (part === 'tracer') g.ellipse(0, 0, r * 2.3, r * 1.25).stroke({ color: tint, alpha: .3, width: r * 1.3 });
    else if (part === 'tracer-fill') g.ellipse(-r * .3, 0, r * 2, r * .9).fill(tint);
    else if (part === 'tracer-star') g.star(0, 0, 6, r * 1.9, r * .65).fill(0xffffff);
    else if (part === 'flame') g.poly([0, -r * .55, -r, 0, 0, r * .55]).fill({ color: 0xffffff, alpha: .55 });
    else if (part === 'disc') g.circle(0, 0, r).fill(tint);
    else if (part === 'white') g.rect(0, 0, 1, 1).fill(0xffffff);
    else paintPlayerTrail(g, { ...view, playerStyle: 'coin', trail: [{ x: -1, y: 0, alpha: 1 }] });
    const baked = this.bake(g);
    g.destroy({ context: true });
    this.parts.set(key, baked);
    return baked;
  }
  appearance(style: NonNullable<ProjectileView['playerStyle']>, r: number, color: string): Appearance {
    const key = `${style}:${r}:${color}`, cached = this.appearances.get(key);
    if (cached) return cached;
    const parts: Appearance = { body: this.get(style, r, color), detail: this.get(style === 'shot' ? 'shot-core' : style === 'coin' ? 'coin-line' : style === 'orb' ? 'orb-core' : 'tracer-fill', r, color) };
    if (style === 'coin') { parts.core = this.get('coin-core', r, color); parts.trail = this.get('coin-trail', r, color); }
    else if (style === 'orb') {
      parts.star = this.get('orb-star', r, color);
      parts.discs = Array.from({ length: 5 }, (_, count) => Array.from({ length: count }, (_, i) => this.get('disc', r * (.35 + (1 - (i + 1) / (count + 1)) * .6), color)));
    } else if (style === 'tracer') { parts.star = this.get('tracer-star', r, color); parts.flame = this.get('flame', r, color); }
    this.appearances.set(key, parts); return parts;
  }
  glow(color: string, source: Texture): BakedPart {
    const key = 'glow:' + color;
    const cached = this.parts.get(key);
    if (cached) return cached;
    const sprite = new Sprite(source); sprite.anchor.set(.5); sprite.width = sprite.height = 64;
    const root = new Container(); root.addChild(sprite);
    const baked = this.bake(root); root.destroy({ children: true }); this.parts.set(key, baked); return baked;
  }
  private readonly images = new Map<Texture, BakedPart>();
  image(source: Texture): BakedPart {
    const cached = this.images.get(source); if (cached) return cached;
    const sprite = new Sprite(source); sprite.anchor.set(.5); sprite.scale.set(source.source.resolution);
    const root = new Container(); root.addChild(sprite);
    const part = this.imageAtlas.bake(root); part.scale = 1 / source.source.resolution;
    root.destroy({ children: true }); this.images.set(source, part); return part;
  }
  vector(key: string, paint: (g: Graphics) => void): BakedPart {
    const cached = this.parts.get('vector:' + key); if (cached) return cached;
    const g = new Graphics(); paint(g); const part = this.bake(g); g.destroy({ context: true }); this.parts.set('vector:' + key, part); return part;
  }
  private bake(g: Container): BakedPart { return this.vectorAtlas.bake(g); }
  dispose(): void {
    for (const part of this.parts.values()) part.texture.destroy();
    this.vectorAtlas.dispose(); this.imageAtlas.dispose();
    for (const image of this.images.values()) image.texture.destroy(); this.images.clear();
    this.parts.clear(); this.appearances.clear();
  }
}
