import type { PresentationProfile } from '../presentation/profile';
import { Container, Graphics, TilingSprite } from 'pixi.js';
import type { GameFrame } from '../game';
import { GameAssets } from './assets';
import type { CameraTransform } from './camera';
import { BattleBackground } from './battle-background';
import type { PixiRenderer } from './create-renderer';
import { IdleBackground } from './idle-background';

export class GameScene {
  readonly stage = new Container({ label: 'game-stage' });
  readonly content = new Container({ label: 'atmosphere-content' });
  readonly world = new Container({ label: 'world' });
  readonly terrain = new Container({ label: 'terrain' });
  readonly pickups = new Container({ label: 'pickups' });
  readonly actors = new Container({ label: 'actors', sortableChildren: true });
  readonly weapons = new Container({ label: 'weapons' });
  readonly projectiles = new Container({ label: 'projectiles' });
  readonly effects = new Container({ label: 'effects' });
  readonly telegraphs = new Container({ label: 'telegraphs' });
  private readonly idle: IdleBackground;
  private readonly battleBackground=new BattleBackground();
  invalidateBackground():void{this.battleBackground.clear();}
  get backgroundDiagnostics(){return this.battleBackground.diagnostics;}
  private readonly background = new TilingSprite({ label: 'battle-background' });
  private readonly shade = new Graphics({ label: 'battle-shade' });
  private readonly grid = new Container({ label: 'battle-grid' });
  private readonly gridLines = [new Graphics(),new Graphics(),new Graphics(),new Graphics()];
  private gridSignature = '';
  private shadeSignature = '';
  private readonly bounds = new Graphics();
  private boundarySignature = '';
  constructor(presentation: Readonly<PresentationProfile>) {
    this.idle = new IdleBackground(presentation);
    this.grid.addChild(...this.gridLines);
    this.stage.eventMode = 'none';
    this.stage.addChild(this.idle, this.content);
    this.content.addChild(this.background, this.shade, this.grid, this.world);
    this.world.addChild(this.terrain, this.telegraphs, this.pickups, this.actors, this.weapons, this.projectiles, this.effects);
    this.world.addChild(this.bounds);
  }
  sync(frame: GameFrame, camera: CameraTransform, assets: GameAssets, nowMs = 0,renderer?:PixiRenderer): void {
    const { width, height, zoom, x, y } = camera;
    const title = frame.phase === 'title';
    this.idle.visible = title; this.content.visible = !title; this.world.visible = !title;
    this.grid.visible = !title; this.shade.visible = !title;
    if (title) {
      this.background.visible = false;
      this.idle.sync(width, height, nowMs);
      return;
    }
    this.world.position.set(width / 2 - x * zoom, height / 2 - y * zoom);
    this.world.scale.set(zoom);
    void assets.request('background', frame.backgroundId);
    const texture = assets.get('background', frame.backgroundId);
    this.background.visible = !!texture;
    if (texture) {
      this.background.texture = renderer?this.battleBackground.texture(texture,renderer):texture;
      this.shade.visible=!renderer;
      this.background.width = width;
      this.background.height = height;
      // Preserve world anchoring. No reverse scrolling or extra camera factor.
      this.background.tileScale.set(zoom);
      this.background.tilePosition.set(width / 2 - x * zoom, height / 2 - y * zoom);
    }
    const shadeSignature = `${width}:${height}:${!!texture}`;
    if (shadeSignature !== this.shadeSignature) {
      this.shade.clear().rect(0, 0, width, height).fill({ color: 0x0a0c12, alpha: texture ? 0.42 : 1 });
      this.shadeSignature = shadeSignature;
    }
    this.applyCamera(camera);
    const arena = frame.encounter?.arena;
    const signature = JSON.stringify(arena ?? frame.worldHalfSize);
    if (signature !== this.boundarySignature) {
      this.boundarySignature = signature;
      const x = arena ? arena.x - arena.halfWidth : -frame.worldHalfSize;
      const y = arena ? arena.y - arena.halfHeight : -frame.worldHalfSize;
      const width = arena ? arena.halfWidth * 2 : frame.worldHalfSize * 2;
      const height = arena ? arena.halfHeight * 2 : frame.worldHalfSize * 2;
      this.bounds.clear().rect(x, y, width, height).stroke({ color: arena ? 0xff6060 : 0x9b9bd9, alpha: arena ? .3 : .5, width: 2 });
    }
  }
  applyCamera(camera:CameraTransform):void {
    const {width,height,zoom,x,y}=camera;
    this.world.position.set(width/2-x*zoom,height/2-y*zoom);this.world.scale.set(zoom);
    this.background.tileScale.set(zoom);this.background.tilePosition.set(width/2-x*zoom,height/2-y*zoom);
    const step = 64 * zoom, major = step * 4;
    const ox = ((width / 2 - x * zoom) % step + step) % step;
    const oy = ((height / 2 - y * zoom) % step + step) % step;
    const bx = ((width / 2 - x * zoom) % major + major) % major;
    const by = ((height / 2 - y * zoom) % major + major) % major;
    const counts = [Math.ceil((width-ox)/step),Math.ceil((height-oy)/step),Math.ceil((width-bx)/major),Math.ceil((height-by)/major)];
    const gridSignature = `${width}:${height}:${zoom}:${counts.join(':')}`;
    if (gridSignature !== this.gridSignature) {
      this.gridLines.forEach((g,i)=>{g.clear();const vertical=i%2===0,spacing=i<2?step:major;
        for(let n=0;n<counts[i];n++){const p=n*spacing;if(vertical)g.moveTo(p,0).lineTo(p,height);else g.moveTo(0,p).lineTo(width,p);}
        g.stroke(i<2?{color:0xffffff,alpha:.035,width:1}:{color:0xff7bac,alpha:.055,width:1.5});});
      this.gridSignature=gridSignature;
    }
    this.gridLines[0].position.set(ox,0);this.gridLines[1].position.set(0,oy);
    this.gridLines[2].position.set(bx,0);this.gridLines[3].position.set(0,by);
  }
  dispose(): void { this.battleBackground.clear();this.stage.destroy({ children: true, context: true }); }
}
