import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { ActorView, CometView } from '../game';
import type { CameraTransform } from './camera';
import type { GameAssets } from './assets';
import { syncArt } from './encounters/display-art';

const TIMING = { fly: 1.6, dive: .5, boom: .9, roar: 4, takeoff: 1.6 };
/** A dedicated comet cinematic; no rule timing or collision state is advanced here. */
export class CometDisplay {
  readonly ground = new Graphics(); readonly world = new Container(); readonly screen = new Container();
  private readonly fire = new Graphics(); private readonly smoke = new Graphics();
  private readonly landingMarkers = new Graphics();
  private readonly falling = new Container(); private readonly waveArt = new Container(); private readonly waveLines = new Graphics();
  private readonly fallingSprites: Sprite[] = []; private readonly waveSprites: Sprite[] = [];
  private readonly dragon = new Sprite(); private readonly aura = new Graphics(); private readonly stars = new Graphics();
  private readonly overlay = new Graphics(); private readonly banner = new Container();
  private readonly bannerBack = new Graphics();
  private readonly bannerText = new Text({ text: '？？？ 袭击', style: { fontSize: 22, fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } });
  constructor() {
    // Reference comet.js MOBILE_ADD is the constant 'lighter' on every platform.
    // Keep lights separate: shadows, smoke and the dark ground wave use normal.
    this.ground.blendMode = 'normal'; this.smoke.blendMode = 'normal';
    this.dragon.anchor.set(.5); this.fire.blendMode = 'add'; this.aura.blendMode = 'add';
    this.world.addChild(this.fire, this.landingMarkers, this.falling, this.smoke, this.aura, this.dragon, this.stars, this.waveArt, this.waveLines);
    this.landingMarkers.blendMode = 'add';
    this.waveLines.blendMode = 'add';
    this.bannerText.position.set(51, 13); this.banner.addChild(this.bannerBack, this.bannerText);
    this.screen.addChild(this.overlay, this.banner);
  }
  sync(view: CometView | undefined, camera: CameraTransform, actors: readonly ActorView[], assets: GameAssets): void {
    const active = !!view && view.phase !== 'idle' && view.phase !== 'done';
    this.world.visible = active; this.ground.visible = active; this.screen.visible = active;
    this.ground.clear(); this.fire.clear(); this.landingMarkers.clear(); this.smoke.clear(); this.aura.clear(); this.stars.clear(); this.overlay.clear(); this.waveLines.clear();
    if (!view || !active) return;
    const { phase, time: t, age, center: c, direction: dir, halfSize: half } = view;
    const flying = phase === 'fly1' || phase === 'fly2', diving = phase === 'dive', roaring = phase === 'roar', taking = phase === 'takeoff';
    this.dragon.visible = flying || diving || roaring || taking;
    if (this.dragon.visible) {
      const k = Math.max(0, Math.min(1, t / (diving ? TIMING.dive : taking ? TIMING.takeoff : TIMING.fly)));
      let x = c.x, y = c.y, width = 460, rotation = 0;
      if (flying) { const margin = half + 260; x = dir > 0 ? -margin + k * margin * 2 : margin - k * margin * 2; y = -half * .55 + Math.sin(age * 2.2) * 50; rotation = (dir > 0 ? 0 : Math.PI) + Math.PI / 2; width = 380; }
      if (diving) { const start = dir * (half + 200); x = start + (c.x - start) * k; y = -half * .42 + (c.y + half * .42) * k; rotation = Math.atan2(c.y + half * .42, c.x - start) + Math.PI / 2; width = 400; this.ground.ellipse(x, y + 60, 130, 34).fill({ color: 0, alpha: .28 }); }
      if (taking) { x = c.x - dir * k * k * 320; y = c.y - 120 - k * k * (half + 400); rotation = -dir * .22 * k; width = 460 * (1 - k * .25); }
      syncArt(this.dragon, assets, roaring ? 'comet/roar.png' : 'comet/fly.png', width);
      this.dragon.position.set(x, y); this.dragon.rotation = rotation;
      this.dragon.anchor.set(.5, roaring ? 1 : .5);
      this.dragon.tint = flying ? 0x000000 : 0xffffff;
      this.dragon.alpha = flying ? .45 : taking ? 1 - k * .5 : 1;
      if (roaring) { this.dragon.scale.x = Math.abs(this.dragon.scale.x) * (dir > 0 ? -1 : 1); this.dragon.scale.y *= .9 + .1 * Math.min(1, t / .35); }
      for (let i = 5; i > 0; i--) this.aura.ellipse(x, y, width * (.3 + i * .035), width * (.45 + i * .045)).fill({ color: 0xf44817, alpha: .012 });
    }
    let fallingCount = 0;
    for (const bolt of view.bolts) {
      if (!bolt.landed) {
        const proximity = Math.max(0, Math.min(1, 1 - (bolt.landY - bolt.y) / 760));
        if (proximity > .02) {
          const pulse = .75 + .25 * Math.sin(proximity * 30);
          this.landingMarkers.circle(bolt.x, bolt.landY, 110 * (.55 + .45 * proximity))
            .stroke({ color: 0xff3a1c, width: 3, alpha: proximity * .55 * pulse });
          this.primitive(this.fallingSprites, fallingCount++, this.falling, assets, 'red', bolt.x, bolt.landY, 165, proximity * .22);
        }
        const radius = bolt.radius, tail = Math.min(170, bolt.vy * .2);
        for (let i = 7; i >= 1; i--) {
          const fraction = i / 7, y = bolt.y - fraction * tail;
          const size = radius * (3.4 - 2.2 * fraction) * (.9 + .1 * Math.sin(age * 30 + i));
          const x = bolt.x + (this.hash(bolt.seed, i) - .5) * radius * .5;
          this.primitive(this.fallingSprites, fallingCount++, this.falling, assets, fraction < .45 ? 'orange' : 'red', x, y, size, .85 * (1 - fraction * .85));
        }
        for (let i = 1; i <= 3; i++) {
          const size = radius * (.9 - i * .12);
          this.primitive(this.fallingSprites, fallingCount++, this.falling, assets, 'hot', bolt.x, bolt.y - i * tail / 4.2, size * 2, .9 - i * .2);
        }
        this.primitive(this.fallingSprites, fallingCount++, this.falling, assets, 'orange', bolt.x, bolt.y, radius * 5.2, .8);
        this.primitive(this.fallingSprites, fallingCount++, this.falling, assets, 'hot', bolt.x, bolt.y, radius * 3.2, 1);
      } else {
        const radius = bolt.exploded ? 128 : 62, progress = Math.max(0, Math.min(1, bolt.elapsed / .7));
        this.explosion(bolt.x, bolt.landY, radius, progress, bolt.seed);
      }
    }
    for (let i = fallingCount; i < this.fallingSprites.length; i++) this.fallingSprites[i].visible = false;
    for (const puff of view.trails) this.smoke.circle(puff.x, puff.y, puff.radius).fill({ color: 0x651513, alpha: puff.alpha * .22 });
    let waveCount = 0;
    for (const ring of view.rings) {
      const rt = ring.elapsed - ring.delay;
      if (rt < 0) continue;
      const k = Math.min(1, rt / Math.max(.001, ring.duration)), radius = ring.radius * (1 - Math.pow(1 - k, 2.2));
      if (ring.kind === 'ground') {
        this.ground.circle(ring.x, ring.y, radius).stroke({ color: 0x1a0505, width: Math.max(2, 46 * (1 - k)), alpha: .9 * (1 - k) })
          .circle(ring.x, ring.y, radius).stroke({ color: 0xff3020, width: Math.max(1, 14 * (1 - k)), alpha: .9 * (1 - k) });
        this.waveLines.circle(ring.x, ring.y, Math.max(1, radius - 20))
          .stroke({ color: k < .3 ? 0xffffff : 0xffb060, width: Math.max(1, 7 * (1 - k)), alpha: .95 * (1 - k) });
      } else {
        const alpha = (1 - k) * (ring.warm ? .9 : .7);
        this.primitive(this.waveSprites, waveCount++, this.waveArt, assets, ring.warm ? 'warm' : 'cool', ring.x, ring.y, radius * 2.25, alpha);
        this.waveLines.circle(ring.x, ring.y, radius)
          .stroke({ color: k < .35 ? 0xffffff : ring.warm ? 0xff8a60 : 0xffe0e0,
            width: Math.max(1, (ring.kind === 'bolt' ? 5 : ring.warm ? 8 : 4) * (1 - k)), alpha: alpha * .6 });
      }
    }
    for (let i = waveCount; i < this.waveSprites.length; i++) this.waveSprites[i].visible = false;
    if (phase === 'boom' || roaring || taking) {
      const elapsed = phase === 'boom' ? t : roaring ? TIMING.boom + t : TIMING.boom + TIMING.roar + t;
      if (elapsed < 1.7) {
        for (const [delay, dx, dy, seed] of [[0, -20, 0, 7.1], [.09, -150, 40, 8.3], [.17, 140, 30, 9.7]]) {
          const progress = Math.max(0, Math.min(1, (elapsed - delay) / 1.5));
          this.explosion(c.x + dx, c.y + dy, 190, progress, seed);
        }
      }
      if (phase === 'boom' || roaring) for (const actor of actors) {
        if (actor.kind !== 'player' || actor.downed) continue;
        for (let i = 0; i < 5; i++) { const a = age * 2.6 + i * Math.PI * 2 / 5; this.stars.star(actor.x + Math.cos(a) * 20, actor.y - actor.radius - 26 + Math.sin(a) * 8, 5, 5, 2).fill({ color: 0xffe680, alpha: .8 }); }
      }
    }
    this.syncScreen(view, camera);
  }
  private hash(seed: number, index: number) {
    const value = Math.sin(seed * 127.1 + index * 311.7) * 43758.5453123;
    return value - Math.floor(value);
  }
  private primitive(pool: Sprite[], index: number, layer: Container, assets: GameAssets,
    name: 'hot' | 'orange' | 'red' | 'warm' | 'cool', x: number, y: number, size: number, alpha: number) {
    const sprite = pool[index] ??= layer.addChild(new Sprite());
    sprite.anchor.set(.5); sprite.blendMode = 'add';
    sprite.position.set(x, y); sprite.alpha = alpha;
    syncArt(sprite, assets, `fx/comet-source-${name}.png`, size, size);
  }
  private explosion(x: number, y: number, radius: number, progress: number, seed: number): void {
    const fade = Math.max(0, 1 - progress);
    for (let i = 0; i < 8; i++) {
      const a = i * 2.39996 + seed, r = radius * (.15 + progress * .65), puff = radius * .34 * fade;
      this.fire.circle(x + Math.cos(a) * r, y + Math.sin(a) * r * .6, puff).fill({ color: i % 2 ? 0xff4a18 : 0xffb44b, alpha: fade * .35 });
      this.smoke.circle(x + Math.cos(a) * r, y + Math.sin(a) * r * .6 - progress * radius * .4, radius * .3 * (progress + .3)).fill({ color: 0x321219, alpha: fade * .19 });
      this.smoke.rect(x + Math.cos(a) * radius * progress * 1.5, y + Math.sin(a) * radius * progress, 3, 3).fill({ color: 0x1b1218, alpha: fade });
    }
  }
  private syncScreen(view: CometView, camera: CameraTransform): void {
    const { width: w, height: h } = camera;
    const activeShade = ['dive', 'boom', 'roar'].includes(view.phase) ? 1 : view.phase === 'takeoff' ? Math.max(0, 1 - view.time / TIMING.takeoff) : .5;
    this.overlay.rect(0, 0, w, h).fill({ color: 0x0a0004, alpha: activeShade * .16 });
    if (view.phase === 'boom') {
      if (view.flash > .78) this.overlay.rect(0, 0, w, h).fill({ color: 0xfff7ea, alpha: Math.min(1, (view.flash - .78) / .22) });
      else for (let i = 0; i < 3; i++) {
        const k = (view.time - i * .3) / .85;
        if (k < 0 || k > 1) continue;
        this.overlay.circle(w / 2, h / 2, Math.hypot(w, h) * .62 * (1 - Math.pow(1 - k, 2))).stroke({ color: k < .25 ? 0xffffff : 0xff7a50, width: Math.max(1, 26 * (1 - k)), alpha: (1 - k) * .75 });
      }
    }
    this.banner.visible = view.phase === 'banner';
    if (this.banner.visible) {
      const bw = Math.min(300, w * .34), rest = Math.max(10, w - bw - 142), t = view.time;
      const k = t < .3 ? t / .3 : 1;
      const ease = 1 + 2.7 * Math.pow(k - 1, 3) + 1.7 * Math.pow(k - 1, 2);
      this.banner.position.set(t < .3 ? w + (rest - w) * ease : t < 3.3 ? rest : rest + (w + bw - rest) * Math.pow((t - 3.3) / .3, 2), h - 150);
      this.banner.alpha = t < 3.3 ? Math.min(1, k * 2) : Math.max(0, 1 - (t - 3.3) / .3);
      this.bannerBack.clear().roundRect(0, 0, bw, 52, 10).fill(0x4a0000).stroke({ color: 0xffcc00, width: 2 })
        .poly([26, 13, 14, 36, 38, 36]).fill(0xff3020);
    }
  }
  dispose(): void { this.ground.destroy(); this.world.destroy({ children: true, context: true }); this.screen.destroy({ children: true, context: true }); }
}
