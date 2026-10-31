import { Container, Graphics } from 'pixi.js';
import type { MazeView } from '../game';
/** Static maze geometry is rebuilt only when its measured source changes. */
export class MazeDisplay extends Container {
  private readonly floor = new Graphics();
  private readonly walls = new Graphics();
  private readonly lamps = new Graphics();
  private signature = '';
  constructor() { super(); this.addChild(this.floor, this.walls, this.lamps); }
  sync(view: MazeView | undefined, time: number): void {
    this.visible = !!view;
    if (!view) return;
    const signature = JSON.stringify(view);
    if (signature !== this.signature) {
      this.signature = signature;
      const p = view.plaza, b = view.bounds;
      this.floor.clear().roundRect(p.x, p.y, p.width, p.height, 26).fill(0x9db8cc).stroke({ color: 0x1e3250, width: 5, alpha: .9 });
      for (let x = Math.ceil(p.x / 64) * 64; x < p.x + p.width; x += 64) this.floor.moveTo(x, p.y).lineTo(x, p.y + p.height);
      for (let y = Math.ceil(p.y / 64) * 64; y < p.y + p.height; y += 64) this.floor.moveTo(p.x, y).lineTo(p.x + p.width, y);
      this.floor.stroke({ color: 0x2e4a68, width: 1.4, alpha: .38 }).rect(b.x, b.y, b.width, b.height).fill({ color: 0x284e76, alpha: .3 });
      this.walls.clear();
      // All wall shadows/outlines precede all fills, avoiding exposed overlap seams.
      for (const wall of view.walls) this.walls.rect(wall.x + 6, wall.y + 9, wall.width ?? 0, wall.height ?? 0).fill({ color: 0x0e1e3a, alpha: .25 });
      for (const wall of view.walls) this.walls.rect(wall.x, wall.y, wall.width ?? 0, wall.height ?? 0).stroke({ color: 0x2b4a6c, width: 4 });
      for (const wall of view.walls) this.walls.rect(wall.x, wall.y, wall.width ?? 0, wall.height ?? 0).fill(0x9fc5e0);
      for (const wall of view.walls) {
        const w = wall.width ?? 0, h = wall.height ?? 0;
        if (w > 8 && h > 8) this.walls.rect(wall.x + 3, wall.y + 3, w - 6, h - 6).fill(0xd6eefb);
        if (w > h) this.walls.moveTo(wall.x + 6, wall.y + h / 2).lineTo(wall.x + w - 6, wall.y + h / 2);
        else this.walls.moveTo(wall.x + w / 2, wall.y + 6).lineTo(wall.x + w / 2, wall.y + h - 6);
      }
      this.walls.stroke({ color: 0xffffff, width: 1.6, alpha: .75 });
    }
    this.lamps.clear();
    for (const [point, color] of [[view.entry, 0x7dffb0], [view.exit, 0xffd070]] as const) {
      const pulse = .75 + Math.sin(time * 2.4 + point.x * .01) * .25;
      for (let i = 8; i > 0; i--) this.lamps.circle(point.x, point.y, 9 + i * 5).fill({ color, alpha: pulse * .009 });
      this.lamps.circle(point.x, point.y, 9 + 2 * pulse).fill({ color, alpha: .5 * pulse }).circle(point.x, point.y, 3.2).fill({ color: 0xffffff, alpha: .9 });
    }
  }
  override destroy(): void { super.destroy({ children: true, context: true }); }
}
