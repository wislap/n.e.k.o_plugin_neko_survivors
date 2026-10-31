// Public NEKO Mini-Game SDK protocol v1 declaration snapshot.
// Source: static/game/sdk/neko-minigame-sdk.d.ts in host main 09a7669cf.
// Type declarations only; no private host runtime is bundled.
export as namespace NekoMiniGame;

declare namespace NekoMiniGame {
  type JsonPrimitive = string | number | boolean | null;
  type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
  type Capability =
    | 'runtime'
    | 'dialogue'
    | 'quick-lines'
    | 'logging'
    | 'voice-input'
    | 'avatar-renderer'
    | 'audio'
    | 'media-timeline'
    | 'speech-output'
    | 'vision'
    | 'context-read'
    | 'memory'
    | 'storage'
    | 'leaderboard-local'
    | 'leaderboard-server'
    | (string & {});
  type ContractKind = 'event' | 'state' | 'control' | 'result' | 'command';
  type ContractSchemaType =
    | 'null'
    | 'boolean'
    | 'number'
    | 'integer'
    | 'string'
    | 'array'
    | 'object';

  interface ContractSchema {
    type: ContractSchemaType;
    enum?: readonly JsonPrimitive[];
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    minItems?: number;
    maxItems?: number;
    items?: ContractDeclaration;
    properties?: Readonly<Record<string, ContractDeclaration>>;
    required?: readonly string[];
    additionalProperties?: boolean;
  }

  type ContractDeclaration = ContractSchema | readonly string[];

  interface CommandRequestSchema {
    type: 'object';
    properties?: Readonly<Record<string, ContractDeclaration>>;
    required?: readonly string[];
    additionalProperties?: boolean;
  }

  interface CommandContract {
    request: CommandRequestSchema;
    response: ContractDeclaration;
  }

  interface ManifestContracts {
    events?: Readonly<Record<string, ContractDeclaration>>;
    states?: Readonly<Record<string, ContractDeclaration>>;
    controls?: Readonly<Record<string, ContractDeclaration>>;
    results?: Readonly<Record<string, ContractDeclaration>>;
    commands?: Readonly<Record<string, CommandContract>>;
  }

  interface Manifest {
    id: string;
    version: string;
    protocolVersion?: '1';
    requiredCapabilities: readonly Capability[];
    optionalCapabilities?: readonly Capability[];
    contracts?: ManifestContracts;
    leaderboards?: Readonly<Record<string, LeaderboardDefinition>>;
  }

  interface NormalizedManifest extends Omit<Manifest, 'protocolVersion' | 'optionalCapabilities' | 'contracts' | 'leaderboards'> {
    protocolVersion: '1';
    optionalCapabilities: readonly Capability[];
    contracts: Readonly<Required<ManifestContracts>>;
    leaderboards: Readonly<Record<string, Readonly<LeaderboardDefinition>>>;
  }

  interface LeaderboardDefinition {
    scoreField?: string;
    order?: 'ascending' | 'descending';
    maxEntries?: number;
    retention?: 'best' | 'recent';
  }

  interface RegistrationIdentity {
    mode: 'registered' | 'development';
    gameId: string;
    publisherId: string;
    version: string;
  }

  interface HostInfo {
    version: string;
    protocolVersion: '1';
    registration: RegistrationIdentity;
  }

  interface HostHandshakeRequest {
    sdkVersion: string;
    protocolVersions: readonly ['1'];
    manifest: NormalizedManifest;
  }

  interface HostHandshakeResponse {
    accepted: boolean;
    protocolVersion?: '1' | string;
    hostVersion?: string;
    registration?: RegistrationIdentity;
    grantedCapabilities?: readonly Capability[];
    code?: string;
    message?: string;
  }

  /** Trusted host boundary. Game code must not implement or inspect this transport. */
  interface HostTransport {
    connectGame(
      request: HostHandshakeRequest,
      options: { signal: AbortSignal; timeoutMs: number },
    ): HostHandshakeResponse | Promise<HostHandshakeResponse>;
    dispose?(options?: { preservePendingOperations?: readonly string[] }): void;
    [key: string]: unknown;
  }

  interface ConnectOptions {
    /** Injected by the trusted N.E.K.O host, not created by the game. */
    transport: HostTransport;
    signal?: AbortSignal;
    connectTimeoutMs?: number;
    windowImpl?: Window;
    documentImpl?: Document;
  }

