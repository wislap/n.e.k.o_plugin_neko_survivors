import { setImmediate } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';
import { observeHostOutput } from '../../src/app/host-output';
import type { HostResult, HostStatus } from '../../src/host/neko-host';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('host output receipts', () => {
  const statuses = [
    'submitted', 'queued', 'completed', 'throttled', 'unavailable', 'rejected', 'cancelled',
  ] as const satisfies readonly HostStatus[];

  it.each(statuses)('delivers %s once, preserving its receipt and reason', async status => {
    const pending = deferred<HostResult>();
    const operation = vi.fn(() => pending.promise);
    const deliver = vi.fn();
    const receipt: HostResult = { status, reason: `${status}_reason` };
    expect(observeHostOutput(operation, new AbortController().signal, deliver)).toBeUndefined();
    expect(deliver).not.toHaveBeenCalled();
    await setImmediate();
    pending.resolve(receipt);
    await setImmediate();
    expect(operation).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledExactlyOnceWith(receipt);
    expect(deliver.mock.calls[0]?.[0]).toBe(receipt);
  });

  it('does not start a call whose owner is already disposed', async () => {
    const controller = new AbortController();
    controller.abort();
    const operation = vi.fn(async (): Promise<HostResult> => ({ status: 'queued' }));
    const deliver = vi.fn();
    observeHostOutput(operation, controller.signal, deliver);
    await setImmediate();
    expect(operation).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('drops the old delayed result after the owner is replaced by a new session', async () => {
    const old = deferred<HostResult>();
    const current = deferred<HostResult>();
    const oldOwner = new AbortController();
    const nextOwner = new AbortController();
    const deliver = vi.fn();
    observeHostOutput(() => old.promise, oldOwner.signal, deliver);
    await setImmediate();
    oldOwner.abort();
    observeHostOutput(() => current.promise, nextOwner.signal, deliver);
    current.resolve({ status: 'queued' });
    await setImmediate();
    old.resolve({ status: 'rejected', reason: 'old route ended' });
    await setImmediate();
    expect(deliver).toHaveBeenCalledExactlyOnceWith({ status: 'queued' });
  });

  it('consumes a late rejection after disposal without delivering it', async () => {
    const pending = deferred<HostResult>();
    const owner = new AbortController();
    const deliver = vi.fn();
    observeHostOutput(() => pending.promise, owner.signal, deliver);
    await setImmediate();
    owner.abort();
    pending.reject(new Error('disconnected after disposal'));
    await setImmediate();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('suppresses a receipt when abort happens after resolution but before delivery', async () => {
    const pending = deferred<HostResult>();
    const owner = new AbortController();
    const deliver = vi.fn();
    observeHostOutput(() => pending.promise, owner.signal, deliver);
    pending.resolve({ status: 'completed' });
    owner.abort();
    await setImmediate();
    expect(deliver).not.toHaveBeenCalled();
  });

  it('turns a synchronous host exception into one unavailable receipt', async () => {
    const deliver = vi.fn();
    const operation = vi.fn((): Promise<HostResult> => { throw new Error('transport not ready'); });
    observeHostOutput(operation, new AbortController().signal, deliver);
    await setImmediate();
    expect(deliver).toHaveBeenCalledExactlyOnceWith({ status: 'unavailable', reason: 'transport not ready' });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('turns an asynchronous host rejection into one unavailable receipt', async () => {
    const pending = deferred<HostResult>();
    const deliver = vi.fn();
    observeHostOutput(() => pending.promise, new AbortController().signal, deliver);
    await setImmediate();
    pending.reject('host disconnected');
    await setImmediate();
    expect(deliver).toHaveBeenCalledExactlyOnceWith({ status: 'unavailable', reason: 'host disconnected' });
  });

  it('does not retry or emit a second receipt when the consumer throws', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = deferred<HostResult>();
    const operation = vi.fn(() => pending.promise);
    const deliver = vi.fn(() => { throw new Error('consumer failed'); });
    observeHostOutput(operation, new AbortController().signal, deliver);
    pending.resolve({ status: 'queued' });
    await setImmediate();
    expect(operation).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith('Could not consume host output receipt', expect.any(Error));
    diagnostic.mockRestore();
  });
});
