import type { HostResult, AvatarManifest, AvatarDisposalReport } from '../neko-host';
import frameRuntime from './legacy-avatar-frame.ts?avatar-runtime';

export interface AvatarMount {
  readonly ready: Promise<void>;
  /** Confirms explicit engine teardown, not just disappearance of an iframe. */
  readonly released: Promise<AvatarDisposalReport>;
  setEmotion(name: string, signal?: AbortSignal): Promise<HostResult>;
  dispose(): void;
}
const mounts = new WeakMap<HTMLElement, AvatarMount>();

function messageRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isDisposalReport(value: unknown): value is AvatarDisposalReport {
  if (!messageRecord(value) || typeof value.confirmed !== 'boolean' || typeof value.reason !== 'string') return false;
  const countKeys = ['modelsObserved', 'appsObserved', 'contextsObserved', 'contextsLost'] as const;
  const flagKeys = ['modelsDestroyed', 'appsDestroyed', 'tickersStopped', 'pendingLoadRetired', 'sharedTickersStopped'] as const;
  return countKeys.every(key => value[key] === undefined || typeof value[key] === 'number' && Number.isFinite(value[key]))
    && flagKeys.every(key => value[key] === undefined || typeof value[key] === 'boolean')
    && (value.errors === undefined || Array.isArray(value.errors) && value.errors.every(error => typeof error === 'string'));
}
function isHostStatus(value: unknown): value is HostResult['status'] {
  return value === 'completed' || value === 'cancelled' || value === 'unavailable' || value === 'rejected';
}


