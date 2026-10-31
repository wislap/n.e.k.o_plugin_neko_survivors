import { Graphics } from 'pixi.js';
import type { TerrainView } from '../game';
const COLORS = { ice: 0x8cd9ef, wall: 0x363946, tree: 0x3f614b };
/** Draw the rule-owned obstacle geometry, preserving the tiled art underneath. */
export class TerrainDisplay extends Graphics {
  private signature = '';
  sync(view: TerrainView): void {
    const signature = JSON.stringify(view);
    if (signature === this.signature) return;
    this.signature = signature; this.clear();
    this.position.set(view.x, view.y); this.alpha = view.alpha ?? 1;
    if (view.kind === 'rect') this.rect(0, 0, view.width ?? 0, view.height ?? 0);
    else if (view.kind === 'circle') this.circle(0, 0, view.radius ?? 0);
    const color = COLORS[view.material];
    this.fill({ color, alpha: view.material === 'ice' ? .22 : .1 }).stroke({ color, alpha: .8, width: view.material === 'ice' ? 2.2 : 2 });
    if (view.material === 'ice' && view.kind === 'rect') {
      const w = view.width ?? 0, h = view.height ?? 0;
      this.moveTo(3, 3).lineTo(w - 3, 3).lineTo(w - 3, h - 3).stroke({ color: 0xe6ffff, alpha: .45, width: 1 });
    }
  }
}
