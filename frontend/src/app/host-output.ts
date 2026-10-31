import type { HostResult } from '../host';

/** Observe one call; its owner aborts the signal when that session is retired.
 * Aborting suppresses delivery, without claiming to retract accepted host work.
 * Bounded teardown can omit a signal so a failed cleanup receipt is still observed.
 */
export function observeHostOutput(
  operation: () => Promise<HostResult>,
  signal: AbortSignal | undefined,
  deliver: (result: HostResult) => void,
): void {
  if (signal?.aborted) return;

  async function observe() {
    let result: HostResult;
    try {
      result = await operation();
    } catch (error) {
      result = {
        status: 'unavailable',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    if (!signal?.aborted) deliver(result);
  }

  // A consumer exception must not become an unhandled background rejection or
  // be misreported as a second host receipt. The observer never retries a call.
  void observe().catch(error => { console.error('Could not consume host output receipt', error); });
}
