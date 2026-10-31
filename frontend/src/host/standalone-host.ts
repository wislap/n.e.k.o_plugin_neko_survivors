import type { HostResult, NekoHost } from './neko-host';

export function createStandaloneHost(): NekoHost {
  let disposed = false;
  const unavailable = async (_text?: string, signal?: AbortSignal): Promise<HostResult<never>> => ({
    status: disposed || signal?.aborted ? 'cancelled' : 'unavailable', reason: 'host_not_connected',
  });
  return {
    mode: 'standalone',
    mountAvatar: async () => null,
    resetSession: (signal) => unavailable(undefined, signal),
    closeSession: async () => ({ status: 'completed' }),
    getAvatarState: (signal) => unavailable(undefined, signal),
    report: (_event, text, signal) => unavailable(text, signal),
    speak: unavailable,
    dispose() { disposed = true; },
  };
}
