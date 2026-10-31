import { describe, expect, it, vi } from 'vitest';
import { DisplayObjectIndex } from '../../src/rendering/object-index';
import { ResourcePool } from '../../src/rendering/resource-scope';

describe('display identity ownership', () => {
  it('reuses IDs, destroys disappeared views once, and releases all on dispose', () => {
    const makeDisplay = () => ({ destroy: vi.fn<() => void>() });
    const index = new DisplayObjectIndex<ReturnType<typeof makeDisplay>>();
    const displays: ReturnType<typeof makeDisplay>[] = [];
    const create = vi.fn(() => { const d = makeDisplay(); displays.push(d); return d; });
    const update = vi.fn();
    index.sync([{ id: 1 }, { id: 2 }], create, update);
    index.sync([{ id: 2 }, { id: 3 }], create, update);
    expect(create).toHaveBeenCalledTimes(3);
    expect(displays[0].destroy).toHaveBeenCalledTimes(1);
    expect(displays[1].destroy).not.toHaveBeenCalled();
    index.dispose(); index.dispose();
    expect(displays.map(d => d.destroy.mock.calls.length)).toEqual([1, 1, 1]);
    expect(index.size).toBe(0);
  });
});
describe('async GPU texture ownership', () => {
  it('shares an in-flight load and retains it while another renderer owns it', async () => {
    const unload = vi.fn(async () => {});
    const load = vi.fn(async () => ({ texture: true }));
    const pool = new ResourcePool(load, unload);
    const first = pool.acquire('actor'); const second = pool.acquire('actor');
    expect(await first.value).toBe(await second.value);
    expect(load).toHaveBeenCalledTimes(1);
    first.release(); expect(unload).not.toHaveBeenCalled();
    second.release(); await Promise.resolve();
    expect(unload).toHaveBeenCalledTimes(1);
    second.release(); expect(unload).toHaveBeenCalledTimes(1);
  });
  it('unloads completion arriving after its renderer was disposed', async () => {
    let finish!: (value: object) => void;
    const unload = vi.fn(async () => {});
    const pool = new ResourcePool(() => new Promise(resolve => { finish = resolve; }), unload);
    const lease = pool.acquire('late');
    await Promise.resolve(); lease.release(); finish({});
    await lease.value; await Promise.resolve();
    expect(unload).toHaveBeenCalledExactlyOnceWith('late');
  });
  it('awaits an old unload before a remount can reload the same URL', async () => {
    let finishUnload!: () => void;
    const load = vi.fn(async () => ({}));
    const pool = new ResourcePool(load, () => new Promise(resolve => { finishUnload = resolve; }));
    const first = pool.acquire('same'); await first.value; first.release();
    await Promise.resolve();
    const next = pool.acquire('same');
    await Promise.resolve(); expect(load).toHaveBeenCalledTimes(1);
    finishUnload(); await next.value;
    expect(load).toHaveBeenCalledTimes(2);
  });
});
