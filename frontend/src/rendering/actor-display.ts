import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { ActorView } from '../game';
import { GameAssets, type SpriteKind } from './assets';
import { enemyEyePlacement } from './enemy-eyes';

/** Keeps visual resources separate from actor rule state. Sprite identity is stable. */
export class ActorDisplay extends Container {
  private readonly shadow = new Graphics().ellipse(0, 0, 1, 0.36).fill({ color: 0, alpha: 0.32 });
  private readonly image = new Sprite();
  private readonly fallback = new Graphics({ label: 'actor-fallback' });
  private readonly hitFlash = new Sprite();
  private readonly shield = new Graphics();
  private readonly status = new Graphics();
  private readonly health = new Graphics();
  private readonly eyes = new Graphics();
  private readonly turretGlow = new Sprite();
  private readonly turretCore = new Graphics();
  private metalTexture?: Texture;
  private signature = '';
  private healthSignature = '';
  private eyeGeometry?: { definitionId: string; radius: number; eyeRadius: number };
  constructor() {
    super();
    this.hitFlash.blendMode = 'add';
    this.addChild(this.shadow, this.shield, this.image, this.hitFlash, this.fallback, this.eyes, this.health, this.status, this.turretGlow, this.turretCore);
    this.turretGlow.anchor.set(.5); this.turretGlow.blendMode = 'normal'; this.turretCore.blendMode = 'normal';
  }
  sync(actor: ActorView, time: number, assets: GameAssets): void {
    this.position.set(actor.x, actor.y);
    this.zIndex = actor.y;
    const invulnerable = (actor.invulnerability ?? 0) > 0;
    const flashing = invulnerable && Math.floor((actor.invulnerability ?? 0) * 20) % 2 === 0;
    this.alpha = (actor.alpha ?? (actor.downed ? 0.45 : 1)) * (flashing ? .42 : 1);
    const r = actor.radius * (actor.scale ?? 1);
    const bob = actor.moving ? Math.sin(actor.walkPhase ?? time * 10) * 2 : Math.sin((actor.age ?? time) * 2) * 1.2;
    const character = actor.kind === 'player' || actor.kind === 'phantom';
    const kind: SpriteKind = character ? 'character' : actor.kind === 'chest' ? 'chest' : actor.kind === 'pet' ? 'pet' : actor.kind === 'turret' ? 'weapon' : 'enemy';
    const id = actor.spriteId !== undefined ? actor.spriteId : actor.kind === 'pet' ? 'kitten' : actor.kind === 'chest' && !actor.definitionId.startsWith('chest_') ? 'chest_1' : actor.definitionId;
    if (id !== null && actor.kind !== 'turret') void assets.request(kind, id);
    const texture = id === null || actor.kind === 'turret' ? undefined : assets.get(kind, id);
    this.image.rotation = 0; this.fallback.rotation = 0;
    this.image.visible = !!texture;
    this.fallback.visible = !texture;
    this.shadow.position.y = r * 0.85;
    this.shadow.scale.set(r * 0.92, r); this.shadow.alpha = 1;
    this.fallback.y = character ? bob : 0;
    this.shield.y = character ? bob : 0; this.status.y = character ? bob : 0;
    this.turretGlow.visible = actor.kind === 'turret'; this.turretCore.visible = actor.kind === 'turret';
    let metal: Texture | undefined;
    if (actor.kind === 'turret') {
      this.shadow.y = r * .55; this.shadow.scale.set(r * 1.05, r * .5 / .36); this.shadow.alpha = .28 / .32;
      const glowPath = `ordinary/glow_${actor.color.slice(1).toLowerCase()}.png`;
      void assets.requestFile('ordinary/metal.png'); void assets.requestFile(glowPath);
      metal = assets.getFile('ordinary/metal.png');
      if (metal !== this.metalTexture) { this.signature = ''; this.metalTexture = metal; }
      const glow = assets.getFile(glowPath), size = r * (.5 + (actor.spawnProgress ?? 1) * .5);
      const flash = 1 + Math.max(0, actor.recoil ?? 0) / .16 * 1.1;
      this.turretGlow.visible = !!glow;
      if (glow) { this.turretGlow.texture = glow; this.turretGlow.width = this.turretGlow.height = size * 1.15 * flash * 2; this.turretGlow.alpha = .55; }
      this.turretCore.clear().circle(0, 0, size * .42 * flash).fill(actor.color).circle(0, 0, size * .2).fill(0xffffff);
    }
    if (texture) {
      this.image.texture = texture;
      if (character) {
        const h = r * 3.6;
        this.image.anchor.set(0.5, 1);
        this.image.height = h;
        this.image.width = h * texture.width / texture.height;
        this.image.position.set(0, r * 0.85 + bob + (actor.moving ? Math.sin(actor.walkPhase ?? time * 10) * r * .1 : 0));
        this.image.scale.x = Math.abs(this.image.scale.x) * (Math.cos(actor.facing ?? actor.angle) < -0.15 ? -1 : 1);
      } else {
        const size = r * 2.6;
        const fit = actor.kind === 'chest' || actor.kind === 'pet';
        this.image.anchor.set(0.5, fit ? 0.5 : 0.6);
        const ratio = fit ? size / Math.max(texture.width, texture.height) : 0;
        this.image.width = fit ? texture.width * ratio : size;
        this.image.height = fit ? texture.height * ratio : size;
        this.image.position.set(0, bob * 0.5);
      }
      if (!character && actor.facePlayer) {
        if (actor.faceRotate) this.image.rotation = (actor.facing ?? actor.angle) + Math.PI / 2;
        else this.image.scale.x = Math.abs(this.image.scale.x) * (Math.cos(actor.facing ?? actor.angle) < 0 ? -1 : 1);
      }
      this.image.tint = actor.downed ? 0xaaaacc : actor.mutant ? 0x9e2941 : 0xffffff;
      this.hitFlash.texture = texture;
      this.hitFlash.anchor.copyFrom(this.image.anchor);
      this.hitFlash.position.copyFrom(this.image.position);
      this.hitFlash.scale.copyFrom(this.image.scale);
      this.hitFlash.rotation = this.image.rotation;
    }
    this.hitFlash.visible = !!texture && (actor.hurtFlash ?? 0) > 0;
    this.hitFlash.alpha = Math.min(.7, (actor.hurtFlash ?? 0) * 4);
    this.shield.clear();
    if ((actor.shield ?? 0) > 0) {
      const shieldRatio = actor.maxShield ? Math.min(1, (actor.shield ?? 0) / actor.maxShield) : 1;
      const pulse = shieldRatio < .3 ? .5 + Math.sin(time * 6) * .5 : 1;
      this.shield.circle(0, 0, r * 1.75).stroke({ color: 0xbff3ff, width: 6, alpha: (.14 + shieldRatio * .2) * pulse })
        .circle(0, 0, r * 1.75).stroke({ color: 0x6ee7ff, width: 2.5, alpha: (.35 + shieldRatio * .45) * pulse });
    }
    this.status.clear();
    if (!texture && character && (actor.hurtFlash ?? 0) > 0) this.status.circle(0, 0, r * 1.05)
      .fill({ color: 0xffffff, alpha: Math.max(0, Math.min(1, (actor.hurtFlash ?? 0) / .25)) * .55 });
    if (actor.kind === 'chest' && actor.glowPhase !== undefined) {
      const pulse = .5 + Math.sin(actor.glowPhase) * .5;
      this.status.circle(0, 0, r + 10 + pulse * 8).stroke({ color: actor.color, width: 8, alpha: .12 + pulse * .06 });
    }
    if (actor.downed) {
      const segments = Math.min(3, Math.max(1, actor.downCount ?? 1)), radius = r + 14;
      for (let i = 0; i < segments; i++) {
        const a = -Math.PI / 2 + i * Math.PI * 2 / 3 + .09, b = -Math.PI / 2 + (i + 1) * Math.PI * 2 / 3 - .09;
        this.status.arc(0, 0, radius, a, b).stroke({ color: 0, width: 9, alpha: .8 })
          .arc(0, 0, radius, a, b).stroke({ color: 0x54468c, width: 6, alpha: .6 });
      }
      const fraction = Math.min(1, (actor.rescueProgress ?? 0) / Math.max(1, actor.rescueNeed ?? 1));
      if (fraction > .005) this.status.arc(0, 0, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * segments / 3 * fraction)
        .stroke({ color: 0xb98cff, width: 5 }).arc(0, 0, radius - 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * segments / 3 * fraction)
        .stroke({ color: 0xe6d9ff, width: 2 });
    }
    if ((actor.wallFlash ?? 0) > 0) this.status.circle(0, 0, r + 16).fill({ color: 0xff6060, alpha: Math.min(.1, (actor.wallFlash ?? 0) / .45 * .1) })
      .stroke({ color: 0xff6060, alpha: Math.min(.5, (actor.wallFlash ?? 0) / .45 * .5), width: 2.5 });
    const eyePlacement = actor.kind === 'enemy' && texture && !actor.noEyes ? enemyEyePlacement(actor.definitionId, r, actor.angle) : undefined;
    this.eyes.visible = !!eyePlacement;
    if (eyePlacement) {
      const [left, right] = eyePlacement.eyes, half = (right.x - left.x) / 2;
      // Facing translates both eyes equally; radius and separation depend only on definition/r.
      this.eyes.position.set((left.x + right.x) / 2, this.image.y + left.y);
      const previous = this.eyeGeometry;
      if (!previous || previous.definitionId !== actor.definitionId || previous.radius !== r || previous.eyeRadius !== eyePlacement.eyeRadius) {
        this.eyes.clear();
        for (const x of [-half, half]) {
          this.eyes.circle(x, 0, eyePlacement.eyeRadius).fill({ color: 0x0a0a0e, alpha: .92 })
            .circle(x - eyePlacement.eyeRadius * .25, -eyePlacement.eyeRadius * .3, eyePlacement.eyeRadius * .25).fill({ color: 0xffffff, alpha: .85 });
        }
        this.eyeGeometry = { definitionId: actor.definitionId, radius: r, eyeRadius: eyePlacement.eyeRadius };
      }
    } else if (this.eyeGeometry) {
      this.eyes.clear(); this.eyeGeometry = undefined;
    }
    if (!texture && actor.facePlayer) this.fallback.rotation = actor.facing ?? actor.angle;
    const animated = character ? `${actor.blinkPhase}:${actor.facing}:${actor.age ?? time}:${actor.walkPhase}:${actor.moving}:${actor.accent}`
      : actor.kind === 'turret' ? `${actor.recoil}:${actor.spawnProgress}:${actor.angle}` : '';
    const signature = `${r}:${actor.color}:${actor.kind}:${actor.silhouette}:${actor.noEyes}:${animated}`;
    if (signature !== this.signature) {
      this.signature = signature;
      this.fallback.clear();
      if (character) paintCharacter(this.fallback, actor, r, time);
      else if (actor.kind === 'turret') paintTurret(this.fallback, actor, r, metal);
      else if (actor.silhouette === 'bottle') {
        const bw = r * .78, bh = r * 1.05, nw = bw * .42, nh = r * .42;
        this.fallback.moveTo(-bw, bh).lineTo(-bw, -bh + r * .3)
          .quadraticCurveTo(-bw, -bh, -nw, -bh - nh * .12).lineTo(-nw, -bh - nh)
          .lineTo(nw, -bh - nh).lineTo(nw, -bh - nh * .12)
          .quadraticCurveTo(bw, -bh, bw, -bh + r * .3).lineTo(bw, bh).closePath()
          .fill(actor.color).stroke({ color: 0, alpha: .38, width: Math.max(1, r * .05) })
          .rect(-nw, -bh - nh, nw * 2, nh * .62).fill({ color: 0x141418, alpha: .85 })
          .rect(-bw * .92, -r * .16, bw * 1.84, r * .62).fill({ color: 0xf2efe6, alpha: .55 });
      } else if (actor.kind === 'chest') this.fallback.roundRect(-r, -r * .7, r * 2, r * 1.4, 3).fill(0xa37638)
        .rect(-r, -r * .2, r * 2, r * .22).fill(0xf4cc6b).rect(-r * .15, -r * .3, r * .3, r * .5).fill(0xffe4a0);
      else {
        this.fallback.circle(0, 0, r).fill(actor.color)
        .poly([-r * .85, -r * .4, -r * .7, -r * 1.25, -r * .15, -r * .8]).fill(actor.color)
        .poly([r * .85, -r * .4, r * .7, -r * 1.25, r * .15, -r * .8]).fill(actor.color);
        if (!actor.noEyes) this.fallback.circle(-r * .3, -r * .1, Math.max(1, r * .1))
          .circle(r * .3, -r * .1, Math.max(1, r * .1)).fill(0xffffff);
      }
    }
    const ratio = actor.maxHp ? Math.max(0, Math.min(1, (actor.hp ?? 0) / actor.maxHp)) : 1;
    this.health.visible = ratio < 1 || !!actor.boss;
    const healthSignature = `${ratio}:${r}:${actor.kind}`;
    if (this.healthSignature !== healthSignature) {
      this.healthSignature = healthSignature;
      this.health.clear().roundRect(-r, -r * 2.6, r * 2, 4, 2).fill({ color: 0, alpha: .7 })
        .roundRect(-r, -r * 2.6, r * 2 * ratio, 4, 2).fill(character ? 0x6ee7a8 : 0xff5f6d);
    }
  }
  override destroy(): void { super.destroy({ children: true, context: true }); }
}

