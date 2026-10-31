import { WebGLRenderer } from 'pixi.js';

export type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;
export type PixiRenderer = WebGLRenderer<RenderCanvas>;
function removeCanvas(canvas:RenderCanvas):void { if('remove' in canvas)canvas.remove(); }
export interface RendererOptions {
  width: number;
  height: number;
  resolution: number;
}
export interface RendererDevice<C extends RenderCanvas = HTMLCanvasElement> {
  renderer: PixiRenderer;
  canvas: C;
}

/**
 * Pixi 8.22 constructs every pipe before awaiting system initialization. Its
 * AbstractRenderer.destroy aborts on the first failing destructor; several native
 * destructors additionally assume init/contextChange already allocated state.
 * Keep this pinned-version adaptation here, without patching Pixi prototypes.
 */
function failedRendererCleanup(renderer: PixiRenderer, canvas: RenderCanvas,
  readContext: () => WebGL2RenderingContext | null): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const errors: string[] = [];
    const cleanup = (name: string, operation: () => void) => {
      try { operation(); } catch (error) {
        errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    let contextReleased = false;
    const runner = renderer.runners.destroy;
    const items = [...runner.items].reverse();
    // Detach first: the final native renderer teardown must not destroy any
    // already released system twice, even when another destructor throws.
    runner.removeAll();
    for (const item of items) {
      const name = item.constructor?.name ?? 'Pixi resource';
      if (item === renderer.view && !renderer.view.texture) continue;
      if (item === renderer.context && !renderer.gl) continue;
      // GraphicsPipe has constructor-owned GC resources even without a device.
      // Still run its native destructor, guarding only the absent adaptor shader.
      if (item === renderer.renderPipes?.graphics) {
        const graphics = item as { _adaptor?: { shader?: { destroy(): void }; destroy(): void } };
        const adaptor = graphics._adaptor;
        if (adaptor && !adaptor.shader) adaptor.destroy = () => {};
      }
      // DOMPipe always removes its constructor-created element/listeners, but
      // creates CanvasObserver only in init(), after device initialization.
      if (item === renderer.renderPipes?.dom) {
        const dom = item as { _canvasObserver?: { destroy(): void } };
        dom._canvasObserver ??= { destroy() {} };
      }
      cleanup(name, () => {
        item.destroy({ removeView: true, releaseGlobalResources: false });
        if (item === renderer.context) contextReleased = true;
      });
    }
    // False releaseGlobalResources preserves caches belonging to other live
    // renderers (including the host avatar); this failed attempt does not own them.
    cleanup('renderer finalization', () => renderer.destroy({ removeView: true, releaseGlobalResources: false }));
    cleanup('WebGL2 context', () => { if (!contextReleased) readContext()?.getExtension('WEBGL_lose_context')?.loseContext(); });
    cleanup('canvas', () => removeCanvas(canvas));
    if (errors.length) throw new AggregateError(errors, `Failed renderer cleanup: ${errors.join('; ')}`);
  };
}

/** Own the context so Pixi cannot silently choose WebGL1. */
export function createRenderer(options:RendererOptions & {canvas:OffscreenCanvas}):Promise<RendererDevice<OffscreenCanvas>>;
export function createRenderer(options:RendererOptions):Promise<RendererDevice>;
export async function createRenderer(options: RendererOptions & {canvas?:OffscreenCanvas}): Promise<RendererDevice<RenderCanvas>> {
  const canvas = options.canvas ?? document.createElement('canvas');
  if('setAttribute' in canvas)canvas.setAttribute('aria-label', '猫娘幸存者游戏画面');
  if('style' in canvas)Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none' });
  let renderer: PixiRenderer;
  try { renderer = new WebGLRenderer<RenderCanvas>(); }
  catch (error) { removeCanvas(canvas); throw error; }
  let context: WebGL2RenderingContext | null = null;
  const dispose = failedRendererCleanup(renderer, canvas, () => context);
  try {
    context = canvas.getContext('webgl2', { alpha: false, antialias: false, stencil: true });
    if (!context) throw new Error('This environment cannot create a WebGL2 context');
    await renderer.init({
      canvas, context, preferWebGLVersion: 2,
      width: Math.max(1, options.width), height: Math.max(1, options.height),
      resolution: options.resolution, background: '#162131', antialias: false, autoDensity: !options.canvas,
    });
    return { renderer, canvas };
  } catch (error) {
    try { dispose(); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `WebGL2 initialization failed: ${String(error)}; cleanup: ${String(cleanupError)}`);
    }
    throw error;
  }
}
