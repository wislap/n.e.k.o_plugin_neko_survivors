import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameSession } from '../../src/game/index.ts';

function offer(id, rarity) {
  const session = createGameSession();
  session.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69 } });
  const save = session.exportSave();
  save.run.phase = 'upgrade';
  save.run.afterUpgrade = 'playing';
  save.run.player.pendingLevelUps = 1;
  save.run.upgradeOptions = [{ id, rarity }];
  return createGameSession({ save });
}

test('the public upgrade summary reports the rolled benefit that is actually applied', () => {
  const session = offer('up_maxhp', 'legendary');
  const ui = session.readUi();
  assert.deepEqual(ui.upgrades[0].effectLines, ['+12 最大生命']);
  const before = ui.players[0].maxHp;
  assert.equal(session.dispatch({ type: 'choose-upgrade', optionId: 'up_maxhp', revision: ui.revision }).ok, true);
  assert.equal(session.readUi().players[0].maxHp - before, 12);
});

test('upgrade projections preserve fractional flat recovery, percentage downsides and tier-specific shields', () => {
  const regen = offer('up_regen', 'common'), regenUi = regen.readUi();
  assert.deepEqual(regenUi.upgrades[0].effectLines, ['+0.5 生命回复']);
  const before = regenUi.players[0].statDetails.find(detail => detail.statId === 'hpRegen').value;
  assert.equal(regen.dispatch({ type: 'choose-upgrade', optionId: 'up_regen', revision: regenUi.revision }).ok, true);
  assert.equal(regen.readUi().players[0].statDetails.find(detail => detail.statId === 'hpRegen').value - before, .5);
  const glassSession = offer('up_glass', 'legendary'), glass = glassSession.readUi();
  assert.ok(glass.upgrades[0].effectLines.includes('-15% 最大生命'));
  const previousPct = glassSession.exportSave().run.player.stats.pct.maxHp ?? 0;
  assert.equal(glassSession.dispatch({ type: 'choose-upgrade', optionId: 'up_glass', revision: glass.revision }).ok, true);
  assert.ok(Math.abs(glassSession.exportSave().run.player.stats.pct.maxHp - previousPct + .15) < 1e-9);
  const shield = offer('up_heal_now', 'legendary').readUi().upgrades[0];
  assert.equal(shield.healAll, true);
  assert.equal(shield.shieldPercent, 150);
});

test('public stat explanations retain actual armour mitigation and the character luck multiplier', () => {
  const session = createGameSession();
  session.dispatch({ type: 'start-run', options: { characterId: 'nana', difficulty: 'normal', partySize: 1, seed: 69 } });
  const details = session.readUi().players[0].statDetails;
  assert.match(details.find(detail => detail.statId === 'armor').description, /护甲|减伤/);
  assert.match(details.find(detail => detail.statId === 'luck').description, /96%/);
});