/** Geometry from the reference fallback; only missing character textures use it. */
function paintCharacter(g: Graphics, actor: ActorView, r: number, time: number) {
  const accent = actor.accent ?? actor.color, phase = actor.age ?? time;
  const swing = Math.sin(phase * 4 + (actor.moving ? actor.walkPhase ?? 0 : 0)) * .35;
  g.moveTo(-r * .7, r * .3).quadraticCurveTo(-r * 1.7, r * .2 + Math.sin(swing) * 6,
    -r * 1.9, -r * .7 + Math.sin(swing) * 10).stroke({ color: actor.color, width: 4, cap: 'round' });
  g.circle(0, 0, r).fill(actor.color).ellipse(0, r * .22, r * .6, r * .5).fill(accent);
  for (const sign of [-1, 1]) {
    g.poly([sign * r * .30, -r * .78, sign * r * .72, -r * 1.62, sign * r * .92, -r * .62]).fill(actor.color)
      .poly([sign * r * .42, -r * .82, sign * r * .68, -r * 1.36, sign * r * .78, -r * .72]).fill(accent);
  }
  const lookX = Math.cos(actor.facing ?? actor.angle) * r * .16, lookY = Math.sin(actor.facing ?? actor.angle) * r * .16;
  const squash = Math.sin(Math.max(0, Math.min(1, (actor.blinkPhase ?? 0) / .12)) * Math.PI), eyeHeight = r * .19 * (1 - squash);
  for (const sign of [-1, 1]) {
    const x = sign * r * .3 + lookX * .5, y = -r * .1 + lookY * .5;
    if (eyeHeight > .6) {
      g.ellipse(x, y, r * .15, eyeHeight).fill('#1a1d29');
      if (squash < .7) g.circle(x + 1.5, -r * .16 + lookY * .5, r * .055).fill({ color: 0xffffff, alpha: .85 * (1 - squash) });
    } else g.moveTo(x - r * .15, y).quadraticCurveTo(x, y + r * .09, x + r * .15, y)
      .stroke({ color: '#1a1d29', width: Math.max(1.2, r * .055), cap: 'round' });
    g.ellipse(sign * r * .62, r * .14, r * .2, r * .13).fill({ color: '#ff7bac', alpha: .42 });
  }
}

