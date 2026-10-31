export const HOST_STATUSES = ['submitted', 'queued', 'completed', 'throttled', 'unavailable', 'rejected', 'cancelled'] as const;
export type HostStatus = typeof HOST_STATUSES[number];
export function isHostStatus(value: unknown): value is HostStatus { return HOST_STATUSES.some(status => status === value); }
export interface HostResult<T = never> {
  readonly status: HostStatus;
  readonly reason?: string;
  readonly data?: T;
}
export interface AvatarState { readonly identity: string }
export interface AvatarManifest { readonly name: string; readonly generation: string; readonly modelUrl: string; readonly scripts: readonly string[] }
export interface AvatarMountOptions { readonly container: HTMLElement; readonly signal?: AbortSignal }
export interface AvatarDisposalReport {
  readonly confirmed: boolean;
  readonly reason: string;
  readonly modelsObserved?: number;
  readonly modelsDestroyed?: boolean;
  readonly appsObserved?: number;
  readonly appsDestroyed?: boolean;
  readonly tickersStopped?: boolean;
  readonly contextsObserved?: number;
  readonly contextsLost?: number;
  readonly pendingLoadRetired?: boolean;
  readonly sharedTickersStopped?: boolean;
  readonly errors?: readonly string[];
}
export interface AvatarLease {
  /** Present only when the adapter can observe and acknowledge actual teardown. */
  readonly released?: Promise<AvatarDisposalReport>;
  setEmotion(name: string, signal?: AbortSignal): Promise<HostResult>;
  dispose(): void;
}
export interface NekoHost {
  readonly mode: 'plugin' | 'sdk' | 'standalone';
  resetSession(signal?: AbortSignal): Promise<HostResult>;
  closeSession(reason?: string): Promise<HostResult>;
  getAvatarState(signal?: AbortSignal): Promise<HostResult<AvatarState>>;
  mountAvatar(options: AvatarMountOptions): Promise<AvatarLease | null>;
  report(event: string, text: string, signal?: AbortSignal): Promise<HostResult>;
  speak(text: string, signal?: AbortSignal): Promise<HostResult>;
  dispose(): void;
}
export const PLUGIN_ID = 'neko_survivors_react';

/** One owner aborts all requests when this game session ends. */
export function requestLifetime() {
  const lifetime = new AbortController();
  const ownedSignal = (external?: AbortSignal) => external ? AbortSignal.any([lifetime.signal, external]) : lifetime.signal;
  return {
    ownedSignal,
    signal(external?: AbortSignal, timeoutMs = 15_000) {
      return AbortSignal.any([ownedSignal(external), AbortSignal.timeout(timeoutMs)]);
    },
    dispose() { lifetime.abort(); },
  };
}
