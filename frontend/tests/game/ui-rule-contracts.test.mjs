import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameSession, EMPTY_INPUT, getCharacterChoices, isGameSave } from '../../src/game/index.ts';
import { RNG } from '../../src/game/math/random.ts';
import { World } from '../../src/game/world/world.ts';
import { Player } from '../../src/game/actors/player.ts';
import { SessionEngine } from '../../src/game/session-engine.ts';
import { settleWave } from '../../src/game/progression/wave-settlement.ts';

const options = { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69, pilot: false };
function start(extra = {}, sessionOptions) {
  const session = createGameSession(sessionOptions);
  assert.equal(session.dispatch({ type: 'start-run', options: { ...options, ...extra } }).ok, true);
  return session;
}
function roles(session) {
  const save = session.exportSave();
  return [save.run.player, ...(save.run.mates ?? [])].map(player => player.characterId);
}
function phaseFixture(phase) {
  const save = start().exportSave(); save.run.phase = phase; save.run.pilot = true;
  save.run.player.kills = 3;
  if (phase === 'upgrade') { save.run.player.pendingLevelUps = 1; save.run.afterUpgrade = 'shop'; }
  return createGameSession({ save });
}

for (const phase of ['playing', 'shop', 'upgrade', 'paused', 'flandre', 'vergil']) test(`abandon-run ends ${phase} as silent counted result, with no manual/AI retry`, () => {
  let session;
  if (['flandre', 'vergil'].includes(phase)) {
    session = createGameSession();
    session.dispatch({ type: 'start-challenge', challenge: phase, options: { ...options, pilot: true } });
    session.advance(EMPTY_INPUT); // Drain initial run/pilot speech before exercising quit.
  } else {
    session = phaseFixture(phase === 'paused' ? 'playing' : phase);
    if (phase === 'paused') session.dispatch({ type: 'pause' });
  }
  const before = session.getMeta(), kills = session.readUi().players[0].kills, wave = session.readUi().wave;
  assert.equal(session.dispatch({ type: 'abandon-run' }).ok, true);
  const ui = session.readUi();
  assert.equal(ui.phase, 'result'); assert.equal(ui.won, false); assert.equal(ui.canRetry, false);
  assert.equal(session.getMeta().runs, before.runs + 1); assert.equal(session.getMeta().wins, before.wins);
  assert.equal(session.getMeta().totalKills, before.totalKills + kills);
  assert.equal(session.getMeta().bestWave, Math.max(before.bestWave, wave));
  const events = session.advance(EMPTY_INPUT).events;
  assert.equal(events.filter(event => event.type === 'run-ended' && !event.won).length, 1);
  assert.ok(events.some(event => event.type === 'music' && event.scene === 'result'));
  assert.equal(events.some(event => event.type === 'report' && ['death', 'pilot_lose'].includes(event.event)), false);
  assert.equal(events.some(event => event.type === 'avatar-emotion' && event.emotion === 'sad'), false);
  assert.equal(events.some(event => event.type === 'speech' && event.key === 'pilot:handover'), false);
  assert.equal(session.dispatch({ type: 'retry-wave' }).ok, false);
  const counted = session.getMeta(); assert.equal(session.dispatch({ type: 'abandon-run' }).ok, false);
  for (let tick = 0; tick < 90; tick++) session.advance(EMPTY_INPUT);
  assert.equal(session.readUi().phase, 'result'); assert.deepEqual(session.getMeta(), counted);
  // Checkpoint statistics stay intact; the result flag disables retry across continuation.
  const saved = session.exportSave(); assert.equal(saved.run.abandoned, true); assert.ok(saved.checkpoint);
  const restored = createGameSession({ save: saved });
  assert.equal(restored.readUi().phase, 'result'); assert.equal(restored.readUi().canRetry, false);
  assert.equal(restored.dispatch({ type: 'retry-wave' }).ok, false);
  assert.ok(restored.advance(EMPTY_INPUT).events.some(event => event.type === 'music' && event.scene === 'result'));
});

