import { expandTerrain } from '../../src/game/world/terrain.ts';
import { WORLD_SIZE } from '../../src/game/world/config.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Battle, BATTLE_STEP } from '../../src/game/battle/battle.ts';
import { RNG } from '../../src/game/math/random.ts';
import { EMPTY_INPUT } from '../../src/game/commands.ts';
import { RunControl } from '../../src/game/control.ts';

function create(overrides = {}) {
  const events = [];
  const control = new RunControl();
  const rng = new RNG(69);
  const battle = new Battle({ rng, options: { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69, ...overrides },
    platform: 'desktop', effects: { emit: event => events.push(event) }, control });
  battle.prepareBossRoster();
  battle.bindPilots();
  battle.enterWave(0, false);
  return { battle, rng, events, setPilot: enabled => control.change(enabled, battle.player) };
}

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('Battle owns roster, pilots and fixed combat time while accepting normalized human input', () => {
  const { battle } = create({ partySize: 4 });
  assert.equal(battle.world.players().length, 4);
  assert.deepEqual(battle.captureAiProfiles().map(profile => profile.id), [1, 2, 3, 4]);
  const x = battle.player.x, y = battle.player.y;
  for (let tick = 1; tick <= 6; tick++) {
    const result = battle.advance({ ...EMPTY_INPUT, moveX: 1, moveY: 1, p2MoveX: -1 });
    assert.deepEqual(result, { kind: 'running', refresh: tick === 6 });
  }
  assert.equal(battle.tick, 6);
  close(battle.time, 6 * BATTLE_STEP);
  close(battle.waveElapsed, 6 * BATTLE_STEP);
  assert.ok(battle.player.x > x && battle.player.y > y);
  close(battle.player.x - x, battle.player.y - y);
  assert.ok(battle.world.player2.x < 60);
});

test('Battle uses current run control instead of retaining pilot enablement from construction', () => {
  const { battle, setPilot } = create();
  battle.advance(EMPTY_INPUT);
  assert.equal(battle.player.agentMoveTarget, null);
  setPilot(true);
  battle.advance(EMPTY_INPUT);
  assert.ok(battle.player.agentMoveTarget);
  setPilot(false);
  battle.advance(EMPTY_INPUT);
  assert.equal(battle.player.agentMoveTarget, null);
});

test('wave entry captures replay rules before rolling the next environment and owns the physical scene', () => {
  const { battle, rng } = create();
  const before = { systems: { weather: battle.weather.captureState(), comet: battle.comet.captureState() },
    rngState: rng.state, backgroundId: battle.backgroundId, ...battle.world.waves.captureRules() };
  battle.world.pendingItemRewards.push(...Array.from({ length: 13 }, () => ({
    id: 'warm_milk', name: '热牛奶', price: 9, rare: false, sellValue: 3,
  })));
  const materials = battle.player.materials;
  const entry = battle.enterWave(10, false);
  assert.deepEqual(entry.rules, before);
  assert.equal(battle.world.pendingItemRewards.length, 12);
  assert.equal(battle.player.materials, materials + 3);
  assert.equal(battle.waveIndex, 10);
  assert.equal(battle.waveElapsed, 0);
  assert.equal(battle.waveDuration, battle.world.waves.requireCurrent().duration);
  assert.deepEqual(battle.world.terrain, expandTerrain(battle.backgroundId, WORLD_SIZE));
  assert.equal(battle.world.pet.x, battle.player.x + 40);
  assert.equal(battle.world.pet.y, battle.player.y + 20);
  assert.equal(entry.bossWave, !!(battle.world.waves.requireCurrent().config.boss || battle.world.waves.requireCurrent().config.bosses?.length));
});

test('comet freeze stops actor time and wave time while the world and comet still advance', () => {
  const { battle } = create();
  const state = battle.comet.captureState();
  state.fields.phase = 'roar'; state.fields.t = 0; state.fields.pending = false;
  battle.comet.restoreState(state);
  battle.player.hurtFlash = 1;
  const worldTime = battle.world.t;
  const x = battle.player.x;
  battle.advance({ ...EMPTY_INPUT, moveX: 1 });
  close(battle.time, BATTLE_STEP);
  close(battle.waveElapsed, 0);
  close(battle.player.hurtFlash, 1);
  close(battle.player.x, x);
  close(battle.world.t - worldTime, BATTLE_STEP);
  close(battle.comet.captureState().fields.t, BATTLE_STEP);
  assert.equal(battle.world.spawnPaused, true);
  assert.equal(battle.world.enemyFrozen, true);
});

