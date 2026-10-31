import type { AudioSettings } from '../audio/types';

export function readAudioSettings(value: unknown): AudioSettings {
  const source = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  const level = (key: string, fallback: number) => typeof source[key] === 'number' && Number.isFinite(source[key])
    ? Math.max(0, Math.min(1, source[key] as number)) : fallback;
  return { master: level('master', 0.65), sfx: level('sfx', 0.7), music: level('music', 0.45),
    enabled: typeof source.enabled === 'boolean' ? source.enabled : true };
}

export function readEffectOpacity(value: unknown): number {
  const settings = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (typeof settings.playerEffectOpacity === 'number' && Number.isFinite(settings.playerEffectOpacity)) {
    return Math.max(0, Math.min(1, settings.playerEffectOpacity));
  }
  return 1;
}
