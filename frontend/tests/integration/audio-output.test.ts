import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioSystem } from '../../src/audio/audio-player.ts';

class AudioElement extends EventTarget {
  static created: AudioElement[] = [];
  static playBehavior: ((element: AudioElement) => Promise<void>) | undefined;
  error: { code?: number; message?: string } | null = null; currentSrc = ''; playCount = 0;
  src = ''; paused = true; ended = false; loop = false; volume = 1;
  playbackRate = 1; currentTime = 0; dataset: Record<string, string> = {};
  constructor(src = '') { super(); this.src = src; AudioElement.created.push(this); }
  play() { this.playCount++; this.paused = false; return AudioElement.playBehavior?.(this) ?? Promise.resolve(); }
  pause() { this.paused = true; }
  load() {}
  removeAttribute(name: string) { if (name === 'src') this.src = ''; }
  cloneNode() { return new AudioElement(this.src); }
}
interface OutputNode { inputs: Gain[] }
class Gain implements OutputNode {
  inputs: Gain[] = [];
  gain = { value: 1, setValueAtTime(value: number) { this.value = value; },
    linearRampToValueAtTime(value: number) { this.value = value; }, exponentialRampToValueAtTime(value: number) { this.value = value; } };
  connect(target: OutputNode) { target.inputs.push(this); }
  disconnect() {}
}
class AudioBackend {
  static created: AudioBackend[] = [];
  static failBuffer = false;
  static bufferStarts = 0;
  static routeMedia = false;
  static mediaConnections = 0;
  static mediaDisconnections = 0;
  static initialState = 'running';
  static resumeBehavior: (() => Promise<void>) | undefined;
  static decodeBehavior: (() => Promise<unknown>) | undefined;
  destination: OutputNode = { inputs: [] };
  state = AudioBackend.initialState; currentTime = 1; sampleRate = 10;
  constructor() { AudioBackend.created.push(this); }
  createGain() { return new Gain(); }
  createBuffer(_channels: number, length: number) { if (AudioBackend.failBuffer) throw new Error('buffer allocation failed'); return { getChannelData: () => new Float32Array(length) }; }
  resume() { return (AudioBackend.resumeBehavior?.() ?? Promise.resolve()).then(() => { this.state = 'running'; }); }
  decodeAudioData() { return AudioBackend.decodeBehavior?.() ?? Promise.resolve({}); }
  createBufferSource() { return { buffer: null as unknown, loop: false, playbackRate: { value: 1 }, connect() {}, start() { AudioBackend.bufferStarts++; }, stop() {} }; }
  createMediaElementSource() {
    if (!AudioBackend.routeMedia) throw new Error('Media routing unavailable');
    return { connect() { AudioBackend.mediaConnections++; }, disconnect() { AudioBackend.mediaDisconnections++; } };
  }
  createOscillator() { return { type: 'sine', frequency: new Gain().gain, connect() {}, start() {}, stop() {} }; }
  createBiquadFilter() { return { type: 'lowpass', frequency: new Gain().gain, Q: { value: 1 }, connect() {} }; }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks(); AudioBackend.created = []; AudioElement.created = [];
  AudioBackend.failBuffer = false; AudioBackend.bufferStarts = 0; AudioBackend.initialState = 'running'; AudioBackend.resumeBehavior = undefined;
  AudioBackend.decodeBehavior = undefined; AudioElement.playBehavior = undefined;
  AudioBackend.routeMedia = false; AudioBackend.mediaConnections = 0; AudioBackend.mediaDisconnections = 0;
});

