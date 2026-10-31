import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameSession, EMPTY_INPUT } from '../../src/game/index.ts';
import { SessionEngine } from '../../src/game/session-engine.ts';

const options = { characterId: 'yui', difficulty: 'normal', partySize: 4, seed: 53 };

test('public frames always carry a lightweight live P1 HUD projection or null', () => {
  const session = createGameSession();
  assert.equal(session.readFrame().hud, null);
  assert.equal(session.dispatch({ type: 'start-run', options }).ok, true);
  const player = session.readUi().players[0], hud = session.readFrame().hud;
  assert.deepEqual(hud, { hp: player.hp, maxHp: player.maxHp, shield: player.shield,
    xp: player.xp, xpNeeded: player.xpNeeded, level: player.level });
  assert.deepEqual(Object.keys(hud), ['hp', 'maxHp', 'shield', 'xp', 'xpNeeded', 'level']);
});

test('HUD values are fresh between cached UI revisions and detached from mutable rule state', () => {
  const engine = new SessionEngine(); engine.dispatch({ type: 'start-run', options });
  const cached = engine.readUi(), prior = engine.readFrame().hud;
  engine.battle.player.hp -= 7; engine.battle.player.shield = 3;
  engine.battle.player.xp = 9; engine.battle.player.level += 1;
  const current = engine.readFrame().hud;
  assert.equal(engine.readUi(), cached);
  assert.equal(current.hp, prior.hp - 7); assert.equal(current.shield, 3);
  assert.equal(current.xp, 9); assert.equal(current.level, prior.level + 1);
  assert.equal(prior.hp, cached.players[0].hp);
  current.hp = 0; assert.notEqual(engine.battle.player.hp, 0);
  engine.dispatch({ type: 'pause' });
  assert.equal(engine.readFrame().phase, 'paused');
  assert.equal(engine.readFrame().hud.hp, engine.battle.player.hp);
});

test('live top-bar clock and materials advance between cached React summaries, including challenge timers', () => {
  const engine = new SessionEngine(); engine.dispatch({ type: 'start-run', options });
  const cached = engine.readUi();
  engine.advance({}); engine.battle.player.materials += 17;
  const chrome = engine.readFrame().hudChrome;
  assert.equal(engine.readUi(), cached);
  assert.ok(chrome.secondsLeft < cached.secondsLeft); assert.equal(chrome.materials, engine.battle.player.materials);
  assert.equal(chrome.timerTotal, engine.battle.waveDuration);
  chrome.materials = 0; assert.notEqual(engine.battle.player.materials, 0);
  engine.startChallenge('flandre');
  assert.equal(engine.battle.encounter.readClock().timer, null);
  assert.equal(engine.readFrame().hudChrome.timerVisible, false);
  for (let tick = 0; tick < 600; tick++) engine.advance(EMPTY_INPUT);
  const before = engine.battle.encounter.readClock().timer;
  assert.ok(before && before.left > 0);
  engine.readUi();
  engine.advance(EMPTY_INPUT);
  const display = engine.battle.encounter.readClock().timer;
  assert.ok(display.left < before.left);
  assert.deepEqual(engine.readFrame().hudChrome, { wave: engine.battle.waveIndex + 1, materials: engine.battle.player.materials,
    secondsLeft: display.left, timerTotal: display.total, timerLabel: display.label, timerVisible: true, flandre: true });
});
