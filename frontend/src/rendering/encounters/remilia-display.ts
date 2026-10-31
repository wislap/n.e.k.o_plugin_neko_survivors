import { Container, Graphics, Sprite } from 'pixi.js';
import type { EncounterView } from '../../game';
import type { CameraTransform } from '../camera';
import type { GameAssets } from '../assets';
import { ENCOUNTER_ART, spriteAnimationFile } from './materials';
import { syncArt } from './display-art';
import type { EncounterVisual } from './encounter-display';

export class RemiliaDisplay implements EncounterVisual {
  readonly background = new Container(); readonly ground = new Container();
  readonly actors = new Container(); readonly foreground = new Container();
  private readonly sky = new Graphics(); private readonly moon = new Sprite();
  private readonly tower = new Sprite(); private readonly bats = new Container();
  private readonly sigil = new Sprite(); private readonly aura = new Graphics(); private readonly boss = new Sprite();
  constructor() {
    for (const s of [this.moon, this.sigil, this.boss]) s.anchor.set(.5);
    this.tower.anchor.set(.5, 1); this.boss.anchor.y = .6;
    this.sigil.blendMode = 'add';
    this.background.addChild(this.sky, this.moon, this.tower);
    this.ground.addChild(this.bats, this.sigil); this.actors.addChild(this.aura, this.boss);
  }
  sync(view: EncounterView, camera: CameraTransform, assets: GameAssets): void {
    if (view.kind !== 'remilia') return;
    const { width: w, height: h } = camera;
    this.sky.clear().rect(0, 0, w, h).fill(0x110a26);
    this.moon.position.set(w * .72, h * .23); syncArt(this.moon, assets, ENCOUNTER_ART.remilia.moon, Math.min(w, h) * .48);
    this.moon.tint = 0xffa8c9; this.moon.alpha = .86;
    this.tower.position.set(w * .28, h * 1.05); syncArt(this.tower, assets, ENCOUNTER_ART.remilia.tower, w * .46);
    this.tower.alpha = .55;
    while (this.bats.children.length > view.bats.length) this.bats.removeChildAt(this.bats.children.length - 1).destroy();
    while (this.bats.children.length < view.bats.length) {
      // remilia-render.js bakes this path into a 32x20 sprite, then flaps by
      // scaling its destination height. Preserve those exact source coordinates.
      this.bats.addChild(new Graphics().moveTo(0, 2)
        .quadraticCurveTo(-6, -8, -14, -5).quadraticCurveTo(-7, -1, 0, 2)
        .quadraticCurveTo(7, -1, 14, -5).quadraticCurveTo(6, -8, 0, 2)
        .fill({ color: 0x1c040e, alpha: .92 })
        .ellipse(0, 3, 2.6, 3.6).fill({ color: 0x1c040e, alpha: .92 }));
    }
    view.bats.forEach((bat, index) => {
      const display = this.bats.children[index];
      display.position.set(bat.x, bat.y); display.scale.set(bat.width / 32, bat.height / 20); display.alpha = bat.alpha;
    });
    this.sigil.position.set(view.boss.x, view.boss.y); this.sigil.rotation = view.time * .16;
    syncArt(this.sigil, assets, ENCOUNTER_ART.remilia.sigil, 250, 250); this.sigil.alpha = Math.min(.72, view.sigil * .65);
    this.aura.clear();
    for (let i = 4; i > 0; i--) this.aura.circle(view.boss.x, view.boss.y, 42 + i * 17).fill({ color: i % 2 ? 0x6d57ff : 0xff477e, alpha: .016 });
    const file = spriteAnimationFile('remilia', view.animationFrame === undefined ? view.time : view.animationFrame / 12);
    this.boss.position.set(view.boss.x, view.boss.y); syncArt(this.boss, assets, file, 130.4);
    // Reference v0.4.18 explicitly removed full-screen spell cut-ins (round 205).
    this.boss.alpha = (view.alpha ?? 1) * (view.ending > 0 ? Math.max(0, 1 - view.ending) : 1);
  }
  dispose(): void { for (const c of [this.background, this.ground, this.actors, this.foreground]) c.destroy({ children: true, context: true }); }
}
