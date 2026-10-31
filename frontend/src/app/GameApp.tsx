import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRuntime, type GameRuntime } from './runtime';
import { GameScreen } from '../ui/GameScreen';
import { I18nProvider } from '../ui/i18n';
import { t } from '../i18n';
import type { HostOptions } from '../host';
import { bindPageLifecycle } from './browser-lifecycle';
import { UiSymbols } from '../ui/components/UiSymbols';
import { PerformanceCapturePanel } from './PerformanceCapturePanel';

const RuntimeDiagnostics = memo(function RuntimeDiagnostics({ runtime }: { runtime: GameRuntime }) {
  const [snapshot, setSnapshot] = useState(() => runtime.diagnostics);
  useEffect(() => {
    const timer = window.setInterval(() => setSnapshot(runtime.diagnostics), 1000);
    return () => window.clearInterval(timer);
  }, [runtime]);
  return <details className="runtime-diagnostics" open><summary>运行诊断 · CPU 时间不代表 GPU 执行时间</summary>
    <pre data-testid="runtime-diagnostics">{JSON.stringify(snapshot, null, 2)}</pre>
  </details>;
});

function AvatarPanel({ runtime }: { runtime: GameRuntime }) {
  const slot = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!slot.current) return;
    return runtime.watchAvatar(slot.current, setReady);
  }, [runtime]);
  return <div id="neko-panel" className="neko-panel">
    <div id="neko-avatar-slot" className="neko-avatar-slot" ref={slot} style={{ visibility: ready ? 'visible' : 'hidden' }} />
  </div>;
}

function RunningInterface({ runtime, diagnostics, profiling, onExit }: { runtime: GameRuntime; diagnostics: boolean; profiling: boolean; onExit(): void }) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  return <>
    <AvatarPanel runtime={runtime} />
    <GameScreen presentation={runtime.presentation} snapshot={state.game} characters={runtime.characters} canContinue={state.canContinue}
      hostFeedback={state.hostFeedback} audio={state.audio} audioIssue={state.audioIssue} dispatch={runtime.dispatch}
      onContinue={runtime.continueRun} onImportLegacy={runtime.importLegacyRun} onSave={runtime.save} onAudio={runtime.setAudio}
      effectOpacity={state.effectOpacity} onEffectOpacity={runtime.setEffectOpacity} softQuality={state.softQuality} onSoftQuality={runtime.setPlayerSoftQuality} onExit={onExit} showAdvanced={diagnostics} hudDisplay={runtime.hudDisplay} />
    {state.pendingCommands > 0 && <div className="notifications" role="status"><div className="notification">正在处理操作…</div></div>}
    {state.notice && <div className="notifications" aria-live="polite"><div className={`notification ${state.notice.tone}`}>{state.notice.text}</div></div>}
    {diagnostics && <RuntimeDiagnostics runtime={runtime} />}
    {profiling && <PerformanceCapturePanel runtime={runtime} softQuality={state.softQuality} />}
  </>;
}

export function GameApp({ hostOptions, diagnostics = false, profiling = false }: { hostOptions?: HostOptions; diagnostics?: boolean; profiling?: boolean }) {
  const mount = useRef<HTMLDivElement>(null);
  const [runtime, setRuntime] = useState<GameRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageEpoch, setPageEpoch] = useState(0);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (closing) {
      let fallback: ReturnType<typeof setTimeout>;
      const timer = setTimeout(() => {
        try { window.close(); } catch { /* The reference falls back to its root when close is unavailable. */ }
        fallback = setTimeout(() => { if (!window.closed) window.location.assign('/'); }, 150);
      }, 600);
      return () => { clearTimeout(timer); clearTimeout(fallback); };
    }
    if (!mount.current) return;
    let cancelled = false;
    let active: GameRuntime | null = null;
    const lifetime = new AbortController();
    const unbindPage = bindPageLifecycle(window, () => {
      cancelled = true; lifetime.abort(); active?.dispose();
    }, () => {
      setRuntime(null); setError(null); setPageEpoch(value => value + 1);
    });
    void createRuntime(mount.current, { ...hostOptions, profile: diagnostics, capture: profiling, signal: lifetime.signal }).then(created => {
      if (cancelled) { created.dispose(); return; }
      active = created;
      setRuntime(created);
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { unbindPage(); cancelled = true; lifetime.abort(); active?.dispose(); };
  }, [hostOptions, diagnostics, profiling, pageEpoch, closing]);
  return <main id="app" className="game-shell"><UiSymbols /><div className="game-canvas" ref={mount} />
    {runtime && !closing && <I18nProvider><RunningInterface runtime={runtime} diagnostics={diagnostics} profiling={profiling} onExit={async () => { if (['title', 'result'].includes(runtime.getSnapshot().game.phase) || await runtime.save()) setClosing(true); }} /></I18nProvider>}
    {closing && <div className="notifications" role="status"><div className="notification">正在关闭游戏…</div></div>}
    {!runtime && !error && !closing && <div className="loading-screen">{t('ui.loading')}</div>}
    {error && <div className="error-screen" role="alert"><article><h1>{t('ui.error.title')}</h1><p>{t('ui.error.description')}</p><pre>{error}</pre><button onClick={() => location.reload()}>{t('ui.error.retry')}</button></article></div>}
  </main>;
}
