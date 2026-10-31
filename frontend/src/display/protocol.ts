import type { GameFrame } from '../game';
import type { GameRenderer } from '../rendering';
import type { PresentationProfile,PlayerSoftQuality } from '../presentation/profile';
import type { FrameCapture } from '../diagnostics/frame-capture';
import type { SimulationStats } from '../simulation/protocol';

export interface RenderStatus {
  viewCamera: { x: number; y: number; zoom: number; width: number; height: number };
  frame: Pick<GameFrame, 'camera' | 'tick' | 'phase' | 'combat' | 'hud' | 'hudChrome'>;
  counts: { actors: number; projectiles: number; effects: number; pickups: number };
  diagnostics: GameRenderer['diagnostics'];
  revision: number;
  step: number;
  stateAt: number;
  producedAt: number;
  renderedFrames: number;
  stats: SimulationStats;
}
export type RenderInput =
  | { kind: 'initialize'; canvas: OffscreenCanvas; port: MessagePort; width: number; height: number;
      presentation: Readonly<PresentationProfile>; assetBaseUrl: string }
  | { kind: 'resize'; width: number; height: number }
  | { kind: 'opacity'; value: number }
  | { kind: 'soft-quality';value:PlayerSoftQuality }
  | { kind: 'visible'; visible: boolean }
  | { kind: 'dispose' }
  | { kind: 'capture-start'; id: number; context: Record<string, unknown>; stats: SimulationStats }
  | { kind: 'capture-stop'; id: number }
  | { kind: 'gpu-timing'; enabled: boolean }
  | { kind: 'probe-context'; lost: boolean };
export type RenderOutput =
  | { kind: 'ready'; diagnostics: GameRenderer['diagnostics'] }
  | { kind: 'status'; status: RenderStatus }
  | { kind: 'failure'; message: string }
  | { kind: 'receipt'; id: number; capture?: FrameCapture; error?: string };
