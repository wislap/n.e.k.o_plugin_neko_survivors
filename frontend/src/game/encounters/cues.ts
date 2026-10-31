import type { RuleEffects } from '../world/effects-port.ts';
import type { GameEvent } from '../events.ts';
type SoundOptions = Omit<Extract<GameEvent, { type: 'sound' }>, 'type' | 'name'>;
type MusicOptions = Partial<Omit<Extract<GameEvent, { type: 'music' }>, 'type' | 'scene' | 'track'>>;
/** Semantic output only. The application owns all media and browser lifetimes. */
export function encounterCues(effects?: RuleEffects) {
  const emit = (event: GameEvent) => effects?.emit?.(event);
  return {
    play(name: string, options: SoundOptions = {}) { emit({ type: 'sound', name, ...options }); },
    playScene(scene: string) { emit({ type: 'music', scene: 'boss', track: scene }); },
    stopMusic() { emit({ type: 'music', scene: 'boss', track: '', stop: true }); },
  };
}
export function musicCue(effects: RuleEffects | undefined, track: string, initialVolume = 0.85) {
  let playing = false, position = 0, gain = initialVolume;
  const emit = (extra: MusicOptions) => effects?.emit?.({ type: 'music', scene: 'boss', track, ...extra });
  return {
    get paused() { return !playing; },
    get currentTime() { return position; },
    set currentTime(value: number) { position = value; emit({ position }); },
    get volume() { return gain; },
    set volume(value: number) { gain = value; emit({ volume: gain }); },
    play() { playing = true; emit({ position, volume: gain }); return Promise.resolve(); },
    pause() { playing = false; emit({ stop: true }); },
  };
}
