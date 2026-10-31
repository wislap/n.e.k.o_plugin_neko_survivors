import { describe, expect, it } from 'vitest';
import { createSimulationEnvironment } from '../../src/simulation/scheduler';
import { decodeFrame } from '../../src/simulation/frame-packet';
import { SimulationHost } from '../../src/simulation/host';
import { EMPTY_INPUT } from '../../src/game';
import type { WorkerOutput } from '../../src/simulation/protocol';
describe('worker task scheduling', () => {
  it('cancels queued and timed tasks, closes its ports and permits only one pending task', async () => {
    const env = createSimulationEnvironment(), calls: string[] = [];
    const first = env.schedule(() => calls.push('cancelled'), 0);
    expect(() => env.schedule(() => {}, 0)).toThrow('already has'); env.cancel(first);
    await new Promise<void>(resolve => env.schedule(() => { calls.push('message'); resolve(); }, 0));
    env.schedule(() => calls.push('timer'), 20); env.close!();
    await new Promise(resolve => setTimeout(resolve, 30)); expect(calls).toEqual(['message']);
  });
  it('caps combat summary delivery in wall time while rule steps accelerate', () => {
    let now = 0, next = 0; const scheduled = new Map<number, () => void>(), messages: WorkerOutput[] = [];
    let host: SimulationHost;
    host = new SimulationHost(message => {
      messages.push(structuredClone(message));
      if (message.kind === 'update') host.receive({ kind: 'ack', sequence: message.sequence });
    }, { now: () => now, schedule: callback => { scheduled.set(++next, callback); return next; }, cancel: id => { scheduled.delete(id); } });
    host.receive({ kind: 'initialize', id: 1, options: {}, width: 1920, height: 1080, packed: true, profile: false });
    host.receive({ kind: 'command', id: 2, command: { type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69 } } });
    host.receive({ kind: 'speed', id: 3, speed: 8 }); host.receive({ kind: 'start', id: 4 });
    for (let i = 0; i < 500; i++) { now += 2; const batch = [...scheduled.values()]; scheduled.clear(); for (const callback of batch) callback(); }
    expect(host.stats.steps).toBe(480);
    const summaries = messages.filter(message => message.kind === 'update' && message.ui);
    expect(summaries.length).toBeGreaterThan(0); expect(summaries.length).toBeLessThanOrEqual(10);
    host.dispose(); expect(scheduled.size).toBe(0);
  });  it('does not let an internal viewport receipt consume a pending phase update', () => {
    let now = 0, next = 0; const scheduled = new Map<number, () => void>(), messages: WorkerOutput[] = [];
    const host = new SimulationHost(message => messages.push(structuredClone(message)), {
      now: () => now, schedule: callback => { scheduled.set(++next, callback); return next; }, cancel: id => { scheduled.delete(id); },
    });
    let id = 0;
    host.receive({ kind: 'initialize', id: ++id, options: {}, width: 1920, height: 1080, packed: true, profile: false });
    host.receive({ kind: 'command', id: ++id, command: { type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69 } } });
    let phase = 'playing';
    for (let i = 0; i < 60 && phase === 'playing'; i++) {
      host.receive({ kind: 'advance', id: ++id, steps: 64, input: { moveX: 0, moveY: 0, aimX: 0, aimY: 0, manualAim: false, slow: false, clear: false, ultimate: false, p2MoveX: 0, p2MoveY: 0, p2Slow: false, p2Clear: false } });
      const reply = messages.at(-1); if (reply?.kind === 'reply') phase = reply.ui.phase;
    }
    expect(phase).not.toBe('playing');
    host.receive({ kind: 'viewport', id: ++id, width: 1280, height: 720 }); host.receive({ kind: 'start', id: ++id });
    const callbacks = [...scheduled.values()]; scheduled.clear(); for (const callback of callbacks) callback();
    expect(messages.some(message => message.kind === 'update' && message.ui?.phase === phase)).toBe(true);
    host.dispose(); now++;
  });
  it('applies the latest held movement together with a queued one-shot action', () => {
    let now = 0, next = 0; const scheduled = new Map<number, () => void>(), messages: WorkerOutput[] = [];
    const host = new SimulationHost(message => messages.push(structuredClone(message)), {
      now: () => now, schedule: callback => { scheduled.set(++next, callback); return next; }, cancel: id => { scheduled.delete(id); },
    });
    host.receive({ kind: 'initialize', id: 1, options: {}, width: 1920, height: 1080, packed: true, profile: false });
    host.receive({ kind: 'command', id: 2, command: { type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69 } } });
    host.receive({ kind: 'frame' });
    const before = messages.find(message => message.kind === 'frame');
    host.receive({ kind: 'input', sequence: 1, input: { ...EMPTY_INPUT, moveX: 1, clear: true } });
    host.receive({ kind: 'input', sequence: 2, input: { ...EMPTY_INPUT, moveX: 0 } });
    host.receive({ kind: 'start', id: 3 }); now = 20;
    const batch = [...scheduled.values()]; scheduled.clear(); for (const callback of batch) callback();
    host.receive({ kind: 'frame' }); const after = messages.at(-1);
    if (before?.kind !== 'frame' || after?.kind !== 'frame') throw new Error('Missing frame');
    expect(decodeFrame(after.packet).actors.find(actor => actor.kind === 'player')?.x).toBe(decodeFrame(before.packet).actors.find(actor => actor.kind === 'player')?.x);
    expect(host.stats.inputSequence).toBe(2); expect(host.stats.queuedInputEdges).toBe(0); host.dispose();
  });

});
