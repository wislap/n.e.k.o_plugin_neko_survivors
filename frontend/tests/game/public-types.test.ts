import { expect, expectTypeOf, test } from 'vitest';
import { createGameSession, isGameSave, type GameSaveData } from '../../src/game';

test('the public save boundary exposes validated values and narrows unknown imports', () => {
  const session = createGameSession();
  expectTypeOf(session.exportSave()).toEqualTypeOf<GameSaveData | null>();
  expect(session.exportSave()).toBeNull();
  const imported: unknown = {};
  if (isGameSave(imported)) expectTypeOf(imported).toEqualTypeOf<GameSaveData>();
});