/** The isolated document exclusively owns the legacy Pixi 7 renderer and model. */
export function mountPluginAvatar(container: HTMLElement, host: { syncAvatar(signal?: AbortSignal): Promise<HostResult<AvatarManifest>> }, signal?: AbortSignal): AvatarMount {
  const previous = mounts.get(container); previous?.dispose();
  const cancellation = new AbortController();
  const active = signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal;
  const mountId = crypto.randomUUID();
  let frame: HTMLIFrameElement | undefined, disposing = false, finished = false;
  let disposalTimeout: ReturnType<typeof setTimeout> | undefined;
  let retryTimeout: ReturnType<typeof setTimeout> | undefined;
  let resolveRelease!: (report: AvatarDisposalReport) => void;
  const released = new Promise<AvatarDisposalReport>(resolve => { resolveRelease = resolve; });
  let lease: AvatarMount;
  const emotions = new Map<string, (result: HostResult) => void>();
  let retireEmotion: (() => void) | undefined;
  function finalize(report: AvatarDisposalReport) {
    if (finished) return;
    finished = true;
    disposing = true; cancellation.abort();
    clearTimeout(disposalTimeout); clearTimeout(retryTimeout);
    window.removeEventListener('message', lifecycleMessage);
    active.removeEventListener('abort', dispose);
    frame?.remove(); frame = undefined;
    if (mounts.get(container) === lease) mounts.delete(container);
    resolveRelease(report);
  }
  function sendDisposal() {
    if (finished || !frame) return;
    frame.contentWindow?.postMessage({ type: 'neko-survivors-react-avatar-control', mountId, action: 'dispose' }, location.origin);
    if (!finished) retryTimeout = setTimeout(sendDisposal, 100);
  }
  function dispose() {
    if (disposing) return;
    disposing = true; cancellation.abort();
    if (!frame) { finalize({ confirmed: true, reason: 'not-mounted', appsObserved: 0, contextsObserved: 0 }); return; }
    disposalTimeout = setTimeout(() => finalize({ confirmed: false, reason: 'disposal_ack_timeout' }), 3000);
    sendDisposal();
  }
  function lifecycleMessage(event: MessageEvent<unknown>) {
    const data = event.data;
    if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin || !messageRecord(data) || data.type !== 'neko-survivors-react-avatar' || data.mountId !== mountId) return;
    if (data.status === 'disposed' && isDisposalReport(data.report)) finalize(data.report);
    else if (data.status === 'emotion') {
      const result = data.result;
      if (messageRecord(result) && isHostStatus(result.status) && typeof data.requestId === 'string') {
        emotions.get(data.requestId)?.({ status: result.status, reason: typeof result.reason === 'string' ? result.reason : undefined });
      }
    }
  }
  window.addEventListener('message', lifecycleMessage);
  active.addEventListener('abort', dispose, { once: true });
  const ready = (async () => {
    await previous?.released;
    active.throwIfAborted();
    const result = await host.syncAvatar(active);
    active.throwIfAborted();
    if (result.status !== 'completed' || !result.data) throw new Error(result.reason ?? 'avatar_sync_failed');
    const { scripts, modelUrl: model, name } = result.data;
    const config = JSON.stringify({ mountId, model, scripts, baseUrl: container.ownerDocument.baseURI, parentOrigin: location.origin }).replace(/</g, '\\u003c');
    frame = document.createElement('iframe'); frame.title = name;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    frame.style.cssText = 'width:100%;height:100%;border:0;background:transparent;pointer-events:none';
    frame.srcdoc = `<!doctype html><html><head><style>html,body,#avatar{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}canvas{display:block;width:100%;height:100%}</style></head><body><div id="avatar"><canvas id="model"></canvas></div><script>${frameRuntime}\nstartLegacyAvatar(${config});<\/script></body></html>`;
    const currentFrame = frame;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('avatar_mount_timeout')), 45_000);
      const finish = (error?: Error) => {
        clearTimeout(timeout); window.removeEventListener('message', message); active.removeEventListener('abort', abort);
        if (error) reject(error); else resolve();
      };
      const abort = () => finish(new DOMException('Avatar mount cancelled', 'AbortError'));
      const message = (event: MessageEvent<unknown>) => {
        const data = event.data;
        if (event.source !== currentFrame.contentWindow || event.origin !== location.origin || !messageRecord(data) || data.type !== 'neko-survivors-react-avatar' || data.mountId !== mountId) return;
        if (data.status === 'ready') finish();
        else if (data.status === 'error') finish(new Error(String(data.reason ?? 'avatar_mount_failed')));
        else if (data.status === 'disposed') finish(new DOMException('Avatar was disposed', 'AbortError'));
      };
      window.addEventListener('message', message); active.addEventListener('abort', abort, { once: true });
      container.append(currentFrame);
    });
  })().catch((error: unknown) => { dispose(); throw error; });
  async function setEmotion(name: string, external?: AbortSignal): Promise<HostResult> {
    const signal = external ? AbortSignal.any([active, external]) : active;
    if (signal.aborted || disposing) return { status: 'cancelled', reason: 'avatar_retired' };
    if (!name.trim() || name.length > 64) return { status: 'rejected', reason: 'invalid_emotion' };
    retireEmotion?.();
    // Race readiness against cancellation, without detaching a rejected ready promise.
    return new Promise<HostResult>(resolve => {
      const requestId = crypto.randomUUID();
      let sent = false, settled = false, retired = false;
      let timeout: ReturnType<typeof setTimeout>;
      const finish = (result: HostResult) => {
        if (settled) return;
        settled = true; clearTimeout(timeout); emotions.delete(requestId);
        // Completion is only a receipt: the model can still own animation and
        // timer work. Retain its one cancellation channel until actual retirement.
        if (result.status !== 'completed') retire();
        resolve(result);
      };
      const cancelRequest = () => {
        if (!sent) return;
        try { frame?.contentWindow?.postMessage({ type: 'neko-survivors-react-avatar-control', mountId, action: 'cancel-emotion', requestId }, location.origin); }
        catch { /* A detached frame has already lost its owner. */ }
      };
      const retire = () => {
        if (retired) return;
        retired = true;
        cancelRequest();
        signal.removeEventListener('abort', retire);
        if (retireEmotion === retire) retireEmotion = undefined;
        finish({ status: 'cancelled', reason: 'avatar_emotion_cancelled' });
      };
      retireEmotion = retire;
      timeout = setTimeout(() => {
        finish({ status: 'unavailable', reason: 'avatar_emotion_timeout' });
      }, 15_000);
      signal.addEventListener('abort', retire, { once: true });
      void ready.then(() => {
        if (settled) return;
        if (signal.aborted || disposing || !frame) { retire(); return; }
        emotions.set(requestId, finish); sent = true;
        frame.contentWindow?.postMessage({ type: 'neko-survivors-react-avatar-control', mountId, action: 'emotion', requestId, name }, location.origin);
      }, error => finish({ status: signal.aborted || disposing ? 'cancelled' : 'unavailable', reason: String(error) }))
        .catch(error => finish({ status: signal.aborted || disposing ? 'cancelled' : 'unavailable', reason: String(error) }));
    });
  }
  lease = { ready, released, dispose, setEmotion }; mounts.set(container, lease);
  return lease;
}
