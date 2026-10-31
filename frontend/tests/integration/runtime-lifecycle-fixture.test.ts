import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';

const fixture = readFileSync(resolve(import.meta.dirname, '../e2e/runtime-lifecycle-fixture.html'), 'utf8');
const observerSource = fixture.slice(fixture.indexOf('    function installObservers() {'), fixture.indexOf('    function contextState('));
function setup() {
  let nextId = 0;
  const pending = new Map<number, { callback: (...args: unknown[]) => unknown; args: unknown[]; interval: boolean }>();
  function schedule(interval: boolean, callback: (...args: unknown[]) => unknown, _delay?: number, ...args: unknown[]) {
    const id = ++nextId; pending.set(id, { callback, args, interval }); return id;
  }
  const window = Object.assign(new EventTarget(), {
    setTimeout: schedule.bind(null, false), setInterval: schedule.bind(null, true),
    clearTimeout(id: number) { pending.delete(id); }, clearInterval(id: number) { pending.delete(id); },
    requestAnimationFrame(callback: (...args: unknown[]) => unknown) { return schedule(false, callback, 0, 123.456); },
    cancelAnimationFrame(id: number) { pending.delete(id); },
  });
  const originals = { ...window };
  const context = createContext({ window, document: new EventTarget() });
  runInContext(`${observerSource}\nglobalThis.observer = installObservers();`, context, { filename: 'http://qa/tests/e2e/runtime-lifecycle-fixture.html' });
  const app = (source: string) => runInContext(source, context, { filename: 'http://qa/src/app/fixture-observer-test.ts' });
  return { window, context, originals, app, pending, snapshot: () => runInContext('observer.snapshot()', context),
    fire(id: number) { const timer = pending.get(id)!; if (!timer.interval) pending.delete(id); return Reflect.apply(timer.callback, window, timer.args); },
    restore() { runInContext('observer.restore()', context); },
  };
}

describe('lifecycle fixture observation transparency', () => {
  it('preserves native timer IDs/arguments and cross-cancellation while counting only pending App work', () => {
    const s = setup();
    try {
      const first = s.app("globalThis.values = []; window.setTimeout(function(...args) { values.push(this === window, ...args); }, 25, 'hello', 17)");
      expect(s.snapshot().pendingApplicationTimers).toBe(1);
      expect(s.pending.get(first)?.args).toEqual(['hello', 17]); s.fire(first);
      expect(Array.from(s.app('values'))).toEqual([true, 'hello', 17]); expect(s.snapshot().pendingApplicationTimers).toBe(0);
      s.app("globalThis.intervalId = window.setInterval(() => {}, 30); window.clearTimeout(intervalId)");
      s.app("globalThis.timeoutId = window.setTimeout(() => {}, 30); window.clearInterval(timeoutId)");
      expect(s.snapshot().pendingApplicationTimers).toBe(0); expect(s.pending.size).toBe(0);
      expect(s.snapshot().timerCancelled).toBe(2);
    } finally { s.restore(); }
    for (const name of ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] as const) expect(s.window[name]).toBe(s.originals[name]);
  });
  it('does not suppress callback errors, change RAF timestamps, or count the fixture own scheduling', () => {
    const s = setup();
    try {
      const own = runInContext('window.setTimeout(() => {}, 5)', s.context, { filename: 'http://qa/tests/e2e/runtime-lifecycle-fixture.html' });
      expect(s.snapshot().pendingApplicationTimers).toBe(0); s.fire(own);
      const frame = s.app('window.requestAnimationFrame(timestamp => { globalThis.timestamp = timestamp; })');
      expect(s.snapshot().pendingApplicationRaf).toBe(1); s.fire(frame);
      expect(s.app('timestamp')).toBe(123.456); expect(s.snapshot().pendingApplicationRaf).toBe(0);
      const bad = s.app("window.setTimeout(() => { throw new Error('native callback error'); }, 5)");
      expect(() => s.fire(bad)).toThrow('native callback error'); expect(s.snapshot().pendingApplicationTimers).toBe(0);
    } finally { s.restore(); }
  });
});

function frameDeadlineSetup() {
  let nextId = 0, now = 100;
  const rafs = new Map<number, (timestamp: number) => void>(), timers = new Map<number, () => void>();
  const cancelledRafs: number[] = [], clearedTimers: number[] = [];
  const window = {
    requestAnimationFrame(callback: (timestamp: number) => void) { const id = ++nextId; rafs.set(id, callback); return id; },
    cancelAnimationFrame(id: number) { cancelledRafs.push(id); rafs.delete(id); },
    setTimeout(callback: () => void) { const id = ++nextId; timers.set(id, callback); return id; },
    clearTimeout(id: number) { clearedTimers.push(id); timers.delete(id); },
  };
  const source = fixture.slice(fixture.indexOf('    const nativeRequest ='), fixture.indexOf('    function show('));
  const context = createContext({ window, performance: { now: () => now } });
  runInContext(source, context);
  return { window, rafs, timers, cancelledRafs, clearedTimers,
    wait: () => runInContext("nextFrame(150, 'display wait')", context) as Promise<number>,
    fireTimer(id: number) { now = 150; const callback = timers.get(id)!; timers.delete(id); callback(); },
    fireRaf(id: number) { now = 120; const callback = rafs.get(id)!; rafs.delete(id); callback(123.456); },
  };
}

describe('fixture RAF waits have independent native deadlines', () => {
  it('rejects and cancels a pending fixture RAF when no frame callback ever arrives', async () => {
    const s = frameDeadlineSetup();
    s.window.cancelAnimationFrame = () => { throw new Error('observed cancel must be bypassed'); };
    s.window.clearTimeout = () => { throw new Error('observed clear must be bypassed'); };
    const waiting = s.wait();
    const settled = waiting.then(value => ({ value }), error => ({ error }));
    expect(s.timers.size).toBe(1); expect(s.rafs.size).toBe(1);
    const frameId = [...s.rafs.keys()][0]; s.fireTimer([...s.timers.keys()][0]);
    const result = await settled;
    expect('error' in result && result.error.message).toContain('NOT_VERIFIED');
    expect(s.cancelledRafs).toContain(frameId); expect(s.rafs.size).toBe(0); expect(s.timers.size).toBe(0);
  });
  it('uses captured native APIs and clears the deadline timer when the frame arrives first', async () => {
    const s = frameDeadlineSetup();
    s.window.requestAnimationFrame = () => { throw new Error('observed RAF must be bypassed'); };
    s.window.setTimeout = () => { throw new Error('observed timer must be bypassed'); };
    s.window.clearTimeout = () => { throw new Error('observed clear must be bypassed'); };
    const waiting = s.wait();
    expect(s.timers.size).toBe(1); const timerId = [...s.timers.keys()][0];
    s.fireRaf([...s.rafs.keys()][0]); expect(await waiting).toBe(123.456);
    expect(s.clearedTimers).toContain(timerId); expect(s.timers.size).toBe(0); expect(s.rafs.size).toBe(0);
  });
});
