import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameSession } from '../../src/game/index.ts';

test('public summaries retain saved combat records and distinguish this-wave, total and manual retries', () => {
  const game = createGameSession();
  game.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 2, seed: 69 } });
  const save = game.exportSave();
  Object.assign(save.run.player, { damageDealt: 1234.5, damageTaken: 67.2, timeAlive: 150.7 });
  Object.assign(save.run.mates[0], { damageDealt: 321, damageTaken: 12, timeAlive: 140 });
  Object.assign(save.run, { retries: 5, manualRetries: 2 });
  save.checkpoint.retries = 3;
  const restored = createGameSession({ save });
  const ui = restored.readUi();
  assert.equal(ui.players[0].damageDealt, 1234.5);
  assert.equal(ui.players[0].damageTaken, 67.2);
  assert.equal(ui.players[0].timeAlive, 150.7);
  assert.equal(ui.players[1].damageDealt, 321);
  assert.equal(ui.players[1].timeAlive, 140);
  assert.deepEqual(ui.retryStats, { wave: 2, total: 5, manual: 2 });
  assert.equal(restored.dispatch({ type: 'retry-wave' }).ok, true);
  assert.deepEqual(restored.readUi().retryStats, { wave: 3, total: 6, manual: 3 });
});
