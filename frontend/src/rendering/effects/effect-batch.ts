import { EffectTemplates } from './effect-templates';
import { DamageFonts } from './damage-fonts';
import { EffectTextCache } from './text-cache';
import type { PixiRenderer } from '../create-renderer';
import { Container } from 'pixi.js';
import type { EffectView } from '../../game';
import type { BakedPart, PlayerArt } from '../player-art';
import { InstanceRuns } from '../instance-mesh';
import { OrderedTransients } from '../transient-batches';
import { EffectDisplay } from './effect-display';

/** Ordered analytic primitives for frequent FX. Complex curves, seeded chains,
 * encounter-specific paths and text retain their reference implementation. */
export class EffectBatch extends Container {
  private readonly order = new OrderedTransients<EffectView>();
  private readonly groups: (InstanceRuns | EffectTemplates)[] = [];
  private readonly fallback = new Map<EffectView['id'], EffectDisplay>();
  private emitted = 0;
  private textCache?: EffectTextCache;
  private digits?: DamageFonts;
  private centered?: BakedPart;
  warmText(renderer:PixiRenderer):void{this.digits??=new DamageFonts(renderer.resolution);this.digits.warm();}
  get size(): number { return this.order.entries.size; }
  get diagnostics() { return { effects: this.size, primitives: this.emitted, fallback: this.fallback.size,
    meshes: this.groups.reduce((n, g) => n + g.diagnostics.meshes, 0), uploadBytes: this.groups.reduce((n, g) => n + g.diagnostics.uploadBytes, 0), textCache: this.textCache?.diagnostics, digits: this.digits?.diagnostics }; }
  sync(views: readonly EffectView[], time: number, art: PlayerArt, opacity: number, renderer?: PixiRenderer, epoch = ''): void {
    this.order.sync([], 0, views); this.emitted = 0;
    if (renderer) { this.textCache ??= new EffectTextCache(renderer); this.digits ??= new DamageFonts(renderer.resolution); this.textCache.begin(epoch); }
    for (const [id, d] of this.fallback) if (!this.order.entries.has(id)) { d.destroy(); this.fallback.delete(id); }
    let current: InstanceRuns | EffectTemplates | undefined, groupIndex = 0, childIndex = 0;
    const place = (child: Container) => { if (child.parent !== this) this.addChild(child); if (this.getChildIndex(child) !== childIndex) this.setChildIndex(child, childIndex); childIndex++; };
    for (const value of this.order.entries.values()) {
      const v = value as EffectView;
      if(v.alpha*(v.playerOwned?opacity:1)<=0){const stale=this.fallback.get(v.id);if(stale)stale.visible=false;continue;}
      const bitmap = v.kind === 'text' && this.digits?.accepts(v.text) ? this.digits.font(v.text!,v.critical) : undefined;
      if (this.supports(v)) {
        const gpu = EffectTemplates.supports(v);
        if (!current || gpu !== (current instanceof EffectTemplates)) {
          current?.finish();
          let group: InstanceRuns | EffectTemplates | undefined = this.groups[groupIndex];
          if (group && gpu !== (group instanceof EffectTemplates)) { group.destroy(); group = undefined; }
          current = this.groups[groupIndex++] = group ?? (gpu ? new EffectTemplates() : new InstanceRuns(true));
          current.begin(); place(current);
        }
        const p = art.get('white', 1, '#ffffff');
        if (this.centered?.texture !== p.texture) this.centered = { texture: p.texture, anchorX: .5, anchorY: .5 };
        const stale = this.fallback.get(v.id); if (stale) { stale.destroy(); this.fallback.delete(v.id); }
        if (current instanceof EffectTemplates) this.emitted += current.append(v, opacity);
        else this.paint(current, this.centered, v, opacity);
      } else {
        if (current) { current.finish(); current = undefined; }
        let d = this.fallback.get(v.id);
        if (!d) { d = new EffectDisplay(); this.fallback.set(v.id, d); }
        const notes = v.kind === 'nova' ? v.notes?.map(n => this.textCache?.pinNote(n.text)) : undefined;
        d.visible=true;d.sync(v, time, notes, bitmap); if (v.playerOwned) d.alpha *= opacity; place(d);
      }
    }
    if (current) current.finish();
    for (let i = groupIndex; i < this.groups.length; i++) { const group = this.groups[i]; group.begin(); group.finish(); if (group.parent === this) this.removeChild(group); }
  }
  private supports(v: EffectView): boolean {
    if (v.kind === 'sparkle' && v.end || v.variant === 'glass' || v.variant === 'crack') return false;
    return ['sparkle', 'shard', 'hit', 'impact', 'shockwave', 'explosion', 'ring', 'beam', 'trail'].includes(v.kind);
  }
  private paint(run: InstanceRuns, part: BakedPart, view: EffectView, opacity: number): void {
    const k = Math.max(0, Math.min(1, view.progress ?? 0)), fade = 1 - k, r = view.radius;
    const rotation = view.end ? 0 : view.angle ?? 0, ca = Math.cos(rotation), sa = Math.sin(rotation);
    const alpha = view.alpha * (view.playerOwned ? opacity : 1), blend = view.kind === 'shard' ? 'normal' : 'add';
    const emit = (x: number, y: number, w: number, h: number, angle: number, color: string | number, a: number, shape: number, inner = 0, start = 0, span = 0) => {
      this.emitted++;
      run.quad(part, blend, view.x + x * ca - y * sa, view.y + x * sa + y * ca, rotation + angle, w / part.texture.width, h / part.texture.height, alpha * a, run.colorNumber(color), shape, inner, start, span);
    };
    const disc = (radius: number, color: string | number, a = 1) => emit(0, 0, radius * 2, radius * 2, 0, color, a, 1);
    const ring = (radius: number, width: number, color: string | number, a: number, start?: number, span?: number) => {
      const outer = radius + width / 2; emit(0, 0, outer * 2, outer * 2, 0, color, a, start === undefined ? 2 : 3, Math.max(0, radius - width / 2) / outer, start === undefined ? 0 : ((start % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), span);
    };
    const line = (x1: number, y1: number, x2: number, y2: number, width: number, color: string | number, a = 1) => emit((x1 + x2) / 2, (y1 + y2) / 2, Math.hypot(x2 - x1, y2 - y1), width, Math.atan2(y2 - y1, x2 - x1), color, a, 4);
    switch (view.kind) {
      case 'sparkle': disc(Math.max(.1, r * fade), view.color); break;
      case 'shard': { const size = r * (.5 + fade * .7); emit(0, -size * .1, size * 1.8, size * 1.8, 0, view.color, 1, 5); break; }
      case 'trail': emit(0, 0, r * 2, r * .5, 0, view.color, 1, 1); break;
      case 'hit':
        disc(3 + k * 4, 0xffffff);
        for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + .4, inner = 4 + k * 8, outer = 8 + k * 16;
          line(Math.cos(a) * inner, Math.sin(a) * inner, Math.cos(a) * outer, Math.sin(a) * outer, (i % 2 ? 1.6 : 3) * fade + .6, view.color); }
        break;
      case 'impact': {
        const power = view.power ?? .5, rays = view.rays ?? 9;
        for (let i = 0; i < rays; i++) {
          const a = i / rays * Math.PI * 2, long = i % 2 === 0, inner = (6 + power * 8) * (.5 + k * .9);
          const length = (long ? 20 : 11) * (.6 + power * .9) * (.4 + fade * .8), width = (long ? 2.6 : 1.6) * (.5 + fade * .6);
          emit(Math.cos(a) * (inner + length / 2), Math.sin(a) * (inner + length / 2), length, width * 2, a, 0xffffff, 1, 6);
        }
        disc((power * 10 + 5) * (.4 + k * 1.2), view.color, .32); break;
      }
      case 'shockwave': {
        const radius = r * (.35 + k * 1.15); ring(radius, 14 * fade + 2, view.color, .85); ring(radius + 6 * fade, 3 * fade + .5, 0xffffff, .7); break;
      }
      case 'explosion': {
        const radius = r * (.35 + k * .85); ring(radius * .92, 7 * fade + 1.5, view.color, .55);
        for (let i = 10; i > 0; i--) disc(radius * i / 10, view.color, .045 * (1 - i / 11));
        disc(radius * (.46 - k * .16), 0xffffff, .65); break;
      }
      case 'ring':
        if (view.progress === undefined) ring(r, 2, view.color, 1);
        else { const radius = r * (.4 + k * .8), crack = k > .55 ? (1 - k) / .45 : 1;
          for (let i = 0; i < 12; i++) ring(radius, 3 * fade + 1, view.color, k > .55 ? crack * crack : .7, i / 12 * Math.PI * 2 + (view.seed ?? 0), Math.PI * 2 / 12 * .63);
        }
        break;
      case 'beam': {
        const x = (view.end?.x ?? view.x + r) - view.x, y = (view.end?.y ?? view.y) - view.y, w = view.width ?? 8;
        line(0, 0, x, y, w * (.4 + fade * .6), view.color); line(0, 0, x, y, Math.max(.5, w * .3 * fade), 0xffffff, .9); break;
      }
    }
  }
  invalidateText(): void { this.textCache?.clear(); this.digits?.clear(); }
  override destroy(): void {
    for (const g of this.groups) g.destroy(); this.groups.length = 0;
    for (const d of this.fallback.values()) d.destroy(); this.fallback.clear(); this.textCache?.clear(); this.digits?.clear(); this.order.clear(); super.destroy({ children: true });
  }
}
