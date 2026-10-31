import { Container, Graphics, Sprite } from 'pixi.js';
import type { WeatherView } from '../game';
import type { CameraTransform } from './camera';
import type { GameAssets } from './assets';
import { syncArt } from './encounters/display-art';
import { DisplayObjectIndex } from './object-index';

const hash = (index: number, salt: number) => {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
  return value - Math.floor(value);
};
const TYPHOON_LAYERS = [[.62, 4, 5, .50], [.98, 2.4, 4, .36], [1.34, 1.3, 3, .22]] as const;

/** weather-fx.js drawTyphoon's deterministic layers and original baked art. */
class TyphoonDisplay extends Container {
  private readonly shadow = new Sprite(); private readonly mist = new Sprite();
  private readonly arms: Sprite[] = []; private readonly particles: Sprite[] = [];
  private readonly eye = new Sprite(); private readonly rings = new Graphics();
  private readonly flash = new Sprite();
  constructor() {
    super();
    for (let i = 0; i < 12; i++) this.arms.push(new Sprite());
    for (let i = 0; i < 16; i++) this.particles.push(new Sprite());
    const sprites = [this.shadow, this.mist, ...this.arms, ...this.particles, this.eye, this.flash];
    for (const sprite of sprites) sprite.anchor.set(.5);
    this.flash.blendMode = 'add';
    this.addChild(this.shadow, this.mist, ...this.arms, ...this.particles, this.eye, this.rings, this.flash);
  }
  sync(view: WeatherView['typhoons'][number], time: number, assets: GameAssets) {
    const radius = view.radius;
    this.position.set(view.x, view.y);
    const art = (sprite: Sprite, name: string, size: number) => syncArt(sprite, assets, `fx/typhoon-source-${name}.png`, size, size);
    art(this.shadow, 'shadow', radius * 2.7); this.shadow.alpha = .55;
    art(this.mist, 'mist', radius * 2.6); this.mist.alpha = .5;
    let index = 0;
    for (const [layer, [ratio, speed, count, alpha]] of TYPHOON_LAYERS.entries()) {
      for (let arm = 0; arm < count; arm++) {
        const sprite = this.arms[index++]; art(sprite, `arm-${layer}`, radius * ratio * 2);
        sprite.rotation = view.angle * speed + ratio * 5.1 + arm * Math.PI * 2 / count;
        sprite.alpha = alpha;
      }
    }
    for (let i = 0; i < this.particles.length; i++) {
      const sprite = this.particles[i], phase = (hash(i, 1) + time * (.05 + .03 * hash(i, 2))) % 1;
      const distance = radius * (1.2 - phase), angle = hash(i, 3) * Math.PI * 2 + view.angle * (1 + 2.6 * phase * phase) * (.8 + .4 * hash(i, 4));
      sprite.position.set(Math.cos(angle) * distance, Math.sin(angle) * distance * .92);
      const fade = Math.sin(Math.PI * phase);
      if (i % 3 === 0) {
        art(sprite, 'puff', radius * (.16 + .1 * hash(i, 5)) * 2);
        sprite.alpha = .5 * fade;
      } else {
        const size = 9 + 6 * hash(i, 6); art(sprite, `leaf-${i % 3}`, size);
        sprite.height *= .5 + .5 * Math.abs(Math.sin(time * 3 + i));
        sprite.rotation = time * (2 + 3 * hash(i, 7)) + i;
        sprite.alpha = .85 * fade;
      }
    }
    art(this.eye, 'eye', radius); this.eye.alpha = .75;
    this.rings.clear();
    for (let i = 0; i < 2; i++) this.rings.circle(0, 0, radius * (.2 + .1 * i) + Math.sin(view.angle * 4.6 - i * 1.8) * radius * .03)
      .stroke({ color: 0xd6e6f4, width: 1.6, alpha: .2 - i * .07 });
    const slot = Math.floor(time / 4.3), elapsed = time - slot * 4.3;
    this.flash.visible = elapsed < .18;
    if (this.flash.visible) {
      art(this.flash, 'flash', radius * .7);
      this.flash.position.set((hash(slot + view.x * .01, 11) - .5) * radius * 1.2, (hash(slot + view.x * .01, 12) - .5) * radius * 1.2);
      this.flash.alpha = (1 - elapsed / .18) * .7;
    }
  }
  override destroy() { super.destroy({ children: true, context: true }); }
}

