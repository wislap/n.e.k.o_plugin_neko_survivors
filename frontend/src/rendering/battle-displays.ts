import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { PickupView, ProjectileView, TelegraphView } from '../game';
import { PlayerArt } from './player-art';
import { GameAssets } from './assets';
import type { PixiRenderer } from './create-renderer';
import { makeProjectileGraphic, projectileColor, paintPlayerProjectile } from './projectile-art';

/** GPU-generated shared bullet silhouettes; no Canvas2D scene or texture baking. */
export class ProjectileTextures {
  private readonly textures = new Map<string, Texture>();
  private generated = 0; private released = 0;
  get statistics() { return { cached: this.textures.size, generated: this.generated, released: this.released }; }
  readonly player: PlayerArt;
  constructor(private readonly renderer: PixiRenderer) { this.player = new PlayerArt(renderer); }
  get(shape: ProjectileView['shape'] | 'halo'): Texture {
    // Appearance semantics stay on the view; only identical baked geometry shares storage.
    const key = shape === 'orb' || shape === 'jade' || shape === 'bead' ? 'circle'
      : shape === 'shard' ? 'needle' : shape ?? 'circle';
    let texture = this.textures.get(key);
    if (texture) return texture;
    const graphic = makeProjectileGraphic(key);
    texture = this.renderer.generateTexture({ target: graphic, resolution: 2 });
    graphic.destroy();
    this.generated++; this.textures.set(key, texture);
    return texture;
  }
  dispose(): void { this.player.dispose(); for (const texture of this.textures.values()) { texture.destroy(true); this.released++; } this.textures.clear(); }
}
type ProjectileAppearance = Pick<ProjectileView, 'shape' | 'radius' | 'length' | 'width' | 'anchor' | 'color' | 'hostile' | 'hitRadius'>;
export class ProjectileDisplay extends Container {
  private readonly halo = new Sprite();
  private readonly body = new Sprite();
  private readonly core = new Sprite();
  private readonly hitCircle = new Graphics();
  private readonly trail = new Graphics();
  private readonly playerBody = new Graphics();
  private glowPath = '';
  private appearance?: ProjectileAppearance;
  private playerAppearance?: Pick<ProjectileView, 'playerStyle' | 'radius' | 'color'>;
  constructor(mobile: boolean) {
    super();
    // Long round-capped player trails exceed Pixi's auto-batch size threshold.
    // Keep their unchanged geometry in the shared batch instead of allocating one
    // separate shader-uniform block per trail.
    this.trail.context.batchMode = 'batch';
    this.trail.blendMode = mobile ? 'normal' : 'add';
    this.playerBody.blendMode = mobile ? 'normal' : 'add';
    for (const sprite of [this.halo, this.body, this.core]) sprite.anchor.set(.5);
    this.halo.blendMode = mobile ? 'normal' : 'add';
    this.addChild(this.halo, this.body, this.core, this.hitCircle, this.trail, this.playerBody);
  }
  sync(view: ProjectileView, textures: ProjectileTextures, assets: GameAssets): void {
    this.position.set(view.x, view.y); this.rotation = view.angle; this.alpha = view.alpha ?? 1;
    if (view.playerStyle) {
      this.rotation = 0;
      this.body.visible = false; this.core.visible = false; this.hitCircle.visible = false;
      this.playerBody.visible = true; this.trail.visible = true;
      const glowPath = `ordinary/glow_${view.color.slice(1).toLowerCase()}.png`;
      if (this.glowPath !== glowPath) { this.glowPath = glowPath; void assets.requestFile(glowPath); }
      const glow = assets.getFile(glowPath);
      this.halo.visible = !!glow; this.halo.anchor.set(.5);
      if (glow) this.halo.texture = glow;
      this.halo.width = view.radius * 6.4; this.halo.height = view.radius * 6.4;
      this.halo.alpha = .34; this.halo.tint = 0xffffff;
      const prior = this.playerAppearance;
      const fixedBody = view.playerStyle === 'shot' || view.playerStyle === 'coin';
      const redrawBody = !fixedBody || !prior || prior.playerStyle !== view.playerStyle
        || prior.radius !== view.radius || prior.color !== view.color;
      paintPlayerProjectile(this.trail, this.playerBody, view, redrawBody);
      if (fixedBody && redrawBody) this.playerAppearance = { playerStyle: view.playerStyle, radius: view.radius, color: view.color };
      else if (!fixedBody) this.playerAppearance = undefined;
      this.appearance = undefined;
      return;
    }
    this.playerAppearance = undefined;
    this.body.visible = true; this.hitCircle.visible = true; this.playerBody.visible = false; this.trail.visible = false;
    const texture = textures.get(view.shape), haloTexture = textures.get('halo'), prior = this.appearance;
    // Position, rotation and opacity vary every frame; silhouettes and tint usually do not.
    // Compare actual textures too: context restoration replaces the generated render targets.
    if (prior && prior.shape === view.shape && prior.radius === view.radius && prior.length === view.length
      && prior.width === view.width && prior.anchor === view.anchor && prior.color === view.color
      && prior.hostile === view.hostile && prior.hitRadius === view.hitRadius
      && this.body.texture === texture && this.halo.texture === haloTexture) return;
    const elongated = ['needle', 'rice', 'shard', 'drop', 'petal', 'blade'].includes(view.shape ?? '');
    const width = view.shape === 'laser' ? (view.length ?? view.radius * 8) : elongated ? view.length ?? view.radius * 3.2 : view.radius * 2;
    const height = view.shape === 'laser' ? (view.width ?? view.radius * 2) : elongated ? view.width ?? view.radius * 1.3 : view.radius * 2;
    this.body.texture = texture; this.core.texture = texture; this.halo.texture = haloTexture;
    const anchor = view.anchor === 'head' ? 1 : .5;
    for (const sprite of [this.halo, this.body, this.core]) sprite.anchor.x = anchor;
    this.body.width = width; this.body.height = height; this.body.tint = projectileColor(view.color);
    this.halo.width = width * 2.6; this.halo.height = height * 2.6; this.halo.tint = projectileColor(view.color);
    this.halo.alpha = .14; this.halo.visible = view.hostile;
    this.core.width = width * .45; this.core.height = height * .45; this.core.alpha = .9;
    this.core.visible = view.shape !== 'ring'; this.core.tint = view.shape === 'jade' ? 0x8d6a1b : 0xffffff;
    if (!prior || prior.shape !== view.shape || prior.hitRadius !== view.hitRadius) {
      this.hitCircle.clear();
      if (view.shape === 'jade' && view.hitRadius) this.hitCircle.circle(0, 0, view.hitRadius).stroke({ color: 0xff3f4f, width: 1.5, alpha: .9 });
    }
    this.appearance = { shape: view.shape, radius: view.radius, length: view.length, width: view.width,
      anchor: view.anchor, color: view.color, hostile: view.hostile, hitRadius: view.hitRadius };
  }
  override destroy(): void { super.destroy({ children: true, context: true }); }
}
export class PickupDisplay extends Container {
  private readonly image = new Sprite(); private readonly fallback = new Graphics(); private signature = '';
  constructor() { super(); this.image.anchor.set(.5); this.addChild(this.image, this.fallback); }
  sync(view: PickupView, assets: GameAssets): void {
    const id = view.kind === 'xp' ? 'xp' : view.kind === 'heal' ? 'heal' : view.variant === 2 ? 'coin_2' : 'coin_1';
    void assets.request('pickup', id);
    const texture = assets.get('pickup', id);
    this.position.set(view.x, view.y + Math.sin(view.bobPhase) * 2);
    this.image.visible = !!texture; this.fallback.visible = !texture;
    if (texture) {
      this.image.texture = texture;
      const s = view.kind === 'heal' ? 45 * (1 + Math.sin(view.bobPhase * 1.6) * .06) : view.kind === 'xp' ? 16 : 18;
      this.image.scale.set(s / Math.max(texture.width, texture.height));
    }
    if (this.signature !== view.kind) {
      this.signature = view.kind; this.fallback.clear();
      if (view.kind === 'heal') this.fallback.rect(-6, -2, 12, 4).rect(-2, -6, 4, 12).fill(0xff5f6d);
      else this.fallback.poly([0, -5, 5, 0, 0, 5, -5, 0]).fill(view.kind === 'xp' ? 0x6ee7a8 : 0xffc857);
    }
  }
  override destroy(): void { super.destroy({ children: true, context: true }); }
}
export { EffectDisplay } from './effects/effect-display';
export class TelegraphDisplay extends Graphics {
  private signature = '';
  sync(view: TelegraphView): void {
    this.position.set(view.x, view.y); this.alpha = view.alpha;
    const signature = JSON.stringify(view);
    if (signature === this.signature) return;
    this.signature = signature; this.clear();
    if (view.kind === 'line' && view.end) {
      const x = view.end.x - view.x, y = view.end.y - view.y, w = view.width ?? 4;
      if (w >= 10) this.moveTo(0, 0).lineTo(x, y).stroke({ color: view.color, width: w * 1.6, alpha: .18 });
      this.moveTo(0, 0).lineTo(x, y).stroke({ color: view.color, width: w, alpha: w >= 10 ? .7 : 1 });
      if (w >= 10) this.moveTo(0, 0).lineTo(x, y).stroke({ color: 0xfff2df, width: Math.max(1, w * .16), alpha: 1 });
    }
    else if (view.kind === 'cone') {
      const a = view.angle ?? 0, spread = view.spread ?? .5;
      this.moveTo(0, 0).arc(0, 0, view.radius ?? 40, a - spread / 2, a + spread / 2).closePath().fill({ color: view.color, alpha: 1 }).stroke({ color: view.color, width: 2 });
    } else this.circle(0, 0, view.radius ?? 20).fill({ color: view.color, alpha: .15 }).stroke({ color: view.color, width: 2 });
  }
}
