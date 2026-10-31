import { describe, expect, it } from 'vitest';
import { ContextProbe, FiniteFixtureLoop, type ContextSnapshot } from '../../src/rendering/dev/context-probe';
const initial: ContextSnapshot = { contextLost: false, recoveries: 0, generatedTextures: { cached: 5, generated: 5, released: 0 } };
describe('development recovery evidence state', () => {
  it('requires both recovery and fresh generated textures before reporting regeneration', () => {
    let now = 0; const probe = new ContextProbe(() => ++now);
    probe.request(initial); probe.nativeLoss({ ...initial, contextLost: true });
    probe.observe({ ...initial, contextLost: true }); expect(probe.state).toBe('lost');
    probe.observe({ contextLost: false, recoveries: 1, generatedTextures: { cached: 0, generated: 5, released: 5 } });
    expect(probe.state).toBe('restored-awaiting-textures');
    probe.observe({ contextLost: false, recoveries: 1, generatedTextures: { cached: 5, generated: 10, released: 5 } });
    expect(probe.state).toBe('regenerated');
    expect(probe.records.map(record => record.event)).toContain('projectile-textures-regenerated');
  });
  it('does not accept texture growth without a native recovery and keeps repeated records bounded', () => {
    const probe = new ContextProbe(() => 1); probe.request(initial);
    probe.observe({ ...initial, generatedTextures: { cached: 6, generated: 6, released: 0 } });
    expect(probe.state).toBe('requested');
    for (let i = 0; i < 100; i++) probe.record(`sample-${i}`, initial);
    expect(probe.records).toHaveLength(80); expect(probe.records.at(-1)?.event).toBe('sample-99');
  });
});
describe('finite visual resource loop', () => {
  it('stops after the configured actual scene intervals and never skips unrendered background steps', () => {
    const loop = new FiniteFixtureLoop(3, 100); loop.start(0);
    expect(loop.advance(0)).toBe(0); expect(loop.advance(50)).toBeUndefined();
    expect(loop.advance(10000)).toBe(1); expect(loop.completed).toBe(2);
    expect(loop.advance(10001)).toBeUndefined(); expect(loop.advance(10100)).toBe(2);
    expect(loop.advance(10200)).toBeUndefined(); expect(loop.running).toBe(false); expect(loop.completed).toBe(3);
    loop.start(20000); loop.stop(); expect(loop.advance(21000)).toBeUndefined();
  });
});