test('abandon-run rejects title, endless prompt and existing results without counting a new run', () => {
  const title = createGameSession(), before = title.getMeta();
  assert.equal(title.dispatch({ type: 'abandon-run' }).ok, false); assert.deepEqual(title.getMeta(), before);
  for (const phase of ['endless-prompt', 'result']) {
    const session = phaseFixture(phase), meta = session.getMeta();
    assert.equal(session.dispatch({ type: 'abandon-run' }).ok, false);
    assert.equal(session.readUi().phase, phase); assert.deepEqual(session.getMeta(), meta);
  }
});

test('randomParty chooses P1 and unique teammates through the seeded session and preserves chosen roles on restore', () => {
  const a = start({ randomParty: true, partySize: 4, pilot: true });
  const b = start({ characterId: 'mimi', randomParty: true, partySize: 4, pilot: true });
  assert.deepEqual(roles(a), roles(b), 'the unused selected character does not drive random-party selection');
  assert.equal(new Set(roles(a)).size, 4);
  for (let tick = 0; tick < 60; tick++) a.advance(EMPTY_INPUT);
  const saved = a.exportSave(), restored = createGameSession({ save: saved });
  assert.deepEqual(roles(restored), roles(a));
  assert.equal(restored.exportSave().run.waveStartRngState, saved.run.waveStartRngState);
  assert.equal('randomParty' in saved.run, false, 'a save persists actual actors, not an instruction to reroll them');
});

test('randomParty can choose each of the eight P1 roles while ordinary start keeps its original RNG stream', () => {
  const observed = new Set();
  for (let seed = 1; seed <= 64; seed++) {
    const session = start({ randomParty: true, partySize: 2, pilot: true, seed });
    const selected = roles(session); observed.add(selected[0]); assert.notEqual(selected[0], selected[1]);
  }
  assert.deepEqual([...observed].sort(), getCharacterChoices().map(character => character.id).sort());
  assert.deepEqual(start({ partySize: 4 }).exportSave(), start({ partySize: 4, randomParty: false }).exportSave());
  assert.equal(roles(start({ characterId: 'mimi' }))[0], 'mimi');
});

test('wave income observes existing real payouts once without paying cleanup pickups twice', () => {
  const rng = new RNG(69), world = new World(rng), p1 = new Player('yui', rng), p2 = new Player('nana', rng), p3 = new Player('mimi', rng);
  world.player = p1; world.player2 = p2; world.player3 = p3;
  [p1, p2, p3].forEach((player, index) => { player.id = index + 1; player.world = world; });
  world.waves.begin(0); world.noSpawn = true;
  p3.takeDamage(1000, 100, 0, { fixedDamage: 1000, ignoreIFrames: true }); assert.equal(p3.dead, true);
  p1.stats.addFlat('harvesting', 5 - p1.stats.get('harvesting'));
  world.waves.spawnEnemyById('slime', 200, 0);
  const payouts = [], roundCalls = [], luckCalls = [];
  for (const player of [p1, p2, p3]) {
    const gain = player.gainMaterials.bind(player); player.gainMaterials = value => { payouts.push([player.id, value]); return gain(value); };
    const round = player.charRt.onRoundEnd.bind(player.charRt); player.charRt.onRoundEnd = () => { roundCalls.push(player.id); return round(); };
    const luck = player.charRt.luckHarvest.bind(player.charRt); player.charRt.luckHarvest = () => { luckCalls.push(player.id); return luck(); };
  }
  const income = settleWave(world, 0);
  assert.deepEqual(income, { cleanup: 1, harvest: 10, clear: 10, total: 21 });
  assert.deepEqual(payouts, [[1, 5], [1, 2], [2, 3], [1, 10]]);
  assert.deepEqual(roundCalls, [1, 2]); assert.deepEqual(luckCalls, [1, 2]);
  assert.equal(p1.materials, 20); assert.equal(p2.materials, 20); assert.equal(p3.materials, 0);
  assert.equal(world.pickups.items.filter(drop => drop.type === 'material').reduce((sum, drop) => sum + drop.value, 0), 1);
});

