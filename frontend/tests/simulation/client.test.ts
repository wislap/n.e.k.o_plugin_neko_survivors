import { Worker as NodeWorker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSimulation } from '../../src/simulation/client';
import type { WorkerInput } from '../../src/simulation/protocol';
import { EMPTY_INPUT } from '../../src/game/index.ts';
const workers: NodeWorker[] = [];
afterEach(async () => { await Promise.all(workers.splice(0).map(w => w.terminate())); vi.restoreAllMocks(); });
class ThreadPort extends EventTarget {
  readonly worker = new NodeWorker(new URL('./node-worker.mjs', import.meta.url));
  readonly sent: WorkerInput[] = [];
  terminations = 0;
  dropFrames = false;
  constructor() {
    super(); workers.push(this.worker);
    this.worker.on('message', data => this.dispatchEvent(new MessageEvent('message', { data })));
    this.worker.on('error', error => this.dispatchEvent(Object.assign(new Event('error'), { message: error instanceof Error ? error.message : String(error) })));
  }
  postMessage(message: WorkerInput, transfer: ArrayBuffer[] = []) { this.sent.push(message); if (!(this.dropFrames && message.kind === 'frame')) this.worker.postMessage(message, transfer); }
  terminate() { this.terminations++; void this.worker.terminate(); }
}
const options = { session: {}, width: 1920, height: 1080, packed: true, profile: true };
const command = { type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69 } } as const;
describe('simulation connection through a real transferable worker port', () => {
  it('coalesces display requests, restores frame readers and retires old-epoch buffers', async () => {
    const port = new ThreadPort(), client = await createSimulation(options, () => port as unknown as Worker);
    await client.request({ kind: 'command', command });
    for (let i = 0; i < 100; i++) client.requestFrame();
    await client.request({ kind: 'metrics' });
    expect(port.sent.filter(m => m.kind === 'frame')).toHaveLength(1);
    const first = client.takeFrame()!; expect(first.frame.transients!.readPlayer).toBeTypeOf('function');
    expect(client.takeFrame()!.revision).toBe(first.revision);
    const buffers = first.frame.transients!.players;
    await client.request({ kind: 'command', command });
    expect(buffers.byteLength).toBe(0); expect(client.takeFrame()).toBeUndefined();
    client.requestFrame(); await client.request({ kind: 'metrics' }); expect(client.takeFrame()!.revision).toBeGreaterThan(first.revision);
    client.dispose(); client.dispose(); expect(port.terminations).toBe(1);
  });
  it('forces held input to be resent after suspension and rejects pending requests on disposal', async () => {
    const port = new ThreadPort(), client = await createSimulation(options, () => port as unknown as Worker);
    const input = { ...EMPTY_INPUT, moveX: 1 };
    client.setInput(input); client.setInput(input);
    expect(port.sent.filter(m => m.kind === 'input')).toHaveLength(1);
    await client.request({ kind: 'suspend', suspended: true }); client.setInput(input);
    await client.request({ kind: 'suspend', suspended: false }); client.setInput(input);
    expect(port.sent.filter(m => m.kind === 'input')).toHaveLength(3);
    const pending = client.request({ kind: 'save' }); client.dispose(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('cleans an aborted startup and never creates a synchronous fallback', async () => {
    const port = new ThreadPort(), controller = new AbortController();
    const pending = createSimulation({ ...options, signal: controller.signal }, () => port as unknown as Worker);
    controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(port.terminations).toBe(1);
  });
  it('detects a silently missing display response instead of drawing an old state forever', async () => {
    const port = new ThreadPort(), client = await createSimulation(options, () => port as unknown as Worker);
    const failures: string[] = []; client.subscribe(message => { if (message.kind === 'failure') failures.push(message.message); });
    port.dropFrames = true; client.requestFrame();
    const now = performance.now(); vi.spyOn(performance, 'now').mockReturnValue(now + 10001);
    client.requestFrame(); expect(failures).toEqual(['Simulation display response timed out']);
    expect(port.terminations).toBe(1); client.dispose(); expect(port.terminations).toBe(1);
  });
  it('reports worker startup errors and terminates once', async () => {
    const port = new ThreadPort();
    await expect(createSimulation({ ...options, session: { meta: { broken: true } } }, () => port as unknown as Worker)).rejects.toThrow();
    expect(port.terminations).toBe(1);
  });
});
