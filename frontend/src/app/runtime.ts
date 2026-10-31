import type {PlayerSoftQuality}from '../presentation/profile';
import { getCharacterChoices, isGameSave, isGameMeta, convertLegacyProgress } from '../game';
import type { GameCommand, GameUiSnapshot } from '../game';
import { createGameDisplay } from '../display/display';
import { createGameRenderer } from '../rendering';
import { createConnectedHost, type HostOptions, type HostResult } from '../host';
import { browserStorage, createSaveRepository } from '../storage';
import { createKeyboardInput } from '../input/keyboard';
import { createPointerInput } from '../input/pointer';
import { AudioSystem } from '../audio/audio-player.ts';
import { createDisplayLoop } from '../display/loop';
import { createSimulation } from '../simulation/client';
import type { GameOutput, Progress, Reply, Request, SimulationStats } from '../simulation/protocol';
import { detectPlatform } from './platform';
import { createHudDisplay } from './hud-display';
import { createUiStore } from './ui-store';
import { readAudioSettings, readEffectOpacity } from './audio-settings';
import { watchAvatar, type AvatarWatcher, type AvatarFeedbackKind } from './avatar-watch';
import { observeHostOutput } from './host-output';
import { createPerformanceProfile } from './performance';
import { createFrameCapture, type CaptureStage } from '../diagnostics/frame-capture';
import { t } from '../i18n';
import type { AudioSettings, AudioIssueSummary } from '../audio/types';

export interface RuntimeSnapshot {
  game: GameUiSnapshot;
  hostFeedback: Pick<HostResult, 'status' | 'reason'> | null;
  canContinue: boolean;
  audio: AudioSettings;
  audioIssue: AudioIssueSummary | null;
  effectOpacity: number;
  softQuality:PlayerSoftQuality;
  notice: { id: number; text: string; tone: 'info' | 'good' | 'bad' } | null;
  pendingCommands: number;
}

export interface RuntimeOptions extends HostOptions { signal?: AbortSignal; profile?: boolean; capture?: boolean }

