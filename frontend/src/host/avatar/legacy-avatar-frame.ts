/** Only the legacy APIs actually used by this isolated document. */
interface LegacyViewport { width: number; height: number }
interface LegacyFit { mode: string; align: string; padding: number }
interface LegacyTicker { started: boolean; stop(): void }
interface LegacyModel { destroyed: boolean }
interface LegacyRenderer {
  gl?: WebGLRenderingContext;
  context?: { gl?: WebGLRenderingContext };
  resize(width: number, height: number): void;
}
interface LegacyApplication {
  renderer: LegacyRenderer | null;
  stage: object | null;
  ticker?: LegacyTicker;
  stop?(): void;
  destroy(removeView: boolean, options: { children: boolean; texture: boolean; baseTexture: boolean }): void;
}
interface LegacyManager {
  pixi_app: LegacyApplication | null;
  currentModel: LegacyModel | null;
  isInitialized: boolean;
  _activeLoadToken?: number;
  _cancelAvatarOperations?(): void;
  _stopIdleFpsGovernor?(): void;
  _screenChangeHandler?: EventListener | null;
  _displayChangeHandler?: EventListener | null;
  initPIXI(canvasId: string, containerId: string, options: object): Promise<unknown>;
  loadModel(model: string, options: { minimalEmbed: boolean }): Promise<unknown>;
  removeModel?(options: { skipCloseWindows: boolean }): Promise<unknown> | unknown;
  setFocus?(point: { x: number; y: number }): void;
  setEmotion?(name: string, options?: { signal: AbortSignal; isCurrent(): boolean }): Promise<boolean | void> | boolean | void;
  pauseRendering?(): void;
  resumeRendering?(): void;
}
interface LegacyController {
  setModel(): Promise<void>;
  focus(point: { x: number; y: number }): void;
  setEmotion(name: string): void;
  pause(): void;
  resume(): void;
  getState(): { modelLoaded: boolean };
  resize(viewport: LegacyViewport, fit: LegacyFit): void;
  dispose(): void;
}
interface LegacyAvatarHost {
  mount(options: { slot: string; model: { type: string; path: string }; viewport: { mode: string }; fit: LegacyFit; resize: { mode: string } }): Promise<LegacyController>;
  dispose(): void;
}
interface LegacyHostFactory {
  create(options: { slots: { cat: { containerId: string; createController(): Promise<LegacyController> } } }): LegacyAvatarHost;
  fitLive2DModel(model: LegacyModel, viewport: LegacyViewport, fit: LegacyFit): void;
}
interface Window {
  Live2DManager?: new () => LegacyManager;
  live2dManager?: LegacyManager | null;
  NekoMiniGameAvatarHost?: LegacyHostFactory;
  PIXI?: { Ticker?: { shared?: LegacyTicker; system?: LegacyTicker } };
}
interface LegacyAvatarConfig { mountId: string; parentOrigin: string; baseUrl: string; scripts: readonly string[]; model: string }
interface LegacyReleaseReport {
  confirmed: boolean; reason: string; errors: string[];
  modelsObserved?: number; modelsDestroyed?: boolean; appsObserved?: number;
  tickersStopped?: boolean; appsDestroyed?: boolean; contextsObserved?: number;
  contextsLost?: number; pendingLoadRetired?: boolean; sharedTickersStopped?: boolean;
}
interface LegacyEmotionResult { status: 'completed' | 'cancelled' | 'unavailable' | 'rejected'; reason?: string }
type LegacyAnnouncement = { report?: LegacyReleaseReport; requestId?: string; result?: LegacyEmotionResult; reason?: string };

/* Executed only inside the isolated legacy Live2D srcdoc document.
 * No game Pixi 8 objects or globals enter this adapter. See README.md for the
 * upstream lifetime hooks used below and the exact disposal evidence contract.
 */
