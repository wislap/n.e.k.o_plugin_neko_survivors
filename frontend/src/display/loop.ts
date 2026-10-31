export interface AnimationDriver { request(callback: FrameRequestCallback): number; cancel(id: number): void }
/** Rendering owns no simulation clock. It may reuse a completed display packet,
 * but requests at most one newer packet through the simulation connection. */
export function createDisplayLoop(options: {
  onFrame?(timestamp: number): void; render(): void; displayFps?: number;
  driver?: AnimationDriver; onError?(error: unknown): void;
}) {
  const driver = options.driver ?? { request: (callback: FrameRequestCallback) => requestAnimationFrame(callback), cancel: (id: number) => cancelAnimationFrame(id) };
  const interval = options.displayFps === undefined ? 0 : 1000 / options.displayFps;
  if (options.displayFps !== undefined && (!(options.displayFps > 0) || !Number.isFinite(options.displayFps))) throw new RangeError('Invalid display rate');
  let running = false, id: number | undefined, last: number | undefined;
  function stop() { running = false; if (id !== undefined) driver.cancel(id); id = undefined; last = undefined; }
  function frame(now: number) {
    if (!running) return;
    id = undefined;
    try {
      if (last === undefined || now - last + 1e-7 >= interval) {
        options.onFrame?.(now); options.render();
        last = interval && last !== undefined ? last + Math.max(1, Math.floor((now - last + 1e-7) / interval)) * interval : now;
      }
      if (running) id = driver.request(frame);
    } catch (error) { stop(); if (options.onError) options.onError(error); else throw error; }
  }
  return { start() { if (running) return; running = true; last = undefined; id = driver.request(frame); },
    stop, resetClock() { last = undefined; }, get running() { return running; } };
}
