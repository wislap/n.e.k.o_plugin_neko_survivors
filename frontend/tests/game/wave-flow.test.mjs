import test from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../../src/game/math/random.ts';
import { World } from '../../src/game/world/world.ts';
import { Player } from '../../src/game/actors/player.ts';
import { settleWave } from '../../src/game/progression/wave-settlement.ts';
import { SessionEngine } from '../../src/game/session-engine.ts';
import { createGameSession, EMPTY_INPUT } from '../../src/game/index.ts';

const options = { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69, pilot: false };
const rolls = { charge: .04, bullet: .13, tank: .21, chaos: .30, slack: .39, payday: .47, egg: .56 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function setup(type = null, wave = 10, character = 'yui') {
  const rng = new RNG(69), world = new World(rng), player = new Player(character, rng);
  player.id = 1; player.world = world; player.weapons = []; world.player = player; world.waves.setDifficulty('normal');
  const state = { rng, world, player, elapsed: 0 };
  begin(state, wave, type); return state;
}
function begin(state, wave, type) {
  // Entropy controls which real startWave branch is chosen; source values and methods stay intact.
  state.rng.next = () => type == null ? .99 : rolls[type];
  state.world.waves.begin(wave); state.rng.next = () => .99; state.elapsed = 0;
}
function spawnFor(state, seconds) {
  for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) {
    state.elapsed += 1 / 60;
    state.world.waves.advanceSpawning(1 / 60, state.player, state.elapsed);
  }
}
function enemy(state, id, x = 300, y = 0) { return state.world.waves.spawnEnemyById(id, x, y); }
function awaitShot(state, shooter) {
  const before = state.world.enemyBullets.length;
  for (let tick = 0; tick < 5 * 60 && state.world.enemyBullets.length === before; tick++) {
    shooter.update(1 / 60, state.player, state.world);
  }
  assert.ok(state.world.enemyBullets.length > before, 'the real firing cooldown reaches its first shot');
}
function damage(state, target) { state.world.dealDamage(state.player, null, target, target.maxHp * 5, { pierceArmor: true }); }

for (const [type, expected] of [['charge', ['charger']], ['bullet', ['spitter', 'chaos_egg', 'spiral_cat', 'blade_cat']], ['tank', ['tank', 'crab', 'elite_crab', 'splitter']]]) {
  test(`${type} special wave reaches actual telegraphed spawning and replaces the ordinary enemy population`, () => {
    const state = setup(type); spawnFor(state, .8);
    assert.ok(state.world.waves.read().warnings.length > 0); assert.equal(state.world.enemies.length, 0);
    spawnFor(state, 2);
    const spawned = state.world.enemies.items;
    assert.ok(spawned.length > 0);
    assert.ok(spawned.every(actor => expected.includes(actor.def.id)));
    if (type === 'charge') assert.ok(spawned.every(actor => actor.behavior === 'charger'));
    if (type === 'bullet') {
      assert.ok(spawned.every(actor => ['shooter', 'chaseShooter'].includes(actor.behavior)));
      const shooter = spawned[0]; state.player.x = shooter.x + 200; state.player.y = shooter.y;
      awaitShot(state, shooter);
      assert.ok(state.world.enemyBullets.length > 0, 'the selected population really fires projectiles');
    }
  });
}

test('chaos makes a real shooter aim at a melee enemy and its real projectile damages that foe', () => {
  const state = setup('chaos'); state.player.x = 1000; state.world.noSpawn = true;
  const victim = enemy(state, 'slime', 100), shooter = enemy(state, 'spitter', 200);
  awaitShot(state, shooter);
  const bullet = state.world.enemyBullets.items[0]; assert.ok(bullet);
  assert.ok(Math.cos(bullet.angle) < -.9, 'foe is left, while the human is to the right');
  const hp = victim.hp; bullet.x = victim.x; bullet.y = victim.y;
  state.world.update(0, state.player, 0);
  assert.ok(victim.hp < hp); assert.equal(bullet.dead, true);
});

function shooting(state, seconds = 12) {
  const shooter = enemy(state, 'spitter', 300);
  for (let tick = 0; tick < seconds * 60; tick++) shooter.update(1 / 60, state.player, state.world);
  return { shooter, shots: state.world.enemyBullets.items };
}

test('slack changes real movement and actual firing cadence, while keeping each projectile damage unchanged', () => {
  const normal = setup(), slack = setup('slack');
  const a = enemy(normal, 'slime'), b = enemy(slack, 'slime'); const ax = a.x, bx = b.x;
  a.update(.1, normal.player, normal.world); b.update(.1, slack.player, slack.world);
  close((bx - b.x) / (ax - a.x), .7);
  const active = shooting(normal), lazy = shooting(slack);
  assert.ok(active.shots.length > lazy.shots.length); assert.ok(lazy.shots.length > 0);
  close(lazy.shots[0].damage, active.shots[0].damage);
});

