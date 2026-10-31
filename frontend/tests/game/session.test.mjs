import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionEngine } from '../../src/game/session-engine.ts';
import { isSupportedSave } from '../../src/game/save/schema.ts';
const INPUT = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, manualAim: false, slow: false,
  clear: false, ultimate: false, p2MoveX: 0, p2MoveY: 0, p2Slow: false, p2Clear: false };
const options = { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 65, pilot: true };
function start(overrides = {}) {
  const session = new SessionEngine();
  assert.deepEqual(session.dispatch({ type: 'start-run', options: { ...options, ...overrides } }), { ok: true });
  return session;
}
function reachShop(session) {
  for (let i = 0; i < 12000; i++) {
    session.advance(INPUT);
    if (session.readUi().phase === 'shop') return;
    if (session.readUi().phase === 'result') throw new Error('Unexpected early defeat');
  }
  throw new Error('Did not reach shop');
}

test('public session flow completes a real wave, upgrades, shops and advances once', () => {
  const session = start();
  let sawUpgrade = false;
  for (let i = 0; i < 12000; i++) {
    const result = session.advance(INPUT);
    if (session.readUi().phase === 'upgrade') sawUpgrade = true;
    assert.ok(Array.isArray(result.events));
    if (session.readUi().phase === 'shop') break;
  }
  assert.equal(session.readUi().phase, 'shop');
  assert.ok(sawUpgrade);
  assert.equal(session.readUi().wave, 1);
  assert.equal(session.dispatch({ type: 'next-wave' }).ok, true);
  assert.equal(session.readUi().wave, 2);
  assert.equal(session.dispatch({ type: 'next-wave' }).ok, false);
});

test('shop validates revision and refuses another player shelf and repeated purchase', () => {
  const session = start();
  reachShop(session);
  session.dispatch({ type: 'set-pilot', enabled: false });
  const ui = session.readUi();
  const offer = ui.offers.find(o => !o.sold && o.price <= ui.players[0].materials);
  assert.ok(offer);
  assert.equal(session.dispatch({ type: 'buy-offer', offerId: offer.id, revision: ui.revision - 1 }).ok, false);
  assert.equal(session.dispatch({ type: 'buy-offer', offerId: offer.id, revision: ui.revision, playerId: 2 }).ok, false);
  assert.equal(session.dispatch({ type: 'buy-offer', offerId: offer.id, revision: ui.revision }).ok, true);
  const balance = session.readUi().players[0].materials;
  assert.equal(session.dispatch({ type: 'buy-offer', offerId: offer.id, revision: ui.revision }).ok, false);
  assert.equal(session.readUi().players[0].materials, balance);
});

test('pause freezes simulation but still flushes queued command events', () => {
  const session = start();
  session.advance(INPUT);
  const time = session.readFrame().time;
  assert.equal(session.dispatch({ type: 'pause' }).ok, true);
  for (let i = 0; i < 100; i++) session.advance(INPUT);
  assert.equal(session.readFrame().time, time);
  assert.equal(session.dispatch({ type: 'resume' }).ok, true);
  session.advance(INPUT);
  assert.ok(session.readFrame().time > time);
});

test('shop save roundtrip preserves purchases, funds, stock and locks without paying wave income again', () => {
  const session = start();
  reachShop(session);
  session.dispatch({ type: 'set-pilot', enabled: false });
  const initial = session.readUi();
  session.dispatch({ type: 'toggle-lock', offerId: initial.offers[0].id, revision: initial.revision });
  const saved = JSON.parse(JSON.stringify(session.exportSave()));
  assert.equal(isSupportedSave(saved), true);
  const restored = new SessionEngine({ save: saved });
  assert.equal(restored.readUi().phase, 'shop');
  // Wave income is an ephemeral shop explanation; wallets/equipment/attributes remain exact.
  assert.deepEqual(restored.readUi().players, session.readUi().players.map(player => ({ ...player, waveIncome: null })));
  assert.deepEqual(restored.readUi().offers.map(o => ({ ...o, id: '' })), session.readUi().offers.map(o => ({ ...o, id: '' })));
  assert.equal(restored.readUi().rerollCost, session.readUi().rerollCost);
});

test('four-player restore and retry retain every character and growth with a fresh full wave', () => {
  const session = start({ partySize: 4, pilot: false });
  const initial = session.readUi().players;
  const saved = session.exportSave();
  const restored = new SessionEngine({ save: saved });
  assert.deepEqual(restored.readUi().players, initial);
  restored.advance({ ...INPUT, moveX: 1 });
  assert.equal(restored.dispatch({ type: 'retry-wave' }).ok, true);
  assert.deepEqual(restored.readUi().players, initial);
  assert.equal(restored.readUi().secondsLeft, 30);
});

test('save rejects malformed progression, unknown content and non-finite modifiers', () => {
  const original = start().exportSave();
  for (const mutate of [
    data => { data.run.player.characterId = 'missing'; },
    data => { data.run.player.weapons[0].id = 'missing'; },
    data => { data.run.player.stats.flat.maxHp = NaN; },
    data => { data.run.waveIndex = -1; },
    data => { data.version = 99; },
  ]) {
    const data = structuredClone(original); mutate(data);
    assert.equal(isSupportedSave(data), false);
    assert.throws(() => new SessionEngine({ save: data }), TypeError);
  }
});

test('return to title retains a valid continuation save and stable readUi identity', () => {
  const session = start();
  assert.equal(session.readUi(), session.readUi());
  session.dispatch({ type: 'return-title' });
  assert.equal(session.readUi().phase, 'title');
  assert.equal(isSupportedSave(session.exportSave()), true);
});

test('wave checkpoint restores seeded spawn decisions, terrain and ordinary progression', () => {
  const session = start({ pilot: false });
  const collect = current => {
    for (let step = 0; step < 240; step++) current.advance({ ...INPUT, moveX: 1 });
    const frame = current.readFrame();
    return { backgroundId: frame.backgroundId, terrain: frame.terrain,
      player: current.readUi().players,
      enemyPositions: frame.actors.filter(actor => actor.kind === 'enemy').map(actor => [actor.definitionId, actor.x, actor.y, actor.hp]),
      projectiles: frame.projectiles.map(bullet => [bullet.x, bullet.y, bullet.radius, bullet.angle]),
    };
  };
  const first = collect(session);
  assert.equal(session.dispatch({ type: 'retry-wave' }).ok, true);
  const retry = collect(session);
  assert.deepEqual(retry, first);
});

test('snow maze publishes its actual unique plaza, gates and collision walls as copied geometry', () => {
  const session = start({ pilot: false });
  // Background selection is deterministic; cycle ordinary wave fixtures until snow.
  let snow;
  const original = session.exportSave();
  for (let wave = 0; wave < 20; wave++) {
    const data = structuredClone(original); data.run.waveIndex = wave;
    const restored = new SessionEngine({ save: data });
    const frame = restored.readFrame();
    if (frame.maze) { snow = frame; break; }
  }
  assert.ok(snow);
  assert.ok(snow.maze.plaza.width >= snow.maze.bounds.width);
  assert.ok(snow.maze.walls.length > 20);
  assert.ok(snow.maze.walls.every(wall => wall.material === 'ice' && wall.width > 0 && wall.height > 0));
  assert.notDeepEqual(snow.maze.entry, snow.maze.exit);
  assert.equal(snow.terrain.filter(wall => wall.material === 'ice').length, snow.maze.walls.length);
});
