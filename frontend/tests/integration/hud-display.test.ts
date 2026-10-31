import { describe, expect, it } from 'vitest';
import { createHudDisplay } from '../../src/app/hud-display';
import { createDisplayLoop, type AnimationDriver } from '../../src/display/loop';
import type { HudDisplaySample } from '../../src/app/hud-display';

const sample = (timestampMs: number): HudDisplaySample => ({ timestampMs, combat: true,
  hud: { hp: 40, maxHp: 50, shield: 8, xp: 4, xpNeeded: 10, level: 2 } });
function clockDriver() {
  let callback: FrameRequestCallback | undefined;
  return {
    request(next) { callback = next; return 1; },
    cancel() { callback = undefined; },
    fire(now: number) { const current = callback; callback = undefined; current?.(now); },
    get pending() { return callback !== undefined; },
  } satisfies AnimationDriver & { fire(now: number): void; readonly pending: boolean };
}

describe('HUD display ownership', () => {
  it('uses the sole display loop once per display frame, independently of simulation scheduling', () => {
    const driver = clockDriver(), received: HudDisplaySample[] = [];
    const hud = createHudDisplay(error => { throw error; });
    let timestamp = 0;
    hud.display.connect(value => received.push(value));
    const loop = createDisplayLoop({ driver, onFrame: now => { timestamp = now; },
      render: () => hud.publish(sample(timestamp)) });
    loop.start(); driver.fire(0); driver.fire(5); driver.fire(50);
    expect(received.map(value => value.timestampMs)).toEqual([0, 5, 50]);
    expect(received.map(value => value.resetClock)).toEqual([true, undefined, undefined]);
    loop.stop(); hud.dispose(); expect(driver.pending).toBe(false);
  });

  it('copies only the six live scalars and never exposes the cached object for mutation', () => {
    const hud = createHudDisplay(error => { throw error; });
    const input = { ...sample(16), hud: { ...sample(16).hud! }, actors: [{ id: 1 }] };
    hud.publish(input);
    input.hud!.hp = 1;
    let received: HudDisplaySample | undefined;
    hud.display.connect(value => { received = value; });
    expect(received).toEqual({ ...sample(16), resetClock: true });
    expect(Object.keys(received!.hud!)).toEqual(['hp', 'maxHp', 'shield', 'xp', 'xpNeeded', 'level']);
    expect(Object.isFrozen(received!.hud)).toBe(true);
  });

  it('an old unsubscribe cannot detach a new owner, including the same callback identity', () => {
    const hud = createHudDisplay(error => { throw error; });
    const calls: number[] = [], paint = (value: HudDisplaySample) => calls.push(value.timestampMs);
    const old = hud.display.connect(paint), current = hud.display.connect(paint);
    old(); old(); hud.publish(sample(20));
    expect(calls).toEqual([20]);
    current(); current(); hud.publish(sample(30)); expect(calls).toEqual([20]);
    const last = hud.display.connect(paint);
    expect(calls).toEqual([20, 30]);
    hud.dispose(); hud.dispose(); hud.publish(sample(40)); last();
    hud.display.connect(paint); expect(calls).toEqual([20, 30]);
  });

  it('suppresses hidden delivery without discarding the wall-clock gap on resume', () => {
    const received: HudDisplaySample[] = [], hud = createHudDisplay(error => { throw error; });
    hud.display.connect(value => received.push(value));
    hud.publish(sample(100)); hud.setVisible(false); hud.publish(sample(5000));
    hud.setVisible(true); expect(received).toHaveLength(1);
    hud.publish(sample(10000));
    expect(received[1].resetClock).toBeUndefined();
    expect(Math.min(.1, (received[1].timestampMs - received[0].timestampMs) / 1000)).toBe(.1);
    hud.publish({ ...sample(10016), combat: false });
    hud.publish({ ...sample(10032), combat: false });
    expect(received.slice(-2).map(value => value.combat)).toEqual([false, false]);
  });

  it('a new leaf resets its own clock exactly once and cleared sessions never replay stale values', () => {
    const hud = createHudDisplay(error => { throw error; });
    hud.publish(sample(20));
    const received: HudDisplaySample[] = [];
    hud.display.connect(value => received.push(value)); hud.publish(sample(36));
    expect(received.map(value => value.resetClock)).toEqual([true, undefined]);
    hud.clearSample();
    const next: HudDisplaySample[] = [];
    hud.display.connect(value => next.push(value)); expect(next).toHaveLength(0);
    hud.publish(sample(52)); expect(next[0].resetClock).toBe(true);
  });

  it('HUD exceptions are reported without stopping the display clock or subsequent combat steps', () => {
    const failures = new Map<string, string>(), driver = clockDriver();
    const hud = createHudDisplay(error => failures.set('hud', (error as Error).message));
    const error = new Error('SVG paint failed'); let displays = 0;
    hud.display.connect(() => { throw error; });
    const loop = createDisplayLoop({ driver, render: () => { displays++; hud.publish(sample(0)); } });
    loop.start(); driver.fire(0); driver.fire(50); driver.fire(100);
    expect(displays).toBe(3); expect(failures.size).toBe(1); expect(failures.get('hud')).toBe(error.message);
    expect(loop.running).toBe(true); loop.stop(); hud.dispose();
  });
});
