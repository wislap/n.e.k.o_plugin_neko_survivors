import test from 'node:test';
import assert from 'node:assert/strict';
import { ComponentList } from '../../src/game/ecs/entity-store.ts';
import { PLAYER_SHOT_FIELDS, ENEMY_SHOT_FIELDS, PICKUP_FIELDS } from '../../src/game/ecs/components.ts';
import { Bullet, EnemyBullet } from '../../src/game/actors/bullet.ts';
import { Pickup } from '../../src/game/actors/pickup.ts';
import { TrailBuffer } from '../../src/game/ecs/trail-buffer.ts';
import { createGameSession, GameFrameBuffer, EMPTY_INPUT } from '../../src/game/index.ts';
import { SessionEngine } from '../../src/game/session-engine.ts';

const config = { x: 10, y: 20, angle: .7, speed: 110, damage: 3 };
test('all transient kinds use authoritative Float64 columns and stable identities through growth/swap/retirement', () => {
  for (const [fields, make] of [[PLAYER_SHOT_FIELDS, () => new Bullet(config)], [ENEMY_SHOT_FIELDS, () => new EnemyBullet(config)], [PICKUP_FIELDS, () => new Pickup('material', 10, 20, 3)]]) {
    const list = new ComponentList(fields), entities = Array.from({ length: 130 }, () => list.add(make()));
    const expected = entities.map(e => e.id), first = entities[0], removed = entities[3], last = entities.at(-1);
    first.x = Math.PI; assert.equal(list.columns.x[0], Math.PI);
    list.columns.y[0] = .1 + .2; assert.equal(first.y, .1 + .2);
    assert.equal(list.get(first.id), first); assert.equal(list.columns.x.BYTES_PER_ELEMENT, 8);
    removed.dead = true; list.sweep(); expected[3] = expected.pop();
    assert.deepEqual(list.items.map(e => e.id), expected); assert.equal(last.componentRow, 3);
    assert.equal(list.get(removed.id), undefined); assert.equal(removed.componentRow, -1);
    const lastX = last.x; removed.x = 999; assert.equal(last.x, lastX);
    list.clear(); const next = list.add(make()); const oldX = first.x;
    next.x = 500; assert.equal(first.x, oldX); first.x = -700; assert.equal(next.x, 500);
    assert.notEqual(next.id, first.id); assert.equal(list.get(first.id), undefined);
  }
});

test('six-point buffer matches original append/drop/fade arithmetic and permits controller edits', () => {
  const actual = new TrailBuffer(), expected = [];
  for (let step = 0; step < 100; step++) {
    if (step % 2 === 0) {
      const x = Math.sin(step), y = step / 7;
      actual.append(x, y); expected.push({ x, y, a: 1 }); if (expected.length > 6) expected.shift();
    }
    actual.fade(1 / 60); for (const point of expected) point.a -= 1 / 60 * 3.5;
    assert.deepEqual(actual.map(p => ({ x: p.x, y: p.y, a: p.a })), expected);
  }
  actual[0].x = 900; assert.equal(actual.values[actual.offset(0)], 900);
  assert.equal(actual.length, 6);
});

test('render scratch reuses transient views and histories while ordinary readFrame remains detached', () => {
  const engine = new SessionEngine({});
  engine.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'nightmare', partySize: 1, seed: 69, pilot: false } });
  const world = engine.battle.world;
  const shot = world.spawnBullet({ ...config, ownerPlayer: engine.battle.player });
  shot.trail.push({ x: 1, y: 2, a: .8 }, { x: 3, y: 4, a: .9 });
  world.spawnEnemyBullet(config); world.pickups.add(new Pickup('xp', 80, 90));
  const buffer = new GameFrameBuffer(), snapshot = engine.readFrame(), frozen = structuredClone(snapshot);
  const borrowed = engine.readFrame(buffer), view = borrowed.projectiles[0], point = view.trail[0], pickup = borrowed.pickups[0];
  assert.deepEqual(borrowed, snapshot);
  shot.x = 123; shot.trail[0].x = 456;
  const next = engine.readFrame(buffer);
  assert.equal(next.projectiles[0], view); assert.equal(next.projectiles[0].trail[0], point); assert.equal(next.pickups[0], pickup);
  assert.equal(view.x, 123); assert.equal(point.x, 456); assert.deepEqual(snapshot, frozen);
  world.bullets.clear(); world.enemyBullets.clear(); world.pickups.clear();
  assert.equal(engine.readFrame(buffer).projectiles.length, 0); assert.equal(engine.readFrame(buffer).pickups.length, 0);
});

test('public session render scratch is optional and cannot mutate rule state or exports', () => {
  const game = createGameSession(), buffer = new GameFrameBuffer();
  game.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69, pilot: true } });
  for (let i = 0; i < 120; i++) game.advance(EMPTY_INPUT);
  const save = game.exportSave(), frame = game.readFrame();
  assert.deepEqual(game.readFrame(buffer), frame);
  buffer.projectiles.length = 0; buffer.pickups.length = 0;
  assert.deepEqual(game.readFrame(), frame); assert.deepEqual(game.exportSave(), save);
});

test('synchronous explosion callbacks can grow component tables and appended shots still advance this step', () => {
  const engine = new SessionEngine({});
  engine.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69, pilot: false } });
  const world = engine.battle.world, player = engine.battle.player;
  world.noSpawn = true; world.pet = null;
  const first = world.spawnBullet({ ...config, x: 400, y: 400, ownerPlayer: player, range: 0, explosionRadius: 30 });
  for (let i = 0; i < 63; i++) world.spawnBullet({ ...config, x: 1000, y: 1000, ownerPlayer: player, range: 1e5 });
  const target = { id: -1, x: 400, y: 400, radius: 2, dead: false, isEnemy: true };
  world.grid.query = (x, y, radius, out = []) => { out.length = 0; if (radius === 30) out.push(target); return out; };
  const added = []; world.dealDamage = () => { for (let i = 0; i < 80; i++) added.push(world.spawnBullet({ ...config, x: 1000, y: 1000, ownerPlayer: player, range: 1e5 })); return 0; };
  world.update(1 / 60, player, 0);
  assert.equal(first.dead, true); assert.equal(first.componentRow, -1); assert.equal(world.bullets.length, 143);
  assert.ok(added.every(b => b.age === 1 / 60 && !b.dead));
  assert.equal(world.bullets.get(first.id), undefined);
});

test('pickup callbacks may clear/repopulate their table without retired boundary writes touching a new drop', () => {
  const engine = new SessionEngine({});
  engine.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69, pilot: false } });
  const world = engine.battle.world, player = engine.battle.player;
  world.noSpawn = true; world.pet = null; player.x = player.y = 5000;
  const old = world.pickups.add(new Pickup('material', 5000, 5000)); old.vx = old.vy = 0;
  let next; world.onPickup = () => { world.pickups.clear(); next = world.pickups.add(new Pickup('xp', 10, 20)); next.vx = next.vy = 0; };
  world.update(1 / 60, player, 0);
  assert.equal(old.dead, true); assert.equal(old.componentRow, -1);
  assert.equal(old.x, world.halfSize - 4); assert.equal(old.y, world.halfSize - 4);
  assert.equal(next.x, 10); assert.equal(next.y, 20); assert.equal(next.age, 0);
});
