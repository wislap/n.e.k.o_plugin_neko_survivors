import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const probe = vi.hoisted(() => ({ sources: new Set<object>() }));
vi.mock('pixi.js', async importOriginal => {
  const actual = await importOriginal<typeof import('pixi.js')>();
  return { ...actual, compileHighShaderGl: (options: Parameters<typeof actual.compileHighShaderGl>[0]) => {
    const source = actual.compileHighShaderGl(options); probe.sources.add(source); return source;
  } };
});
import { DOMAdapter, Texture } from 'pixi.js';
import { InstanceMesh } from '../../src/rendering/instance-mesh';
beforeEach(() => {
  probe.sources.clear();
  vi.spyOn(DOMAdapter.get(), 'createCanvas').mockReturnValue({ getContext: () => null } as unknown as HTMLCanvasElement);
});
afterEach(() => vi.restoreAllMocks());
describe('instance shader cache lifetime', () => {
  it('reuses the real compiler result across transient mesh churn and both fixed variants', () => {
    for (let i = 0; i < 100; i++) { const mesh = new InstanceMesh(Texture.WHITE, 'mixed', true); mesh.destroy(); }
    expect(probe.sources.size).toBe(1);
    for (let i = 0; i < 100; i++) { const mesh = new InstanceMesh(Texture.WHITE, 'mixed', false); mesh.destroy(); }
    expect(probe.sources.size).toBe(2);
  });
});