describe('music request ownership through the public audio interface', () => {
  it('keeps one streaming element, preserves single-song reentry and avoids the previous stage track across stops', () => {
    const output = createOutput();
    output.applyMusicCue({ scene: 'shop' });
    expect(AudioElement.created[0]!.src).toContain('shop.ogg');
    const music = AudioElement.created[0]; music.currentTime = 18;
    output.applyMusicCue({ scene: 'shop' });
    expect(AudioElement.created[0]!.src).toContain('shop.ogg');
    expect(music.playCount).toBe(1); expect(music.currentTime).toBe(18);
    output.applyMusicCue({ scene: 'stage', wave: 1 }); const first = music.src;
    output.applyMusicCue({ stop: true });
    output.applyMusicCue({ scene: 'stage', wave: 2 }); expect(music.src).not.toBe(first);
    const stage = music.src; expect(stage).toContain('stage_1_');
    output.applyMusicCue({ scene: 'stage', wave: 11 }); expect(music.src).toContain('stage_2_');
    output.applyMusicCue({ track: '../unknown' }); expect(music.src).toContain('stage_2_');
    expect(AudioElement.created).toHaveLength(1); output.dispose();
  });

  it('cancels a blocked request when another scene starts or music stops', async () => {
    const output = createOutput();
    AudioElement.playBehavior = () => Promise.reject(namedError('NotAllowedError', 'gesture required'));
    output.applyMusicCue({ track: 'halloween', position: 12, volume: .25 }); await flush();
    AudioElement.playBehavior = undefined;
    output.applyMusicCue({ scene: 'shop' }); await flush();
    const music = AudioElement.created[0], plays = music.playCount;
    output.unlock(); await flush();
    expect(music.playCount).toBe(plays); expect(music.src).toContain('shop.ogg');
    AudioElement.playBehavior = () => Promise.reject(namedError('AbortError', 'interrupted'));
    output.applyMusicCue({ scene: 'title' }); await flush(); output.applyMusicCue({ stop: true }); output.unlock(); await flush();
    expect(music.playCount).toBe(plays + 1); expect(music.paused).toBe(true); output.dispose();
  });

  it('restarts a blocked scene on retry and retains the explicit position of named challenge cues', async () => {
    const output = createOutput(); let calls = 0;
    AudioElement.playBehavior = () => ++calls === 1 ? Promise.reject(namedError('NotAllowedError', 'gesture required')) : Promise.resolve();
    output.applyMusicCue({ scene: 'shop' }); await flush();
    const music = AudioElement.created[0]; music.currentTime = 15;
    output.unlock(); await flush(); expect(music.currentTime).toBe(0);
    output.applyMusicCue({ track: 'bury_the_light', position: 9 }); music.currentTime = 17;
    output.applyMusicCue({ track: 'bury_the_light' }); expect(music.currentTime).toBe(17);
    output.applyMusicCue({ track: 'bury_the_light', position: -1 }); expect(music.currentTime).toBe(0); output.dispose();
  });

  it('applies routed BGM gain once and disconnects its sole media source when disposed', () => {
    AudioBackend.routeMedia = true;
    const output = createOutput(); output.applyMusicCue({ track: 'vergil', volume: .25 });
    output.setVolumes({ master: .6, music: .8 });
    const master = AudioBackend.created[0].destination.inputs[0], music = AudioElement.created[0];
    expect(master.gain.value).toBe(.6); expect(master.inputs[1].gain.value).toBe(.2);
    expect(music.volume).toBe(1); expect(AudioBackend.mediaConnections).toBe(1);
    output.toggle(); expect(master.gain.value).toBe(0); expect(music.volume).toBe(1);
    output.applyMusicCue({ scene: 'shop' }); expect(master.inputs[1].gain.value).toBe(.8);
    output.dispose(); output.dispose();
    expect(AudioBackend.mediaDisconnections).toBe(1); expect(music.src).toBe(''); expect(music.paused).toBe(true);
  });
});
function createOutput() {
  vi.stubGlobal('Audio', AudioElement);
  vi.stubGlobal('window', { AudioContext: AudioBackend, Audio: AudioElement, addEventListener() {}, removeEventListener() {} });
  const output = new AudioSystem();
  expect(output.init()).toBe(true);
  return output;
}

describe('audio output through a browser media adapter', () => {
  it('keeps the destination muted when any volume slider changes', () => {
    const output = createOutput();
    output.toggle();
    output.setVolumes({ master: 0.4, sfx: 0.2, music: 0.6 });
    expect(AudioBackend.created[0].destination.inputs[0].gain.value).toBe(0);
    output.toggle();
    expect(AudioBackend.created[0].destination.inputs[0].gain.value).toBe(0.4);
    output.dispose();
  });

  it('plays original challenge shot files and releases active voices on exit', () => {
    const output = createOutput();
    expect(() => output.play('flandreShot')).not.toThrow();
    expect(AudioElement.created.some(element => !element.paused && element.src.endsWith('/tan00.ogg'))).toBe(true);
    output.dispose();
    expect(AudioElement.created.every(element => element.paused)).toBe(true);
    expect(AudioBackend.created.every(context => context.state === 'closed')).toBe(true);
  });

  it('preserves challenge gain when the music slider changes and restores ordinary scene gain', () => {
    const output = createOutput();
    output.applyMusicCue({ type: 'music', scene: 'boss', track: 'vergil', volume: 0.25 });
    output.setVolumes({ music: 0.8 });
    const master = AudioBackend.created[0].destination.inputs[0];
    expect(master.inputs[1].gain.value).toBeCloseTo(0.2);
    expect(AudioElement.created[0].volume).toBeCloseTo(0.75 * 0.8 * 0.25);
    output.applyMusicCue({ type: 'music', scene: 'shop' });
    expect(master.inputs[1].gain.value).toBeCloseTo(0.8);
    expect(AudioElement.created[0].volume).toBeCloseTo(0.75 * 0.8);
    output.dispose();
  });
});


