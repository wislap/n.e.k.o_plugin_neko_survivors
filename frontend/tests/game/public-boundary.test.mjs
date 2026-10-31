import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameSession, isGameSave, EMPTY_INPUT } from '../../src/game/index.ts';
import { getWeapon, WEAPON_MAP, RECIPE_MAP } from '../../src/game/content/weapons.ts';
import { getItem, ITEM_MAP } from '../../src/game/content/items.ts';
import { getUpgrade, UPGRADE_MAP, getRarity } from '../../src/game/content/upgrades.ts';
import { getEnemy } from '../../src/game/content/enemies.ts';
import { getCharSkill } from '../../src/game/content/char-skills.ts';
import { characterArch } from '../../src/game/content/archetypes.ts';
const options = { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69 };
function start() { const session = createGameSession(); session.dispatch({ type: 'start-run', options }); return session; }
const inherited = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'propertyIsEnumerable'];

test('inherited object names never resolve as game content or recipe definitions', () => {
  for (const id of inherited) {
    for (const lookup of [getWeapon, getItem, getUpgrade, getEnemy]) assert.equal(lookup(id), undefined, `${lookup.name}(${id})`);
    for (const table of [WEAPON_MAP, ITEM_MAP, UPGRADE_MAP, RECIPE_MAP]) assert.equal(table[id], undefined);
    assert.equal(getCharSkill(id), null);
    assert.deepEqual(characterArch(id), []);
    assert.equal(getRarity(id).id, 'common');
  }
});

test('every content-bearing save path rejects inherited names through the public predicate', () => {
  const original = start().exportSave();
  for (const id of inherited) {
    for (const mutate of [
      save => { save.run.player.weapons[0].id = id; },
      save => { save.run.player.items = [[id, 1]]; },
      save => { save.run.player.upgrades = [[id, 1]]; },
      save => { save.run.pendingItemRewards = [{ id, sellValue: 5 }]; },
      save => { save.run.upgradeOptions = [{ id, rarity: 'common' }]; },
      save => { save.run.shop.offers = [{ kind: 'weapon', id, price: 1 }]; },
      save => { save.run.shop.offers = [{ kind: 'item', id, price: 1 }]; },
      save => { save.checkpoint.player.weapons[0].id = id; },
    ]) {
      const save = structuredClone(original); mutate(save);
      assert.equal(isGameSave(save), false, id);
      assert.throws(() => createGameSession({ save }), TypeError);
    }
  }
});

test('the nine-method facade closes over the engine without exposing mutable runtime internals', () => {
  const session = start();
  assert.deepEqual(Object.keys(session).sort(), ['advance', 'dispatch', 'drainEvents', 'exportSave', 'getMeta', 'readDisplay', 'readFrame', 'readUi', 'setViewport']);
  assert.equal(Object.isFrozen(session), true);
  for (const name of ['world', 'player', 'shop', 'rng', 'encounter', 'start', 'finishWave', 'restore']) assert.equal(name in session, false);
  assert.throws(() => { session.world = {}; }, TypeError);
  const first = session.readUi(); assert.equal(session.readUi(), first);
  const dispatch = session.dispatch;
  assert.equal(dispatch({ type: 'pause' }).ok, true);
  session.advance(EMPTY_INPUT);
  assert.equal(session.readUi().phase, 'paused');
});

test('validated exported saves are detached values and unknown object profiles fail without coercion', () => {
  const session = start();
  const exported = session.exportSave();
  assert.equal(isGameSave(exported), true);
  exported.run.player.hp = 999;
  assert.notEqual(session.exportSave().run.player.hp, 999);
  const malformed = session.exportSave();
  malformed.run.challenge = { toString: 'invalid' };
  assert.equal(isGameSave(malformed), false);
  const inheritedSave = Object.create(session.exportSave());
  assert.equal(isGameSave(inheritedSave), false);
});
