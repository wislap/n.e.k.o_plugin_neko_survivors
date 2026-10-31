import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameSession, EMPTY_INPUT, isGameSave } from '../../src/game/index.ts';

const options = { characterId: 'yui', difficulty: 'normal', partySize: 4, seed: 69, pilot: false };
function started() {
  const session = createGameSession();
  assert.deepEqual(session.dispatch({ type: 'start-run', options }), { ok: true });
  return session;
}

test('entry replay allocates missing weapon identities around preserved identities for every party member', () => {
  const saved = started().exportSave();
  const actors = [saved.run.player, ...saved.run.mates];
  actors[0].weapons[0].instanceId = 500;
  for (const actor of actors.slice(1)) for (const weapon of actor.weapons) delete weapon.instanceId;
  const restored = createGameSession({ save: saved });
  const ids = restored.exportSave().run;
  const weapons = [ids.player, ...ids.mates].flatMap(actor => actor.weapons);
  assert.equal(weapons[0].instanceId, 500);
  assert.ok(weapons.every(weapon => Number.isInteger(weapon.instanceId)));
  assert.equal(new Set(weapons.map(weapon => weapon.instanceId)).size, weapons.length);
  assert.ok(weapons.slice(1).every(weapon => weapon.instanceId > 500));
  assert.equal(restored.readUi().wave, 1);
  assert.equal(restored.readUi().secondsLeft, 30);
});

test('entry replay resets inactive upgrade and challenge history while preserving the result outcome', () => {
  const probe = started();
  assert.equal(probe.dispatch({ type: 'set-pilot', enabled: true }).ok, true);
  for (let step = 0; step < 4000 && probe.readUi().phase !== 'upgrade'; step++) probe.advance(EMPTY_INPUT);
  assert.equal(probe.readUi().phase, 'upgrade');
  const upgradeOptions = probe.exportSave().run.upgradeOptions;
  assert.ok(upgradeOptions.length > 0);
  for (const phase of ['playing', 'result', 'endless-prompt']) {
    const saved = started().exportSave();
    Object.assign(saved.run, { phase, upgradeOptions, afterUpgrade: 'shop', challengeChain: true, won: true });
    assert.equal(isGameSave(saved), true);
    const restored = createGameSession({ save: saved });
    const exported = restored.exportSave().run;
    assert.equal(restored.readUi().phase, phase);
    assert.deepEqual(exported.upgradeOptions, []);
    assert.equal(exported.afterUpgrade, 'playing');
    // Replaying a fresh wave resets its upgrade continuation; unrelated history remains valid.
    assert.equal(exported.challengeChain, false);
    assert.equal(exported.won, true);
  }
});
