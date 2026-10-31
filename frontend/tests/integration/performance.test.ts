import { describe, expect, it } from 'vitest';
import { createPerformanceProfile } from '../../src/app/performance';

describe('bounded runtime timing observations', () => {
  it('reports nearest-rank percentiles for a bounded recent window without retaining every sample', () => {
    const profile = createPerformanceProfile(() => 0, 4);
    for (const value of [100, 1, 2, 3, 4]) profile.record('simulation', value);
    profile.record('simulation', NaN); profile.record('simulation', -1);
    expect(profile.snapshot(true).timings.simulation).toEqual({ totalSamples: 5, windowSamples: 4,
      meanMs: 2.5, p50Ms: 2, p95Ms: 4, p99Ms: 4, maxMs: 4 });
  });
  it('uses RAF timestamps rather than measuring CPU submission as a frame or GPU duration', () => {
    let now = 0;
    const profile = createPerformanceProfile(() => now);
    const counts = { actors: 4, projectiles: 500, effects: 20, pickups: 50 };
    profile.frame('playing', counts, 0);
    now = 500; profile.frame('playing', counts, 16);
    now = 900; profile.frame('playing', { ...counts, projectiles: 100 }, 80);
    profile.dropped(.2);
    const result = profile.snapshot(true);
    expect(result.timings.frameInterval.meanMs).toBe(40);
    expect(result.longFramesOver50ms).toBe(1);
    expect(result.timings.renderSubmit.totalSamples).toBe(0);
    expect(result.peakEntities.projectiles).toBe(500);
    expect(result.phases.playing).toBe(3);
    expect(result.droppedSimulationSeconds).toBe(.2);
    expect(result.limitation).toContain('not GPU execution time');
  });
  it('excludes a background gap after clock reset and throttles diagnostic percentile calculation', () => {
    let now = 0;
    const profile = createPerformanceProfile(() => now);
    const counts = { actors: 1, projectiles: 0, effects: 0, pickups: 0 };
    profile.frame('playing', counts);
    const first = profile.snapshot();
    profile.resetFrameClock(); now = 100_000; profile.frame('paused', counts);
    expect(profile.snapshot().timings.frameInterval.totalSamples).toBe(0);
    profile.record('projection', 2);
    const cached = profile.snapshot();
    expect(cached).not.toBe(first);
    expect(profile.snapshot()).toBe(cached);
    expect(profile.snapshot(true).timings.projection.totalSamples).toBe(1);
  });
});