const namedError = (name: string, message: string) => Object.assign(new Error(message), { name });
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
describe('bounded public audio failure diagnostics', () => {
  it('reports unsupported initialization and releases a partially initialized context before retry', () => {
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
    const absent = new AudioSystem(); expect(absent.init()).toBe(false);
    expect(absent.lastIssue).toMatchObject({ id: 1, kind: 'initialization', recoverable: false });
    expect(absent.lastIssue?.reason).toContain('AudioContext'); expect(Object.isFrozen(absent.lastIssue)).toBe(true);
    expect(absent.init()).toBe(false); expect(absent.lastIssue?.id).toBe(1); absent.dispose();
    vi.stubGlobal('Audio', AudioElement);
    vi.stubGlobal('window', { AudioContext: AudioBackend, Audio: AudioElement, addEventListener() {}, removeEventListener() {} });
    AudioBackend.failBuffer = true;
    const output = new AudioSystem(); expect(output.init()).toBe(false);
    expect(output.lastIssue?.reason).toContain('buffer allocation failed'); expect(AudioBackend.created[0].state).toBe('closed');
    AudioBackend.failBuffer = false; expect(output.init()).toBe(true); expect(output.lastIssue).toBeNull(); output.dispose();
  });
  it('distinguishes suspended/policy-blocked context initialization as recoverable', async () => {
    AudioBackend.initialState = 'suspended';
    AudioBackend.resumeBehavior = () => Promise.reject(namedError('NotAllowedError', 'user gesture required'));
    const output = createOutput(); expect(output.lastIssue).toMatchObject({ kind: 'initialization', recoverable: true, waitingForGesture: true });
    output.unlock(); await flush();
    expect(output.lastIssue?.reason).toContain('NotAllowedError'); expect(output.lastIssue?.recoverable).toBe(true);
    AudioBackend.resumeBehavior = undefined; output.unlock(); await flush(); expect(output.isRunning).toBe(true); expect(output.lastIssue).toBeNull(); output.dispose();
  });
  it('retries autoplay-blocked challenge music after a gesture without blacklisting its track or losing seek/gain', async () => {
    const output = createOutput(); let calls = 0;
    AudioElement.playBehavior = () => ++calls === 1 ? Promise.reject(namedError('NotAllowedError', 'autoplay blocked')) : Promise.resolve();
    output.applyMusicCue({ type: 'music', scene: 'boss', track: 'halloween', position: 12, volume: .25 });
    await flush(); expect(output.lastIssue).toMatchObject({ kind: 'music', recoverable: true });
    expect(output.lastIssue?.resource).toContain('mischievous.wav'); const issueId = output.lastIssue!.id;
    output.unlock(); await flush();
    expect(calls).toBe(2); expect(AudioElement.created[0].paused).toBe(false);
    expect(AudioElement.created[0].currentTime).toBe(12); expect(AudioElement.created[0].volume).toBeCloseTo(.75 * .4 * .25);
    expect(output.lastIssue).toBeNull();
    const element = AudioElement.created[0]; element.error = { code: 3, message: 'late decode after accepted playback' }; element.dispatchEvent(new Event('error'));
    expect(output.lastIssue!.id).toBeGreaterThan(issueId); expect(output.lastIssue?.recoverable).toBe(false); output.dispose();
  });
  it('reports a music media HTTP failure with its resource while retaining silent fallback', async () => {
    const output = createOutput(); output.applyMusicCue({ scene: 'shop' });
    const element = AudioElement.created[0]; element.error = { code: 2, message: 'HTTP 404 missing track' }; element.dispatchEvent(new Event('error')); await flush();
    expect(output.lastIssue).toMatchObject({ kind: 'music', recoverable: false });
    expect(output.lastIssue?.resource).toContain('shop.ogg'); expect(output.lastIssue?.reason).toContain('404'); expect(element.paused).toBe(true);
    output.applyMusicCue({ scene: 'shop' }); expect(AudioElement.created[0]!.paused).toBe(true); output.dispose();
  });
  it('reports original sound media and embedded decode failures through public playback/unlock', async () => {
    const output = createOutput(); output.play('vergil_atk');
    const voice = AudioElement.created.find(element => element.src.endsWith('/vergil_atk.ogg'))!;
    voice.error = { code: 3, message: 'unsupported codec' }; voice.dispatchEvent(new Event('error'));
    expect(output.lastIssue).toMatchObject({ kind: 'sound', recoverable: false }); expect(output.lastIssue?.reason).toContain('decode');
    let decodes = 0; AudioBackend.decodeBehavior = () => ++decodes === 1 ? Promise.reject(namedError('EncodingError', 'invalid OGG sample')) : Promise.resolve({});
    output.unlock(); await flush();
    expect(output.lastIssue).toMatchObject({ kind: 'sound', recoverable: false }); expect(output.lastIssue?.resource).toContain('tan00.ogg'); expect(output.lastIssue?.reason).toContain('EncodingError');
    output.dispose();
  });
  it('ignores an older music promise rejection after a new scene is already playing', async () => {
    const output = createOutput(), late = deferred(); let calls = 0;
    AudioElement.playBehavior = () => ++calls === 1 ? late.promise : Promise.resolve();
    output.applyMusicCue({ scene: 'title' }); output.applyMusicCue({ scene: 'shop' }); late.reject(namedError('NotSupportedError', 'old source decode failed')); await flush();
    expect(output.lastIssue).toBeNull(); expect(AudioElement.created[0].src).toContain('shop.ogg'); expect(AudioElement.created[0].paused).toBe(false);
    output.applyMusicCue({ scene: 'shop' });
    expect(AudioElement.created[0]!.src).toContain('shop.ogg'); expect(calls).toBe(2); output.dispose();
  });
  it('ignores stale media errors whose selected resource belongs to the preceding scene', () => {
    const output = createOutput(); output.applyMusicCue({ scene: 'title' }); const element = AudioElement.created[0], oldSource = element.src;
    output.applyMusicCue({ scene: 'shop' }); element.currentSrc = oldSource; element.error = { code: 3, message: 'old decode error' }; element.dispatchEvent(new Event('error'));
    expect(output.lastIssue).toBeNull(); output.applyMusicCue({ scene: 'shop' }); expect(AudioElement.created[0]!.src).toContain('shop.ogg'); output.dispose();
  });
  it('ignores stopped/disposed play and decode results instead of publishing or repopulating output', async () => {
    const output = createOutput(), lateMusic = deferred(), lateDecode = deferred<unknown>();
    AudioElement.playBehavior = () => lateMusic.promise; AudioBackend.decodeBehavior = () => lateDecode.promise;
    output.applyMusicCue({ scene: 'title' }); output.unlock(); output.dispose(); const issue = output.lastIssue;
    lateMusic.reject(namedError('NotSupportedError', 'late music')); lateDecode.reject(namedError('EncodingError', 'late decode')); await flush();
    for (const element of AudioElement.created) { element.error = { code: 4 }; element.dispatchEvent(new Event('error')); }
    expect(output.lastIssue).toBe(issue); expect(output.isRunning).toBe(false); expect(output.init()).toBe(false);
    expect(AudioBackend.created.every(context => context.state === 'closed')).toBe(true);
  });
});


