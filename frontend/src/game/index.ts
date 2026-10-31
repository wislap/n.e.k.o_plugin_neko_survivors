export type * from './views';
export type { GamePlatform } from './platform';
export * from './commands.ts';
export type * from './events';
export { createGameSession, isGameSave } from './session.ts';
export type { GameSession, SessionOptions, GameSaveData, RunSave } from './session.ts';
export { isGameMeta, createEmptyMeta } from './save/meta.ts';
export type { GameMeta } from './save/meta.ts';
export { getCharacterChoices, getDifficultyChoices } from './catalog.ts';
export { convertLegacyProgress } from './save/schema.ts';

export { GameFrameBuffer } from './frame-buffer.ts';

export { RenderStream, PLAYER_STRIDE, ENEMY_STRIDE, PICKUP_STRIDE, PLAYER_STYLES, BULLET_SHAPES, PICKUP_KINDS } from './render-stream.ts';

export type { RenderStreamData, RenderStreamView } from './render-stream.ts';
export { readPlayerView, readEnemyView, readPickupView } from './render-stream.ts';

export { GameDisplayBuffer, DISPLAY_BODY_STRIDE } from './display-frame.ts';
export type { DisplayFrame, DisplayBodies, DisplayAppearance } from './display-frame.ts';

export { writeDisplayBody } from './display-body.ts';

export { TrailPreparation } from './display-trail.ts';
export { PlayerTrailPreparation } from './display-trails.ts';
export type { PreparedTrails,TrailRun } from './display-trails.ts';