test('payday increases real firing cadence and projectile damage, including a real hit on the player', () => {
  const normal = setup(), payday = setup('payday');
  const a = shooting(normal), b = shooting(payday);
  assert.ok(b.shots.length > a.shots.length); close(b.shots[0].damage / a.shots[0].damage, 1.2);
  const losses = [];
  for (const [state, bullet] of [[normal, a.shots[0]], [payday, b.shots[0]]]) {
    bullet.x = state.player.x; bullet.y = state.player.y; state.player.invuln = 0;
    const hp = state.player.hp; bullet.update(0, state.world, [state.player]); losses.push(hp - state.player.hp);
  }
  assert.ok(losses[1] > losses[0]); assert.ok(losses[0] > 0);
});

test('egg halves actual ordinary spawns, retains baseline elite count, and doubles real loot and collected currency', () => {
  const normal = setup(), egg = setup('egg');
  for (const state of [normal, egg]) spawnFor(state, state.world.waves.requireCurrent().duration + 2);
  assert.equal(normal.world.waves.read().warnings.length, 0); assert.equal(egg.world.waves.read().warnings.length, 0);
  const ordinary = state => state.world.enemies.items.filter(actor => !actor.isChest && actor.def?.behavior !== 'flee' && !actor.elite).length;
  const elites = state => state.world.enemies.items.filter(actor => actor.elite).length;
  assert.ok(ordinary(normal) > 10); assert.ok(Math.abs(ordinary(egg) * 2 - ordinary(normal)) <= 1);
  // The fixed baseline reduces the spawn budget, while the separately queued elites stay unchanged.
  assert.ok(elites(normal) > 0); assert.equal(elites(egg), elites(normal));
  const outputs = [];
  for (const type of [null, 'egg']) {
    const state = setup(type), target = enemy(state, 'slime', 400); state.rng.next = () => .2; damage(state, target);
    const totals = type => state.world.pickups.items.filter(drop => drop.type === type).reduce((total, drop) => total + drop.value, 0);
    const xp = totals('xp'), materials = totals('material'); assert.ok(xp > 0 && materials > 0);
    for (const pickup of state.world.pickups.items.filter(drop => drop.type === 'material')) {
      pickup.x = state.player.x; pickup.y = state.player.y; pickup.update(0, state.world, state.player);
    }
    outputs.push({ xp, materials, wallet: state.player.materials });
  }
  assert.equal(outputs[1].xp, outputs[0].xp * 2); assert.equal(outputs[1].materials, outputs[0].materials * 2);
  assert.equal(outputs[1].wallet, outputs[0].wallet * 2);
});

test('special wave cooldown excludes the next two actual waves and boss/early waves', () => {
  const state = setup('charge');
  for (const [wave, special] of [[10, 'charge'], [11, null], [12, null], [13, 'charge']]) {
    if (wave !== 10) begin(state, wave, 'charge');
    assert.equal(state.world.waves.read().current?.special, special); spawnFor(state, 2.2);
    assert.ok(state.world.enemies.length > 0);
    if (special) assert.ok(state.world.enemies.items.every(actor => actor.def.id === 'charger'));
    else assert.ok(state.world.enemies.items.some(actor => actor.def.id !== 'charger'));
    settleWave(state.world, wave);
  }
  for (const wave of [0, 9, 19]) {
    const ignored = setup('charge', wave); assert.equal(ignored.world.waves.read().current?.special, null); spawnFor(ignored, 2.2);
    assert.ok(ignored.world.enemies.length > 0);
    if (wave > 0) assert.ok(ignored.world.enemies.items.some(actor => actor.boss));
  }
});

test('public retry reproduces the same actual special-wave spawn stream from a real saved RNG state', () => {
  const seed = createGameSession(); seed.dispatch({ type: 'start-run', options });
  const save = seed.exportSave(); save.run.waveIndex = 10;
  save.checkpoint = null; // Capture this fixture's actual wave-11 entry, not the source wave-1 checkpoint.
  // Mulberry32 state 1 has first draw .627 (no comet) and second .0027 (charge wave).
  // It is serializable entropy, not a patched RNG function hidden from the checkpoint.
  save.run.waveStartRngState = 1; save.run.waveStartRules.rngState = 1;
  const session = createGameSession({ save });
  const observe = () => {
    for (let tick = 0; tick < 140; tick++) session.advance({ ...EMPTY_INPUT, moveX: -1 });
    const actors = session.readFrame().actors.filter(actor => actor.kind === 'enemy');
    assert.ok(actors.length > 0); assert.ok(actors.every(actor => actor.definitionId === 'charger'));
    return { actors: actors.map(actor => [actor.definitionId, actor.x, actor.y, actor.hp]), rng: session.exportSave().run.rngState };
  };
  const first = observe(); assert.equal(session.dispatch({ type: 'retry-wave' }).ok, true); assert.deepEqual(observe(), first);
});