describe('music request identity and failure bounds', () => {
  it('rejects an old same-track play promise after stop and restart by request epoch', async () => {
    const output = createOutput(), old = deferred(); let calls = 0;
    AudioElement.playBehavior = () => ++calls === 1 ? old.promise : Promise.resolve();
    output.applyMusicCue({ scene: 'title' }); output.applyMusicCue({ stop: true }); output.applyMusicCue({ scene: 'title' });
    old.reject(namedError('NotSupportedError', 'earlier request, same filename')); await flush();
    expect(output.lastIssue).toBeNull(); expect(AudioElement.created[0].paused).toBe(false);
    output.applyMusicCue({ scene: 'title' }); expect(AudioElement.created[0]!.src).toContain('open.ogg'); expect(calls).toBe(2); output.dispose();
  });
  it('keeps only one immutable latest issue and deduplicates the same observed reason', () => {
    const output = createOutput(); vi.spyOn(performance, 'now').mockReturnValue(1000);
    output.play('vergil_atk'); const first = AudioElement.created.at(-1)!;
    first.error = { code: 3, message: 'bad codec' }; first.dispatchEvent(new Event('error'));
    const issue = output.lastIssue!; expect(issue.id).toBe(1); expect(Object.isFrozen(issue)).toBe(true);
    vi.spyOn(performance, 'now').mockReturnValue(1100);
    output.play('vergil_atk'); const repeated = AudioElement.created.at(-1)!;
    repeated.error = { code: 3, message: 'bad codec' }; repeated.dispatchEvent(new Event('error'));
    expect(output.lastIssue).toBe(issue);
    vi.spyOn(performance, 'now').mockReturnValue(1200);
    output.play('vergil_aoe'); const other = AudioElement.created.at(-1)!;
    other.error = { code: 2, message: 'HTTP 404' }; other.dispatchEvent(new Event('error'));
    expect(output.lastIssue?.id).toBe(2); expect(output.lastIssue?.resource).toContain('vergil_aoe.ogg');
    expect(Object.keys(output.lastIssue!)).toEqual(['id', 'kind', 'resource', 'reason', 'recoverable', 'waitingForGesture']); output.dispose();
  });
});