/** Visual randomness is derived from an index; it never consumes gameplay RNG. */
export class WeatherDisplay {
  readonly world = new Container();
  readonly screen = new Container();
  private readonly worldEffects = new Graphics();
  private readonly particles = new Graphics();
  private readonly flash = new Graphics();
  private readonly cycloneLayer = new Container();
  private readonly cyclones = new DisplayObjectIndex<TyphoonDisplay>();
  constructor(private readonly assets: GameAssets, private readonly mobile = false) {
    this.screen.addChild(this.particles, this.flash);
    this.world.addChild(this.worldEffects, this.cycloneLayer);
  }
  sync(weather: WeatherView | undefined, camera: CameraTransform): void {
    this.worldEffects.clear(); this.particles.clear(); this.flash.clear();
    this.screen.visible = !!weather; this.world.visible = !!weather;
    this.cyclones.sync(weather?.typhoons ?? [], () => this.cycloneLayer.addChild(new TyphoonDisplay()),
      (display, cyclone) => display.sync(cyclone, weather!.elapsed, this.assets));
    if (!weather) return;
    const time = weather.elapsed;
    const { width, height } = camera;
    const strength = Math.max(0, Math.min(1, weather.strength));
    this.world.alpha = strength; this.particles.alpha = strength;
    if (weather.id === 'rain' || weather.id === 'typhoon') {
      const count = this.mobile ? weather.id === 'typhoon' ? 47 : 32 : weather.id === 'typhoon' ? 95 : 65;
      for (let i = 0; i < count; i++) {
        const x = ((i * 143.13 - time * 165) % (width + 100) + width + 100) % (width + 100) - 50;
        const y = (i * 83.7 + time * 550) % (height + 60) - 30;
        this.particles.moveTo(x, y).lineTo(x - 7, y + 19);
      }
      this.particles.stroke({ color: 0xb9dcff, alpha: .36, width: 1 });
    }
    if (weather.id === 'breeze' || weather.id === 'calm') {
      for (let i = 0; i < (this.mobile ? 18 : 36); i++) {
        const x = (i * 123.3 + time * 35) % (width + 30) - 15;
        const y = (i * 87.4 + Math.sin(time + i) * 25) % height;
        this.particles.ellipse(x, y, 3 + i % 3, 1.7).fill({ color: i % 3 ? 0xffbbd8 : 0xd0f7ce, alpha: .5 });
      }
    }
    if (weather.id === 'clear' || weather.id === 'scorch' || weather.id === 'bloodMoon') {
      const cx = width * .83, cy = height * .16;
      for (let i = 4; i > 0; i--) this.particles.circle(cx, cy, 25 + i * 13).fill({ color: weather.id === 'bloodMoon' ? 0xec243d : 0xffdd83, alpha: .012 * (5 - i) });
      this.particles.circle(cx, cy, weather.id === 'bloodMoon' ? 30 : 22).fill({ color: weather.id === 'bloodMoon' ? 0xc83e55 : 0xffe9a8, alpha: .65 });
    }
    for (const meteor of weather.meteors) {
      const p = Math.max(0, Math.min(1, meteor.progress));
      this.worldEffects.circle(meteor.x, meteor.y, meteor.radius).fill({ color: 0xff4e25, alpha: .06 + p * .13 }).stroke({ color: 0xffaf67, alpha: .35 + p * .55, width: 2 });
      this.worldEffects.circle(meteor.x, meteor.y, meteor.radius * (1.7 - p * .7)).stroke({ color: 0xffb16b, alpha: .35, width: 1.5 });
      if (p > .45) {
        const falling = Math.min(1, (p - .45) / .55), remaining = 1 - falling * falling;
        const offsetX = (meteor.side ?? 1) * 520 * remaining, offsetY = -760 * remaining;
        for (let i = 9; i >= 0; i--) {
          const f = i / 10;
          this.worldEffects.circle(meteor.x + offsetX + (meteor.side ?? 1) * f * 95, meteor.y + offsetY - f * 140, 14 * (1 - f * .8))
            .fill({ color: i < 2 ? 0xffe8ad : 0xff5b25, alpha: .6 * (1 - f) });
        }
      }
    }
    for (const zone of weather.burnZones) {
      this.worldEffects.circle(zone.x, zone.y, zone.radius).fill({ color: 0xfc4d17, alpha: zone.alpha * .13 });
      for (let i = 0; i < 8; i++) {
        const a = i * 2.39996 + time * .4, r = zone.radius * Math.sqrt((i + 1) / 8);
        const rise = ((time * 25 + i * 12) % 26);
        this.worldEffects.ellipse(zone.x + Math.cos(a) * r, zone.y + Math.sin(a) * r - rise, 2, 5).fill({ color: 0xffb843, alpha: zone.alpha * (1 - rise / 26) });
      }
    }
    for (const cloud of weather.fogClouds ?? []) {
      for (let i = 3; i > 0; i--) this.worldEffects.circle(cloud.x, cloud.y, cloud.radius * (.55 + i * .15)).fill({ color: 0xd8e4f0, alpha: .025 });
      this.worldEffects.circle(cloud.x, cloud.y, cloud.radius).stroke({ color: 0xe6eff7, alpha: .14, width: 1 });
    }
    if (weather.id === 'fog' || weather.id === 'riverFog') {
      for (let i = 0; i < (this.mobile ? 6 : 12); i++) {
        const x = ((i * 197 + time * 13) % (width + 300)) - 150;
        const y = ((i * 173 - time * 5) % (height + 200) + height + 200) % (height + 200) - 100;
        this.particles.ellipse(x, y, 190, 55).fill({ color: 0xd7e4eb, alpha: .026 });
      }
    }
    if (weather.flash > 0) this.flash.rect(0, 0, width, height).fill({ color: 0xffffff, alpha: Math.min(.65, weather.flash * 4) });
  }
  dispose(): void { this.cyclones.dispose(); this.world.destroy({ children: true, context: true }); this.screen.destroy({ children: true, context: true }); }
}
