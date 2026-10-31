import { BGM_DIR, BGM_POOLS, CHALLENGE_MUSIC_FILES, lookupCatalog, pickTrack, resolveScene } from './sound-catalog.ts';
import type { SceneOptions } from './sound-catalog.ts';
import type { AudioMusicCue } from './types.ts';
import { isRetryablePlaybackError } from './playback-error.ts';

type MusicRequest = { kind: 'scene'; scene: string; opts: SceneOptions } | { kind: 'cue'; cue: AudioMusicCue };
interface MusicAttempt {
  request: MusicRequest;
  status: 'active' | 'blocked' | 'failed';
  track: string;
  key: string | null;
  resource: string;
}
interface MusicDiagnostics {
  issueId(): number | undefined;
  report(resource: string | undefined, error: unknown, recoverable?: boolean): void;
  clear(resource: string, issueId: number | undefined): void;
}
interface MusicOutput {
  context: AudioContext | null;
  bus: GainNode | null;
  enabled: boolean;
  master: number;
  music: number;
}

/** Owns streaming BGM, its current request, retry and asynchronous lifetime. */
export class MusicPlayback {
  private element: HTMLAudioElement | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private errorListener: ((event: Event) => void) | null = null;
  private current: MusicAttempt | null = null;
  private readonly failedTracks = new Set<string>();
  private readonly lastByKey = new Map<string, string>();
  private output: MusicOutput = { context: null, bus: null, enabled: true, master: .75, music: .4 };
  private challengeVolume = 1;
  private disposed = false;
  private retrying = false;
  private readonly diagnostics: MusicDiagnostics;
  private readonly random = Math.random;

  constructor(diagnostics: MusicDiagnostics) {
    this.diagnostics = diagnostics;
  }

  setOutput(output: MusicOutput) {
    this.output = output;
    this.syncVolume();
  }

  playScene(scene: string, opts: SceneOptions | null = {}): string | null {
    if (this.disposed) return null;
    const resolved = resolveScene(scene, opts);
    if (!resolved) return null;
    const { key, pool } = resolved;
    const trackBefore = this.current?.status === 'failed' ? null : this.current?.track;
    const usable = pool.filter(track => !this.failedTracks.has(track));
    if (!usable.length) { this.stop(); return null; }
    const track = pickTrack(usable, this.lastByKey.get(key) || trackBefore || null, this.random);
    if (!track) return null;
    const request: MusicRequest = { kind: 'scene', scene, opts: { ...opts } };
    if (this.current?.key === key && this.current.track === track && this.current.status === 'active') {
      this.current.request = request;
      return track;
    }
    if (this.start(request, track, key, `${BGM_DIR}/${track}`, true) !== true) return null;
    this.lastByKey.set(key, track);
    return track;
  }

  applyCue({ track, stop = false, position, volume, scene, wave }: AudioMusicCue) {
    if (this.disposed) return;
    if (stop) { this.stop(); return; }
    if (track && (lookupCatalog(CHALLENGE_MUSIC_FILES, track) || !lookupCatalog(BGM_POOLS, track))) {
      if (!/^[a-z0-9_-]+(?:\.ogg|\.wav)?$/i.test(track)) return;
      const filename = /\.(ogg|wav)$/i.test(track) ? track : `${track}.ogg`;
      if (this.failedTracks.has(filename)) { this.stop(); return; }
      const request: MusicRequest = { kind: 'cue', cue: { track, position, volume, scene, wave } };
      // Named cue replays keep their position unless an explicit seek is supplied.
      // Scene replays, including gesture retries, restart a paused same-track file.
      if (this.start(request, filename, track, lookupCatalog(CHALLENGE_MUSIC_FILES, track) ?? `${BGM_DIR}/${filename}`, false) === null) return;
    } else if (track) this.playScene(track);
    else if (scene) this.playScene(scene === 'title' ? 'open' : scene === 'result' ? 'end' : scene, { wave });
    if (!track && volume === undefined) this.challengeVolume = 1;
    if (this.element && typeof position === 'number' && Number.isFinite(position)) {
      try { this.element.currentTime = Math.max(0, position); } catch {}
    }
    if (typeof volume === 'number' && Number.isFinite(volume)) this.challengeVolume = Math.max(0, Math.min(1, volume));
    this.syncVolume();
  }

