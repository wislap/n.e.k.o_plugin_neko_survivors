import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameSession, EMPTY_INPUT, isGameSave } from '../../src/game/index.ts';
import { SessionEngine } from '../../src/game/session-engine.ts';

const options = { characterId: 'kuro', difficulty: 'nightmare', partySize: 1, seed: 1342502704, pilot: false };
function start(overrides = {}) {
  const game = createGameSession();
  assert.equal(game.dispatch({ type: 'start-run', options: { ...options, ...overrides } }).ok, true);
  return game;
}
const toggle = (game, enabled) => assert.equal(game.dispatch({ type: 'set-pilot', enabled }).ok, true);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('natural fractional health survives repeated paused handovers and every checkpoint', () => {
  const game = start(); toggle(game, true);
  for (let i = 0; i < 721; i++) game.advance(EMPTY_INPUT);
  const full = game.readUi().players[0];
  near(full.hp, 19.98); near(full.maxHp, 19.98);
  assert.equal(game.dispatch({ type: 'pause' }).ok, true);
  const tick = game.readFrame().tick;
  for (let i = 0; i < 20; i++) {
    toggle(game, false); near(game.readUi().players[0].hp, full.maxHp);
    toggle(game, true);
    assert.equal(isGameSave(game.exportSave()), true);
    assert.equal(game.readUi().phase, 'paused');
    assert.equal(game.readFrame().tick, tick);
  }
  game.dispatch({ type: 'resume' });
  for (let i = 0; i < 2400; i++) {
    const result = game.advance(EMPTY_INPUT);
    if (result.events.some(event => event.type === 'checkpoint')) assert.equal(isGameSave(game.exportSave()), true);
  }
  assert.ok(game.readUi().wave >= 2);
});

test('takeover retains the entry health fraction through growth and save continuation', () => {
  const saved = start().exportSave(); saved.run.player.hp = 6;
  const game = createGameSession({ save: saved }); toggle(game, true);
  for (let i = 0; i < 721; i++) game.advance(EMPTY_INPUT);
  const continued = createGameSession({ save: JSON.parse(JSON.stringify(game.exportSave())) });
  const maximum = continued.readUi().players[0].maxHp;
  toggle(continued, false); near(continued.readUi().players[0].hp, maximum * .5);
  toggle(continued, false); near(continued.readUi().players[0].hp, maximum * .5);
  assert.equal(continued.exportSave().run.handoverHealth, null);
});

test('a fresh automatic run has no handover debt and keeps permanent AI growth on return', () => {
  const game = start({ pilot: true }); game.advance(EMPTY_INPUT);
  const before = game.readUi().players[0]; toggle(game, false);
  near(game.readUi().players[0].hp, before.hp);
  assert.equal(game.exportSave().run.handoverHealth, null);
  assert.equal(game.readUi().players[0].statDetails.find(stat => stat.statId === 'armor').value, 10);
});

test('retry ends the failed takeover instead of applying its health debt to a new attempt', () => {
  const saved = start().exportSave(); saved.run.player.hp = 3;
  const game = createGameSession({ save: saved }); toggle(game, true);
  game.advance(EMPTY_INPUT);
  assert.equal(game.dispatch({ type: 'retry-wave' }).ok, true);
  assert.equal(game.readUi().pilot, true);
  assert.equal(game.exportSave().run.handoverHealth, null);
  const health = game.readUi().players[0].hp; toggle(game, false);
  near(game.readUi().players[0].hp, health);
});

test('result controls cannot rewrite a dead character, and retirement clears temporary assistance', () => {
  const engine = new SessionEngine(); engine.dispatch({ type: 'start-run', options });
  engine.dispatch({ type: 'set-pilot', enabled: true }); engine.advance(EMPTY_INPUT);
  for (let i = 0; i < 6; i++) {
    engine.battle.player.hp = 0; engine.battle.player.dead = true;
    engine.endRun(false);
    engine.advance(EMPTY_INPUT);
  }
  assert.equal(engine.run.phase, 'result'); assert.equal(engine.pilotEnabled, false);
  assert.equal(engine.battle.player.pilotBuff, false);
  assert.equal(engine.battle.player.agentMoveTarget, null);
  assert.equal(engine.exportSave().run.handoverHealth, null);
  const hp = engine.battle.player.hp;
  assert.equal(engine.dispatch({ type: 'set-pilot', enabled: true }).ok, false);
  assert.equal(engine.battle.player.hp, hp); assert.equal(engine.battle.player.dead, true);
});

