// 音频系统
//
// 音效（SFX）：原始文件及内嵌解码补偿与 WebAudio 实时合成。
//
// BGM：只使用原音频文件；加载失败或自动播放被拦时保持静音。
// AudioContext 用户手势解锁、文件音轨及已有合成 SFX 共用音量总线。
// lastIssue 提供当前未恢复的最新问题；请求身份和生命周期避免迟到结果改写状态。
// 内嵌 OGG 数据供文件音效解码补偿使用。
import { SE_DATA } from './se-data.ts';
import { playCometSound } from './comet-sounds.ts';
import { CHALLENGE_SOUND_FILES } from './sound-catalog.ts';
import { MusicPlayback } from './music-playback.ts';
import { audioErrorReason, isRetryablePlaybackError, playbackErrorFields } from './playback-error.ts';

import { SE_DIR, SE_LIB, SE_MIN_GAP, SE_GAP_DEFAULT, WEAPON_SFX_GAP, WEAPON_SFX_GAIN, lookupCatalog } from './sound-catalog.ts';

import type { AudioMusicCue } from './types.ts';

interface AudioIssue { id: number; kind: 'initialization' | 'music' | 'sound'; resource?: string; reason: string; recoverable: boolean; waitingForGesture: boolean }
interface WeaponSound { kind?: string; behavior?: string; tier?: number }
interface SoundOptions { volume?: number; playbackRate?: number; duration?: number }
interface ToneOptions { type?: OscillatorType; freq?: number; freqEnd?: number | null; dur?: number; gain?: number; attack?: number; delay?: number; bus?: AudioNode | null }
interface NoiseOptions { dur?: number; gain?: number; delay?: number; filter?: BiquadFilterType; freq?: number; freqEnd?: number | null; q?: number }

const NOTE = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