function fastWave(character = 'yui', wave = 3, special = null, peak = false) {
  const state = setup(special, wave, character); state.world.noSpawn = true;
  if (peak) enemy(state, 'elite_crab', 1000);
  const targets = Array.from({ length: 8 }, (_, i) => enemy(state, 'slime', 500 + i * 20));
  state.world.update(.5, state.player, .5);
  for (const target of targets) damage(state, target);
  return state;
}
function nextContact(state, wave = 4) {
  begin(state, wave, null); const actor = enemy(state, 'slime', 0, 0);
  state.player.invuln = 0; const hp = state.player.hp; actor.update(0, state.player, state.world);
  return { maxHp: actor.maxHp, loss: hp - state.player.hp };
}

test('fast real kills raise next-wave enemy HP and actual contact damage; slow timeout lowers both', () => {
  const normal = setup(null, 4), base = nextContact(normal);
  const fast = fastWave(); settleWave(fast.world, 3); const raised = nextContact(fast);
  assert.ok(raised.maxHp > base.maxHp); assert.ok(raised.loss > base.loss);
  const slow = setup(null, 3); slow.world.noSpawn = true; slow.world.update(slow.world.waves.requireCurrent().duration, slow.player, slow.world.waves.requireCurrent().duration);
  settleWave(slow.world, 3); const lowered = nextContact(slow);
  assert.ok(lowered.maxHp < base.maxHp); assert.ok(lowered.loss < base.loss);
});

test('adaptive one-hit guard blocks attack growth from a genuinely lethal spawn but still raises enemy HP', () => {
  const state = fastWave('kuro', 3, null, true);
  assert.ok(state.world.enemies.items.some(enemy => !enemy.boss && enemy.damage >= state.player.maxHp));
  settleWave(state.world, 3); const adjusted = nextContact(state);
  const base = nextContact(setup(null, 4, 'kuro'));
  assert.ok(adjusted.maxHp > base.maxHp); close(adjusted.loss, base.loss);
});

test('adaptive feedback ignores introductory, real boss and special waves despite real fast kills', () => {
  const intro = fastWave('yui', 1), special = fastWave('yui', 10, 'charge');
  const boss = setup(null, 9); spawnFor(boss, .5); assert.equal(boss.world.waves.read().bossSpawned, true); boss.world.noSpawn = true;
  const targets = Array.from({ length: 8 }, (_, i) => enemy(boss, 'slime', 500 + i * 20));
  boss.world.update(.5, boss.player, .5); for (const target of targets) damage(boss, target);
  for (const state of [intro, special, boss]) {
    settleWave(state.world, state.world.waves.requireCurrent().index); assert.equal(state.world.waves.captureProgress().diffHp, 1); assert.equal(state.world.waves.captureProgress().diffDmg, 1);
  }
});

for (const action of ['claim-reward', 'sell-reward']) test(`controlled Vergil victory reaches actual session settlement and public ${action} exactly once`, () => {
  const engine = new SessionEngine(); engine.dispatch({ type: 'start-challenge', challenge: 'vergil', options });
  for (let tick = 0; tick < 550; tick++) engine.advance(EMPTY_INPUT);
  const fight = engine.battle.encounter; assert.equal(fight.kind, 'vergil'); assert.notEqual(fight.readFrame().encounter.state, 'intro');
  const boss = engine.battle.world.enemies.items.find(enemy => enemy.id === fight.readCombat().bodyId); assert.ok(boss);
  // Explicit controlled victory fixture; not a natural-damage or natural-campaign claim.
  boss.hp = 0;
  for (let tick = 0; tick < 120 && engine.battle.encounter; tick++) engine.advance(EMPTY_INPUT);
  assert.equal(engine.battle.encounter, null); assert.equal(engine.battle.world.pendingItemRewards.filter(reward => reward.id === 'yamato').length, 1);
  const balance = engine.battle.player.materials; fight.advance(1 / 60); engine.advance(EMPTY_INPUT);
  assert.equal(engine.battle.player.materials, balance); assert.equal(engine.battle.world.pendingItemRewards.filter(reward => reward.id === 'yamato').length, 1);
  while (engine.readUi().phase === 'upgrade') assert.equal(engine.dispatch({ type: 'auto-upgrade' }).ok, true);
  assert.equal(engine.readUi().phase, 'shop');
  const session = createGameSession({ save: engine.exportSave() }), ui = session.readUi();
  const reward = ui.rewards.find(reward => reward.definitionId === 'yamato'); assert.ok(reward);
  const money = ui.players[0].materials;
  const command = { type: action, rewardId: reward.id, revision: ui.revision };
  assert.equal(session.dispatch(command).ok, true); assert.equal(session.readUi().rewards.length, 0);
  assert.equal(session.dispatch({ ...command, revision: session.readUi().revision }).ok, false);
  if (action === 'claim-reward') assert.equal(session.exportSave().run.player.items.find(([id]) => id === 'yamato')[1], 1);
  else assert.equal(session.readUi().players[0].materials, money + reward.sellValue);
});