  interface ErrorDetails {
    operation?: string;
    capability?: string;
    [key: string]: unknown;
  }

  class Error extends globalThis.Error {
    readonly code: string;
    readonly details: ErrorDetails;
  }

  interface Response<T = Record<string, unknown>> {
    readonly ok: boolean;
    readonly status: number;
    readonly data: T;
  }

  interface RequestOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
  }

  interface Capabilities {
    readonly granted: readonly Capability[];
    readonly unavailable: readonly Capability[];
    has(capability: Capability): boolean;
    require(capability: Capability): true;
  }

  type RuntimeState = 'idle' | 'starting' | 'running' | 'degraded' | 'inactive' | 'ending' | 'ended' | 'disposed';

  interface RuntimeSession {
    readonly id: string;
    readonly characterName: string;
    readonly routeInstanceId: string;
  }

  interface RuntimeEvent<T = unknown> {
    readonly protocolVersion: '1';
    readonly sequence: number;
    readonly type: string;
    readonly timestamp: number;
    readonly sessionId: string;
    readonly payload: T;
  }

  interface RuntimeConfiguration {
    /**
     * Return a bounded plain JSON object. The object type only excludes primitives;
     * arrays, functions, Date/Map objects and class instances are rejected at runtime.
     */
    payload?: () => object;
    heartbeat?: false | { intervalMs?: number; timeoutMs?: number };
    outputs?: false | { intervalMs?: number; timeoutMs?: number; limit?: number };
    /** The page-exit payload follows the same static/runtime contract as payload. */
    pageExit?: false | true | { payload?: (context: unknown) => object };
  }

  interface Runtime {
    readonly state: RuntimeState;
    readonly session: RuntimeSession;
    configure(config?: RuntimeConfiguration): Readonly<RuntimeConfiguration>;
    /**
     * `keepCharacter` re-applies the currently bound character synchronously, so a
     * replay keeps its mounted Avatars without re-binding. It is not re-resolved, and
     * every mounted or mounting Avatar must declare that same `characterName`.
     */
    reset(options?: { newSession?: boolean; keepCharacter?: boolean }): RuntimeSession;
    /** Resolve and bind locally before pregame requests. Omit name for current character. */
    bindCharacter(name?: string, options?: RequestOptions): Promise<AvatarCharacterDescriptor | null>;
    /**
     * Accepts object interfaces without index signatures. Static checking only
     * excludes primitives; runtime requires a bounded plain JSON object and rejects
     * arrays, functions, Date/Map objects and class instances with invalid_request.
     */
    start(payload?: object, options?: RequestOptions): Promise<Response>;
    /** Uses the same static/runtime payload contract as start. */
    end(payload?: object, options?: RequestOptions & { useBeacon?: boolean }): Promise<Response>;
    pulse(force?: boolean): Promise<unknown>;
    pollOutputs(): Promise<unknown>;
    startMonitoring(options?: { heartbeat?: boolean; outputs?: boolean }): void;
    stopMonitoring(): void;
  }

  interface Dialogue {
    readonly pendingCount: number;
    quickLines(
      payload?: Readonly<Record<string, JsonValue>>,
      options?: RequestOptions,
    ): Promise<Response>;
    request(
      payload?: Readonly<Record<string, JsonValue>> & {
        readonly prompt?: Readonly<{
          mode: 'author-managed';
          messages: readonly Readonly<{
            role: 'system' | 'user' | 'assistant';
            content: string;
          }>[];
        }>;
      },
      options?: RequestOptions,
    ): Promise<Response>;
  }

  interface SpeechRequest {
    text: string;
    requestId?: string;
    source?: string;
    eventKey?: string;
    priority?: number;
    relativeGain?: number;
    interruptExisting?: boolean;
    reuseSynthesizedAudio?: boolean;
    mirrorText?: boolean;
    emitTurnEnd?: boolean;
    reason?: string;
    language?: string;
    renderLanguage?: string;
    event?: Readonly<Record<string, JsonValue>>;
  }

  interface SpeechPreloadOptions extends RequestOptions {
    language?: string;
    renderLanguage?: string;
  }

  interface SpeechMirrorRequest {
    text: string;
    requestId?: string;
    turnId?: string;
    source?: string;
    finalizeTurn?: boolean;
    event?: Readonly<Record<string, JsonValue>>;
  }

  interface SpeechPlaybackState {
    readonly active: boolean;
    readonly speechId: string;
    readonly remainingSeconds: number;
    readonly pendingAudioWork: boolean;
    readonly priority: number | null;
    readonly requestId: string;
    readonly eventKey: string;
    readonly [key: string]: unknown;
  }

  interface SpeechOutput {
    readonly connected: boolean;
    readonly pendingCount: number;
    readonly preloadPendingCount: number;
    speak(request: SpeechRequest, options?: RequestOptions): Promise<Response>;
    mirror(request: SpeechMirrorRequest, options?: RequestOptions): Promise<Response>;
    preload(lines: string | readonly string[], options?: SpeechPreloadOptions): Promise<Response>;
    getState(): SpeechPlaybackState;
    onState(handler: (state: SpeechPlaybackState) => void): () => void;
    onError(handler: (error: Readonly<Record<string, unknown>>) => void): () => void;
  }

  interface AvatarModel { type: 'live2d' | 'vrm' | 'mmd' | 'pngtuber'; path: string }
  interface AvatarCharacterDescriptor {
    readonly name: string;
    readonly model: Readonly<AvatarModel> | null;
    readonly rendererAvailable: boolean;
    /** Empty locale + resolved=true means explicitly no stored preference; false means unavailable. */
    readonly languagePreference?: Readonly<{ locale: string; resolved: boolean }>;
    /** Canonical host-supplied alternatives, at most four. Never invented by the game. */
    readonly fallbackModels?: readonly Readonly<AvatarModel>[];
  }
  interface AvatarMountConfiguration {
    slot: string;
    /** Matching session characters automatically follow SDK speech playback. */
    characterName?: string;
    model: AvatarModel;
    /** Maximum display rectangle. Fixed mode requires both dimensions. */
    viewport: { mode: 'fixed'; width: number; height: number }
      | { mode: 'container' | 'host-window'; width?: number; height?: number };
    fit?: {
      /** contain is the default; width/height can crop the other axis. */
      mode?: 'contain' | 'cover' | 'native' | 'width' | 'height';
      /** Default true. False preserves native size times scaleMultiplier. */
      autoScale?: boolean;
      /** Soft CSS-pixel minima; ignored in manual/native mode. */
      minWidth?: number;
      minHeight?: number;
      align?: string;
      padding?: number;
      scaleMultiplier?: number;
    };
    resize?: { mode: 'fixed' | 'container' | 'host-window' };
  }

  interface AvatarController {
    readonly disposed: boolean;
    readonly config: Readonly<AvatarMountConfiguration>;
    setModel(model: AvatarModel): Promise<unknown>;
    setView(view: { scale: number; x: number; y: number }): Promise<unknown>;
    /** Manual override for custom rendering; not needed for normal SDK speech. */
    setSpeaking(active: boolean): Promise<unknown>;
    focus(point: { x: number; y: number }): unknown;
    setEmotion(name: string): unknown;
    pause(): unknown;
    resume(): unknown;
    getState(): Readonly<Record<string, unknown>>;
    dispose(): void;
  }

  interface Avatar {
    readonly activeCount: number;
    /** At most four queries, including transports still settling after cancellation. */
    readonly pendingQueryCount: number;
    /** Display-only metadata; default deadline 10s, maximum 30s. */
    getCurrentCharacter(options?: RequestOptions): Promise<AvatarCharacterDescriptor | null>;
    getCharacter(name: string, options?: RequestOptions): Promise<AvatarCharacterDescriptor | null>;
    listCharacters(options?: RequestOptions): Promise<readonly string[]>;
    mount(config: AvatarMountConfiguration): Promise<AvatarController>;
    disposeAll(): void;
  }

  /** Subset of the public Client used by this adapter. */
  interface Client {
    readonly capabilities: Capabilities;
    readonly runtime: Runtime;
    readonly dialogue: Dialogue;
    readonly speech: SpeechOutput;
    readonly avatar: Avatar;
    dispose(options?: { preserveRuntimeEnd?: boolean }): void;
  }
}
export = NekoMiniGame;