describe('clearing recovered audio issues by request and resource', () => {
  it('only clears a sound issue after the same resource is accepted again', async () => {
    const output = createOutput(); let now = 1000; vi.spyOn(performance, 'now').mockImplementation(() => now);
    AudioElement.playBehavior = () => Promise.reject(namedError('NotAllowedError', 'gesture required'));
    output.play('vergil_atk'); await flush(); const issue = output.lastIssue!;
    AudioElement.playBehavior = undefined; now += 100; output.play('vergil_aoe'); await flush();
    expect(output.lastIssue).toBe(issue);
    now += 100; output.play('vergil_atk'); await flush(); expect(output.lastIssue).toBeNull(); output.dispose();
  });
  it('does not let an earlier same-resource success erase a later failure with the same reason', async () => {
    const output = createOutput(); let now = 1000; vi.spyOn(performance, 'now').mockImplementation(() => now);
    AudioElement.playBehavior = () => Promise.reject(namedError('NotAllowedError', 'gesture required'));
    output.play('vergil_atk'); await flush(); const issue = output.lastIssue!;
    const earlier = deferred(); AudioElement.playBehavior = () => earlier.promise; now += 100; output.play('vergil_atk');
    AudioElement.playBehavior = () => Promise.reject(namedError('NotAllowedError', 'gesture required')); now += 100; output.play('vergil_atk'); await flush();
    earlier.resolve(); await flush(); expect(output.lastIssue).toBe(issue); output.dispose();
  });
  it('does not erase a new media failure when its earlier play promise succeeds late', async () => {
    const output = createOutput(); let calls = 0; const accepted = deferred();
    AudioElement.playBehavior = () => ++calls === 1 ? Promise.reject(namedError('NotAllowedError', 'gesture required')) : accepted.promise;
    output.applyMusicCue({ type: 'music', scene: 'boss', track: 'halloween' }); await flush(); output.unlock();
    const element = AudioElement.created[0]; element.error = { code: 2, message: 'HTTP 404' }; element.dispatchEvent(new Event('error')); const issue = output.lastIssue;
    accepted.resolve(); await flush(); expect(output.lastIssue).toBe(issue); expect(issue?.reason).toContain('404'); output.dispose();
  });
});


