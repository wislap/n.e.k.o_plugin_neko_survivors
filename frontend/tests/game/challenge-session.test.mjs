import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionEngine } from '../../src/game/session-engine.ts';
import { createEmptyMeta } from '../../src/game/save/meta.ts';
import { isSupportedSave } from '../../src/game/save/schema.ts';
const INPUT = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, manualAim: false, slow: false,
  clear: false, ultimate: false, p2MoveX: 0, p2MoveY: 0, p2Slow: false, p2Clear: false };
const options = { characterId: 'yui', difficulty: 'nightmare', partySize: 1, seed: 69, pilot: true };

test('public Flandre session naturally completes every encounter in the full reward chain', () => {
  const session = new SessionEngine();
  assert.equal(session.dispatch({ type: 'start-challenge', challenge: 'flandre', options }).ok, true);
  const phases = new Set(), armed = new Set();
  for (let step = 0; step < 40000; step++) {
    session.advance(INPUT);
    const ui = session.readUi(); phases.add(ui.phase);
    if (step % 60 === 0) {
      const frame = session.readFrame();
      if (frame.encounter && frame.projectiles.length) armed.add(frame.encounter.kind);
    }
    if (ui.phase === 'endless-prompt') break;
  }
  assert.deepEqual([...phases], ['flandre', 'remilia', 'halloween', 'endless-prompt']);
  assert.deepEqual([...armed], ['flandre', 'remilia', 'halloween']);
  const meta = session.getMeta();
  assert.equal(meta.flandreUnlocked, true);
  assert.equal(meta.remiliaUnlocked, true);
  assert.equal(meta.halloweenUnlocked, true);
  assert.ok(session.readUi().rewards.some(reward => reward.definitionId === 'laevatein'));
  assert.equal(session.dispatch({ type: 'finish-run' }).ok, true);
  assert.equal(session.readUi().won, true);
  assert.equal(session.getMeta().wins, 1);
  assert.equal(session.getMeta().runs, 1);
  // The v2 chain field also records history between attempts in the same session.
  assert.equal(session.dispatch({ type: 'start-run', options }).ok, true);
  assert.equal(session.exportSave().run.challengeChain, true);
  assert.equal(session.dispatch({ type: 'retry-wave' }).ok, true);
  assert.equal(session.exportSave().run.challengeChain, true);
  const fresh = new SessionEngine({ save: session.exportSave() });
  assert.equal(fresh.exportSave().run.challengeChain, false);
});

test('all direct challenges own an actual controller and resume that challenge from a validated save', () => {
  for (const challenge of ['flandre', 'vergil', 'remilia', 'halloween']) {
    const session = new SessionEngine();
    session.dispatch({ type: 'start-challenge', challenge, options });
    session.setViewport(1120, 940);
    for (let step = 0; step < 600; step++) session.advance(INPUT);
    const frame = session.readFrame();
    assert.equal(frame.encounter.kind, challenge);
    assert.ok(frame.projectiles.length > 0);
    assert.equal(session.readUi().challengeName.length > 0, true);
    session.dispatch({ type: 'pause' });
    const saved = session.exportSave();
    assert.equal(isSupportedSave(saved), true);
    const restored = new SessionEngine({ save: saved });
    assert.equal(restored.readUi().phase, challenge);
    assert.equal(restored.readFrame().encounter.kind, challenge);
    const before = restored.readFrame().encounter.time;
    for (let step = 0; step < 60; step++) restored.advance(INPUT);
    assert.ok(restored.readFrame().encounter.time > before);
    assert.equal(restored.dispatch({ type: 'retry-wave' }).ok, true);
    assert.equal(restored.readFrame().encounter.kind, challenge);
  }
});

test('real Vergil timeout returns to the normal shop without granting his blade', () => {
  const session = new SessionEngine();
  session.dispatch({ type: 'start-challenge', challenge: 'vergil', options });
  let observedIntro = false, observedCombat = false;
  for (let step = 0; step < 10000; step++) {
    session.advance(INPUT);
    const frame = session.readFrame();
    if (frame.encounter?.state === 'intro') observedIntro = true;
    else if (frame.encounter) observedCombat = true;
    if (session.readUi().phase === 'shop') break;
  }
  assert.equal(observedIntro && observedCombat, true);
  assert.equal(session.readUi().phase, 'shop');
  assert.equal(session.readUi().rewards.some(reward => reward.definitionId === 'yamato'), false);
});

test('automatic upgrades survive waves and saves and reset only for a new run', () => {
  const session = new SessionEngine();
  session.dispatch({ type: 'start-run', options: { ...options, difficulty: 'normal' } });
  assert.equal(session.dispatch({ type: 'set-auto-upgrade', enabled: true }).ok, true);
  for (let step = 0; step < 12000 && session.readUi().phase !== 'shop'; step++) session.advance(INPUT);
  assert.equal(session.readUi().autoUpgrade, true);
  const restored = new SessionEngine({ save: session.exportSave() });
  assert.equal(restored.readUi().autoUpgrade, true);
  restored.dispatch({ type: 'next-wave' });
  assert.equal(restored.readUi().autoUpgrade, true);
  restored.dispatch({ type: 'start-run', options });
  assert.equal(restored.readUi().autoUpgrade, false);
});

test('current metadata rejects damage and retains validated challenge unlocks without aliasing', () => {
  for (const meta of [{ wins: 3 }, { ...createEmptyMeta(), wins: NaN }, { ...createEmptyMeta(), runs: -1 },
    { ...createEmptyMeta(), totalKills: 'bad' }]) assert.throws(() => new SessionEngine({ meta }), TypeError);
  const session = new SessionEngine({ meta: { ...createEmptyMeta(), bestWave: 12,
    flandreUnlocked: true, halloweenUnlocked: true } });
  const meta = session.getMeta();
  assert.equal(meta.wins, 0); assert.equal(meta.runs, 0); assert.equal(meta.bestWave, 12);
  assert.equal(meta.totalKills, 0); assert.equal(meta.flandreUnlocked, true);
  assert.ok(session.readUi().unlockedChallenges.includes('halloween'));
  meta.bestWave = 999;
  assert.equal(session.getMeta().bestWave, 12);
});

test('frame projection uses facing radians and actual orbit-ball positions, never weapon attack ranges', () => {
  const session = new SessionEngine();
  session.dispatch({ type: 'start-run', options: { ...options, pilot: false } });
  // A saved inventory fixture exercises public restoration, rather than renderer internals.
  const data = session.exportSave();
  data.run.player.weapons = [{ id: 'mouse_toy', level: 1 }, { id: 'fish_shield', level: 1 }];
  const restored = new SessionEngine({ save: data });
  restored.advance({ ...INPUT, moveX: -1 });
  const frame = restored.readFrame();
  assert.equal(frame.actors.find(actor => actor.kind === 'player').facing, Math.PI);
  assert.ok(frame.weapons.length > 0);
  assert.ok(frame.weapons.every(weapon => weapon.radius === 18));
  assert.ok(frame.weapons.some(weapon => weapon.x !== frame.actors[0].x || weapon.y !== frame.actors[0].y));
});
