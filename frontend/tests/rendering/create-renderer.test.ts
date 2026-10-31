import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  failStage: '' as '' | 'early' | 'late', failCleanup: false, failConstructor: false, failObserverCleanup: false,
  init: vi.fn(), destroy: vi.fn(), shaderDestroy: vi.fn(), graphicsDestroy: vi.fn(),
  viewDestroy: vi.fn(), contextDestroy: vi.fn(), observerDestroy: vi.fn(),
}));
vi.mock('pixi.js', async importOriginal => {
  const { DOMPipe, SystemRunner } = await importOriginal<typeof import('pixi.js')>();
  return {
    WebGLRenderer: class {
      gl?: { getExtension(name: string): { loseContext(): void } | null };
      view = { texture: undefined as { destroy(): void } | undefined, destroy() { state.viewDestroy(); this.texture!.destroy(); } };
      context = { destroy: () => { state.contextDestroy(); this.gl!.getExtension('WEBGL_lose_context')?.loseContext(); } };
      runners = { destroy: new SystemRunner('destroy'), init: new SystemRunner('init'), postrender: new SystemRunner('postrender') };
      renderPipes: { dom?: InstanceType<typeof DOMPipe>; graphics?: { _adaptor: { shader?: { destroy(): void }; destroy(): void }; destroy(): void } } | null = {};
      constructor() {
        if (state.failConstructor) throw new Error('GL constructor failed');
        const graphics = { _adaptor: { shader: undefined as { destroy(): void } | undefined,
          destroy() { this.shader!.destroy(); } }, destroy() { state.graphicsDestroy(); this._adaptor.destroy(); } };
        this.renderPipes!.graphics = graphics;
        // Exercise Pixi's real constructor-owned DOM and its destructor.
        const dom = new DOMPipe(this as unknown as import('pixi.js').Renderer);
        this.renderPipes!.dom = dom;
        this.runners.destroy.items.push(dom, this.view, this.context,
          { destroy() { if (state.failCleanup) throw new Error('owned resource destruction failed'); } }, graphics);
      }
      async init(options: { context: { getExtension(name: string): { loseContext(): void } | null } }) {
        state.init(options); this.gl = options.context;
        if (state.failStage === 'early') throw new Error('early GL init failed');
        this.view.texture = { destroy: vi.fn() };
        this.renderPipes!.graphics!._adaptor.shader = { destroy() { state.shaderDestroy(); } };
        (this.renderPipes!.dom as unknown as { _canvasObserver: { destroy(): void } })._canvasObserver = { destroy() {
          state.observerDestroy(); if (state.failObserverCleanup) throw new Error('allocated observer failed');
        } };
        if (state.failStage === 'late') throw new Error('late GL init failed');
      }
      destroy(options: unknown) {
        state.destroy(options);
        for (const resource of [...this.runners.destroy.items].reverse()) resource.destroy(options);
        this.runners.destroy.removeAll(); this.renderPipes = null;
      }
    },
  };
});
import { createRenderer } from '../../src/rendering/create-renderer';
afterEach(() => {
  vi.unstubAllGlobals(); vi.clearAllMocks();
  state.failStage = ''; state.failCleanup = false; state.failConstructor = false; state.failObserverCleanup = false;
});
function environment(supportGL2 = true) {
  const loseContext = vi.fn(), context = { getExtension: vi.fn(() => ({ loseContext })) };
  const canvases: { getContext: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; style: object; setAttribute: ReturnType<typeof vi.fn> }[] = [];
  const elements: { remove: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal('document', { createElement: vi.fn(tag => {
    const canvas = { style: {}, setAttribute: vi.fn(), remove: vi.fn(), getContext: vi.fn(type => type === 'webgl2' && supportGL2 ? context : null) };
    if (tag === 'canvas') canvases.push(canvas); else elements.push(canvas);
    return canvas;
  }) });
  return { canvases, elements, context, loseContext };
}
describe('strict WebGL2 renderer startup and partial failure cleanup', () => {
  it('owns one explicit WebGL2 context and preserves the application resolution', async () => {
    vi.stubGlobal('devicePixelRatio', 4); const { canvases, context } = environment();
    const result = await createRenderer({ width: 800, height: 600, resolution: 1.25 });
    expect(canvases).toHaveLength(1);
    expect(canvases[0].getContext).toHaveBeenCalledExactlyOnceWith('webgl2', { alpha: false, antialias: false, stencil: true });
    expect(state.init).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ canvas: canvases[0], context, resolution: 1.25, preferWebGLVersion: 2 }));
    expect(state.destroy).not.toHaveBeenCalled();
    result.renderer.destroy({ removeView: true, releaseGlobalResources: false });
    expect(state.contextDestroy).toHaveBeenCalledOnce(); expect(state.shaderDestroy).toHaveBeenCalledOnce();
  });
  it('clamps an empty viewport before initialization', async () => {
    environment(); const result = await createRenderer({ width: 0, height: -1, resolution: 1 });
    expect(state.init).toHaveBeenCalledWith(expect.objectContaining({ width: 1, height: 1, resolution: 1 }));
    result.renderer.destroy({ removeView: true, releaseGlobalResources: false });
  });
  it('fails without WebGL2, cleans constructor-owned resources and never tries another context', async () => {
    const { canvases, elements } = environment(false);
    await expect(createRenderer({ resolution: 1, width: 1, height: 1 })).rejects.toThrow('cannot create a WebGL2 context');
    expect(state.init).not.toHaveBeenCalled();
    expect(canvases[0].getContext.mock.calls.map(call => call[0])).toEqual(['webgl2']);
    expect(state.graphicsDestroy).toHaveBeenCalledOnce(); expect(state.shaderDestroy).not.toHaveBeenCalled();
    expect(state.viewDestroy).not.toHaveBeenCalled(); expect(state.contextDestroy).not.toHaveBeenCalled();
    expect(elements[0].remove).toHaveBeenCalledOnce(); expect(state.observerDestroy).not.toHaveBeenCalled();
    expect(canvases[0].remove).toHaveBeenCalledOnce();
    expect(state.destroy).toHaveBeenCalledExactlyOnceWith({ removeView: true, releaseGlobalResources: false });
  });
  it('cleans an early initialization failure without unallocated shader or view destructors', async () => {
    state.failStage = 'early'; const { loseContext, elements } = environment();
    await expect(createRenderer({ resolution: 1, width: 1, height: 1 })).rejects.toThrow('early GL init failed');
    expect(state.graphicsDestroy).toHaveBeenCalledOnce(); expect(state.shaderDestroy).not.toHaveBeenCalled();
    expect(state.viewDestroy).not.toHaveBeenCalled(); expect(state.contextDestroy).toHaveBeenCalledOnce();
    expect(loseContext).toHaveBeenCalledOnce(); expect(elements[0].remove).toHaveBeenCalledOnce();
  });
  it('releases every allocated resource exactly once on a late failure', async () => {
    state.failStage = 'late'; const { loseContext, elements, canvases } = environment();
    await expect(createRenderer({ resolution: 1, width: 1, height: 1 })).rejects.toThrow('late GL init failed');
    for (const fn of [state.graphicsDestroy, state.shaderDestroy, state.viewDestroy, state.contextDestroy, state.observerDestroy, state.destroy, loseContext]) expect(fn).toHaveBeenCalledOnce();
    expect(elements[0].remove).toHaveBeenCalledOnce(); expect(canvases[0].remove).toHaveBeenCalledOnce();
  });
  it('reports both startup and cleanup failures while continuing later cleanup', async () => {
    state.failStage = 'late'; state.failCleanup = true; const { canvases, loseContext } = environment();
    await expect(createRenderer({ resolution: 1, width: 1, height: 1 })).rejects.toThrow(/late GL init failed.*owned resource destruction failed/);
    expect(state.viewDestroy).toHaveBeenCalledOnce(); expect(loseContext).toHaveBeenCalledOnce(); expect(canvases[0].remove).toHaveBeenCalledOnce();
  });
  it('preserves a genuine observer destruction failure', async () => {
    state.failStage = 'late'; state.failObserverCleanup = true; const { loseContext } = environment();
    await expect(createRenderer({ resolution: 1, width: 1, height: 1 })).rejects.toThrow(/late GL init failed.*allocated observer failed/);
    expect(state.observerDestroy).toHaveBeenCalledOnce(); expect(loseContext).toHaveBeenCalledOnce();
  });
  it('removes the canvas when construction fails before resources can be owned', async () => {
    state.failConstructor = true; const { canvases } = environment();
    await expect(createRenderer({ resolution: 1, width: 1, height: 1 })).rejects.toThrow('GL constructor failed');
    expect(canvases[0].remove).toHaveBeenCalledOnce(); expect(state.destroy).not.toHaveBeenCalled();
  });
});
