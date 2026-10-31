import { Graphics, Sprite, type Texture } from 'pixi.js';
import type { GameAssets } from '../assets';
import { starPolygons } from './materials';

export function syncArt(sprite: Sprite, assets: GameAssets, file: string, width: number, height?: number): boolean {
  void assets.requestFile(file);
  const texture = assets.getFile(file);
  sprite.visible = !!texture;
  if (!texture) return false;
  sprite.texture = texture;
  fitSprite(sprite, texture, width, height);
  return true;
}
export function fitSprite(sprite: Sprite, texture: Texture, width: number, height?: number): void {
  sprite.width = width; sprite.height = height ?? width * texture.height / texture.width;
}
export function magicSigil(graphic: Graphics, vertices: number, step: number, radius: number, color: string): void {
  graphic.clear().circle(0, 0, radius).circle(0, 0, radius * .93).stroke({ color, alpha: .75, width: 1.8 });
  for (const path of starPolygons(vertices, step, radius * .82)) graphic.poly([...path], true).stroke({ color, alpha: .9, width: 2 });
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2;
    graphic.moveTo(Math.cos(a) * radius * .94, Math.sin(a) * radius * .94)
      .lineTo(Math.cos(a) * radius * .99, Math.sin(a) * radius * .99);
  }
  graphic.stroke({ color, alpha: .8, width: 2 });
}
export function zigzagBlade(graphic: Graphics, x1: number, y1: number, x2: number, y2: number, seed: number, alpha: number): void {
  let state = seed >>> 0;
  const random = () => { state = Math.imul(state, 1664525) + 1013904223 | 0; return (state >>> 0) / 4294967296; };
  const dx = x2 - x1, dy = y2 - y1, distance = Math.hypot(dx, dy) || 1;
  graphic.moveTo(x1, y1);
  for (let i = 1; i < 12; i++) {
    const jitter = (random() - .5) * 18;
    graphic.lineTo(x1 + dx * i / 12 - dy / distance * jitter, y1 + dy * i / 12 + dx / distance * jitter);
  }
  graphic.lineTo(x2, y2).stroke({ color: 0x38cfff, width: 7, alpha: alpha * .16 });
  graphic.moveTo(x1, y1).lineTo(x2, y2).stroke({ color: 0xd8ffff, width: 1.3, alpha });
}
