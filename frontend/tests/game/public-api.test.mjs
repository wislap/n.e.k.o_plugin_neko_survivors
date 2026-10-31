import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameSession, isGameSave, isGameMeta, createEmptyMeta, EMPTY_INPUT } from '../../src/game/index.ts';
const options = { characterId: 'yui', difficulty: 'normal', partySize: 4, seed: 69, pilot: true };
function start() { const s = createGameSession(); s.dispatch({ type: 'start-run', options }); return s; }
function shop(s) {
  for (let i = 0; i < 10000 && s.readUi().phase !== 'shop'; i++) s.advance(EMPTY_INPUT);
  assert.equal(s.readUi().phase, 'shop');
}

test('public metadata guards require the complete current shape and new profiles are detached', () => {
  const current = { ...createEmptyMeta(), bestWave: 20, wins: 3, unlocked: ['yui'] };
  assert.equal(isGameMeta(current), true);
  for (const value of [null, [], {}, { bestWave: 20, wins: 3, unlocked: ['yui'] },
    { ...current, wins: NaN }, { ...current, wins: -1 }, { ...current, wins: '3' },
    { ...current, flandreUnlocked: 1 }, { ...current, fxAlpha: 75 }]) assert.equal(isGameMeta(value), false);
  const first = createEmptyMeta(), second = createEmptyMeta(); first.unlocked.push('mimi');
  assert.deepEqual(second.unlocked, []);
});

test('four-player shop continuation is economically idempotent over repeated save restores', () => {
  const session = start(); shop(session);
  session.dispatch({ type: 'set-pilot', enabled: false });
  const expected = session.readUi();
  let restored = session;
  for (let i = 0; i < 4; i++) {
    const saved = restored.exportSave();
    assert.equal(isGameSave(saved), true);
    restored = createGameSession({ save: saved });
    const actual = restored.readUi();
    // The old UI income summary is deliberately not persisted; all other fields remain exact.
    assert.deepEqual(actual.players, expected.players.map(player => ({ ...player, waveIncome: null })));
    assert.deepEqual(actual.offers.map(o => ({ ...o, id: '' })), expected.offers.map(o => ({ ...o, id: '' })));
  }
});

test('already rolled upgrade rarity survives continuation and deferred shop remains reachable', () => {
  const session = start();
  session.dispatch({ type: 'set-pilot', enabled: false });
  const fixture = session.exportSave();
  fixture.run.player.pendingLevelUps = 1;
  fixture.run.phase = 'upgrade'; fixture.run.afterUpgrade = 'shop';
  // Let the real rule generator supply definitions and rarity for this fixture.
  const rolling = createGameSession({ save: fixture });
  const selected = rolling.readUi().upgrades;
  assert.ok(selected.length > 0);
  const restored = createGameSession({ save: rolling.exportSave() });
  assert.deepEqual(restored.readUi().upgrades, selected);
  assert.equal(restored.dispatch({ type: 'choose-upgrade', optionId: selected[0].id, revision: restored.readUi().revision }).ok, true);
  assert.equal(restored.readUi().phase, 'shop');
});

test('all permanent multiplayer modifiers and pending special rewards survive public continuation', () => {
  const session = start();
  const fixture = session.exportSave();
  fixture.run.pendingItemRewards = [{ id: 'laevatein', name: '莱万汀', sellValue: 60, price: 99, rare: true }];
  for (const player of [fixture.run.player, ...fixture.run.mates]) {
    player.apPierce = 4; player.shield = 7; player.maxShield = 10; player.shieldFullBlock = true;
    player.dealtFinalMul = 1.6; player.takenFinalMul = 1.3;
    player.xpDebt = 3; player.materialDebt = 5; player.stats.capBonus = { dodge: 10 };
  }
  const restored = createGameSession({ save: fixture });
  const result = restored.exportSave();
  for (const player of [result.run.player, ...result.run.mates]) {
    assert.equal(player.apPierce, 4); assert.equal(player.shield, 7); assert.equal(player.maxShield, 10);
    assert.equal(player.shieldFullBlock, true); assert.equal(player.dealtFinalMul, 1.6); assert.equal(player.takenFinalMul, 1.3);
    assert.equal(player.xpDebt, 3); assert.equal(player.materialDebt, 5); assert.equal(player.stats.capBonus.dodge, 10);
  }
  assert.equal(restored.readUi().rewards[0].definitionId, 'laevatein');
});

test('explicit current metadata takes precedence over an older embedded save profile', () => {
  const old = start().exportSave();
  old.meta.wins = 1; old.meta.runs = 1;
  const current = { ...createEmptyMeta(), wins: 5, runs: 9, bestWave: 20 };
  const restored = createGameSession({ save: old, meta: current });
  assert.equal(restored.getMeta().wins, 5); assert.equal(restored.getMeta().runs, 9);
  const selfContained = createGameSession({ save: old });
  assert.equal(selfContained.getMeta().wins, 1);
});

test('teammate AI profiles survive continuation instead of rerolling difficulty tiers', () => {
  const session = start();
  for (let step = 0; step < 180; step++) session.advance(EMPTY_INPUT);
  const saved = session.exportSave();
  const restored = createGameSession({ save: saved });
  assert.deepEqual(restored.exportSave().run.aiProfiles, saved.run.aiProfiles);
});

test('retrying a challenge restores its own entry RNG rather than the preceding wave stream', () => {
  const session = createGameSession();
  session.dispatch({ type: 'start-challenge', challenge: 'vergil', options });
  const collect = () => {
    for (let step = 0; step < 620; step++) session.advance(EMPTY_INPUT);
    const frame = session.readFrame();
    return { phase: frame.phase, actorPositions: frame.actors.map(actor => [actor.definitionId, actor.x, actor.y]),
      shots: frame.projectiles.map(bullet => [bullet.x, bullet.y, bullet.angle, bullet.radius]),
      telegraphs: frame.telegraphs.map(mark => [mark.kind, mark.x, mark.y, mark.radius]) };
  };
  const first = collect();
  assert.equal(session.dispatch({ type: 'retry-wave' }).ok, true);
  assert.deepEqual(collect(), first);
});

test('Flandre HUD follows the controller card timer and hides it before the teaching card', () => {
  const session = createGameSession();
  session.dispatch({ type: 'start-challenge', challenge: 'flandre', options });
  assert.equal(session.readUi().timerVisible, false);
  for (let step = 0; step < 600; step++) session.advance(EMPTY_INPUT);
  const ui = session.readUi();
  assert.equal(ui.timerVisible, true); assert.equal(ui.timerLabel, '？？？');
  assert.ok(ui.secondsLeft > 0 && ui.secondsLeft < 30);
});

test('render/HUD sampling frequency cannot advance AI, simulation clocks or gameplay RNG', () => {
  const run = samplesPerTick => {
    const session = start();
    for (let step = 0; step < 240; step++) {
      session.advance(EMPTY_INPUT);
      for (let read = 0; read < samplesPerTick; read++) { session.readFrame(); session.readUi(); }
    }
    const save = session.exportSave(), frame = session.readFrame();
    return { tick: frame.tick, time: frame.time, rng: save.run.rngState,
      profiles: save.run.aiProfiles, players: session.readUi().players,
      enemies: frame.actors.filter(actor => actor.kind === 'enemy').map(actor => [actor.definitionId, actor.x, actor.y, actor.hp]) };
  };
  assert.deepEqual(run(0), run(7));
});
