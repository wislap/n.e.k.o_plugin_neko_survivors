import type { ActorView, Point } from '../game';
import type { CameraTransform } from './camera';
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export function projectToScreen(point: Point, camera: CameraTransform): Point {
  return { x: (point.x - camera.x) * camera.zoom + camera.width / 2, y: (point.y - camera.y) * camera.zoom + camera.height / 2 };
}
export function offscreenMarker(actor: ActorView, camera: CameraTransform, top = 80) {
  const screen = projectToScreen(actor, camera), margin = 58;
  const bottom = Math.max(top, camera.height - 165), right = Math.max(margin, camera.width - margin);
  if (screen.x >= margin && screen.x <= right && screen.y >= top && screen.y <= bottom) return undefined;
  const x = clamp(screen.x, margin, right), y = clamp(screen.y, top, bottom);
  return { x, y, angle: Math.atan2(screen.y - y, screen.x - x) };
}
/** Text layout stays in screen pixels even when the world camera zooms out. */
export function bubbleLayout(text: string) {
  const maxWidth = 254, lines: string[] = []; let line = '', width = 0, widest = 0;
  for (const character of [...text]) {
    const size = /[\u0000-\u007f]/.test(character) ? 7.3 : 13;
    if (character === '\n' || width + size > maxWidth) { lines.push(line); widest = Math.max(widest, width); line = ''; width = 0; if (character === '\n') continue; }
    line += character; width += size;
  }
  lines.push(line); widest = Math.max(widest, width);
  return { lines, width: Math.max(48, widest + 26), height: lines.length * 19.5 + 18 };
}
