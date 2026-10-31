import type { WeatherSystem } from './weather.ts';
import type { CometDisaster } from './comet.ts';
import type { WeatherView, CometView } from '../views.ts';

export function projectWeather(weather: WeatherSystem | null | undefined): WeatherView | undefined {
  if (!weather) return undefined;
  return {
    id: weather.id ?? '', strength: Math.min(1, weather.visT / (weather.def?.rampS || 1)) * weather.visualAlpha,
    elapsed: weather.visT, flash: weather.flash, fogStrength: weather.fogRamp,
    meteors: weather.meteors.map((meteor, id) => ({ id: `meteor-${id}`, x: meteor.x, y: meteor.y, radius: meteor.r, side: meteor.side, progress: Math.max(0, 1 - meteor.warnT) })),
    burnZones: weather.burnZones.map((zone, id) => ({ id: `burn-${id}`, x: zone.x, y: zone.y, radius: zone.r, alpha: Math.max(0, zone.t / zone.max) })),
    typhoons: weather.typhoons.map((typhoon, id) => ({ id: `typhoon-${id}`, x: typhoon.x, y: typhoon.y, radius: typhoon.r, angle: weather.visT * typhoon.spin })),
    fogClouds: weather.fogClouds.map((cloud, id) => ({ id: `fog-cloud-${id}`, x: cloud.x, y: cloud.y, radius: cloud.r })),
  };
}

/** Disaster phases have their own duration and world-freeze semantics. */
export function projectComet(comet: CometDisaster | null | undefined): CometView | undefined {
  if (!comet || comet.phase === 'idle' && !comet.pending) return undefined;
  return {
    phase: comet.phase, time: comet.t, age: comet.age, direction: comet.dir,
    center: { x: comet.cx, y: comet.cy }, halfSize: comet.half, flash: comet.flash,
    bolts: comet.bolts.map(bolt => ({ x: bolt.x, y: bolt.y, landY: bolt.landY, radius: bolt.r,
      vy: bolt.vy, elapsed: bolt.t, landed: bolt.landed, exploded: !!bolt.second, seed: bolt.seed })),
    rings: comet.rings.map(ring => ({ x: ring.x, y: ring.y, radius: ring.rMax,
      elapsed: ring.t, duration: ring.life, delay: ring.delay ?? 0, kind: ring.kind ?? 'roar', warm: ring.kind === 'bolt' || !!ring.warm })),
    trails: comet.trail.map(trail => ({ x: trail.x, y: trail.y, radius: trail.r, alpha: Math.max(0, 1 - trail.t / trail.life) })),
  };
}
