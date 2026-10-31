export interface SimulationEnvironment {
  now(): number;
  schedule(callback: () => void, delay: number): number;
  cancel(id: number): void;
  close?(): void;
}
/** Timed work sleeps. Already-due work yields through a message task instead of
 * a nested zero-delay timer (which browsers clamp to >=4ms). One pending task. */
export function createSimulationEnvironment(): SimulationEnvironment {
  const channel = new MessageChannel();
  let sequence = 0;
  let pending: { id: number; callback(): void; timeout?: ReturnType<typeof setTimeout> } | undefined;
  function run(id: number) {
    if (pending?.id !== id) return;
    const callback = pending.callback; pending = undefined; callback();
  }
  function cancel(id: number) {
    if (pending?.id !== id) return;
    if (pending.timeout !== undefined) clearTimeout(pending.timeout);
    pending = undefined;
  }
  channel.port1.onmessage = event => run(event.data as number);
  return {
    now: () => performance.now(),
    schedule(callback, delay) {
      if (pending) throw new Error('Simulation already has a scheduled task');
      const id = ++sequence; pending = { id, callback };
      if (delay <= 0) channel.port2.postMessage(id);
      else pending.timeout = setTimeout(() => run(id), delay);
      return id;
    },
    cancel,
    close() { if (pending) cancel(pending.id); channel.port1.close(); channel.port2.close(); },
  };
}
