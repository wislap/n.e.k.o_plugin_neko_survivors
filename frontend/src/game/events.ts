export type GameEvent =
  | { type: 'sound'; name: string; heavy?: boolean; volume?: number; playbackRate?: number; duration?: number }
  | { type: 'weapon-sound'; kind: string; behavior: string; tier: number; heavy: boolean }
  | { type: 'music'; scene: 'title' | 'stage' | 'boss' | 'shop' | 'result'; wave?: number; track?: string; stop?: boolean; position?: number; volume?: number }
  | { type: 'notice'; text: string; tone: 'info' | 'good' | 'bad' }
  | { type: 'speech'; text: string; key: string }
  | { type: 'report'; event: string; text: string }
  | { type: 'avatar-emotion'; emotion: 'happy' | 'sad' | 'surprised' }
  | { type: 'checkpoint' }
  | { type: 'attempt-restarted' }
  | { type: 'run-ended'; won: boolean; wave: number };

export interface StepResult {
  events: readonly GameEvent[];
  uiChanged: boolean;
}
