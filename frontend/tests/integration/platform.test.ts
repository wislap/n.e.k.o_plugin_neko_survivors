import { expect, it } from 'vitest';
import { detectPlatform } from '../../src/app/platform';

it('uses legacy mobile detection and bounds device pixel density without affecting desktop', () => {
  expect(detectPlatform({ userAgent: 'Linux Chrome', devicePixelRatio: 3 })).toEqual({ platform: 'desktop', mobile: false, resolution: 2, displayFps: undefined });
  for (const userAgent of ['Android', 'iPhone', 'iPad', 'iPod', 'Silk Mobile']) {
    expect(detectPlatform({ userAgent, devicePixelRatio: 3 })).toEqual({ platform: 'mobile', mobile: true, resolution: 1, displayFps: 30 });
  }
  expect(detectPlatform({ nativeMobile: true, devicePixelRatio: 1.5 }).platform).toBe('mobile');
  expect(detectPlatform({ userAgent: 'Android', devicePixelRatio: .75 }).resolution).toBe(.75);
  for (const devicePixelRatio of [NaN, Infinity, 0, -1]) expect(detectPlatform({ devicePixelRatio }).resolution).toBe(1);
});