  retry() {
    if (this.disposed || this.retrying || this.current?.status !== 'blocked') return;
    const { request } = this.current;
    this.retrying = true;
    try {
      if (request.kind === 'cue') this.applyCue(request.cue);
      else this.playScene(request.scene, request.opts);
    } catch (error) { this.diagnostics.report(this.element?.src, error); }
    finally { this.retrying = false; }
  }

  stop() {
    // Detach request identity before pause(): cancellation can settle old promises.
    this.current = null;
    if (this.element && this.errorListener) this.element.removeEventListener('error', this.errorListener);
    this.errorListener = null;
    if (this.element) {
      try { this.element.pause(); } catch {}
      try { this.element.currentTime = 0; } catch {}
    }
    // Keep scene history across stops so the next selection avoids its last song.
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    if (this.element) {
      this.element.pause();
      this.element.removeAttribute('src');
      this.element.load();
    }
    this.source?.disconnect();
    this.element = null;
    this.source = null;
  }

  private syncVolume() {
    const { bus, enabled, master, music } = this.output;
    if (bus) bus.gain.value = music * this.challengeVolume;
    if (this.element && !this.source) {
      try { this.element.volume = enabled ? Math.max(0, Math.min(1, master * music * this.challengeVolume)) : 0; } catch {}
    }
  }

  private ensureElement() {
    if (this.element) return this.element;
    const Ctor = (typeof window !== 'undefined' && window.Audio) || (typeof Audio !== 'undefined' ? Audio : null);
    if (!Ctor) { this.diagnostics.report(undefined, 'HTMLAudioElement is unavailable in this browser', false); return null; }
    try {
      const element = new Ctor();
      element.preload = 'auto'; element.loop = true;
      this.element = element;
      const { context, bus } = this.output;
      try {
        if (context && bus && typeof context.createMediaElementSource === 'function') {
          this.source = context.createMediaElementSource(element);
          this.source.connect(bus);
        }
      } catch { this.source = null; }
      this.syncVolume();
      return element;
    } catch (error) { this.diagnostics.report(undefined, error); return null; }
  }

  private start(request: MusicRequest, track: string, key: string, resource: string, restartSame: boolean) {
    const element = this.ensureElement();
    if (!element) return null;
    const previous = this.current;
    const attempt: MusicAttempt = { request, status: 'active', track, key, resource };
    this.current = attempt;
    const issueId = this.diagnostics.issueId();
    try {
      element.loop = true;
      if (previous?.status === 'failed' || previous?.track !== track) element.src = resource;
      else if (restartSame) { try { element.currentTime = 0; } catch {} }
      else attempt.key = previous.key;
      this.bindError(element, attempt);
      element.play()?.then(() => {
        if (this.current === attempt && attempt.status === 'active') this.diagnostics.clear(resource, issueId);
      }).catch(error => this.failed(attempt, error));
      return true;
    } catch (error) { this.failed(attempt, error); return false; }
  }

  private bindError(element: HTMLAudioElement, attempt: MusicAttempt) {
    if (this.errorListener) element.removeEventListener('error', this.errorListener);
    const started = performance.now();
    this.errorListener = event => {
      if (this.disposed || this.current !== attempt) return;
      const selected = element.currentSrc || element.src;
      if (selected && selected !== attempt.resource && !selected.endsWith(`/${attempt.resource.replace(/^\.\//, '')}`)) return;
      if (event.timeStamp && event.timeStamp < started - 1) return;
      this.failed(attempt, element.error || new Error('Audio media resource failed to load'));
    };
    element.addEventListener('error', this.errorListener);
  }

  private failed(attempt: MusicAttempt, error: unknown) {
    if (this.disposed || this.current !== attempt || attempt.status === 'failed') return;
    const blocked = isRetryablePlaybackError(error);
    this.diagnostics.report(attempt.resource, error, blocked);
    try { this.element?.pause(); } catch {}
    attempt.status = blocked ? 'blocked' : 'failed';
    if (!blocked) this.failedTracks.add(attempt.track);
  }
}