function paintTurret(g: Graphics, actor: ActorView, radius: number, metal: Texture | undefined) {
  const r = radius * (.5 + (actor.spawnProgress ?? 1) * .5);
  const hex = (scale = 1) => Array.from({ length: 6 }, (_, i) => {
    const angle = i / 6 * Math.PI * 2 + Math.PI / 6;
    return [Math.cos(angle) * r * scale, Math.sin(angle) * r * scale];
  }).flat();
  g.poly(hex());
  if (metal) g.fill({ texture: metal, textureSpace: 'local' });
  g.stroke({ color: actor.color, alpha: .55, width: 1.6 });
  const points = hex();
  g.moveTo(points[0], points[1]);
  for (let i = 1; i <= 3; i++) g.lineTo(points[i * 2], points[i * 2 + 1]);
  g.stroke({ color: 0xffffff, alpha: .28, width: 1.6 }).poly(hex(.72)).stroke({ color: 0xffffff, alpha: .1, width: 1 });
  const recoil = Math.max(0, actor.recoil ?? 0) / .16, barrel = (radius * 1.5 - recoil * 4) * r / radius;
  const angle = actor.angle, ca = Math.cos(angle), sa = Math.sin(angle);
  const point = (x: number, y: number) => [x * ca - y * sa, x * sa + y * ca];
  const left = r * .2, right = left + barrel, half = 4.2 * r / radius;
  g.poly([...point(left, -half), ...point(right, -half), ...point(right, half), ...point(left, half)]).fill('#171a24');
  const highlightBottom = -half + 2 * r / radius;
  g.poly([...point(left, -half), ...point(right, -half), ...point(right, highlightBottom), ...point(left, highlightBottom)])
    .fill({ color: 0xffffff, alpha: .16 });
  const mouth1 = point(right, -5 * r / radius), mouth2 = point(right, 5 * r / radius);
  g.moveTo(mouth1[0], mouth1[1]).lineTo(mouth2[0], mouth2[1]).stroke({ color: actor.color, width: 1.8 });
}
