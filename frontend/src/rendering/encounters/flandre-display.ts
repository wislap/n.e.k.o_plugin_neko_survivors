import { Container, Graphics, Sprite } from 'pixi.js';
import type { EncounterView } from '../../game';
import type { GameAssets } from '../assets';
import type { CameraTransform } from '../camera';
import { CARD_THEMES, ENCOUNTER_ART } from './materials';
import { magicSigil, syncArt } from './display-art';
import type { EncounterVisual } from './encounter-display';

export class FlandreDisplay implements EncounterVisual {
  readonly background = new Container(); readonly ground = new Container();
  readonly actors = new Container(); readonly foreground = new Container();
  private readonly dark = new Graphics(); private readonly wings = new Graphics();
  private readonly vortex = new Sprite(); private readonly circle = new Sprite();
  private readonly sigil = new Graphics(); private readonly declaration = new Graphics();
  private cardId = '';
  constructor() {
    this.vortex.anchor.set(.5); this.circle.anchor.set(.5); this.circle.blendMode = 'add';
    this.background.addChild(this.dark, this.wings);
    this.ground.addChild(this.vortex, this.circle, this.sigil);
    this.foreground.addChild(this.declaration);
  }
  sync(view: EncounterView, camera: CameraTransform, assets: GameAssets): void {
    if (view.kind !== 'flandre') return;
    const { width: w, height: h } = camera;
    const theme = CARD_THEMES[view.cardId] ?? CARD_THEMES.prologue;
    this.dark.clear().rect(0, 0, w, h).fill(0x100814);
    // Crystal wings are Flandre's signature. Eight coloured drops on each rib.
    this.wings.clear();
    const colors = [0x79e8ff, 0x6c9cff, 0xbf77ff, 0xf08dff, 0xff6478, 0xffad62, 0xffe778, 0x8bff9f];
    for (const sign of [-1, 1]) {
      const cx = w / 2, cy = h * .42;
      this.wings.moveTo(cx, cy).bezierCurveTo(cx + sign * w * .2, cy - h * .24, cx + sign * w * .34, cy - h * .04, cx + sign * w * .48, cy - h * .26)
        .stroke({ color: 0x321f3f, width: 10, alpha: .8 });
      for (let i = 0; i < 8; i++) {
        const x = cx + sign * (w * .09 + i * w * .049), y = cy - Math.sin((i + 1) / 9 * Math.PI) * h * .16;
        const drop = 18 + i * 3;
        this.wings.moveTo(x, y).lineTo(x, y + drop).stroke({ color: 0x665078, width: 2, alpha: .6 });
        this.wings.poly([x, y + drop, x + 10, y + drop + 16, x, y + drop + 35, x - 10, y + drop + 16]).fill({ color: colors[i], alpha: .23 + Math.sin(view.time + i) * .07 });
      }
    }
    this.vortex.position.set(view.arena.x, view.arena.y);
    syncArt(this.vortex, assets, ENCOUNTER_ART.flandre.background, view.arena.halfWidth * 2, view.arena.halfHeight * 2);
    this.vortex.alpha = .43;
    this.circle.position.set(view.boss.x, view.boss.y); this.circle.rotation = view.time * .18;
    syncArt(this.circle, assets, ENCOUNTER_ART.flandre.circle, 380, 380); this.circle.alpha = .35;
    this.sigil.position.set(view.boss.x, view.boss.y); this.sigil.rotation = -view.time * .12;
    if (this.cardId !== view.cardId) { this.cardId = view.cardId; magicSigil(this.sigil, theme.vertices, theme.step, 155, theme.color); }
    this.declaration.clear();
    const d = Math.max(0, Math.min(1, view.declaration));
    if (d > 0) {
      const r = 40 + (1 - d) * 460;
      this.declaration.circle(view.boss.x, view.boss.y, r).stroke({ color: theme.color, alpha: d, width: 4 })
        .circle(view.boss.x, view.boss.y, r * .73).stroke({ color: 0xffffff, alpha: d * .5, width: 2 });
      for (let i = 0; i < 16; i++) {
        const a = i * Math.PI / 8 + view.time * .1;
        this.declaration.moveTo(view.boss.x + Math.cos(a) * r * .5, view.boss.y + Math.sin(a) * r * .5)
          .lineTo(view.boss.x + Math.cos(a) * r * 1.4, view.boss.y + Math.sin(a) * r * 1.4);
      }
      this.declaration.stroke({ color: theme.color, width: 1.5, alpha: d * .65 });
    }
  }
  dispose(): void { for (const c of [this.background, this.ground, this.actors, this.foreground]) c.destroy({ children: true, context: true }); }
}
