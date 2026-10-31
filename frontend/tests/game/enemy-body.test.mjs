import test from 'node:test';
import assert from 'node:assert/strict';
import { EnemyBody } from '../../src/game/actors/enemy.ts';
import { createEnemy } from '../../src/game/enemies/create-enemy.ts';
import { getEnemy } from '../../src/game/content/enemies.ts';
import { RNG } from '../../src/game/math/random.ts';
import { World } from '../../src/game/world/world.ts';
import { Player } from '../../src/game/actors/player.ts';

const scaling = { hp: 1, bossHp: 1, damage: 1, speed: 1, xp: 1, materials: 1 };
function scene(seed = 326) {
  const rng = new RNG(seed), world = new World(rng), player = new Player('yui', rng);
  player.world = world; player.weapons = []; world.player = player;
  world.waves.setDifficulty('normal'); world.waves.begin(0); world.noSpawn = true;
  return { rng, world, player };
}

test('a controlled body allocates no ordinary AI or random initialization and remains damageable', () => {
  const { rng, world, player } = scene();
  const before = rng.state;
  const body = new EnemyBody(getEnemy('flandre'), 0, 0, scaling, rng);
  assert.equal(rng.state, before);
  for (const field of ['attackCooldown', 'state', 'bossPhase', 'wanderAngle', 'wobblePhase', 'jetPhase']) {
    assert.equal(field in body, false, field);
  }
  assert.equal(Object.hasOwn(body, 'takeDamage'), false);
  const hp = body.hp;
  assert.ok(body.takeDamage(20).dealt > 0);
  assert.ok(body.hp < hp);
  const position = [body.x, body.y]; player.x = 800;
  body.update(.1, player, world);
  assert.deepEqual([body.x, body.y], position);
  assert.equal(rng.state, before);
  assert.throws(() => body.setBehaviorOverride('melee'), /no ordinary behavior/);
});

test('ordinary construction retains three draws and uses the first draw for its actual opening shot', () => {
  const { rng, world, player } = scene();
  const expected = new RNG(rng.state);
  const openingCooldown = expected.range(0, .4); expected.next(); expected.next();
  const def = { ...getEnemy('spitter'), attackCooldown: .4, speed: 0 };
  const enemy = createEnemy(def, 200, 0, scaling, rng);
  assert.equal(rng.state, expected.state);
  enemy.update(openingCooldown / 2, player, world);
  assert.equal(world.enemyBullets.length, 0);
  enemy.update(openingCooldown / 2 + 1e-8, player, world);
  assert.ok(world.enemyBullets.length > 0);
  assert.equal(rng.state, expected.state);
});

test('ordinary Boss protection keeps advancing through stun and phase gates remain one shared policy', () => {
  const { rng, world, player } = scene(); player.x = 1000;
  const enemy = createEnemy(getEnemy('boss_cat_king'), 0, 0, scaling, rng);
  assert.equal(enemy.takeDamage(enemy.maxHp * .9).dealt, 0, 'spawn immunity');
  enemy.stun = 8;
  enemy.update(5.01, player, world);
  assert.equal(enemy.readGuard().invulnerable, false, 'stun cannot freeze the guard clock');
  const receipt = enemy.takeDamage(enemy.maxHp * .9, { pierceArmor: true });
  assert.equal(receipt.gated, true);
  assert.ok(enemy.hp >= enemy.maxHp * .66);
  assert.equal(enemy.takeDamage(100).dealt, 0);
  enemy.update(5.01, player, world);
  world.waves.advanceClock(0, world.waves.requireCurrent().duration * .4);
  enemy.update(.01, player, world);
  assert.equal(enemy.readGuard().phase, 2);
  assert.equal(enemy.readGuard().invulnerable, false, 'time transition cannot reuse the consumed HP gate');
});

test('controlled body gate runs before armor and stun pauses status expiration while applying knockback', () => {
  const { rng, world, player } = scene(); player.x = 1000;
  const body = new EnemyBody({ ...getEnemy('flandre'), armor: 20 }, 0, 0, scaling, rng, {
    damageGate: { filter(_body, amount) { return { blocked: false, amount: Math.min(amount, 10) }; } },
  });
  assert.equal(body.takeDamage(100).dealt, 5);
  body.stun = 1; body.curseTimer = 2; body.curseSpeedMul = .5; body.buffTimer = 2;
  body.knockbackX = 100;
  body.update(.1, player, world);
  assert.equal(body.curseTimer, 2); assert.equal(body.buffTimer, 2);
  assert.ok(body.x > 0); assert.ok(body.knockbackX < 100);
  body.stun = 0;
  body.update(.1, player, world);
  assert.equal(body.curseTimer, 1.9); assert.equal(body.buffTimer, 1.9);
});
