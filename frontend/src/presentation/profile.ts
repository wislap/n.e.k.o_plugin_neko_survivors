export type PlayerSoftQuality='native'|'balanced';
/** One application-owned presentation choice shared by every display consumer. */
export interface PresentationProfile {
  readonly mobile: boolean;
  readonly resolution: number;
  readonly displayFps?: number;
}
/** Explicit deterministic profile for development fixtures and desktop previews. */
export const DESKTOP_PRESENTATION: Readonly<PresentationProfile> = Object.freeze({ mobile: false, resolution: 1 });
