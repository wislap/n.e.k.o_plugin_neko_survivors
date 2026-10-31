import type { GameFrame, Point } from '../game';
export interface CameraTransform { x: number; y: number; zoom: number; width: number; height: number }
export function cameraTransform(frame: Pick<GameFrame,'camera'|'tick'>, width: number, height: number): CameraTransform {
  const shake = frame.camera.shake ?? 0;
  return {
    x: frame.camera.x + Math.sin(frame.tick * 2.3) * shake,
    y: frame.camera.y + Math.cos(frame.tick * 1.7) * shake,
    zoom: Math.max(0.05, frame.camera.zoom), width, height,
  };
}
export function screenToWorld(camera: CameraTransform, x: number, y: number): Point {
  return { x: (x - camera.width / 2) / camera.zoom + camera.x, y: (y - camera.height / 2) / camera.zoom + camera.y };
}
