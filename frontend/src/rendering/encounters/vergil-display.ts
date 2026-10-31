import { Container, Graphics, Sprite } from 'pixi.js';
import type { EncounterView } from '../../game';
import type { CameraTransform } from '../camera';
import type { GameAssets } from '../assets';
import { ENCOUNTER_ART } from './materials';
import { syncArt, zigzagBlade } from './display-art';
import type { EncounterVisual } from './encounter-display';

export class VergilDisplay implements EncounterVisual {
  readonly background = new Container(); readonly ground = new Container();
  readonly actors = new Container(); readonly foreground = new Container();
  private readonly voidArt = new Graphics(); private readonly arena = new Sprite();
  private readonly arenaMask = new Graphics(); private readonly border = new Graphics();
  private readonly shadow = new Graphics(); private readonly chair = new Sprite();
  private readonly silhouette = new Sprite(); private readonly attacks = new Graphics();
  constructor() {
    this.arena.anchor.set(.5); this.chair.anchor.set(.5, 1); this.silhouette.anchor.set(.5, 1);
    this.background.addChild(this.voidArt);
    this.ground.addChild(this.arena, this.arenaMask, this.border);
    this.arena.mask = this.arenaMask;
    this.actors.addChild(this.shadow, this.chair, this.silhouette);
    this.foreground.addChild(this.attacks);
  }
  sync(view: EncounterView, camera: CameraTransform, assets: GameAssets): void {
    if (view.kind !== 'vergil') return;
    const { width: w, height: h } = camera; const a = view.arena;
    this.voidArt.clear().rect(0, 0, w, h).fill(0x040810);
    for (let i = 0; i < 48; i++) {
      const x = (i * 147.53 + Math.sin(view.time * .17 + i) * 22) % w;
      const y = ((i * 93.7 - view.time * (7 + i % 5)) % h + h) % h;
      this.voidArt.moveTo(x - 4, y + 14).lineTo(x + 4, y - 14).stroke({ color: 0x3ecff7, alpha: .06 + i % 4 * .025, width: 2 });
    }
    this.arena.position.set(a.x, a.y);
    syncArt(this.arena, assets, ENCOUNTER_ART.vergil.arena, a.halfWidth * 2, a.halfHeight * 2);
    this.arena.alpha = view.state === 'intro' ? Math.max(0, Math.min(1, (view.introTime - 3) / 3)) : 1;
    this.arenaMask.clear().rect(a.x - a.halfWidth, a.y - a.halfHeight, a.halfWidth * 2, a.halfHeight * 2).fill(0xffffff);
    const pulse = .45 + Math.sin(view.time * 2) * .15;
    this.border.clear().rect(a.x - a.halfWidth, a.y - a.halfHeight, a.halfWidth * 2, a.halfHeight * 2).stroke({ color: 0x42d8ff, width: 2, alpha: pulse });
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const x = a.x + sx * a.halfWidth, y = a.y + sy * a.halfHeight;
      this.border.moveTo(x - sx * 26, y).lineTo(x, y).lineTo(x, y - sy * 26).stroke({ color: 0xc2f7ff, width: 3, alpha: .8 });
    }
    const hover = view.state === 'ult' ? -14 : view.charge > 0 ? -5 + Math.sin(view.time * 71) * 2 : Math.sin(view.time * 2.2) * 3;
    this.chair.position.set(view.boss.x, view.boss.y + 6 + hover);
    this.chair.rotation = view.chairFacing - Math.PI / 2;
    syncArt(this.chair, assets, ENCOUNTER_ART.vergil.chair, 120, 120);
    this.chair.visible &&= view.chairVisible;
    this.silhouette.position.set(view.boss.x, view.boss.y + 6);
    syncArt(this.silhouette, assets, ENCOUNTER_ART.vergil.silhouette, 130, 130);
    this.silhouette.visible &&= view.state === 'intro' && view.introTime >= 3 && view.introTime < 9;
    this.silhouette.alpha = Math.max(0, Math.min(.92, (view.introTime - 3) / 3));
    this.shadow.clear().ellipse(view.boss.x, view.boss.y + 6, 31, 12).fill({ color: 0, alpha: .28 });
    this.attacks.clear();
    for (const slash of view.slashes) {
      const begin = slash.angle - 1.1, end = slash.angle + 1.1;
      this.attacks.arc(slash.x, slash.y, slash.radius, begin, end).stroke({ color: 0x3fbfff, width: 11, alpha: slash.alpha * .13 })
        .arc(slash.x, slash.y, slash.radius, begin, end).stroke({ color: 0xd6ffff, width: 2.5, alpha: slash.alpha });
    }
    for (const rift of view.rifts) {
      this.attacks.ellipse(rift.x, rift.y, rift.radius * .16, rift.radius).fill({ color: 0x050a18, alpha: rift.alpha })
        .ellipse(rift.x, rift.y, rift.radius * .22, rift.radius).stroke({ color: 0x5ad8ff, alpha: rift.alpha, width: 2 });
    }
    for (const blade of view.blades) zigzagBlade(this.attacks, blade.x1, blade.y1, blade.x2, blade.y2, blade.seed, blade.alpha);
    if (view.guarding) this.attacks.circle(view.boss.x, view.boss.y, 64).stroke({ color: 0x5adcff, alpha: .1 + Math.sin(view.time * 3.1) * .04, width: 2 })
      .circle(view.boss.x, view.boss.y, 58).stroke({ color: 0xa0f0ff, alpha: .07, width: 1 });
    if ((view.guardShatter ?? 0) > 0) {
      const k = Math.min(1, (view.guardShatter ?? 0) / .35);
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + .4, r = 64 + (1 - k) * 46;
        this.attacks.arc(view.boss.x + Math.cos(a) * r, view.boss.y + Math.sin(a) * r, 9, a - .5, a + .5).stroke({ color: 0x8ce6ff, width: 2.4 * k, alpha: k * .9 });
      }
    }
    if (view.charge > 0) {
      for (let i = 0; i < 5; i++) {
        const r = ((view.time * 80 + i * 25) % 140);
        this.attacks.circle(view.boss.x, view.boss.y, r).stroke({ color: 0x6ae4ff, width: 1.5, alpha: Math.max(0, 1 - r / 140) * .5 });
      }
    }
  }
  dispose(): void { for (const c of [this.background, this.ground, this.actors, this.foreground]) c.destroy({ children: true, context: true }); }
}
