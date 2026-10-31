import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameSession, EMPTY_INPUT } from '../../src/game/index.ts';
import { SessionEngine } from '../../src/game/session-engine.ts';

const options = { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69, pilot: true };
const timer = snapshot => ({ secondsLeft: snapshot.secondsLeft, timerTotal: snapshot.timerTotal,
  timerLabel: snapshot.timerLabel, timerVisible: snapshot.timerVisible, challengeId: snapshot.challengeId });

// Fixed baseline 5ade0bb, ui/ui.js:134–164: only flandreFight/vergilFight
// select getDisplayTimer(); all other fights use frozen waveTimeLeft/duration.
test('all four real start-challenge HUD branches match the original entry values', () => {
  for (const challenge of ['flandre', 'vergil', 'remilia', 'halloween']) {
    const session = createGameSession();
    assert.equal(session.dispatch({ type: 'start-challenge', challenge, options }).ok, true);
    assert.equal(session.readFrame().encounter.kind, challenge);
    assert.deepEqual(timer(session.readUi()), { secondsLeft: challenge === 'vergil' ? 90 : 30,
      timerTotal: challenge === 'vergil' ? 90 : 30, timerLabel: '',
      timerVisible: challenge !== 'flandre', challengeId: challenge }, challenge);
  }
});

test('Remilia and Halloween keep the ordinary frozen wave HUD while real performance time advances', () => {
  for (const challenge of ['remilia', 'halloween']) {
    const session = createGameSession(); session.dispatch({ type: 'start-challenge', challenge, options });
    const before = session.readFrame().encounter.time;
    for (let step = 0; step < 600; step++) session.advance(EMPTY_INPUT);
    const frame = session.readFrame();
    assert.equal(frame.encounter.kind, challenge);
    assert.ok(frame.encounter.time > before + 9);
    assert.deepEqual(timer(session.readUi()), { secondsLeft: 30, timerTotal: 30,
      timerLabel: '', timerVisible: true, challengeId: challenge });
    assert.equal(session.dispatch({ type: 'pause' }).ok, true);
    for (let step = 0; step < 60; step++) session.advance(EMPTY_INPUT);
    assert.deepEqual(timer(session.readUi()), { secondsLeft: 30, timerTotal: 30,
      timerLabel: '', timerVisible: true, challengeId: challenge });
  }
});

test('Flandre and Vergil retain their actual controller timers after intro', () => {
  for (const challenge of ['flandre', 'vergil']) {
    const engine = new SessionEngine(); engine.dispatch({ type: 'start-challenge', challenge, options });
    for (let step = 0; step < 600; step++) engine.advance(EMPTY_INPUT);
    const display = engine.battle.encounter.readClock().timer; assert.ok(display);
    const actual = timer(engine.readUi());
    assert.deepEqual(actual, { secondsLeft: display.left, timerTotal: display.total,
      timerLabel: display.label, timerVisible: true, challengeId: challenge });
    assert.equal(display.label, challenge === 'flandre' ? '？？？' : '');
    assert.equal(display.total, challenge === 'flandre' ? 30 : 90);
    assert.ok(display.left < display.total && display.left > 0);
  }
});

test('Flandre intro explicitly hides the timer while retaining the ordinary wave clock', () => {
  const engine = new SessionEngine(); engine.dispatch({ type: 'start-challenge', challenge: 'flandre', options });
  engine.battle.waveElapsed = 7;
  assert.equal(engine.battle.encounter.readClock().timer, null);
  assert.deepEqual(timer(engine.readUi()), { secondsLeft: 23, timerTotal: 30,
    timerLabel: '', timerVisible: false, challengeId: 'flandre' });
});

test('ordinary combat uses the running wave timer and carries no challenge label', () => {
  const session = createGameSession(); session.dispatch({ type: 'start-run', options });
  for (let step = 0; step < 60; step++) session.advance(EMPTY_INPUT);
  const actual = timer(session.readUi());
  assert.ok(Math.abs(actual.secondsLeft - 29) < 1e-9);
  assert.deepEqual({ ...actual, secondsLeft: 29 }, { secondsLeft: 29, timerTotal: 30,
    timerLabel: '', timerVisible: true, challengeId: undefined });
});
