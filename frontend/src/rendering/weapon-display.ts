import { Container, Graphics } from 'pixi.js';
import type { ActorView, WeaponView } from '../game';

/** Rule snapshots own the 35ms trail samples; rendering never records another history. */
export class WeaponDisplay extends Container {
  private readonly tether = new Graphics();
  private readonly trail = new Graphics();
  private readonly body = new Graphics();
  private readonly arc = new Graphics();
  constructor(mobile: boolean) {
    super(); this.trail.blendMode = 'normal'; this.body.blendMode = 'normal'; this.tether.blendMode = mobile ? 'normal' : 'add'; this.arc.blendMode = mobile ? 'normal' : 'add';
    this.addChild(this.tether, this.trail, this.arc, this.body);
  }
  sync(view: WeaponView, owner?: ActorView, time = 0): void {
    this.position.set(view.x, view.y); this.alpha = view.alpha ?? 1;
    this.tether.clear(); this.trail.clear(); this.arc.clear(); this.body.clear();
    const r = view.radius, age = owner?.age ?? time;
    if (owner) {
      const dx = view.x - owner.x, dy = view.y - owner.y, distance = Math.hypot(dx, dy) || 1;
      const sway = Math.sin(age * 9 + view.ballIndex * 2.4) * distance * .12;
      this.tether.moveTo(-dx, -dy).quadraticCurveTo(-dx / 2 - dy / distance * sway, -dy / 2 + dx / distance * sway, 0, 0)
        .stroke({ color: 0xffd23a, alpha: .42, width: 2 });
      if (view.orbitRadius) {
        const angle = Math.atan2(dy, dx);
        for (let i = 0; i < 6; i++) {
          const fraction = 1 - i / 6;
          this.arc.arc(-dx, -dy, view.orbitRadius, angle - (i + 1) * 1.05 / 6, angle - i * 1.05 / 6)
            .stroke({ color: view.color, alpha: fraction * fraction * .3, width: r * 1.35 * fraction + .4, cap: 'round' });
        }
      }
    }
    for (let i = 0; i < view.trail.length; i++) {
      const point = view.trail[i], fraction = (i + 1) / (view.trail.length + 1);
      this.trail.circle(point.x - view.x, point.y - view.y, r * (.45 + fraction * .5))
        .fill({ color: view.color, alpha: fraction * .3 });
    }
    this.body.circle(0, 0, r).fill(view.color);
    // Three rotated half-ellipses give the reference yarn its rolling strands.
    for (let strand = 0; strand < 3; strand++) {
      const rotation = age * 6 + strand * 2.1, ca = Math.cos(rotation), sa = Math.sin(rotation);
      for (let step = 0; step <= 20; step++) {
        const angle = .3 + step / 20 * (Math.PI - .6), x = Math.cos(angle) * r * .72, y = Math.sin(angle) * r * (.26 + strand * .14);
        const px = x * ca - y * sa, py = x * sa + y * ca;
        if (step === 0) this.body.moveTo(px, py); else this.body.lineTo(px, py);
      }
      this.body.stroke({ color: 0x966610, alpha: .75, width: Math.max(1, r * .14), cap: 'round' });
    }
    this.body.circle(-r * .32, -r * .34, r * .22).fill({ color: 0xffffff, alpha: .8 });
  }
  override destroy(): void { super.destroy({ children: true, context: true }); }
}
