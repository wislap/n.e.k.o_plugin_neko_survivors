import test from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../../src/game/math/random.ts';
import { World } from '../../src/game/world/world.ts';
import { Player } from '../../src/game/actors/player.ts';
import { createEncounter } from '../../src/game/encounters/index.ts';
import { ItemPassives } from '../../src/game/combat/item-passives.ts';
function setup() {
  const rng = new RNG(12), world = new World(rng), player = new Player('yui', rng);
  world.player = player; world.waves.begin(0); world.noSpawn = true;
  return { rng, world, player, passives: new ItemPassives(rng) };
}
const viewport = { cx: 0, cy: 0, viewW: 1280, viewH: 720 };

test('Yamato uses ten timed true-damage combos, preserves offscreen enemies and triggers once per player each wave', () => {
  const { world, player, passives } = setup();
  player.id = 1; player.addItem('yamato'); player.hp = player.maxHp * 0.4;
  const nearby = world.waves.spawnEnemyById('slime', 100, 100);
  const offscreen = world.waves.spawnEnemyById('slime', 1500, 100);
  const offscreenHp = offscreen.hp;
  assert.equal(passives.beforeActors(1 / 60, world, 0, viewport), 0.05);
  for (let step = 0; step < 200; step++) passives.beforeActors(1 / 60, world, 0, viewport);
  assert.equal(nearby.dead, true);
  assert.equal(offscreen.hp, offscreenHp);
  assert.equal(passives.ultimate, null);
  assert.equal(passives.beforeActors(1 / 60, world, 0, viewport), 1);
  assert.equal(passives.beforeActors(1 / 60, world, 1, viewport), 0.05);
});

test('Laevatein creates three actual attacking clones and clears them during special challenges', () => {
  const { world, player, passives } = setup();
  player.addItem('laevatein');
  passives.rng = { next: () => 0.1 };
  world.waves.spawnEnemyById('slime', 80, 0);
  for (let step = 0; step < 310; step++) passives.afterActors(1 / 60, world);
  assert.equal(world.phantoms.length, 3);
  assert.ok(world.phantoms.every(clone => clone.characterId === player.characterId && clone.weapons.length > 0));
  createEncounter('flandre', { world, player, rng: world.rng });
  passives.afterActors(1 / 60, world);
  assert.equal(world.phantoms.length, 0);
});