describe('audio recovery lifetime boundaries', () => {
  it('keeps a music issue when another resource starts successfully', async () => {
    const output = createOutput();
    AudioElement.playBehavior = () => Promise.reject(namedError('NotAllowedError', 'gesture required'));
    output.applyMusicCue({ type: 'music', scene: 'boss', track: 'halloween' }); await flush(); const issue = output.lastIssue;
    AudioElement.playBehavior = undefined; output.applyMusicCue({ scene: 'shop' }); await flush();
    expect(output.lastIssue).toBe(issue); expect(AudioElement.created[0].paused).toBe(false); output.dispose();
  });
  it('ignores a sound play promise that rejects after disposal', async () => {
    const output = createOutput(), late = deferred(); AudioElement.playBehavior = () => late.promise;
    output.play('vergil_atk'); output.dispose(); late.reject(namedError('NotSupportedError', 'late sound failure')); await flush();
    expect(output.lastIssue).toBeNull(); expect(AudioElement.created.every(element => element.paused)).toBe(true);
  });
  it('does not report an obsolete embedded decode failure after that file is accepted through media', async () => {
    const output = createOutput(), late = deferred<unknown>(); let decodes = 0;
    AudioBackend.decodeBehavior = () => ++decodes === 1 ? late.promise : Promise.resolve({});
    output.unlock(); output.play('flandreShot'); await flush(); late.reject(namedError('EncodingError', 'obsolete fallback failure')); await flush();
    expect(output.lastIssue).toBeNull(); expect(AudioElement.created.some(element => !element.paused && element.src.endsWith('/tan00.ogg'))).toBe(true); output.dispose();
  });
});


describe('gesture classification and stale sound compensation', () => {
  it.each([
    ['NotAllowedError', true], ['SecurityError', false], ['AbortError', false], ['MediaError1', false],
  ])('keeps %s retryable without falsely requiring a gesture', async (name, waitingForGesture) => {
    const output = createOutput(); let calls = 0;
    const error = name === 'MediaError1' ? { code: 1, message: 'media request aborted' } : namedError(name, 'play request interrupted or blocked');
    AudioElement.playBehavior = () => ++calls === 1 ? Promise.reject(error) : Promise.resolve();
    output.applyMusicCue({ scene: 'shop' }); await flush();
    expect(output.lastIssue).toMatchObject({ kind: 'music', recoverable: true, waitingForGesture });
    output.unlock(); await flush(); expect(calls).toBe(2); expect(output.lastIssue).toBeNull(); output.dispose();
  });
  it('releases a stale failed sound voice without compensating or clearing the newer request issue', async () => {
    const output = createOutput(), decoded = deferred<unknown>(), older = deferred(), current = deferred();
    AudioBackend.decodeBehavior = () => decoded.promise; output.unlock();
    let calls = 0; AudioElement.playBehavior = () => ++calls === 1 ? older.promise : current.promise;
    output.play('flandreShot'); AudioBackend.created[0].currentTime += 1; output.beginFrame(); output.play('flandreShot');
    expect(calls).toBe(2); current.reject(namedError('NotSupportedError', 'current request failed')); await flush();
    const issue = output.lastIssue!; expect(issue.reason).toContain('current request failed');
    decoded.resolve({}); await flush(); const starts = AudioBackend.bufferStarts;
    older.reject(namedError('NotSupportedError', 'obsolete request failed')); await flush();
    expect(output.lastIssue).toBe(issue); expect(AudioBackend.bufferStarts).toBe(starts);
    expect(AudioElement.created.every(element => element.paused)).toBe(true); output.dispose();
  });
});


it('keeps compensation for the current sound request and resolves only its issue when the buffer starts', async () => {
  const output = createOutput(); output.unlock(); await flush();
  AudioElement.playBehavior = () => Promise.reject(namedError('NotSupportedError', 'media codec unavailable'));
  output.play('flandreShot'); await flush();
  expect(AudioBackend.bufferStarts).toBe(1); expect(output.lastIssue).toBeNull(); output.dispose();
});

it.each(['shoot1', 'shoot2'])('routes ordinary boss %s through file playback, frame deduplication and codec compensation', async name => {
  const output = createOutput(); output.unlock(); await flush();
  output.play(name); output.play(name);
  expect(AudioElement.created.filter(element => element.src.endsWith(`/${name}.ogg`) && element.playCount === 1)).toHaveLength(1);
  const context = AudioBackend.created[0]!;
  output.beginFrame(); output.play(name);
  expect(AudioElement.created.filter(element => element.src.endsWith(`/${name}.ogg`) && element.playCount === 1)).toHaveLength(1);
  context.currentTime += 1; output.beginFrame();
  AudioElement.playBehavior = () => Promise.reject(namedError('NotSupportedError', 'boss codec unavailable'));
  const before = AudioBackend.bufferStarts; output.play(name); await flush();
  expect(AudioBackend.bufferStarts).toBe(before + 1);
  expect(output.lastIssue).toBeNull(); output.dispose();
});
