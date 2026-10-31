import { Container, Graphics, Sprite } from 'pixi.js';
import type { EncounterView } from '../../game';
import type { CameraTransform } from '../camera';
import type { GameAssets } from '../assets';
import { spriteAnimationFile } from './materials';
import { syncArt } from './display-art';
import type { EncounterVisual } from './encounter-display';
const PUMPKIN = ['....SS.......','.....S.......','...ooooooo...','..ooOOOOOoo..','.ooOOOOOOOoo.','ooOkOOOOkOOoo','oOOkkOkkOOOoo','oOOOOOOOOOOoo','oOOkkOkkOOOoo','.oOOkkkOOOoo.','..ooOOOOOoo..','...ooooooo...'];
const PAL: Record<string, number> = { S: 0x4a5a18, o: 0xffa52a, O: 0xff8103, k: 0x2a0a00 };
function pumpkin(graphic: Graphics, x: number, y: number, scale: number, alpha: number): void {
  for (let row = 0; row < PUMPKIN.length; row++) for (let col = 0; col < PUMPKIN[row].length; col++) {
    const color = PAL[PUMPKIN[row][col]];
    if (color !== undefined) graphic.rect(x + (col - 6.5) * scale, y + (row - 6) * scale, scale, scale).fill({ color, alpha });
  }
}
export class HalloweenDisplay implements EncounterVisual {
  readonly background = new Container(); readonly ground = new Container();
  readonly actors = new Container(); readonly foreground = new Container();
  private readonly cemetery = new Graphics(); private readonly moon = new Graphics();
  private readonly haze = new Graphics(); private readonly props = new Graphics();
  private readonly choco = new Sprite(); private readonly vanilla = new Sprite();
  constructor() {
    this.choco.anchor.set(.5); this.vanilla.anchor.set(.5);
    this.background.addChild(this.cemetery, this.moon, this.haze);
    this.actors.addChild(this.choco, this.vanilla); this.foreground.addChild(this.props);
  }
  sync(view: EncounterView, camera: CameraTransform, assets: GameAssets): void {
    if (view.kind !== 'halloween') return;
    const { width: w, height: h } = camera;
    this.cemetery.clear().rect(0, 0, w, h).fill(0x120d22);
    for (let i = 0; i < 18; i++) {
      const x = i * w / 17, y = h * (.75 + (i % 3) * .065), size = 18 + i % 4 * 4;
      this.cemetery.roundRect(x - size / 2, y, size, size * 1.7, size * .4).fill(0x292136)
        .moveTo(x, y + size * .25).lineTo(x, y + size).moveTo(x - size * .25, y + size * .5).lineTo(x + size * .25, y + size * .5).stroke({ color: 0x51405a, width: 2 });
      if (i % 3 === 0) pumpkin(this.cemetery, x + 25, y + size, 1.4, .8);
    }
    this.moon.clear();
    const mx = w * .73, my = h * .2, radius = Math.min(w, h) * .12;
    for (let i = 4; i > 0; i--) this.moon.circle(mx, my, radius + i * 16).fill({ color: 0xff8628, alpha: .02 });
    this.moon.circle(mx, my, radius).fill({ color: 0xffc586, alpha: .8 });
    this.moon.circle(mx + radius * .35, my - radius * .15, radius * Math.max(0, Math.min(.95, view.moonPhase))).fill(0x211329);
    this.haze.clear();
    for (let i = 0; i < 8; i++) {
      const x = ((i * 191 + view.time * 12) % (w + 350)) - 175;
      this.haze.ellipse(x, h * .72 + (i % 4) * 24, 220, 34).fill({ color: 0x7663a0, alpha: .04 });
    }
    for (const [id, sprite] of [['choco', this.choco], ['vanilla', this.vanilla]] as const) {
      const cat = view.cats.find(c => c.id === id);
      sprite.position.set(cat?.x ?? view.boss.x + (id === 'choco' ? -80 : 80), cat?.y ?? view.boss.y);
      const file = spriteAnimationFile(id, cat?.frame === undefined ? view.time : cat.frame / 10);
      syncArt(sprite, assets, file, 84);
      const texture = assets.getFile(file);
      if (texture) {
        texture.source.scaleMode = 'nearest';
        sprite.width = texture.width * 4;
        sprite.height = texture.height * 4 * (1 + .028 * Math.sin(view.time * 2.4 + (id === 'choco' ? 0 : 2.2)));
      }
      sprite.alpha = cat?.alpha ?? 1;
      sprite.visible &&= !cat || cat.alpha > 0;
    }
    this.props.clear();
    for (const p of view.pumpkins) {
      this.props.circle(p.x, p.y, p.radius * 1.3).fill({ color: 0xff8d26, alpha: p.alpha * .1 });
      if (!p.exploding) pumpkin(this.props, p.x, p.y, p.radius * 2 / 13, p.alpha);
      else {
        const age = (p.progress ?? 0) * .9, u = Math.min(1, age / .1), grow = 1 - (1 - u) * (1 - u);
        const length = 215 * grow, width = 24 + 46 * Math.max(0, 1 - age / .9);
        const fade = age < .35 ? 1 : Math.pow(Math.max(0, 1 - (age - .35) / .55), 1.6);
        for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          const x = p.x + Math.cos(a) * length, y = p.y + Math.sin(a) * length;
          this.props.moveTo(p.x, p.y).lineTo(x, y).stroke({ color: 0xff8a1e, width: width * 1.3, alpha: .24 * fade })
            .moveTo(p.x, p.y).lineTo(x, y).stroke({ color: 0xffc24a, width: width * .5, alpha: .6 * fade })
            .moveTo(p.x, p.y).lineTo(x, y).stroke({ color: 0xfff3b0, width: width * .15, alpha: fade });
        }
      }
    }
    for (const candy of view.candies) {
      this.props.poly([candy.x - 14, candy.y - 7, candy.x - 5, candy.y, candy.x - 14, candy.y + 7]).fill(candy.color)
        .circle(candy.x, candy.y, 7).fill(candy.color)
        .poly([candy.x + 14, candy.y - 7, candy.x + 5, candy.y, candy.x + 14, candy.y + 7]).fill(candy.color);
    }
  }
  dispose(): void { for (const c of [this.background, this.ground, this.actors, this.foreground]) c.destroy({ children: true, context: true }); }
}
