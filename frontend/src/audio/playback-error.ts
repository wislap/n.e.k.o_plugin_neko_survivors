interface PlaybackErrorFields { name?: string; code?: number; message?: string }
export function playbackErrorFields(error: unknown): PlaybackErrorFields {
  if (typeof error !== 'object' || error === null) return {};
  return {
    name: 'name' in error && typeof error.name === 'string' ? error.name : undefined,
    code: 'code' in error && typeof error.code === 'number' ? error.code : undefined,
    message: 'message' in error && typeof error.message === 'string' ? error.message : undefined,
  };
}
export function isRetryablePlaybackError(error: unknown) {
  const fields = playbackErrorFields(error);
  return fields.name === 'NotAllowedError' || fields.name === 'SecurityError' || fields.name === 'AbortError' || fields.code === 1 && !fields.name;
}
export function audioErrorReason(error: unknown) {
  if (typeof error === 'string') return error;
  const fields = playbackErrorFields(error), code = fields.code;
  const media = code === 1 && !fields.name ? 'Media request was aborted' : code === 2 ? 'Media network/HTTP failure' : code === 3 ? 'Media decode failure' : code === 4 ? 'Media format/source unsupported' : '';
  const message = fields.message || media || 'Audio playback failed';
  return `${fields.name ? `${fields.name}: ` : ''}${media && message !== media ? `${media}: ` : ''}${message}`;
}
