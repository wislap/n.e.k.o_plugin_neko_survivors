import type { Manifest, HostTransport, RuntimeConfiguration, Client, ConnectOptions } from './official-sdk';
import { PLUGIN_ID, type NekoHost } from './neko-host';
import { createPluginHost } from './plugin-host';
import { createSdkHost, type MiniGameClient } from './sdk-host';
import { createStandaloneHost } from './standalone-host';
export type { NekoHost, HostResult, HostStatus, AvatarLease, AvatarState, AvatarManifest, AvatarDisposalReport } from './neko-host';
export type { MiniGameClient } from './sdk-host';
export type { Manifest as MiniGameManifest, HostTransport as MiniGameTransport, RuntimeConfiguration as MiniGameRuntimeConfiguration } from './official-sdk';
export { PLUGIN_ID } from './neko-host';

export interface SdkBootstrap {
  /** Supplied by the trusted host page, never manufactured by this game. */
  sdk: { connect(manifest: Manifest, options: ConnectOptions): Promise<Client> };
  manifest: Manifest;
  transport: HostTransport;
  runtime?: RuntimeConfiguration;
  /** Trusted pre-registered Avatar slot; never a game-created transport slot. */
  avatarSlot?: string;
}
export interface HostOptions {
  host?: NekoHost;
  location?: Pick<Location, 'origin' | 'pathname'>;
  fetch?: typeof fetch;
  sdk?: MiniGameClient;
  avatarSlot?: string;
  sdkBootstrap?: SdkBootstrap;
}
export function createHost(options: HostOptions = {}): NekoHost {
  if (options.host) return options.host;
  if (options.sdk) return createSdkHost(options.sdk, { avatarSlot: options.avatarSlot });
  const location = options.location ?? (typeof window === 'undefined' ? undefined : window.location);
  if (location?.pathname.startsWith(`/plugin/${PLUGIN_ID}/ui/`)) return createPluginHost(location.origin, options.fetch);
  return createStandaloneHost();
}
/** Failed optional host integration always preserves standalone gameplay. */
export async function createConnectedHost(options: HostOptions = {}, signal?: AbortSignal): Promise<NekoHost> {
  if (options.host || options.sdk || !options.sdkBootstrap) return createHost(options);
  let client: Client | undefined;
  try {
    signal?.throwIfAborted();
    const { sdk, manifest, transport, runtime, avatarSlot } = options.sdkBootstrap;
    client = await sdk.connect(manifest, { transport, signal, connectTimeoutMs: 12_000 });
    if (signal?.aborted) { client.dispose(); return createStandaloneHost(); }
    client.runtime.configure(runtime ?? {
      payload: () => ({ session_id: client!.runtime.session.id, gameId: manifest.id }),
      heartbeat: { intervalMs: 2500, timeoutMs: 4500 }, outputs: false, pageExit: true,
    });
    return createSdkHost(client, { ownsClient: true, avatarSlot: avatarSlot ?? options.avatarSlot });
  } catch {
    client?.dispose(); return createStandaloneHost();
  }
}