test('session publishes the latest wave income and clears this nonpersistent summary on start/restore', () => {
  const engine = new SessionEngine(); assert.equal(engine.lastWaveIncome, null);
  engine.start(options); engine.battle.world.waves.spawnEnemyById('slime', 200, 0); engine.finishWave();
  assert.deepEqual(engine.lastWaveIncome, { cleanup: 1, harvest: 2, clear: 10, total: 13 });
  assert.deepEqual(engine.readUi().players[0].waveIncome, engine.lastWaveIncome);
  const saved = engine.exportSave(); assert.equal('lastWaveIncome' in saved.run, false); assert.equal('waveIncome' in saved.run, false);
  const restored = createGameSession({ save: saved }); assert.equal(restored.readUi().players[0].waveIncome, null);
  engine.start(options); assert.equal(engine.lastWaveIncome, null); assert.equal(engine.readUi().players[0].waveIncome, null);
});

test('actual numeric and boolean shop paw marks survive repeated public continuation without hiding other offer fields', () => {
  const seed = start({ partySize: 4 }), saved = seed.exportSave(); saved.run.phase = 'shop';
  saved.run.shop.offers = Array.from({ length: 16 }, (_, index) => ({ kind: 'item', id: 'warm_milk', price: 1000 + index,
    sold: index % 2 === 0, pawMark: [1, 0, true, false, .25][index % 5], meta: { slot: index } }));
  let session = createGameSession({ save: saved }); const expected = session.readUi().offers;
  for (let round = 0; round < 4; round++) {
    const current = session.exportSave(); assert.equal(isGameSave(current), true);
    assert.deepEqual(current.run.shop.offers.map(offer => offer.pawMark), saved.run.shop.offers.map(offer => offer.pawMark));
    session = createGameSession({ save: current });
    assert.deepEqual(session.readUi().offers, expected);
  }
  const old = session.exportSave(); old.run.shop.offers.forEach(offer => { delete offer.pawMark; });
  assert.equal(isGameSave(old), true);
  assert.ok(createGameSession({ save: old }).readUi().offers.every(offer => !offer.pawMark));
  for (const invalid of ['true', NaN, Infinity, -1, 2, null]) {
    const malformed = structuredClone(saved); malformed.run.shop.offers[0].pawMark = invalid;
    assert.equal(isGameSave(malformed), false);
  }
});


test('abandon-run preserves wave/total retry statistics and cannot be bypassed by restored or re-enabled pilot', () => {
  const save = start().exportSave(); save.run.waveIndex = save.checkpoint.waveIndex = 2;
  save.run.retries = save.meta.retries = 7; save.run.manualRetries = save.meta.manualRetries = 3;
  save.checkpoint.retries = 5; save.checkpoint.manualRetries = 2;
  const session = createGameSession({ save }); const stats = session.readUi().retryStats;
  assert.deepEqual(stats, { wave: 2, total: 7, manual: 3 });
  assert.equal(session.dispatch({ type: 'abandon-run' }).ok, true);
  assert.deepEqual(session.readUi().retryStats, stats);
  session.dispatch({ type: 'set-pilot', enabled: true });
  for (let tick = 0; tick < 90; tick++) session.advance(EMPTY_INPUT);
  assert.equal(session.readUi().phase, 'result'); assert.equal(session.dispatch({ type: 'retry-wave' }).ok, false);
  const saved = session.exportSave(); assert.equal(saved.run.abandoned, true); assert.equal(saved.checkpoint.retries, 5);
  const restored = createGameSession({ save: saved }); assert.equal(restored.readUi().pilot, false);
  assert.deepEqual(restored.readUi().retryStats, stats); assert.equal(restored.readUi().canRetry, false);
  const invalid = structuredClone(saved); invalid.run.phase = 'playing'; assert.equal(isGameSave(invalid), false);
  assert.equal(restored.dispatch({ type: 'start-run', options }).ok, true);
  assert.equal(restored.exportSave().run.abandoned, undefined); assert.equal(restored.readUi().canRetry, true);
});
