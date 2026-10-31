import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameSession, EMPTY_INPUT } from '../../src/game/index.ts';
import { RNG } from '../../src/game/math/random.ts';
import { World } from '../../src/game/world/world.ts';
import { Player } from '../../src/game/actors/player.ts';
import { PhantomClone } from '../../src/game/actors/phantom.ts';
import { createEncounter } from '../../src/game/encounters/index.ts';

const options = { characterId: 'yui', difficulty: 'normal', partySize: 2, seed: 69, pilot: false };
function baseSave() {
  const session = createGameSession(); session.dispatch({ type: 'start-run', options });
  return session.exportSave();
}

test('a playing continuation restores locked shelves without spending either player wallet', () => {
  const save = baseSave();
  save.run.phase = 'shop';
  save.run.shop.offers = Array.from({ length: 8 }, () => ({ kind: 'item', id: 'warm_milk', price: 1000000, sold: false, meta: {} }));
  save.run.shop.locked = [0, 4];
  const session = createGameSession({ save });
  session.dispatch({ type: 'next-wave' });
  const playing = session.exportSave();
  const restored = createGameSession({ save: playing });
  const actual = restored.exportSave();
  assert.deepEqual(actual.run.shop, playing.run.shop);
  assert.deepEqual([actual.run.player.materials, actual.run.mates[0].materials], [playing.run.player.materials, playing.run.mates[0].materials]);
  assert.equal(restored.readUi().phase, 'playing');
});

test('locks carry to the next actual shop in both buyer segments after a playing save restore', () => {
  const save = baseSave();
  save.run.phase = 'shop'; save.run.pilot = true;
  save.run.shop.offers = Array.from({ length: 8 }, () => ({ kind: 'item', id: 'warm_milk', price: 1000000, sold: false, meta: {} }));
  save.run.shop.locked = [0, 4];
  const session = createGameSession({ save }); session.dispatch({ type: 'next-wave' });
  const restored = createGameSession({ save: session.exportSave() });
  for (let step = 0; step < 15000 && restored.readUi().phase !== 'shop'; step++) restored.advance(EMPTY_INPUT);
  const ui = restored.readUi(); assert.equal(ui.phase, 'shop');
  assert.equal(ui.offers[0].definitionId, 'warm_milk'); assert.equal(ui.offers[0].price, 1000000);
  assert.equal(ui.offers[4].definitionId, 'warm_milk'); assert.equal(ui.offers[4].price, 1000000);
});

function projectileFixture() {
  const rng = new RNG(9), world = new World(rng), primary = new Player('yui', rng), teammate = new Player('luna', rng);
  primary.id = 1; teammate.id = 2; world.player = primary; world.player2 = teammate;
  const enemy = world.waves.spawnEnemyById('slime', 80, 0); world.grid.insert(enemy);
  return { rng, world, primary, teammate, enemy };
}

test('every ordinary projectile behavior attributes damage and homing passives to its firing teammate', () => {
  for (const weaponId of ['pebble_toss', 'yarn_thrower', 'star_wand', 'lucky_coin']) {
    const { world, primary, teammate, enemy } = projectileFixture();
    teammate.weapons = []; teammate.addWeapon(weaponId); teammate.addItem('smart_wand');
    teammate.weapons[0]._fire(teammate, world, enemy);
    assert.ok(world.bullets.items.length > 0, weaponId);
    for (const bullet of world.bullets.items) {
      assert.equal(bullet.ownerPlayer, teammate, weaponId);
      assert.equal(bullet.behavior, 'homing', weaponId);
    }
    const bullet = world.bullets.items[0]; bullet.x = enemy.x; bullet.y = enemy.y; bullet.checkEnemyHit(world);
    assert.ok(teammate.damageDealt > 0, weaponId); assert.equal(primary.damageDealt, 0, weaponId);
  }
});

test('clone projectile reward attribution remains with its original player', () => {
  const { rng, world, primary, enemy } = projectileFixture();
  primary.weapons = []; primary.addWeapon('pebble_toss');
  const clone = new PhantomClone(primary, world, 0, 0);
  clone.weapons[0]._fire(clone, world, enemy);
  assert.equal(world.bullets.items[0].ownerPlayer, primary);
});

test('unknown challenge names reject before mutating the live public session', () => {
  const session = createGameSession(); session.dispatch({ type: 'start-run', options });
  const before = session.exportSave();
  for (const challenge of ['constructor', '__proto__', 'toString', 'missing']) {
    assert.equal(session.dispatch({ type: 'start-challenge', challenge, options }).ok, false);
    assert.deepEqual(session.exportSave(), before);
    const rng = new RNG(1), world = new World(rng), player = new Player('yui', rng); world.player = player;
    assert.throws(() => createEncounter(challenge, { world, player, rng }), /Unknown encounter/);
  }
});