export async function createRuntime(container: HTMLElement, options: RuntimeOptions = {}) {
  const platform = detectPlatform();
  const presentation = Object.freeze({ mobile: platform.mobile, resolution: platform.resolution, displayFps: platform.displayFps });
  const renderer = await createGameDisplay({ container, presentation },createGameRenderer);
  if (options.signal?.aborted) { renderer.dispose(); options.signal.throwIfAborted(); }
  const host = await createConnectedHost(options, options.signal);
  if (options.signal?.aborted) { host.dispose(); renderer.dispose(); options.signal.throwIfAborted(); }
  const repository = createSaveRepository(browserStorage());
  const audio = new AudioSystem();
  const profile = options.profile ? createPerformanceProfile() : undefined;
  const capture = options.capture ? createFrameCapture() : undefined;
  const timing = () => profile || capture?.running ? performance.now() : 0;
  function completeTiming(stage: CaptureStage, start: number) {
    if (!profile && !capture?.running) return;
    const end = performance.now();
    capture?.record(stage, start, end);
    if (stage === 'simulation' || stage === 'projection' || stage === 'renderSubmit') profile?.record(stage, end - start);
  }
  const storedSettings = repository.read('settings');
  let audioSettings = readAudioSettings(storedSettings.ok ? storedSettings.value : undefined);
  const storedMeta = repository.read('meta');
  const invalidMeta = storedMeta.ok ? storedMeta.value !== null && !isGameMeta(storedMeta.value) : storedMeta.error === 'invalid';
  const currentMeta = storedMeta.ok && storedMeta.value !== null && !invalidMeta ? storedMeta.value : undefined;
  let softQuality:PlayerSoftQuality='native';
  let effectOpacity = readEffectOpacity(storedSettings.ok ? storedSettings.value : undefined);
  renderer.setPlayerEffectOpacity(effectOpacity);
  const simulation = await createSimulation({ session: { platform: platform.platform, meta: currentMeta },
    width: container.clientWidth, height: container.clientHeight, packed: !platform.mobile,
    profile: !!(options.profile || options.capture), signal: options.signal, renderPort: renderer.thread?.renderPort }).catch(error => {
      host.dispose(); renderer.dispose(); audio.dispose(); throw error;
    });
  let disposed = false;
  let sessionAbort = new AbortController();
  const lifetime = new AbortController();
  let avatar: AvatarWatcher | undefined;
  let avatarGeneration = 0;
  let noticeId = 0;
  let notice: RuntimeSnapshot['notice'] = null;
  let noticeUntil = 0;
  let hostFeedback: RuntimeSnapshot['hostFeedback'] = null;
  let audioIssue: AudioIssueSummary | null = null;
  let lastAudioIssueId = 0;
  let audioNoticeId: number | undefined;
  const hostNotices = new Set<string>();
  const outputFailures = new Map<string, string>();
  const avatarFeedback: Partial<Record<AvatarFeedbackKind, HostResult>> = {};
  const hud = createHudDisplay(error => {
    const message = error instanceof Error ? error.message : String(error);
    outputFailures.set('hud', message.slice(0, 1024));
  });
  hud.setVisible(!document.hidden);renderer.thread?.visible(!document.hidden);
  let contextLossHandled = false;
  let ui = simulation.initial.ui;
  let pendingCommands = 0;
  const characters = getCharacterChoices();
  const initialSave = repository.read('run');
  let canContinue = initialSave.ok && isGameSave(initialSave.value);
  const store = createUiStore<RuntimeSnapshot>({ game: ui, hostFeedback, canContinue, audio: audioSettings, audioIssue, effectOpacity, softQuality, notice, pendingCommands });
  if (audio.init() === false) outputFailures.set('audio:init', audio.lastIssue?.reason ?? 'audio_initialization_failed');
  audio.setVolumes(audioSettings);
  if (audio.enabled !== audioSettings.enabled) audio.toggle();
  if (invalidMeta) announce('成长记录无效，当前使用空白成长；原记录未修改。', 'bad');

  function publish() {
    store.publish({ game: ui, hostFeedback, canContinue, audio: audioSettings, audioIssue, effectOpacity, softQuality, notice, pendingCommands });
  }
  function announce(text: string, tone: 'info' | 'good' | 'bad' = 'info') {
    notice = { id: ++noticeId, text, tone };
    noticeUntil = performance.now() + 4200;
    publish();
  }
  function persist(progress: Progress): boolean {
    const result = repository.writeProgress(progress);
    if (!result.ok) { announce(`保存失败：${result.reason}`, 'bad'); return false; }
    canContinue = progress.run !== null; publish(); return true;
  }
  async function operate(request: Request, onSuccess?: (reply: Reply) => void) {
    if (disposed) return;
    pendingCommands++; publish();
    try {
      const reply = await simulation.request(request);
      if (disposed) return;
      ui = reply.ui;
      if (reply.result.ok) onSuccess?.(reply);
      consumeOutputs(reply.outputs ?? []); publish();
      if (!reply.result.ok) announce(reply.result.reason, 'bad');
      return reply;
    } catch (error) {
      if (!disposed) announce(error instanceof Error ? error.message : String(error), 'bad');
    } finally { pendingCommands--; if (!disposed) publish(); }
  }
  async function save() {
    const reply = await operate({ kind: 'save' });
    if (!reply?.result.ok || !reply.progress) return false;
    if (reply.progress.run === null) { announce('当前没有可保存的对局', 'info'); return false; }
    return persist(reply.progress);
  }
  function receiveHostResult(result: HostResult) {
    if (disposed) return;
    hostFeedback = { status: result.status, reason: result.reason };
    if (['unavailable', 'rejected', 'throttled'].includes(result.status)) {
      const key = `${result.status}:${result.reason ?? ''}`;
      outputFailures.set('host', key);
      if (host.mode !== 'standalone' && !hostNotices.has(key)) {
        if (hostNotices.size >= 32) hostNotices.delete(hostNotices.values().next().value!);
        hostNotices.add(key);
        announce(t('ui.host.feedback', { status: t(`ui.host.result.${result.status}`), reason: result.reason ? ` · ${result.reason.slice(0, 240)}` : '' }), result.status === 'throttled' ? 'info' : 'bad');
        return;
      }
    }
    publish();
  }
  function observeAudioIssue() {
    const issue = audio.lastIssue;
    if (!issue) {
      if (audioIssue) { audioIssue = null; if (notice?.id === audioNoticeId) notice = null; publish(); }
      return;
    }
    if (issue.id === lastAudioIssueId) return;
    lastAudioIssueId = issue.id;
    audioIssue = { reason: issue.reason, recoverable: issue.recoverable, waitingForGesture: issue.waitingForGesture, resource: issue.resource };
    outputFailures.set('audio', issue.reason);
    // The reference waits silently for the first gesture. Keep this normal
    // browser gate in diagnostics rather than adding a default title toast.
    if (audioSettings.enabled && !issue.waitingForGesture) {
      announce(t(issue.recoverable ? 'ui.audio.retry' : 'ui.audio.failed', { reason: issue.reason.slice(0, 240) }), issue.recoverable ? 'info' : 'bad');
      audioNoticeId = notice?.id;
    } else publish();
  }
  function observeHost(operation: (signal: AbortSignal) => Promise<HostResult>) {
    const signal = sessionAbort.signal;
    observeHostOutput(() => operation(signal), signal, receiveHostResult);
  }
  function renewOutputLifetime() {
    sessionAbort.abort();
    sessionAbort = new AbortController();
    hostFeedback = null; hostNotices.clear();
  }
  function closeHostSession(reason: string) {
    renewOutputLifetime();
    observeHost(() => host.closeSession(reason));
  }
  function consumeOutput(output: GameOutput) {
    const event = output.event;
    switch (event.type) {
      case 'sound': audio.play(event.name, event); break;
      case 'weapon-sound': audio.playWeapon(event, event.heavy); break;
      case 'music': audio.applyMusicCue(event); break;
      case 'notice': announce(event.text, event.tone); break;
      case 'checkpoint': if (output.progress) persist(output.progress); else throw new Error('Checkpoint missing its captured progress'); break;
      case 'attempt-restarted': resetHostSession(); break;
      case 'report': observeHost(signal => host.report(event.event, event.text, signal)); break;
      case 'speech': observeHost(signal => host.speak(event.text, signal)); break;
      case 'avatar-emotion': avatar?.setEmotion(event.emotion, sessionAbort.signal); break;
      case 'run-ended': {
        // The results screen still owns this session and its final commentary.
        // Actual exit/new-run disposal retires it after the player leaves.
        if (!output.progress) throw new Error('Settlement missing its captured growth');
        persist({ run: null, meta: output.progress.meta });
        break;
      }
    }
  }
  function consume(output: GameOutput) {
    const event = output.event;
    try { consumeOutput(output); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A peripheral output failure must not freeze combat. Preserve diagnostics
      // and report once rather than throwing from every subsequent animation frame.
      if (!outputFailures.has(event.type)) announce(`输出暂不可用：${message}`, 'bad');
      outputFailures.set(event.type, message);
    }
  }
  function resetHostSession() {
    renewOutputLifetime();
    observeHost(signal => host.resetSession(signal));
  }
  async function replaceSession(save?: unknown, meta?: unknown) {
    await operate({ kind: 'replace', options: { save, meta } }, () => {
      if (ui.phase === 'title') closeHostSession('import-meta'); else resetHostSession();
      hud.clearSample(); notice = null; keyboard.clear(); loop.resetClock();
      capture?.discontinuity('session-replaced'); lastDisplayTimestamp = undefined;
      profile?.resetFrameClock(); simulation.requestFrame();
    });
  }
  async function dispatch(command: GameCommand) {
    if (disposed) return;
    audio.unlock();
    const prepared = (command.type === 'start-run' || command.type === 'start-challenge') && command.options.seed === undefined
      ? { ...command, options: { ...command.options, seed: crypto.getRandomValues(new Uint32Array(1))[0] } } : command;
    await operate({ kind: 'command', command: prepared }, () => {
      if (command.type === 'return-title') closeHostSession('return-title');
      else if (['start-run', 'start-challenge'].includes(command.type)) { hud.clearSample(); resetHostSession(); }
      simulation.requestFrame();
    });
  }
  function setAudio(settings: AudioSettings) {
    audioSettings = settings;
    audio.setVolumes(settings);
    if (audio.enabled !== settings.enabled) audio.toggle();
    const saved = repository.writeSettings({ ...settings, playerEffectOpacity: effectOpacity });
    if (!saved.ok) announce(`声音设置保存失败：${saved.reason}`, 'bad');
    publish();
  }
  function setEffectOpacity(value: number) {
    if (!Number.isFinite(value)) return;
    effectOpacity = Math.max(0, Math.min(1, value));
    renderer.setPlayerEffectOpacity(effectOpacity);
    const result = repository.writeSettings({ ...audioSettings, playerEffectOpacity: effectOpacity });
    if (!result.ok) announce(`画面设置保存失败：${result.reason}`, 'bad');
    publish();
  }
  const keyboard = createKeyboardInput(window, action => {
    if (action === 'mute') setAudio({ ...audioSettings, enabled: !audioSettings.enabled });
    else void operate({ kind: 'shortcut', action });
  });
  const pointer = createPointerInput(container);
  let frameTimestamp = 0;
  let lastDisplayTimestamp: number | undefined;
  let workerCaptureStart: SimulationStats | undefined;
  let workerSamples: NonNullable<import('../diagnostics/frame-capture').FrameCapture['worker']>['samples'] = [];
  let captureState: 'idle' | 'starting' | 'recording' | 'stopping' = 'idle';
  let audioOutputStep = -1;
  function consumeOutputs(outputs: readonly GameOutput[]) {
    for (const output of outputs) {
      if (output.step !== audioOutputStep) { audio.beginFrame(); audioOutputStep = output.step; }
      consume(output);
    }
  }
  const unsubscribeSimulation = simulation.subscribe(message => {
    if (disposed) return;
    if (message.kind === 'failure') {
      outputFailures.set('simulation', message.message);
      announce(`模拟已停止：${message.message}`, 'bad'); renderer.thread?.visible(false);loop.stop(); return;
    }
    const started = timing();
    consumeOutputs(message.outputs);
    if (message.ui) { ui = message.ui; publish(); }
    completeTiming('output', started);

  });
  const loop = createDisplayLoop({
    // Input/UI do not need an unbounded clock when rendering owns another RAF.
    displayFps: renderer.thread ? 120 : platform.displayFps,
    onFrame: timestamp => { frameTimestamp = timestamp; capture?.beginFrame(timestamp); },
    onError(error) {
      const message = error instanceof Error ? error.message : String(error);
      outputFailures.set('frame', message); void simulation.request({ kind: 'suspend', suspended: true }).catch(() => {});
      announce(`运行已暂停：${message}`, 'bad');
    },
    render() {
      const inputStart = timing(); observeAudioIssue();
      if (renderer.contextLost && !contextLossHandled) {
        contextLossHandled = true;
        void simulation.request({ kind: 'suspend', suspended: true }).catch(() => {});
        if (!['title', 'paused', 'result', 'endless-prompt'].includes(ui.phase)) {
          void dispatch({ type: 'pause' }); announce(t('ui.renderingLost', {}, '画面暂时中断，游戏已暂停；恢复后可以继续'), 'info');
        }
      } else if (!renderer.contextLost && contextLossHandled) {
        contextLossHandled = false; void simulation.request({ kind: 'suspend', suspended: document.hidden }).catch(() => {});
      }
      const keys = keyboard.sample(), point = pointer.sample(), worldPoint = renderer.screenToWorld(point.x, point.y);
      const displaySeconds = lastDisplayTimestamp === undefined ? undefined : (frameTimestamp - lastDisplayTimestamp) / 1000;
      lastDisplayTimestamp = frameTimestamp;
      simulation.setInput({ ...keys, aimX: worldPoint.x, aimY: worldPoint.y, manualAim: point.down,
        ...(platform.mobile && displaySeconds !== undefined ? { displaySeconds } : {}) });
      completeTiming('input', inputStart);
      if(renderer.thread?.failure)throw new Error(renderer.thread.failure);
      const display = renderer.thread ? undefined : simulation.takeFrame(); simulation.requestFrame();
      const status=renderer.thread?.status;
      const frame=status?.frame??display?.frame;
      if(!frame)return;
      if(!renderer.thread&&display){const renderStart=timing();renderer.render(display.frame,frameTimestamp,display);completeTiming('renderSubmit',renderStart);}
      const hudStart = timing();
      hud.publish({ timestampMs: frameTimestamp, combat: frame.combat, hud: frame.hud ?? null, chrome: frame.hudChrome ?? null });
      completeTiming('hud', hudStart);
      const counts = status?.counts ?? (display ? {actors:display.frame.actors.length,projectiles:display.frame.projectiles.length+(display.frame.transients?display.frame.transients.playerCount+display.frame.transients.enemyCount:0),effects:display.frame.effects.length,pickups:display.frame.pickups.length+(display.frame.transients?.pickupCount??0)} : {actors:0,projectiles:0,effects:0,pickups:0});
      if (capture?.running && display) {
        if (workerSamples.length < 60000) workerSamples.push({ receivedAt: performance.timeOrigin + performance.now(), frameAgeMs: simulation.frameAgeMs, stats: display.stats, step: display.step, rafMs: frameTimestamp, packetAgeMs: Math.max(0, performance.timeOrigin + performance.now() - display.producedAt) });
        else capture.finish('worker-sample-limit');
      }
      capture?.frame({ phase: frame.phase, wave: ui.wave, combat: frame.combat && ui.combat && !renderer.contextLost && !document.hidden, ...counts });
      profile?.frame(frame.phase, counts, frameTimestamp);
      if (notice && performance.now() > noticeUntil) { notice = null; publish(); }
    },
  });
  const observer = new ResizeObserver(() => {
    renderer.resize(container.clientWidth, container.clientHeight);
    void simulation.request({ kind: 'viewport', width: container.clientWidth, height: container.clientHeight }).catch(() => {});
  });
  observer.observe(container);
  function visibility() {
    hud.setVisible(!document.hidden);
    renderer.thread?.visible(!document.hidden);
    keyboard.clear();
    loop.resetClock();
    capture?.discontinuity('clock-reset');
    lastDisplayTimestamp = undefined;
    profile?.resetFrameClock();
    void simulation.request({ kind: 'suspend', suspended: document.hidden || renderer.contextLost }).catch(() => {});
    if (document.hidden && !['title', 'paused', 'result', 'endless-prompt'].includes(ui.phase)) void dispatch({ type: 'pause' });
  }
  document.addEventListener('visibilitychange', visibility);
  function disposeRuntime() {
      if (disposed) return;
      disposed = true;
      capture?.finish('runtime-disposed');
      hud.dispose();
      sessionAbort.abort();
      // Start bounded host cleanup and retain its receipt after the runtime retires.
      observeHostOutput(() => host.closeSession('dispose'), undefined, result => {
        if (result.status !== 'completed') {
          outputFailures.set('host:dispose', result.reason ?? result.status);
          console.error('Host session cleanup was not confirmed', result.reason ?? result.status);
        }
      });
      const cleanup: readonly (readonly [string, () => void])[] = [
        ['simulation-listener', unsubscribeSimulation], ['simulation', () => simulation.dispose()], ['lifetime', () => lifetime.abort()], ['avatar', () => { avatar?.dispose(); avatar = undefined; }], ['loop', () => loop.stop()],
        ['resize', () => observer.disconnect()], ['visibility', () => document.removeEventListener('visibilitychange', visibility)],
        ['keyboard', () => keyboard.dispose()], ['pointer', () => pointer.dispose()], ['host', () => host.dispose()],
        ['audio', () => audio.dispose()], ['renderer', () => renderer.dispose()], ['store', () => store.dispose()],
      ];
      const errors: string[] = [];
      for (const [name, release] of cleanup) {
        try { release(); } catch (error) { errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
      }
      if (errors.length) {
        outputFailures.set('dispose', errors.join('; '));
        console.error('Could not release every game runtime resource', errors);
      }
    options.signal?.removeEventListener('abort', disposeRuntime);
  }
  options.signal?.addEventListener('abort', disposeRuntime, { once: true });
  if (options.signal?.aborted) { disposeRuntime(); options.signal.throwIfAborted(); }
  try {
    consumeOutputs(simulation.initial.outputs ?? []);
    await simulation.request({ kind: 'suspend', suspended: document.hidden || renderer.contextLost });
    await simulation.request({ kind: 'start' }); simulation.requestFrame(); loop.start();
  }
  catch (error) { disposeRuntime(); throw error; }

  return {
    characters,
    presentation,
    async startPerformanceCapture() {
      if (!capture || disposed) throw new Error('Open with ?profile=1 to enable capture');
      if (captureState !== 'idle' || capture.running) throw new Error('Capture is already starting or running');
      captureState = 'starting';
      try {
      const marker = await simulation.request({ kind: 'metrics' });
      workerCaptureStart = marker.stats; workerSamples = [];
      const metadata={ threadModel: renderer.thread?'main-ui/simulation-worker/render-worker':'simulation-worker/main-render', timeOriginEpochMs: performance.timeOrigin, seed: ui.seed, difficulty: ui.difficulty,
        playerAtStart: ui.players[0] ? { characterId: ui.players[0].characterId, level: ui.players[0].level, hp: ui.players[0].hp,
          stats: Object.fromEntries(ui.players[0].statDetails.map(s => [s.statId, s.value])),
          weapons: ui.players[0].weapons.map(w => ({ id: w.definitionId, level: w.level })) } : null,
        partySize: ui.players.length, startPhase: ui.phase, startWave: ui.wave, renderer: renderer.diagnostics,
        viewport: { width: container.clientWidth, height: container.clientHeight, resolution: presentation.resolution,
          canvasWidth: renderer.canvas.width, canvasHeight: renderer.canvas.height },
        userAgent: navigator.userAgent };
      if(renderer.thread)await renderer.thread.startCapture(metadata,marker.stats);
      capture.start(metadata);
      captureState = 'recording';
      } catch(error) {captureState='idle';throw error;}
    },
    async stopPerformanceCapture() {
      if (!capture) throw new Error('Capture is disabled');
      if (captureState !== 'recording') throw new Error('Capture is not ready to stop');
      captureState = 'stopping';
      try {
      const main = capture.stop();if(!renderer.thread)main.gpuExecution=renderer.diagnostics.gpuTiming;
      const rendered=renderer.thread?await renderer.thread.stopCapture():undefined;
      const end = await simulation.request({ kind: 'metrics' });
      if(rendered){return {...rendered,mainThread:main,worker:rendered.worker?{...rendered.worker,end:end.stats}:undefined};}
      return { ...main, worker: { start: workerCaptureStart, end: end.stats, samples: workerSamples,
        note: 'Worker markers delimit their own window; main-thread simulation/projection spans are absent. CPU samples must target the worker separately.' } };
      }finally{captureState='idle';}
    },
    probeRenderingContext(lost:boolean){if(renderer.thread)renderer.thread.probeContext(lost);else renderer.probeContext(lost);},
    setPlayerSoftQuality(value:PlayerSoftQuality){if(captureState !== 'idle'){announce('采集期间不能切换柔光质量，请先停止采集。','info');return false;}renderer.setPlayerSoftQuality(value);softQuality=value;publish();return true;},
    setGpuTiming(enabled:boolean){if(captureState !== 'idle'){announce('采集期间不能切换GPU计时，请先停止采集。','info');return;}if(renderer.thread)renderer.thread.gpuTiming(enabled);else renderer.setGpuTiming(enabled);},
    hudDisplay: hud.display,
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    dispatch,
    setAudio,
    setEffectOpacity,
    async save() { const success = await save(); if (success) announce('进度已保存', 'good'); return success; },
    async setSimulationSpeed(speed: number) { return (await operate({ kind: 'speed', speed }))?.result.ok ?? false; },
    async continueRun() {
      let saved = repository.read('run');
      if (!saved.ok) { announce(`无法读取存档：${saved.reason}`, 'bad'); return; }
      if (saved.value === null) { announce('没有可继续的存档', 'info'); return; }
      try { await replaceSession(saved.value); audio.unlock(); }
      catch (error) { announce(error instanceof Error ? error.message : '存档无效', 'bad'); }
    },
    async importLegacyRun() {
      const saved = repository.importLegacyProgress(convertLegacyProgress);
      if (!saved.ok) { announce(`旧存档导入失败：${saved.reason}`, 'bad'); return; }
      if (saved.value === null) { announce('没有可导入的旧存档，或新版已有存档', 'info'); return; }
      try {
        await replaceSession(saved.value.run ?? undefined, saved.value.meta);
        const settings = repository.read('settings');
        effectOpacity = readEffectOpacity(settings.ok ? settings.value : undefined);
        renderer.setPlayerEffectOpacity(effectOpacity);
        canContinue = saved.value.run !== null; publish(); audio.unlock();
      } catch (error) { announce(error instanceof Error ? error.message : '旧存档无效', 'bad'); }
    },
    watchAvatar(slot: HTMLElement, visible: (value: boolean) => void) {
      const generation = ++avatarGeneration;
      avatar?.dispose();
      const owned = watchAvatar(host, slot, visible, lifetime.signal, (kind, result) => {
        if (kind === 'retired-release' || generation !== avatarGeneration) {
          if ((kind === 'release' || kind === 'retired-release') && result.status !== 'completed' && result.status !== 'cancelled') {
            outputFailures.set('avatar:retired-release', result.reason ?? result.status);
            console.error('Retired avatar cleanup was not confirmed', result.reason ?? result.status);
          }
          return;
        }
        avatarFeedback[kind] = result;
        const key = `avatar:${kind}`;
        if (result.status === 'completed') outputFailures.delete(key);
        else if (result.status !== 'cancelled') {
          outputFailures.set(key, result.reason ?? result.status);
          if (disposed) console.error('Avatar cleanup was not confirmed', result.reason ?? result.status);
        }
      });
      avatar = owned;
      return () => { owned.dispose(); if (avatar === owned) avatar = undefined; };
    },
    get diagnostics() { return { threadModel:renderer.thread?'simulation-worker/render-worker':'simulation-worker/main-render', renderThread:renderer.thread?.status?{revision:renderer.thread.status.revision,step:renderer.thread.status.step,renderedFrames:renderer.thread.status.renderedFrames,frameAgeMs:Math.max(0,performance.timeOrigin+performance.now()-renderer.thread.status.stateAt)}:undefined, ...renderer.diagnostics, backend: renderer.backend, hostMode: host.mode, avatarFeedback: { ...avatarFeedback }, outputFailures: Object.fromEntries(outputFailures),
      environment: { platform: platform.platform, displayFps: platform.displayFps ?? null, resolution: platform.resolution, userAgent: globalThis.navigator?.userAgent, viewportWidth: container.clientWidth, viewportHeight: container.clientHeight,
        canvasWidth: renderer.canvas.width, canvasHeight: renderer.canvas.height, dpr: globalThis.devicePixelRatio || 1 },
      performance: profile?.snapshot(), simulation: { ...simulation.stats, frameAgeMs: simulation.frameAgeMs } }; },
    dispose: disposeRuntime,
  };
}
export type GameRuntime = Awaited<ReturnType<typeof createRuntime>>;
