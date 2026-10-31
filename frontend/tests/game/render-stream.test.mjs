import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SessionEngine } from '../../src/game/session-engine.ts';
import { GameFrameBuffer } from '../../src/game/frame-buffer.ts';
import { Bullet, EnemyBullet } from '../../src/game/actors/bullet.ts';
import { Pickup } from '../../src/game/actors/pickup.ts';
import { RenderStream, PLAYER_STRIDE } from '../../src/game/render-stream.ts';

function setup() {
  const engine = new SessionEngine({}); engine.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'nightmare', partySize: 1, seed: 69, pilot: true } });
  return engine;
}
function unpack(frame) {
  const stream = frame.transients, projectiles = [], pickups = [];
  for (let i = 0; i < stream.playerCount; i++) { const v = stream.readPlayer(i, { trail: [] }); delete v.alpha; Object.assign(v, { shape: 'circle', hitRadius: undefined, anchor: 'center', length: undefined, width: undefined }); projectiles.push(v); }
  for (let i = 0; i < stream.enemyCount; i++) { const v = stream.readEnemy(i, {}); delete v.alpha; delete v.playerStyle; delete v.hostile; Object.assign(v, { age: frame.__enemyAges?.[i], hostile: true, playerStyle: undefined }); projectiles.push(v); }
  for (let i = 0; i < stream.pickupCount; i++) pickups.push(stream.readPickup(i, {}));
  return { projectiles, pickups };
}
test('packed ECS projection preserves every displayed player value and history without borrowed rule references', () => {
  const engine = setup(), world = engine.battle.world;
  for (let i = 0; i < 256; i++) {
    const b = new Bullet({ x: i / 7, y: -i / 11, radius: i % 9 + 1, angle: i / 3, speed: 100, damage: 2, behavior: i % 4 === 1 ? 'bounce' : 'shot', kind: i % 4 === 2 ? 'element' : i % 4 === 3 ? 'turret' : 'ranged' });
    b.age = i / 13; for (let j = 0; j < 6; j++) b.trail.push({ x: i - j * 9, y: j / 3, a: j % 2 ? 0 : .8 }); world.bullets.add(b);
  }
  for (const type of ['xp', 'material', 'heal']) world.pickups.add(new Pickup(type, 20.2, -19.4, 3));
  const standard = engine.readFrame(), buffer = new GameFrameBuffer({ packed: true }), packed = engine.readFrame(buffer);
  assert.equal(packed.projectiles.length, 0); assert.equal(packed.pickups.length, 0);
  assert.deepEqual(unpack(packed).projectiles, standard.projectiles); assert.deepEqual(unpack(packed).pickups, standard.pickups);
  const saved = engine.exportSave(), first = packed.transients.players[0]; world.bullets.items[0].x += 100;
  assert.equal(packed.transients.players[0], first); packed.transients.players[0] = -999;
  assert.notEqual(world.bullets.items[0].x, -999); assert.deepEqual(engine.exportSave(), saved);
  engine.readFrame(buffer); assert.equal(buffer.packed.players[0], world.bullets.items[0].x);
});
test('packed enemy projection keeps every shape, head anchor and dimensions through row swaps and clearing', () => {
  const engine = setup(), world = engine.battle.world, shapes = ['orb', 'longball', 'crystal', 'jade', 'rice', 'star', 'petal', 'drop', 'shard', 'ring', 'blade'];
  for (let i = 0; i < 96; i++) world.enemyBullets.add(new EnemyBullet({ x: i, y: -i, angle: i / 7, speed: 5, damage: 1, radius: i % 8 + 1, shape: shapes[i % shapes.length], laser: i % 13 === 0, laserLength: 300, hitRadius: i % 5 ? 4 : 0, hwKind: i % 17 === 0 ? 'bead' : '' }));
  const buffer = new GameFrameBuffer({ packed: true });
  for (const remove of [false, true]) {
    if (remove) { world.enemyBullets.items[3].dead = true; world.enemyBullets.sweep(); }
    const reference = engine.readFrame().projectiles, stream = engine.readFrame(buffer).transients;
    assert.equal(stream.enemyCount, reference.length);
    for (let i = 0; i < stream.enemyCount; i++) {
      const actual = stream.readEnemy(i, {}), expected = reference[i];
      for (const key of ['id','x','y','radius','angle','color','shape','hitRadius','anchor','length','width','hostile']) assert.deepEqual(actual[key], expected[key], key);
    }
  }
  world.enemyBullets.clear(); assert.equal(engine.readFrame(buffer).transients.enemyCount, 0); assert.equal(buffer.packed.enemyIds.length, 0);
});
test('stream capacity is retained after shrink and reset, with no stale history length', () => {
  const stream = new RenderStream(), view = { id: 1, x: 0, y: 0, radius: 5, angle: 0, color: '#fff', hostile: false, playerStyle: 'shot', trail: [{ x: 1, y: 2, alpha: .5 }] };
  for (let i = 0; i < 300; i++) stream.playerView({ ...view, id: i });
  const data = stream.players; assert.ok(data.length >= 300 * PLAYER_STRIDE); stream.reset(); stream.playerView({ ...view, trail: [] });
  assert.equal(stream.players, data); assert.equal(stream.readPlayer(0, { trail: [] }).trail.length, 0); assert.equal(stream.playerCount, 1);
});
