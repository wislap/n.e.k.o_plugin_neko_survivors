export interface AudioSettings { master: number; music: number; sfx: number; enabled: boolean }
export interface AudioIssueSummary { reason: string; recoverable: boolean; waitingForGesture: boolean; resource?: string }

/** Audio output request, structurally compatible with a game's music event. */
export interface AudioMusicCue {
  type?: 'music';
  scene?: 'title' | 'stage' | 'boss' | 'shop' | 'result';
  wave?: number;
  track?: string;
  stop?: boolean;
  position?: number;
  volume?: number;
}
