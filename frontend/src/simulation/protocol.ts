import type { CommandResult, GameCommand, GameEvent, GameMeta, GameSaveData, GameUiSnapshot, InputFrame, SessionOptions } from '../game/index.ts';
import type { FramePacket, FrameBuffers } from './frame-packet.ts';

export interface Progress { run: GameSaveData | null; meta: Readonly<GameMeta> }
export interface GameOutput { event: GameEvent; progress?: Progress; step: number; commandId?: number }
export interface SimulationStats {
  speed: number; steps: number; combatSteps: number; simulationMs: number; projectionMs: number;
  packets: number; bytes: number; buffersInFlight: number; inputSequence: number;
  elapsedMs: number; actualSpeed: number; backlogSeconds: number; unservedSeconds: number; resetDebtSeconds: number;
  updatesInFlight: number; bufferedEvents: number; queuedInputEdges: number; inputLatencyMs: number;
}
export type Request =
  | { kind: 'initialize'; options: SessionOptions; width: number; height: number; packed: boolean; profile: boolean; renderPort?: MessagePort }
  | { kind: 'command'; command: GameCommand }
  | { kind: 'shortcut'; action: 'pause' | 'auto-upgrade' | 'toggle-auto-upgrade' }
  | { kind: 'replace'; options: Omit<SessionOptions, 'platform'> }
  | { kind: 'save' }
  | { kind: 'speed'; speed: number }
  | { kind: 'suspend'; suspended: boolean }
  | { kind: 'viewport'; width: number; height: number }
  | { kind: 'start' }
  /** Deterministic driver for headless/real-worker tests. Never enabled by the product client. */
  | { kind: 'advance'; steps: number; input: InputFrame }
  | { kind: 'inspect' }
  | { kind: 'metrics' };
export type WorkerInput =
  | (Request & { id: number })
  | { kind: 'input'; sequence: number; input: InputFrame; sentAt?: number }
  | { kind: 'frame'; afterStep?: number; afterStateAt?: number }
  | { kind: 'recycle'; slot: number; lease: number; buffers?: FrameBuffers }
  | { kind: 'ack'; sequence: number };
export interface Reply {
  kind: 'reply'; id: number; epoch: number; ui: Readonly<GameUiSnapshot>;
  result: CommandResult; stats: SimulationStats; progress?: Progress; outputs?: GameOutput[];
  preceding?: { epoch: number; outputs: GameOutput[] };
}
export type WorkerOutput = Reply
  | { kind: 'update'; epoch: number; sequence: number; ui?: Readonly<GameUiSnapshot>; outputs: GameOutput[]; stats: SimulationStats }
  | { kind: 'frame'; epoch: number; slot: number; lease: number; packet: FramePacket; producedAt: number; stateAt: number; step: number; stats: SimulationStats }
  | { kind: 'fatal'; message: string };

/** Direct-port traffic has its own epoch notification; command receipts remain on Main. */
export type SimulationDisplayOutput=Extract<WorkerOutput,{kind:'frame'|'fatal'}>|{kind:'epoch';epoch:number};
