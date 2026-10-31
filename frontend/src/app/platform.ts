import type { GamePlatform } from '../game';

interface Environment {
  userAgent?: string;
  nativeMobile?: boolean;
  devicePixelRatio?: number;
}
/** Match the legacy mobile UA/native shell policy without browser reads in rules. */
export function detectPlatform(environment: Environment = {
  userAgent: globalThis.navigator?.userAgent,
  nativeMobile: typeof window !== 'undefined' && !!(window as Window & {
    Capacitor?: { isNativePlatform?(): boolean };
  }).Capacitor?.isNativePlatform?.(),
  devicePixelRatio: globalThis.devicePixelRatio,
}) {
  const mobile = !!environment.nativeMobile || /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(environment.userAgent ?? '');
  const platform: GamePlatform = mobile ? 'mobile' : 'desktop';
  const dpr = environment.devicePixelRatio;
  return Object.freeze({ platform, mobile, resolution: Math.min(typeof dpr === 'number' && dpr > 0 && Number.isFinite(dpr) ? dpr : 1, mobile ? 1 : 2),
    displayFps: mobile ? 30 : undefined });
}
