import { Container, Graphics, Text } from 'pixi.js';
import type { EncounterView } from '../../game';
import type { CameraTransform } from '../camera';
import type { GameAssets } from '../assets';
import { FlandreDisplay } from './flandre-display';
import { VergilDisplay } from './vergil-display';
import { RemiliaDisplay } from './remilia-display';
import { HalloweenDisplay } from './halloween-display';

export interface EncounterVisual {
  background: Container; ground: Container; actors: Container; foreground: Container;
  sync(view: EncounterView, camera: CameraTransform, assets: GameAssets): void;
  dispose(): void;
}
export class EncounterDisplay {
  readonly background = new Container(); readonly ground = new Container();
  readonly actors = new Container(); readonly foreground = new Container(); readonly screen = new Container();
  private readonly health = new Graphics();
  private readonly title = new Text({ text: '', style: { fontFamily: 'sans-serif', fontSize: 19, fontWeight: 'bold', fill: 0xf5e7ff, dropShadow: { color: 0x000000, blur: 4, distance: 1 } } });
  private readonly status = new Text({ text: '', style: { fontFamily: 'sans-serif', fontSize: 13, fill: 0x9fefff, stroke: { color: 0x061019, width: 2 } } });
  private readonly transition = new Graphics();
  private kind?: EncounterView['kind']; private visual?: EncounterVisual;
  constructor() { this.title.anchor.set(.5, 0); this.status.anchor.set(.5, 0); this.screen.addChild(this.health, this.title, this.status, this.transition); }
  sync(view: EncounterView | undefined, camera: CameraTransform, assets: GameAssets): void {
    this.screen.visible = !!view;
    if (view?.kind !== this.kind) {
      this.visual?.dispose(); this.visual = undefined; this.kind = view?.kind;
      if (view) {
        this.visual = view.kind === 'flandre' ? new FlandreDisplay() : view.kind === 'vergil' ? new VergilDisplay() : view.kind === 'remilia' ? new RemiliaDisplay() : new HalloweenDisplay();
        this.background.addChild(this.visual.background); this.ground.addChild(this.visual.ground);
        this.actors.addChild(this.visual.actors); this.foreground.addChild(this.visual.foreground);
      }
    }
    if (!view) return;
    this.visual!.sync(view, camera, assets);
    const w = Math.min(600, camera.width - 70), x = (camera.width - w) / 2;
    const ratio = Math.max(0, Math.min(1, view.hp / Math.max(1, view.maxHp)));
    const color = view.kind === 'vergil' ? 0x53d9ff : view.kind === 'halloween' ? 0xffad42 : 0xff518d;
    this.health.clear().roundRect(x, 82, w, 8, 4).fill({ color: 0x080b15, alpha: .85 })
      .roundRect(x, 82, Math.max(0, w * ratio), 8, 4).fill(color);
    this.title.text = view.kind === 'flandre' ? view.cardName : view.title ?? ({ vergil: 'VERGIL', remilia: '紅い月の姉妹', halloween: 'HALLOWEEN NIGHT' } as const)[view.kind];
    this.title.position.set(camera.width / 2, 100);
    this.status.visible = view.kind === 'flandre';
    if (view.kind === 'flandre') {
      this.status.text = view.purgeCooldown > 0 ? `Space · 清弹 ${Math.ceil(view.purgeCooldown)}s` : 'Space · 清弹就绪  /  Shift · 慢速移动';
      this.status.position.set(camera.width / 2, 126);
    }
    this.transition.clear();
    const fade = view.kind === 'halloween' ? view.veil : view.fade ?? 0;
    if (fade > 0) this.transition.rect(0, 0, camera.width, camera.height).fill({ color: 0x06020a, alpha: Math.min(1, fade) });
    if (view.flash) this.transition.rect(0, 0, camera.width, camera.height).fill({ color: 0xffffff, alpha: Math.min(.8, view.flash) });
    if (view.state === 'intro' && view.kind === 'vergil') {
      const opacity = view.introTime < 3 ? view.introTime / 3 : Math.max(0, 1 - (view.introTime - 3) / 3.5);
      this.transition.rect(0, 0, camera.width, camera.height).fill({ color: 0, alpha: opacity });
    }
  }
  dispose(): void {
    this.visual?.dispose(); this.visual = undefined;
    for (const container of [this.background, this.ground, this.actors, this.foreground, this.screen]) container.destroy({ children: true, context: true });
  }
}
