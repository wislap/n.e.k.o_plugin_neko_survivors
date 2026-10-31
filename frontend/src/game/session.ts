import type { GameDisplayBuffer, DisplayFrame } from './display-frame.ts';
import type { GameFrameBuffer } from './frame-buffer.ts';
import type { GameCommand, CommandResult, InputFrame } from './commands';
import type { GameEvent, StepResult } from './events';
import type { GameFrame, GameUiSnapshot } from './views';
import { SessionEngine } from './session-engine.ts';
import { isSupportedSave } from './save/schema.ts';
import type { GameSaveData } from './save/types.ts';
export type { GameSaveData, RunSave } from './save/types.ts';
import type { GameMeta } from './save/meta.ts';
import type { GamePlatform } from './platform';
export { isGameMeta, createEmptyMeta } from './save/meta.ts';
export type { GameMeta } from './save/meta.ts';

export interface GameSession {
  dispatch(command: GameCommand): CommandResult;
  advance(input: InputFrame): StepResult;
  /** Take committed command output without advancing any rule clock. Single consumer. */
  drainEvents(): readonly GameEvent[];
  readDisplay(buffer:GameDisplayBuffer):Readonly<DisplayFrame>;
  readFrame(buffer?: GameFrameBuffer): Readonly<GameFrame>;
  readUi(): Readonly<GameUiSnapshot>;
  exportSave(): GameSaveData | null;
  getMeta(): Readonly<GameMeta>;
  setViewport(width: number, height: number): void;
}
export interface SessionOptions { save?: unknown; meta?: unknown; platform?: GamePlatform }
export function createGameSession(options: SessionOptions = {}): GameSession {
  const engine = new SessionEngine(options);
  const session: GameSession = {
    dispatch: command => engine.dispatch(command),
    advance: input => engine.advance(input),
    drainEvents: () => engine.drainEvents(),
    readDisplay: buffer => engine.readDisplay(buffer),
    readFrame: buffer => engine.readFrame(buffer),
    readUi: () => engine.readUi(),
    exportSave: () => engine.exportSave(),
    getMeta: () => engine.getMeta(),
    setViewport: (width, height) => engine.setViewport(width, height),
  };
  return Object.freeze(session);
}
export function isGameSave(value: unknown): value is GameSaveData { return isSupportedSave(value); }