test('automatic retry budget survives JSON save continuation and resets for a new run', () => {
  const engine = new SessionEngine(); engine.dispatch({ type: 'start-run', options: { ...options, pilot: true } });
  for (let i = 0; i < 5; i++) engine.retryWave(true);
  const restored = new SessionEngine({ save: JSON.parse(JSON.stringify(engine.exportSave())) });
  assert.equal(restored.run.menuAction(true, true, 0), null);
  restored.endRun(false);
  assert.equal(restored.run.menuAction(true, true, 0), 'retire-pilot');
  restored.advance(EMPTY_INPUT); assert.equal(restored.pilotEnabled, false);
  restored.dispatch({ type: 'start-run', options: { ...options, pilot: true } }); restored.endRun(false);
  assert.equal(restored.run.menuAction(true, true, 0), 'retry');
});

test('old v2 progress without an AI budget still loads and rounded health is normalized once', () => {
  const game = start(); toggle(game, true);
  for (let i = 0; i < 721; i++) game.advance(EMPTY_INPUT);
  toggle(game, false);
  const saved = game.exportSave();
  delete saved.run.aiAttempts; delete saved.checkpoint.aiAttempts;
  saved.run.player.hp = Math.round(saved.run.player.hp);
  assert.equal(isGameSave(saved), true);
  const continued = createGameSession({ save: saved });
  const player = continued.readUi().players[0]; near(player.hp, player.maxHp);
  toggle(continued, true); assert.equal(isGameSave(continued.exportSave()), true);
});

test('control changes are idempotent, reject results and never revive a downed actor', () => {
  const engine = new SessionEngine(); engine.dispatch({ type: 'start-run', options: { ...options, partySize: 2 } });
  engine.dispatch({ type: 'set-pilot', enabled: true }); engine.drainEvents();
  const before = engine.exportSave();
  assert.equal(engine.dispatch({ type: 'set-pilot', enabled: true }).ok, true);
  assert.deepEqual(engine.exportSave(), before); assert.deepEqual(engine.drainEvents(), []);
  engine.battle.player.down(); const hp = engine.battle.player.hp;
  assert.equal(engine.dispatch({ type: 'set-pilot', enabled: false }).ok, true);
  assert.equal(engine.battle.player.hp, hp); assert.equal(engine.battle.player.downed, true);
  assert.equal(engine.dispatch({ type: 'set-pilot', enabled: true }).ok, true);
  assert.equal(engine.exportSave().run.handoverHealth, null);
  assert.equal(engine.battle.player.downed, true);
  engine.endRun(false, true);
  assert.equal(engine.pilotEnabled, false); assert.equal(engine.battle.player.pilotBuff, false);
  assert.equal(engine.dispatch({ type: 'set-pilot', enabled: true }).ok, false);
});

test('automatic retry budget rejects malformed values instead of weakening saved-state validation', () => {
  const initial = start().exportSave();
  for (const budget of [[[0, 6]], [[0, -1]], [[-1, 1]], [[0, 1.5]], [[0, NaN]], [[0, 1], [0, 2]], [[0, 1, 2]], null]) {
    const saved = structuredClone(initial); saved.run.aiAttempts = budget;
    assert.equal(isGameSave(saved), false);
    assert.throws(() => createGameSession({ save: saved }), /存档格式或内容无效/);
  }
});

test('internal progress failure has a different error from invalid external save data', () => {
  const engine = new SessionEngine(); engine.dispatch({ type: 'start-run', options });
  const saved = engine.exportSave(); saved.run.player.hp = NaN;
  assert.throws(() => createGameSession({ save: saved }), /存档格式或内容无效/);
  engine.battle.player.hp = NaN;
  assert.throws(() => engine.exportSave(), /游戏内部进度状态不一致/);
});

test('nullable control and encounter fields reject undefined structured-clone input', () => {
  for (const field of ['handoverHealth', 'challenge']) {
    const saved = start({ pilot: true }).exportSave(); saved.run[field] = undefined;
    assert.equal(isGameSave(saved), false, field);
    assert.throws(() => createGameSession({ save: structuredClone(saved) }), /存档格式或内容无效/);
  }
});