/** 音名 → 频率。例如 noteFreq('A', 4) = 440 */
function noteFreq(name: keyof typeof NOTE, octave: number) {
  const semi = NOTE[name];
  if (semi === undefined) return 440;
  const midi = (octave + 1) * 12 + semi;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class AudioSystem {
  private ctx: AudioContext | null;
  private ready: boolean;
  private _enabled: boolean;
  private masterVolume: number;
  private sfxVolume: number;
  private musicVolume: number;
  private _master: GainNode | null;
  private _sfxBus: GainNode | null;
  private _musicBus: GainNode | null;
  private _noiseBuf: AudioBuffer | null;
  private _lastPlayed: Map<string, number>;
  private _weaponBudget: number;
  private _seBuffers: Map<string, AudioBuffer>;
  private _seDecoding: Set<string>;
  private _voiceTimers: Set<ReturnType<typeof setTimeout>>;
  private _voices: Set<HTMLAudioElement>;
  private _disposed: boolean;
  private _lastIssue: Readonly<AudioIssue> | null;
  private _issueId: number;
  private _resumePending: boolean;
  private _unlockListening: boolean;
  private _seDecodeFailed: Set<string>;
  private _soundRequestId: number;
  private _soundRequests: Map<string, number>;
  private _seEls: Map<string, HTMLAudioElement>;
  private _seFrame: Set<string>;
  private _seLastAt: Partial<Record<string, number>>;
  private readonly music: MusicPlayback;
  private _rand: () => number;
  private _unlockBound: () => void;

  private get context(): AudioContext {
    if (!this.ctx) throw new Error('AudioContext is not initialized');
    return this.ctx;
  }
  private get soundBus(): GainNode {
    if (!this._sfxBus) throw new Error('Sound bus is not initialized');
    return this._sfxBus;
  }

  constructor() {
    this.ctx = null;
    this.ready = false;
    this._enabled = true;
    this.masterVolume = 0.75;
    this.sfxVolume = 0.85;
    this.musicVolume = 0.4;

    this._master = null;
    this._sfxBus = null;
    this._musicBus = null;
    this._noiseBuf = null;

    // 同一帧内同类音效的节流（避免 200 只敌人同时死亡炸掉扬声器）
    this._lastPlayed = new Map();

    // 每帧最多三个武器音，另按音色类别限制触发间隔。
    this._weaponBudget = 0;

    // 解码、媒体模板与异步请求各自保存当前拥有者。
    this._seBuffers = new Map();     // name -> AudioBuffer（内嵌 ogg 解码缓存）
    this._seDecoding = new Set();    // 正在解码的文件（防重复 decodeAudioData）
    this._voiceTimers = new Set();
    this._voices = new Set();
    this._disposed = false;
    this._lastIssue = null;
    this._issueId = 0;
    this._resumePending = false;
    this._unlockListening = false;
    this._seDecodeFailed = new Set();
    this._soundRequestId = 0;
    this._soundRequests = new Map();
    this._seEls = new Map();         // name -> 模板 <audio>（主通道，播 ogg）
    this._seFrame = new Set();       // 本帧已响过的原版音效（th06 同帧去重）
    this._seLastAt = {};             // name -> 上次真正出声的时刻（第六十八轮限频）

    this.music = new MusicPlayback({
      issueId: () => this._lastIssue?.id,
      report: (resource, error, recoverable) => this._issue('music', resource, error, recoverable),
      clear: (resource, issueId) => this._clearIssue('music', resource, issueId),
    });
    /** 随机源。抽出来是为了让测试能确定性地驱动随机挑选 */
    this._rand = Math.random;

    // 用户手势后才能真正出声
    this._unlockBound = () => this.unlock();
  }

  get enabled() { return this._enabled; }

  /** Current latest issue, or null after matching recovery; ids remain monotonic. */
  get lastIssue() { return this._lastIssue; }

  private _issue(kind: AudioIssue['kind'], resource: string | undefined, error: unknown, recoverable = isRetryablePlaybackError(error), waitingForGesture = playbackErrorFields(error).name === 'NotAllowedError') {
    if (this._disposed) return;
    const reason = audioErrorReason(error);
    const old = this._lastIssue;
    if (old && old.kind === kind && old.resource === resource && old.reason === reason && old.recoverable === recoverable && old.waitingForGesture === waitingForGesture) return;
    this._lastIssue = Object.freeze({ id: ++this._issueId, kind, ...(resource ? { resource } : {}), reason, recoverable, waitingForGesture });
  }

  // Success can only resolve the exact issue observed when this request began.
  // A later failure (even for the same resource) belongs to a different request.
  private _clearIssue(kind: AudioIssue['kind'], resource: string | undefined, expectedId: number | undefined) {
    const issue = this._lastIssue;
    if (!this._disposed && issue && issue.id === expectedId && issue.kind === kind && issue.resource === resource) this._lastIssue = null;
  }

  private _beginSoundRequest(resource: string) {
    const request = ++this._soundRequestId;
    this._soundRequests.delete(resource);
    this._soundRequests.set(resource, request);
    if (this._soundRequests.size > 64) {
      const oldest = this._soundRequests.keys().next();
      if (!oldest.done) this._soundRequests.delete(oldest.value);
    }
    return request;
  }

  private _soundAccepted(resource: string, request: number, issueId: number | undefined) {
    if (this._soundRequests.get(resource) === request) this._clearIssue('sound', resource, issueId);
  }

  private _listenForUnlock() {
    if (this._unlockListening || typeof window === 'undefined' || this._disposed) return;
    window.addEventListener('pointerdown', this._unlockBound, { passive: true });
    window.addEventListener('keydown', this._unlockBound, { passive: true });
    this._unlockListening = true;
  }

  private _resumeContext() {
    const ctx = this.ctx;
    if (this._disposed || !ctx || ctx.state !== 'suspended' || this._resumePending) return;
    this._resumePending = true;
    const issueId = this._lastIssue?.id;
    try {
      Promise.resolve(ctx.resume()).then(() => {
        if (this.ctx === ctx && ctx.state === 'running') this._clearIssue('initialization', undefined, issueId);
      }).catch(error => {
        if (!this._disposed && this.ctx === ctx) this._issue('initialization', undefined, error, isRetryablePlaybackError(error));
      }).finally(() => { if (this.ctx === ctx) this._resumePending = false; });
    } catch (error) {
      this._resumePending = false;
      this._issue('initialization', undefined, error, isRetryablePlaybackError(error));
    }
  }

  /** Release every resource owned by this application instance. */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const voice of this._voices) { voice.pause(); voice.removeAttribute('src'); voice.load(); }
    this._voices.clear();
    for (const timer of this._voiceTimers) clearTimeout(timer);
    this._voiceTimers.clear();
    this.music.dispose();
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this._unlockBound);
      window.removeEventListener('keydown', this._unlockBound);
    }
    for (const el of this._seEls.values()) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this._seEls.clear();
    this._seBuffers.clear();
    this._seDecoding.clear();
    this._seDecodeFailed.clear();
    this._soundRequests.clear();
    this._master?.disconnect();
    this._sfxBus?.disconnect();
    this._musicBus?.disconnect();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.ready = false;
  }
  // 初始化
  init() {
    if (this._disposed) return false;
    if (this.ctx) return this.ready;
    const issueId = this._lastIssue?.id;
    try {
      const AC = typeof window === 'undefined' ? undefined : window.AudioContext || ('webkitAudioContext' in window && typeof window.webkitAudioContext === 'function' ? window.webkitAudioContext as typeof AudioContext : undefined);
      if (!AC) { this._issue('initialization', undefined, 'AudioContext is unavailable in this browser', false); return false; }
      this.ctx = new AC();
      this._master = this.context.createGain(); this._master.gain.value = this.enabled ? this.masterVolume : 0;
      this._master.connect(this.ctx.destination);
      this._sfxBus = this.context.createGain(); this._sfxBus.gain.value = this.sfxVolume; this._sfxBus.connect(this._master);
      this._musicBus = this.context.createGain(); this._musicBus.gain.value = this.musicVolume; this._musicBus.connect(this._master);
      const len = Math.floor(this.ctx.sampleRate * 1.2), buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate), data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf; this.ready = true; this._syncMusicOutput(); this._listenForUnlock();
      if (this.ctx.state === 'suspended') this._issue('initialization', undefined, 'AudioContext is suspended; click or press a key to enable audio', true, true);
      else if (this.ctx.state === 'running') this._clearIssue('initialization', undefined, issueId);
      return true;
    } catch (error) {
      // A partially created context/bus is owned here even if initialization fails.
      for (const node of [this._master, this._sfxBus, this._musicBus]) { try { node?.disconnect(); } catch {} }
      try { this.ctx?.close()?.catch(() => {}); } catch {}
      this.ctx = null; this._master = null; this._sfxBus = null; this._musicBus = null; this._noiseBuf = null; this.ready = false;
      this._issue('initialization', undefined, error);
      if (isRetryablePlaybackError(error)) this._listenForUnlock();
      return false;
    }
  }

  /** 在用户手势里恢复音频上下文 */
  unlock() {
    if (this._disposed || !this.ready && !this.init() || !this.ctx) return;
    this._resumeContext();
    this.music.retry();
    for (const name of Object.keys(SE_LIB)) this._kickSeDecode(name);
  }


  get isRunning() {
    return !!(this.ready && this.ctx && this.ctx.state === 'running');
  }
  // 音量
  setVolumes({ master, sfx, music }: { master?: number; sfx?: number; music?: number } = {}) {
    if (typeof master === 'number') this.masterVolume = clamp01(master);
    if (typeof sfx === 'number') this.sfxVolume = clamp01(sfx);
    if (typeof music === 'number') this.musicVolume = clamp01(music);
    if (this._master) this._master.gain.value = this.enabled ? this.masterVolume : 0;
    if (this._sfxBus) this._sfxBus.gain.value = this.sfxVolume;
    this._syncMusicOutput();
    this._syncVoices();
  }

  toggle() {
    this._enabled = !this._enabled;
    if (this._master) this._master.gain.value = this.enabled ? this.masterVolume : 0;
    this._syncMusicOutput();
    this._syncVoices();
  }

  private _syncMusicOutput() {
    this.music.setOutput({ context: this.ctx, bus: this._musicBus, enabled: this.enabled, master: this.masterVolume, music: this.musicVolume });
  }
  // 底层发声原语
  private _now() { return this.context.currentTime; }

  /** 单个振荡器音 */
  private _tone({ type = 'sine', freq = 440, freqEnd = null, dur = 0.12, gain = 0.2, attack = 0.005, delay = 0, bus = null }: ToneOptions) {
    const t0 = this._now() + delay;
    const osc = this.context.createOscillator();
    const g = this.context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, freq), t0);
    if (freqEnd && freqEnd !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(bus || this.soundBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** 噪声（打击 / 爆炸 / 脚步） */
  private _noise({ dur = 0.15, gain = 0.2, delay = 0, filter = 'lowpass', freq = 1200, freqEnd = null, q = 1 }: NoiseOptions) {
    const t0 = this._now() + delay;
    const src = this.context.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const flt = this.context.createBiquadFilter();
    flt.type = filter;
    flt.frequency.setValueAtTime(freq, t0);
    if (freqEnd && freqEnd !== freq) {
      flt.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + dur);
    }
    flt.Q.value = q;
    const g = this.context.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt);
    flt.connect(g);
    g.connect(this.soundBus);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** 文件音效依次尝试 HTMLAudioElement、内嵌解码缓冲和合成补偿。
   * true 表示本帧已处理（含限频）；false 才允许调用方播放合成回落。 */
  private _playSeFile(name: string) {
    if (this._seFrame.has(name)) return true;   // 原版同帧去重
    // 限频也算本帧已处理，防止调用方重复补合成音。
    const now = this.ctx?.currentTime ?? performance.now() / 1000;
    if (now - (this._seLastAt[name] ?? -Infinity) < (lookupCatalog(SE_MIN_GAP, name) ?? SE_GAP_DEFAULT)) {
      this._seFrame.add(name);
      return true;
    }
    if (this._seElementPlay(name)) { this._seLastAt[name] = now; return true; }
    const buf = this._seBuffers.get(name);
    if (buf && this.ctx) {
      try {
        this._playBuffer(name, buf);
        this._seLastAt[name] = now;
        this._seFrame.add(name);
        return true;
      } catch { /* 落回合成 */ }
    }
    this._kickSeDecode(name);
    return false;
  }

  /** ① <audio> 元素通道（BGM 同款，播 ogg） */
  private _seElementPlay(name: string) {
    const Ctor = (typeof window !== 'undefined' && window.Audio) || (typeof Audio !== 'undefined' ? Audio : null);
    const resource = `${SE_DIR}/${name}.ogg`, ctx = this.ctx;
    const request = this._beginSoundRequest(resource), issueId = this._lastIssue?.id;
    if (!Ctor) { this._issue('sound', resource, 'HTMLAudioElement is unavailable in this browser', false); return false; }
    try {
      let tpl = this._seEls.get(name);
      if (!tpl) { tpl = new Ctor(); tpl.preload = 'auto'; tpl.src = resource; tpl.load(); this._seEls.set(name, tpl); }
      if (tpl.error) { this._issue('sound', resource, tpl.error, false); return false; }
      const v = tpl.cloneNode() as HTMLAudioElement; this._voices.add(v);
      const release = () => { v.pause(); this._voices.delete(v); };
      const failed = (error: unknown) => {
        if (this._disposed || this.ctx !== ctx || !this._voices.has(v)) return;
        release();
        // An obsolete voice owns its cleanup, not a fallback for the newer request.
        if (this._soundRequests.get(resource) !== request) return;
        this._issue('sound', resource, error);
        const failedIssueId = this._lastIssue?.id;
        try { this._seCompensate(name, failedIssueId); } catch (fallbackError) { this._issue('sound', resource, fallbackError); }
      };
      v.addEventListener('ended', release, { once: true });
      v.addEventListener('error', () => failed(v.error || new Error('Sound media resource failed to load')), { once: true });
      v.dataset.nekoGain = String(lookupCatalog(SE_LIB, name) ?? 0.3);
      v.volume = this.enabled ? Math.min(1, this.masterVolume * this.sfxVolume * Number(v.dataset.nekoGain)) : 0;
      v.playbackRate = 0.98 + this._rand() * 0.04;
      v.play()?.then(() => {
        if (this.ctx === ctx && this._voices.has(v)) this._soundAccepted(resource, request, issueId);
      }).catch(failed);
      this._seFrame.add(name); return true;
    } catch (error) { this._issue('sound', resource, error); return false; }
  }

  /** ② 元素被拦时的补偿：内嵌解码缓冲出声；连缓冲都没有就补一声合成 blip */
  private _seCompensate(name: string, issueId: number | undefined) {
    if (this._disposed || !this.ctx || this.ctx.state !== 'running') return;
    const buf = this._seBuffers.get(name);
    if (buf && this.ctx) {
      try {
        this._playBuffer(name, buf, issueId);
        return;
      } catch { /* 落到 blip */ }
    }
    this._kickSeDecode(name);
    this._tone({ type: 'triangle', freq: 880, freqEnd: 520, dur: 0.08, gain: 0.12 });
  }

  /** 缓冲 → sfx 总线（①②共用的出声末端，与玩家攻击音同一条链） */
  private _playBuffer(name: string, buf: AudioBuffer, issueId = this._lastIssue?.id) {
    const resource = `${SE_DIR}/${name}.ogg`;
    const src = this.context.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.98 + this._rand() * 0.04;
    const g = this.context.createGain();
    g.gain.value = lookupCatalog(SE_LIB, name) ?? 0.3;
    src.connect(g);
    g.connect(this.soundBus);
    src.start();
    this._clearIssue('sound', resource, issueId);
  }

  /** 内嵌 base64 ogg → AudioBuffer（每文件只解码一次，解锁时全部预热） */
  private _kickSeDecode(name: string) {
    const data = lookupCatalog(SE_DATA, `${name}.ogg`), ctx = this.ctx;
    if (this._disposed || this._seBuffers.has(name) || this._seDecodeFailed.has(name) || this._seDecoding.has(name) || !ctx || typeof data !== 'string') return;
    this._seDecoding.add(name);
    const resource = `${SE_DIR}/${name}.ogg`, request = this._soundRequests.get(resource);
    const failed = (error: unknown) => {
      if (this._disposed || this.ctx !== ctx) return;
      if (!isRetryablePlaybackError(error)) this._seDecodeFailed.add(name);
      if (this._soundRequests.get(resource) === request) this._issue('sound', resource, error);
    };
    try {
      const bin = atob(data), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      ctx.decodeAudioData(bytes.buffer).then(decoded => {
        if (!this._disposed && this.ctx === ctx) this._seBuffers.set(name, decoded);
      }).catch(failed).finally(() => { if (this.ctx === ctx) this._seDecoding.delete(name); });
    } catch (error) { this._seDecoding.delete(name); failed(error); }
  }

  /** 同类音效节流：minGap 毫秒内只响一次 */
  private _throttle(key: string, minGap: number) {
    const now = performance.now();
    const last = this._lastPlayed.get(key) || 0;
    if (now - last < minGap) return false;
    this._lastPlayed.set(key, now);
    return true;
  }
  // 武器攻击音
  /** 每个模拟帧重置文件去重与武器配额；按类别的时间限频独立保留。 */
  beginFrame() {
    this._seFrame.clear();
    // 挂起时尝试恢复；_resumePending 防止重复提交，仍受浏览器手势策略控制。
    this._resumeContext();
    this._weaponBudget = 3;
  }

  /** 按武器类别、行为、Tier 与重击选择音色。 */
  playWeapon(def: WeaponSound, heavy = false) {
    try { return this._playWeaponSound(def, heavy); }
    catch (error) { this._issue('sound', `weapon:${def?.behavior ?? 'shot'}`, error); }
  }

  private _playWeaponSound(def: WeaponSound, heavy = false) {
    if (this._disposed || !this.enabled || !this.ready || !this.isRunning) return;
    if (this._weaponBudget <= 0) return;

    const kind = def?.kind ?? 'ranged';
    const tier = def?.tier ?? 1;
    const behavior = def?.behavior ?? 'shot';

    // 类别节流与帧配额共同避免后期噪音叠加。
    const gap = lookupCatalog(WEAPON_SFX_GAP, kind) ?? 70;
    if (!this._throttle(`weapon:${kind}`, gap)) return;

    this._weaponBudget--;

    // 音高随 Tier 略微升高，让高级武器听起来"更强"。
    const pitch = 1 + (tier - 1) * 0.06;
    // Tier 小幅提高音量，整体增益由曲库策略提供。
    const vol = (0.85 + (tier - 1) * 0.05) * WEAPON_SFX_GAIN;

    if (kind === 'melee') {
      this._meleeSfx(behavior, pitch, vol, heavy);
    } else if (kind === 'element') {
      this._elementSfx(behavior, pitch, vol);
    } else if (kind === 'turret') {
      this._turretSfx(pitch, vol);
    } else {
      this._rangedSfx(behavior, pitch, vol, heavy);
    }
  }

  /** 近战：要"打击感"，所以是低频冲击 + 一层短促噪声 */
  private _meleeSfx(behavior: string, pitch: number, vol: number, heavy: boolean) {
    if (behavior === 'quake') {
      // 砸地：低频下坠 + 大量低频噪声，最沉
      this._tone({ type: 'sine', freq: 150 * pitch, freqEnd: 42, dur: 0.20, gain: 0.10 * vol });
      this._noise({ dur: 0.16, gain: 0.10 * vol, freq: 700, freqEnd: 90 });
      return;
    }
    if (behavior === 'thrust') {
      // 刺击：短、尖、干净
      this._tone({ type: 'triangle', freq: 620 * pitch, freqEnd: 240, dur: 0.07, gain: 0.07 * vol });
      this._noise({ dur: 0.05, gain: 0.06 * vol, filter: 'highpass', freq: 1600 });
      return;
    }
    if (behavior === 'flurry') {
      // 乱舞：连击感，音量压低（它触发最频繁）
      this._tone({ type: 'square', freq: 500 * pitch, freqEnd: 300, dur: 0.05, gain: 0.045 * vol });
      return;
    }
    if (behavior === 'spin' || behavior === 'orbit') {
      // 旋转：带一点风声的呼啸，没有明确的"击点"
      this._noise({ dur: 0.12, gain: 0.05 * vol, filter: 'bandpass', freq: 1100 * pitch, q: 1.6 });
      return;
    }
    // sweep（挥砍）：默认近战音 —— 破风声 + 一记闷响
    this._noise({ dur: 0.09, gain: 0.08 * vol, filter: 'bandpass', freq: 1500 * pitch, q: 1.1 });
    this._tone({
      type: 'triangle', freq: 300 * pitch, freqEnd: 150,
      dur: heavy ? 0.13 : 0.09, gain: (heavy ? 0.10 : 0.07) * vol,
    });
  }

  /** 魔法 / 铃铛：用户要求"可爱点"，所以用清亮的高频叮声 */
  private _elementSfx(behavior: string, pitch: number, vol: number) {
    if (behavior === 'chain') {
      // 雷铃：一串快速上行的小叮声，像摇铃
      this._tone({ type: 'sine', freq: 1180 * pitch, dur: 0.06, gain: 0.05 * vol });
      this._tone({ type: 'sine', freq: 1560 * pitch, dur: 0.07, gain: 0.045 * vol, delay: 0.035 });
      return;
    }
    if (behavior === 'nova') {
      // 光环/新星：柔和的钟鸣，一同发声的三度和声
      this._tone({ type: 'sine', freq: 880 * pitch, dur: 0.22, gain: 0.05 * vol });
      this._tone({ type: 'sine', freq: 1320 * pitch, dur: 0.20, gain: 0.035 * vol, delay: 0.02 });
      return;
    }
    // homing（魔杖飞弹）：上滑的"咻叮"，最可爱的一个
    this._tone({ type: 'sine', freq: 740 * pitch, freqEnd: 1480 * pitch, dur: 0.13, gain: 0.055 * vol });
    this._tone({ type: 'triangle', freq: 1240 * pitch, dur: 0.08, gain: 0.03 * vol, delay: 0.05 });
  }

  /** 炮台：机械感的"咔哒 + 啾" */
  private _turretSfx(pitch: number, vol: number) {
    this._tone({ type: 'square', freq: 260 * pitch, freqEnd: 420, dur: 0.04, gain: 0.045 * vol });
    this._tone({ type: 'square', freq: 660 * pitch, freqEnd: 380, dur: 0.06, gain: 0.04 * vol, delay: 0.03 });
  }

  /** 远程：干净的啾声，"不抢戏" */
  private _rangedSfx(behavior: string, pitch: number, vol: number, heavy: boolean) {
    if (behavior === 'beam') {
      // 激光：持续一点的高频，带轻微下滑
      this._tone({ type: 'sawtooth', freq: 1500 * pitch, freqEnd: 900, dur: 0.10, gain: 0.04 * vol });
      return;
    }
    if (behavior === 'spread') {
      // 散射：一次"噗"，比单发闷
      this._noise({ dur: 0.06, gain: 0.05 * vol, filter: 'bandpass', freq: 1200, q: 1.0 });
      this._tone({ type: 'square', freq: 520 * pitch, freqEnd: 260, dur: 0.06, gain: 0.045 * vol });
      return;
    }
    if (behavior === 'bounce') {
      this._tone({ type: 'triangle', freq: 900 * pitch, freqEnd: 1400, dur: 0.07, gain: 0.05 * vol });
      return;
    }
    // shot（默认单发）
    this._tone({
      type: 'square', freq: (heavy ? 620 : 740) * pitch, freqEnd: 340,
      dur: 0.06, gain: 0.05 * vol,
    });
  }
  // 音效（游戏事件）
  play(name: string, opts: SoundOptions = {}) {
    try { return this._playSound(name, opts); }
    catch (error) { this._issue('sound', `sound:${name}`, error); }
  }

  private _playSound(name: string, opts: SoundOptions = {}) {
    if (this._disposed || !this.enabled || !this.ready) return;
    // 已获得手势后，挂起的音频可以在后续事件中恢复。
    this._resumeContext();
    if (!this.isRunning) return;
    if (lookupCatalog(CHALLENGE_SOUND_FILES, name)) { this._playChallengeFile(name, opts); return; }
    if (name.startsWith('comet_')) { playCometSound(this.ctx, this._sfxBus, name.slice(6)); return; }

    switch (name) {
      case 'shoot1':
      case 'shoot2':
        if (this._playSeFile(name)) break;
        if (!this._throttle(name, (lookupCatalog(SE_MIN_GAP, name) ?? SE_GAP_DEFAULT) * 1000)) return;
        this._tone({ type: 'square', freq: name === 'shoot1' ? 520 : 360, freqEnd: 180, dur: 0.1, gain: 0.08 });
        break;

      // ---- 战斗 ----
      case 'kill':
        if (!this._throttle('kill', 55)) return;
        this._tone({ type: 'triangle', freq: 520, freqEnd: 180, dur: 0.11, gain: 0.08 });
        this._noise({ dur: 0.09, gain: 0.06, freq: 1400, freqEnd: 300 });
        break;

      case 'bossKill':
        this._tone({ type: 'sawtooth', freq: 220, freqEnd: 55, dur: 0.9, gain: 0.22 });
        this._noise({ dur: 0.9, gain: 0.2, freq: 1200, freqEnd: 90 });
        this._tone({ type: 'sine', freq: 880, freqEnd: 1760, dur: 0.5, gain: 0.14, delay: 0.12 });
        break;

      case 'explode':
        if (!this._throttle('explode', 80)) return;
        this._noise({ dur: 0.34, gain: 0.17, freq: 900, freqEnd: 70 });
        this._tone({ type: 'sine', freq: 130, freqEnd: 40, dur: 0.3, gain: 0.13 });
        break;

      // 芙兰与符卡音效。
      case 'flandreShot':
        // tan00 的同帧去重与最小间隔由文件通道统一执行。
        if (this._playSeFile('tan00')) break;
        if (!this._throttle('flandreShot', 130)) return;   // 素材没就绪时的合成回落
        this._tone({ type: 'triangle', freq: 990, freqEnd: 620, dur: 0.1, gain: 0.16 });
        this._tone({ type: 'sine', freq: 1480, dur: 0.06, gain: 0.1, delay: 0.03 });
        break;

      case 'spellCard':
        // 开卡同时播放宣言与充能声，任一文件被处理后不再合成。
        this._playSeFile('cat00');
        this._playSeFile('power0');
        if (this._seFrame.has('cat00') || this._seFrame.has('power0')) break;
        // 合成回落
        this._tone({ type: 'triangle', freq: noteFreq('A', 4), dur: 0.14, gain: 0.22 });
        this._tone({ type: 'triangle', freq: noteFreq('C', 5), dur: 0.14, gain: 0.22, delay: 0.09 });
        this._tone({ type: 'triangle', freq: noteFreq('E', 5), dur: 0.24, gain: 0.24, delay: 0.18 });
        this._tone({ type: 'sawtooth', freq: 110, freqEnd: 55, dur: 0.5, gain: 0.18 });
        break;
      case 'flandreLaser':
        // Lævateinn 激光 = lazer00（effect_sound 16，0.36）
        if (this._playSeFile('lazer00')) break;
        this._tone({ type: 'sawtooth', freq: 320, freqEnd: 140, dur: 0.22, gain: 0.12 });
        break;

      case 'flandreCrash':
        // 大爆炸 / BOSS 崩坏 = enep01（effect_sound 18，0.50）
        if (this._playSeFile('enep01')) break;
        this._tone({ type: 'triangle', freq: 200, freqEnd: 40, dur: 0.7, gain: 0.22 });
        this._noise({ dur: 0.6, gain: 0.18, freq: 900, freqEnd: 90 });
        break;

      case 'cardEnd':
        // 符卡结束 = fault（新典专属 effect_sound 33，0.63）
        if (this._playSeFile('fault')) break;
        this._tone({ type: 'triangle', freq: noteFreq('E', 5), dur: 0.12, gain: 0.14 });
        this._tone({ type: 'triangle', freq: noteFreq('A', 4), dur: 0.2, gain: 0.14, delay: 0.08 });
        break;

      case 'cardTick':
        // 最后 10 秒滴答 = timeout（GUI 层，每秒一声，0.56）
        if (this._playSeFile('timeout')) break;
        this._tone({ type: 'square', freq: 880, dur: 0.05, gain: 0.08 });
        break;

      // ---- 玩家 ----
      case 'hurt':
        if (this._playSeFile('hurt00')) break;
        if (!this._throttle('hurt', 150)) return;
        this._tone({ type: 'square', freq: 200, freqEnd: 90, dur: 0.18, gain: 0.13 });
        this._noise({ dur: 0.12, gain: 0.09, freq: 700, freqEnd: 200 });
        break;

      case 'heal':
        // 只有宠物治疗事件触发；道具回血不播放该音效。
        if (this._playSeFile('heal00')) break;
        this._tone({ type: 'sine', freq: 660, dur: 0.1, gain: 0.1 });
        this._tone({ type: 'sine', freq: 990, dur: 0.14, gain: 0.09, delay: 0.08 });
        break;

      case 'pickupXp':
        if (!this._throttle('pickupXp', 40)) return;
        this._tone({ type: 'sine', freq: 1180, freqEnd: 1560, dur: 0.05, gain: 0.035 });
        break;

      case 'pickupMat':
        if (!this._throttle('pickupMat', 40)) return;
        this._tone({ type: 'triangle', freq: 880, freqEnd: 1320, dur: 0.07, gain: 0.05 });
        break;

      case 'levelUp':
        // 第八十三轮：升级 = level00（用户自制，"升级"）
        if (this._playSeFile('level00')) break;
        for (let i = 0; i < 4; i++) {
          this._tone({ type: 'triangle', freq: noteFreq('C', 5) * Math.pow(2, i / 4), dur: 0.22, gain: 0.1, delay: i * 0.07 });
        }
        break;

      // ---- UI / 流程 ----
      case 'click':
        this._tone({ type: 'square', freq: 620, freqEnd: 820, dur: 0.04, gain: 0.05 });
        break;

      case 'buy':
        this._tone({ type: 'triangle', freq: 700, dur: 0.08, gain: 0.09 });
        this._tone({ type: 'triangle', freq: 1050, dur: 0.12, gain: 0.08, delay: 0.07 });
        break;

      case 'error':
        this._tone({ type: 'square', freq: 220, freqEnd: 160, dur: 0.14, gain: 0.08 });
        break;

      case 'reroll':
        this._noise({ dur: 0.16, gain: 0.07, filter: 'highpass', freq: 900 });
        break;

      case 'lock':
        this._tone({ type: 'square', freq: 500, freqEnd: 700, dur: 0.06, gain: 0.06 });
        break;

      case 'combine':
        for (let i = 0; i < 5; i++) {
          this._tone({ type: 'triangle', freq: 440 * Math.pow(2, i / 6), dur: 0.2, gain: 0.1, delay: i * 0.055 });
        }
        break;

      case 'waveStart':
        this._tone({ type: 'sawtooth', freq: 300, freqEnd: 600, dur: 0.35, gain: 0.12 });
        this._tone({ type: 'triangle', freq: 600, dur: 0.3, gain: 0.09, delay: 0.16 });
        break;
      case 'gameStart':
        // "开始游戏"：玩家在选人界面点「用这个角色开始」播一次
        if (this._playSeFile('start00')) break;
        this._tone({ type: 'triangle', freq: 520, freqEnd: 1040, dur: 0.3, gain: 0.12 });
        this._tone({ type: 'sine', freq: 1560, dur: 0.22, gain: 0.08, delay: 0.14 });
        break;
      case 'catStep':
        // "猫的步伐"：悠怡锁血触发瞬间的后空翻（cat_step.ogg）
        if (this._playSeFile('cat_step')) break;
        this._tone({ type: 'sine', freq: 1240, freqEnd: 620, dur: 0.18, gain: 0.11 });
        break;

      case 'knockdown':
        // "倒地"：duo 模式玩家被击倒瞬间（knockdown.ogg）
        if (this._playSeFile('knockdown')) break;
        this._tone({ type: 'sawtooth', freq: 220, freqEnd: 60, dur: 0.45, gain: 0.16 });
        this._noise({ dur: 0.3, gain: 0.12, freq: 500, freqEnd: 120 });
        break;
      case 'cometTinnitus':
        // "耳鸣"：中心大爆炸白闪瞬间（comet_tinnitus.ogg）
        if (this._playSeFile('comet_tinnitus')) break;
        this._tone({ type: 'sine', freq: 8000, dur: 1.2, gain: 0.06 });
        break;

      case 'cometRoarVoice':
        // "吼叫"：落地站姿吼叫 3 秒（comet_roar.ogg）
        if (this._playSeFile('comet_roar')) break;
        this._tone({ type: 'sawtooth', freq: 90, freqEnd: 40, dur: 1.4, gain: 0.2 });
        this._noise({ dur: 1.2, gain: 0.14, freq: 300, freqEnd: 80 });
        break;

      case 'cometTakeoff':
        // "起飞"：吼完再次升空（comet_takeoff.ogg），播完龙已离场
        if (this._playSeFile('comet_takeoff')) break;
        this._tone({ type: 'sawtooth', freq: 140, freqEnd: 900, dur: 1.1, gain: 0.14 });
        break;

      case 'petPurge':
        // 仅主动消弹播放，受击自动消弹静音。
        if (this._playSeFile('purge00')) break;
        this._noise({ dur: 0.25, gain: 0.1, filter: 'highpass', freq: 600 });
        this._tone({ type: 'sine', freq: 980, freqEnd: 420, dur: 0.3, gain: 0.1 });
        break;

      case 'waveClear':
        this._tone({ type: 'triangle', freq: noteFreq('E', 5), dur: 0.2, gain: 0.11 });
        this._tone({ type: 'triangle', freq: noteFreq('G', 5), dur: 0.2, gain: 0.1, delay: 0.12 });
        this._tone({ type: 'triangle', freq: noteFreq('C', 6), dur: 0.3, gain: 0.11, delay: 0.24 });
        break;

      case 'bossSpawn':
        this._tone({ type: 'sawtooth', freq: 90, freqEnd: 55, dur: 1.1, gain: 0.2 });
        this._tone({ type: 'square', freq: 180, freqEnd: 120, dur: 0.9, gain: 0.1, delay: 0.15 });
        this._noise({ dur: 1.0, gain: 0.12, freq: 400, freqEnd: 80 });
        break;

      case 'win':
        for (let i = 0; i < 6; i++) {
          this._tone({ type: 'triangle', freq: noteFreq((['C', 'E', 'G', 'C', 'E', 'G'] as const)[i], i < 3 ? 5 : 6), dur: 0.45, gain: 0.11, delay: i * 0.13 });
        }
        break;

      case 'death':
        this._tone({ type: 'sawtooth', freq: 400, freqEnd: 60, dur: 1.2, gain: 0.16 });
        this._tone({ type: 'sine', freq: 200, freqEnd: 50, dur: 1.4, gain: 0.12, delay: 0.1 });
        break;

      default:
        break;
    }
  }

  private _syncVoices() {
    for (const voice of this._voices) {
      voice.volume = this.enabled ? Math.min(1, this.masterVolume * this.sfxVolume * Number(voice.dataset.nekoGain ?? 1)) : 0;
    }
  }

  private _playChallengeFile(name: string, options: SoundOptions) {
    if (!this._throttle(`file:${name}`, 35)) return;
    const resource = lookupCatalog(CHALLENGE_SOUND_FILES, name), ctx = this.ctx;
    if (!resource) return;
    const request = this._beginSoundRequest(resource), issueId = this._lastIssue?.id;
    let voice: HTMLAudioElement | undefined;
    try {
      const Ctor = (typeof window !== 'undefined' && window.Audio) || (typeof Audio !== 'undefined' ? Audio : null);
      if (!Ctor) throw new Error('HTMLAudioElement is unavailable in this browser');
      voice = new Ctor(resource); voice.dataset.nekoGain = String(options.volume ?? 0.7);
      voice.playbackRate = options.playbackRate ?? 1; this._voices.add(voice); this._syncVoices();
      const currentVoice = voice;
      const release = () => { currentVoice.pause(); this._voices.delete(currentVoice); };
      const failed = (error: unknown) => {
        if (this._disposed || this.ctx !== ctx || !this._voices.has(currentVoice)) return;
        if (this._soundRequests.get(resource) === request) this._issue('sound', resource, error);
        release();
      };
      voice.addEventListener('ended', release, { once: true });
      voice.addEventListener('error', () => failed(currentVoice.error || new Error('Sound media resource failed to load')), { once: true });
      voice.play()?.then(() => {
        if (this.ctx === ctx && this._voices.has(currentVoice)) this._soundAccepted(resource, request, issueId);
      }).catch(failed);
      if (typeof options.duration === 'number' && options.duration > 0) {
        const timer = setTimeout(() => { this._voiceTimers.delete(timer); release(); }, options.duration * 1000);
        this._voiceTimers.add(timer);
      }
    } catch (error) {
      if (voice) { voice.pause(); this._voices.delete(voice); }
      this._issue('sound', resource, error);
    }
  }

  /** Named soundtrack control for challenge sequences, independent of simulation time. */
  applyMusicCue(cue: AudioMusicCue) { this.music.applyCue(cue); }

}

function clamp01(v: number) { return v < 0 ? 0 : v > 1 ? 1 : v; }