function startLegacyAvatar(config: LegacyAvatarConfig) {
  let manager: LegacyManager | undefined, controller: LegacyController | undefined, avatarHost: LegacyAvatarHost | undefined;
  let initPending: Promise<unknown> | undefined, loadState: 'none' | 'pending' | 'settled' = 'none';
  let disposed = false, releasePromise: Promise<LegacyReleaseReport> | undefined;
  let resolveRelease!: (report: LegacyReleaseReport) => void;
  const apps = new Set<LegacyApplication>(), models = new Set<LegacyModel>();
  const emotionOperations = new Map<string, AbortController>();
  const errors: string[] = [];
  const safe = <T>(label: string, action: () => T): T | undefined => {
    try { return action(); } catch (error) { errors.push(`${label}: ${String(error)}`); return undefined; }
  };
  const announce = (status: 'ready' | 'error' | 'disposed' | 'emotion', data: LegacyAnnouncement = {}) => parent.postMessage({ type: 'neko-survivors-react-avatar', mountId: config.mountId, status, ...data }, config.parentOrigin);
  const ensureActive = () => { if (disposed) throw new DOMException('Avatar retired', 'AbortError'); };
  function rememberResources() {
    if (manager?.pixi_app) apps.add(manager.pixi_app);
    if (manager?.currentModel) models.add(manager.currentModel);
  }

  /** The only engine-private compatibility seam. Upstream has no manager.destroy.
   * live2d-model.js loadModel checks _activeLoadToken before installing late models;
   * removeModel cancels model timers/operations. live2d-core.js rebuildPIXI uses
   * _stopIdleFpsGovernor and detaches these viewport listeners before app.destroy.
   */
  function retireLegacyState() {
    if (!manager) return;
    const currentManager = manager;
    currentManager._activeLoadToken = (manager._activeLoadToken || 0) + 1;
    safe('cancel avatar operations', () => currentManager._cancelAvatarOperations?.());
    safe('stop idle governor', () => currentManager._stopIdleFpsGovernor?.());
    for (const [property, event] of [['_screenChangeHandler', 'resize'], ['_displayChangeHandler', 'electron-display-changed']] as const) {
      if (manager[property]) window.removeEventListener(event, manager[property]);
      manager[property] = null;
    }
    safe('pause renderer', () => currentManager.pauseRendering?.());
    safe('stop ticker', () => currentManager.pixi_app?.ticker?.stop());
  }

  function release(reason = 'dispose') {
    if (releasePromise) return releasePromise;
    releasePromise = new Promise(resolve => { resolveRelease = resolve; });
    const pendingLoadRetired = loadState === 'pending';
    disposed = true; // Synchronous retirement happens before any await or callback.
    for (const operation of emotionOperations.values()) operation.abort();
    emotionOperations.clear();
    rememberResources(); retireLegacyState();
    safe('dispose avatar host', () => avatarHost?.dispose());
    void (async () => {
      // initPIXI can finish after the caller has retired the frame. Its produced
      // renderer is still ours, and must be destroyed before acknowledging.
      if (initPending) { try { await initPending; } catch (_) {} }
      rememberResources(); retireLegacyState();
      if (manager) {
        try { await manager.removeModel?.({ skipCloseWindows: true }); }
        catch (error) { errors.push(`remove model: ${String(error)}`); }
      }
      rememberResources();
      const observations = [];
      for (const app of apps) {
        const renderer = app.renderer, ticker = app.ticker;
        const gl = renderer?.gl || renderer?.context?.gl;
        safe('stop application', () => app.stop?.());
        safe('stop ticker before destroy', () => ticker?.stop());
        safe('destroy PIXI application', () => app.destroy(true, { children: true, texture: true, baseTexture: true }));
        if (gl && !gl.isContextLost()) {
          safe('lose WebGL context', () => gl.getExtension('WEBGL_lose_context')?.loseContext());
        }
        observations.push({ tickerStopped: !ticker || ticker.started === false,
          appDestroyed: !app.renderer && !app.stage,
          contextObserved: !!gl, contextLost: gl ? gl.isContextLost() : null });
      }
      const sharedTickers = [window.PIXI?.Ticker?.shared, window.PIXI?.Ticker?.system].filter((ticker): ticker is LegacyTicker => !!ticker);
      for (const ticker of sharedTickers) safe('stop isolated global ticker', () => ticker.stop());
      const sharedTickersStopped = sharedTickers.every(ticker => ticker.started === false);
      if (manager) { manager.currentModel = null; manager.pixi_app = null; manager.isInitialized = false; }
      if (window.live2dManager === manager) window.live2dManager = null;
      const modelsDestroyed = Array.from(models).every(model => model.destroyed === true);
      const report = { confirmed: errors.length === 0 && modelsDestroyed && sharedTickersStopped && observations.every(item => item.appDestroyed && item.tickerStopped && (!item.contextObserved || item.contextLost)),
        reason, modelsObserved: models.size, modelsDestroyed, appsObserved: apps.size,
        tickersStopped: observations.every(item => item.tickerStopped), appsDestroyed: observations.every(item => item.appDestroyed),
        contextsObserved: observations.filter(item => item.contextObserved).length,
        contextsLost: observations.filter(item => item.contextLost).length,
        pendingLoadRetired, sharedTickersStopped, errors: errors.slice() };
      window.removeEventListener('message', control);
      window.removeEventListener('pagehide', pagehide);
      announce('disposed', { report }); resolveRelease(report);
    })().catch(error => {
      const report = { confirmed: false, reason, errors: [...errors, String(error)] };
      announce('disposed', { report }); resolveRelease(report);
    });
    return releasePromise;
  }
  const pagehide = () => { void release('pagehide'); };
  const control = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (typeof data !== 'object' || data === null || !('type' in data) || !('mountId' in data) || !('action' in data)) return;
    if (event.source !== parent || event.origin !== config.parentOrigin || data.type !== 'neko-survivors-react-avatar-control' || data.mountId !== config.mountId) return;
    if (data.action === 'dispose') void release('parent-dispose');
    else if (data.action === 'cancel-emotion') {
      if ('requestId' in data && typeof data.requestId === 'string') { emotionOperations.get(data.requestId)?.abort(); emotionOperations.delete(data.requestId); }
    }
    else if (data.action === 'emotion') {
      if (!('requestId' in data) || !('name' in data)) return;
      const { requestId, name } = data;
      if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) return;
      const reply = (result: LegacyEmotionResult) => announce('emotion', { requestId, result });
      if (disposed) { reply({ status: 'cancelled', reason: 'avatar_retired' }); return; }
      if (typeof name !== 'string' || !name.trim() || name.length > 64) { reply({ status: 'rejected', reason: 'invalid_emotion' }); return; }
      const setEmotion = manager?.setEmotion?.bind(manager);
      if (!controller || !setEmotion) { reply({ status: 'unavailable', reason: 'emotion_not_available' }); return; }
      // Only the latest model-owned intention may finish applying. The real
      // legacy manager supports signal/isCurrent in its public setEmotion options.
      for (const previous of emotionOperations.values()) previous.abort();
      emotionOperations.clear();
      const operation = new AbortController(); emotionOperations.set(requestId, operation);
      void (async () => {
        try {
          const applied = await setEmotion(name, { signal: operation.signal,
            isCurrent: () => !disposed && !operation.signal.aborted && emotionOperations.get(requestId) === operation });
          reply(disposed || operation.signal.aborted ? { status: 'cancelled', reason: 'avatar_emotion_cancelled' }
            : applied === false ? { status: 'unavailable', reason: 'emotion_not_applied' } : { status: 'completed' });
        } catch (error) {
          reply({ status: disposed || operation.signal.aborted ? 'cancelled' : 'unavailable', reason: String(error) });
        } finally {
          // Keep the latest operation current for model animation/timer work
          // after setEmotion returns; replacement/cancellation/disposal retires it.
          if (operation.signal.aborted && emotionOperations.get(requestId) === operation) emotionOperations.delete(requestId);
        }
      })();
    }
  };
  window.addEventListener('message', control);
  window.addEventListener('pagehide', pagehide, { once: true });

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    if (disposed) return Promise.reject(new DOMException('Avatar retired', 'AbortError'));
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, config.baseUrl);
    if (url.pathname.startsWith('/api/live2d/')) return Promise.resolve(new Response(url.pathname.endsWith('/models') ? '[]' : '{}', { headers: { 'Content-Type': 'application/json' } }));
    return nativeFetch(input, options);
  };
  void (async () => {
    for (const src of config.scripts) {
      ensureActive();
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script'); script.src = src;
        script.onload = () => resolve(); script.onerror = () => reject(new Error('script_load_failed:' + src)); document.head.append(script);
      });
    }
    ensureActive();
    const hostFactory = window.NekoMiniGameAvatarHost, Manager = window.Live2DManager;
    if (!hostFactory || typeof hostFactory.create !== 'function' || typeof hostFactory.fitLive2DModel !== 'function' || typeof Manager !== 'function') throw new Error('avatar_engine_contract_unavailable');
    avatarHost = hostFactory.create({ slots: { cat: { containerId: 'avatar', createController: async () => {
      ensureActive(); const activeManager = new Manager(); manager = activeManager; window.live2dManager = activeManager;
      initPending = activeManager.initPIXI('model', 'avatar', {});
      await initPending; rememberResources(); ensureActive();
      loadState = 'pending';
      const loadPending = activeManager.loadModel(config.model, { minimalEmbed: true });
      try { await loadPending; } finally { loadState = 'settled'; }
      rememberResources(); ensureActive();
      return {
        async setModel() { ensureActive(); },
        focus(point) { if (!disposed) activeManager.setFocus?.(point); },
        setEmotion(name) { if (!disposed) activeManager.setEmotion?.(name); },
        pause() { if (!disposed) activeManager.pauseRendering?.(); },
        resume() { if (!disposed) activeManager.resumeRendering?.(); },
        getState() { return { modelLoaded: !disposed && !!activeManager.currentModel }; },
        resize(viewport, fit) {
          if (disposed || !activeManager.pixi_app?.renderer) return;
          activeManager.pixi_app.renderer.resize(viewport.width, viewport.height);
          if (activeManager.currentModel) hostFactory.fitLive2DModel(activeManager.currentModel, viewport, fit);
        },
        dispose() { void release('controller-dispose'); },
      };
    } } } });
    controller = await avatarHost.mount({ slot: 'cat', model: { type: 'live2d', path: config.model }, viewport: { mode: 'container' }, fit: { mode: 'contain', align: 'bottom-center', padding: 4 }, resize: { mode: 'container' } });
    if (disposed) { controller.dispose(); return; }
    announce('ready');
  })().catch(error => {
    if (!disposed) { announce('error', { reason: String(error) }); void release('load-failed'); }
  });
}