test('item ultimate slows World after normal actor time and still consumes one real combat step', () => {
  const { battle } = create();
  battle.itemPassives.ultimate = { t: 0, launched: 0, acc: 0, blades: [] };
  battle.player.hurtFlash = 1;
  const worldTime = battle.world.t;
  battle.advance(EMPTY_INPUT);
  close(battle.player.hurtFlash, 1 - BATTLE_STEP);
  close(battle.world.t - worldTime, BATTLE_STEP * .05);
  close(battle.waveElapsed, BATTLE_STEP);
  close(battle.itemPassives.ultimate.t, BATTLE_STEP);
});

test('Battle returns defeat, upgrade, then wave completion in the retained priority order', () => {
  const { battle } = create();
  battle.player.pendingLevelUps = 1;
  battle.waveElapsed = battle.waveDuration;
  battle.player.dead = true;
  assert.deepEqual(battle.advance(EMPTY_INPUT), { kind: 'defeat' });
  battle.player.dead = false;
  assert.deepEqual(battle.advance(EMPTY_INPUT), { kind: 'upgrade' });
  battle.player.pendingLevelUps = 0;
  assert.deepEqual(battle.advance(EMPTY_INPUT), { kind: 'wave-finished' });
});

test('challenge entry owns positioning and arena clamping', () => {
  const { battle } = create({ partySize: 2 });
  const entry = battle.enterChallenge('vergil', false);
  assert.deepEqual(entry.pet, battle.world.pet.captureState());
  assert.ok(Number.isInteger(entry.rngState));
  assert.equal(battle.encounter.kind, 'vergil');
  const arena = battle.encounter.arena;
  assert.equal(battle.player.x, arena.cx - 25);
  assert.equal(battle.world.player2.x, arena.cx + 25);
  battle.player.x = arena.cx + arena.hw + 400;
  battle.player.y = arena.cy + arena.hh + 400;
  battle.advance(EMPTY_INPUT);
  assert.ok(battle.player.x <= arena.cx + arena.hw);
  assert.ok(battle.player.y <= arena.cy + arena.hh);
  close(battle.waveElapsed, 0);
  battle.leaveChallenge();
  assert.equal(battle.encounter, null);
  assert.equal(battle.world.challenge, null);
  assert.equal(battle.world.noSpawn, false);
});

test('Battle consumes a real challenge completion once without deciding the next run phase', () => {
  const { battle } = create();
  battle.enterChallenge('vergil', false);
  let result = null;
  for (let step = 0; step < 6500; step++) {
    const outcome = battle.advance(EMPTY_INPUT);
    assert.equal(outcome.kind, 'challenge');
    if (outcome.result) { result = outcome.result; break; }
  }
  assert.deepEqual(result, { kind: 'vergil', outcome: 'death' });
  assert.equal(battle.encounter.kind, 'vergil');
  assert.deepEqual(battle.advance(EMPTY_INPUT).result, null);
});

test('Vergil controller clock advances in real time during its slowed world phase', () => {
  const { battle } = create();
  battle.enterChallenge('vergil', false);
  battle.player.invuln = 1000;
  // Enter the real fight, then cross its third-phase HP threshold through the shared body.
  for (let step = 0; step < 550; step++) battle.advance(EMPTY_INPUT);
  const boss = battle.world.enemies.items.find(enemy => !enemy.isChest && enemy.boss);
  assert.ok(boss);
  boss.takeDamage(boss.maxHp * .8, { pierceArmor: true });
  for (let step = 0; step < 10 && battle.encounter.timeScale === 1; step++) battle.advance(EMPTY_INPUT);
  const scale = battle.encounter.timeScale;
  assert.equal(scale, .2);
  const left = battle.encounter.readClock().timer.left;
  const worldTime = battle.world.t;
  battle.player.hurtFlash = 1;
  battle.advance(EMPTY_INPUT);
  close(battle.encounter.readClock().timer.left, left - BATTLE_STEP);
  close(battle.world.t - worldTime, BATTLE_STEP * scale);
  close(battle.player.hurtFlash, 1 - BATTLE_STEP * scale);
});
