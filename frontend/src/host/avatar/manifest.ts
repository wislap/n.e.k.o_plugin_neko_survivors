import type { AvatarManifest, AvatarState } from '../neko-host';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
function localUrl(value: unknown): value is string {
  if (!text(value) || !value.startsWith('/plugin/neko_survivors_react/ui/vendor/') || /[?#\\]/.test(value)) return false;
  try {
    const decoded = decodeURIComponent(value);
    return !decoded.split('/').some(segment => segment === '..' || segment === '.') && !decoded.includes('\\');
  } catch { return false; }
}
/** Decode the public wire contract once, before application code observes it. */
export function decodeAvatarState(value: unknown): AvatarState | null {
  return record(value) && text(value.identity)
    ? { identity: value.identity } : null;
}
export function decodeAvatarManifest(value: unknown): AvatarManifest | null {
  if (!record(value) || !text(value.name) || !text(value.generation) || /[/%?#\\]/.test(value.generation) || !localUrl(value.modelUrl)
    || !Array.isArray(value.scripts) || !value.scripts.length || !value.scripts.every(localUrl)) return null;
  const base = `/plugin/neko_survivors_react/ui/vendor/${value.generation}/`;
  if (!value.modelUrl.startsWith(base) || value.scripts.some(url => !url.startsWith(base)) || new Set(value.scripts).size !== value.scripts.length) return null;
  return { name: value.name, generation: value.generation, modelUrl: value.modelUrl, scripts: Object.freeze([...value.scripts]) };
}
