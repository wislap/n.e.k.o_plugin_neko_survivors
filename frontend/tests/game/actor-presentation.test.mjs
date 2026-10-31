import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionEngine } from '../../src/game/session-engine.ts';
import { Chest } from '../../src/game/actors/chest.ts';

test('actor projection preserves intentional procedural bosses, sprite overrides and chest reward identities', () => {
  const game = new SessionEngine();
  game.start({ characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69 });
  const bottle = game.battle.world.waves.spawnEnemyById('boss_apple_cider', 100, 100);
  const animated = game.battle.world.waves.spawnEnemyById('flandre', 200, 100);
  animated.spriteId = 'flandre_sit';
  const ornate = game.battle.world.enemies.add(new Chest(300, 100, { tier: 2, reward: { kind: 'item', id: 'warm_milk' } }));
  const healing = game.battle.world.enemies.add(new Chest(400, 100, { tier: 2, reward: { kind: 'heal', value: 30 } }));
  const view = game.readFrame();
  const byId = id => view.actors.find(actor => actor.id === id);
  assert.equal(byId(bottle.id).definitionId, 'boss_apple_cider');
  assert.equal(byId(bottle.id).spriteId, null);
  assert.equal(byId(bottle.id).silhouette, 'bottle');
  assert.equal(byId(bottle.id).noEyes, true);
  assert.equal(byId(animated.id).spriteId, 'flandre_sit');
  assert.equal(byId(ornate.id).spriteId, 'chest_2');
  assert.equal(byId(healing.id).spriteId, 'chest_heal');
});
