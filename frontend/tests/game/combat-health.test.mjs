import test from 'node:test';
import assert from 'node:assert/strict';
import { receiveDamage, receiveDirectHit, addPlayerShield, healPlayer, rescuePlayer } from '../../src/game/combat/player-health.ts';

function fixture(overrides = {}) {
  const state = { hp: 50, shield: 0, maxShield: 0, shieldFullBlock: false, invuln: 0,
    hurtFlash: 0, shieldFlash: 0, damageTaken: 0, dead: false, downed: false, duoMode: false,
    downCount: 0, rescueProgress: 0, _rescueIdle: 0, _rescueGate: 0, lsBudget: 10, ...overrides };
  const calls = [];
  const hooks = {
    tryLethalSave: () => false,
    onHealthDamage: () => calls.push('health-damage'), onShieldBreak: () => calls.push('shield-break'),
    onHurt: damage => calls.push(['hurt', damage, state.hp]), onDodge: () => calls.push('dodge'),
    onDeath: () => calls.push('death'), onDown: () => calls.push('down'), onRevive: () => calls.push('revive'),
    onKnockdown: () => calls.push('knockdown-sound'), onOverheal: amount => calls.push(['overflow', amount]),
  };
  const defense = { avoids: () => false, modify: damage => damage, invulnerability: () => .8 };
  return { state, hooks, defense, calls };
}

test('ordinary full-block shields and fixed hits retain different absorption without duplicating the health commit', () => {
  const ordinary = fixture({ shield: 1, shieldFullBlock: true });
  assert.equal(receiveDamage(ordinary.state, 100, 0, 0, {}, ordinary.defense, ordinary.hooks), 100);
  assert.equal(ordinary.state.hp, 50); assert.equal(ordinary.state.shield, 0);
  assert.equal(ordinary.state.damageTaken, 100); assert.equal(ordinary.state.invuln, .8);
  assert.deepEqual(ordinary.calls, ['shield-break', ['hurt', 100, 50]]);

  const fixed = fixture({ shield: 1, shieldFullBlock: true });
  assert.equal(receiveDamage(fixed.state, 100, 0, 0, { fixedDamage: 10 }, fixed.defense, fixed.hooks), 10);
  assert.equal(fixed.state.hp, 41); assert.equal(fixed.state.invuln, 0);
  assert.deepEqual(fixed.calls, ['shield-break', 'health-damage', ['hurt', 10, 41]]);
});

test('damage notification precedes the lethal decision and may synchronously restore health', () => {
  const { state, hooks, defense, calls } = fixture({ hp: 5 });
  hooks.onHurt = damage => { calls.push(['hurt', damage, state.hp]); state.hp += 10; };
  receiveDamage(state, 9, 0, 0, {}, defense, hooks);
  assert.equal(state.hp, 6); assert.equal(state.dead, false);
  assert.deepEqual(calls, ['health-damage', ['hurt', 9, -4]]);
});

test('direct profiles ignore shield/character defense and notify their owner before life-state submission', () => {
  const { state, hooks, calls } = fixture({ hp: 5, shield: 100, duoMode: true });
  receiveDirectHit(state, { damage: 10, sourceX: 2, sourceY: 3, invulnerabilitySeconds: 1,
    ignoreDowned: false, onApplied: () => calls.push(['applied', state.hp, state.downed]) }, hooks);
  assert.equal(state.shield, 100); assert.equal(state.hp, 0); assert.equal(state.downed, true);
  assert.equal(state.dead, false); assert.equal(state.downCount, 1); assert.equal(state.invuln, 1.5);
  assert.deepEqual(calls, [['applied', -5, false], 'knockdown-sound', 'down']);
});

test('the explicit direct-hit downed policy preserves Halloween acceptance and other profiles rejection', () => {
  const { state, hooks } = fixture({ hp: 0, downed: true, duoMode: true, downCount: 1 });
  const hit = { damage: 10, sourceX: 0, sourceY: 0, invulnerabilitySeconds: 1, ignoreDowned: false };
  assert.equal(receiveDirectHit(state, hit, hooks), 0);
  assert.equal(state.downCount, 1); assert.equal(state.damageTaken, 0);
  assert.equal(receiveDirectHit(state, { ...hit, ignoreDowned: true }, hooks), 10);
  assert.equal(state.downCount, 2); assert.equal(state.rescueProgress, 10);
});

test('ordinary death notifies while direct profile death keeps its existing silent receipt', () => {
  const ordinary = fixture({ hp: 1 }), direct = fixture({ hp: 1 });
  receiveDamage(ordinary.state, 2, 0, 0, {}, ordinary.defense, ordinary.hooks);
  receiveDirectHit(direct.state, { damage: 2, sourceX: 0, sourceY: 0, invulnerabilitySeconds: 1, ignoreDowned: false }, direct.hooks);
  assert.equal(ordinary.state.dead, true); assert.equal(direct.state.dead, true);
  assert.equal(ordinary.calls.at(-1), 'death'); assert.deepEqual(direct.calls, []);
});

test('healing overflow, shield replacement and rescue use the same independently owned health state', () => {
  const { state, hooks, calls } = fixture({ hp: 48 });
  assert.equal(healPlayer(state, 10, 50, hooks), 2);
  assert.deepEqual(calls, [['overflow', 8]]);
  assert.equal(addPlayerShield(state, 20, true), 20);
  assert.equal(addPlayerShield(state, 10, true), 0);
  assert.equal(addPlayerShield(state, 10, false), 10);
  assert.equal(state.maxShield, 30);
  state.downed = true; state.hp = 0; state.downCount = 1; state.rescueProgress = .4;
  assert.equal(rescuePlayer(state, 50, hooks), true);
  assert.equal(state.hp, 15); assert.equal(state.invuln, 2); assert.equal(state.downed, false);
  assert.equal(calls.at(-1), 'revive');
});

test('the character proposes lethal protection while health owns the protected HP commit and existing statistic', () => {
  const { state, hooks, defense, calls } = fixture({ hp: 5 });
  hooks.tryLethalSave = (x, y) => { calls.push(['protection', x, y, state.hp]); state.invuln = 3.5; return true; };
  assert.equal(receiveDamage(state, 20, 7, 9, {}, defense, hooks), 20);
  assert.equal(state.hp, 1); assert.equal(state.damageTaken, 0); assert.equal(state.dead, false);
  assert.equal(state.invuln, 3.5); assert.equal(state.hurtFlash, 0);
  assert.deepEqual(calls, [['protection', 7, 9, 5], ['hurt', 20, 1]]);
});

test('Player reuses live health dependencies and does not inspect defense stats for blocked hits', async () => {
  const { Player } = await import('../../src/game/actors/player.ts');
  const { CharRuntime } = await import('../../src/game/actors/character-skills.ts');
  const { RNG } = await import('../../src/game/math/random.ts');
  const player = new Player('mimi', new RNG(69));
  const reads = [], notifications = [];
  const readStat = player.stats.get.bind(player.stats);
  player.stats.get = key => { reads.push(key); return readStat(key); };
  for (const block of ['invuln', 'dead', 'downed']) {
    player.invuln = block === 'invuln' ? 1 : 0;
    player.dead = block === 'dead'; player.downed = block === 'downed';
    assert.equal(player.takeDamage(2, 0, 0), 0);
    assert.deepEqual(reads, [], `${block} never evaluates defense stats`);
  }
  player.invuln = 0; player.dead = false; player.downed = false;
  player.charRt.onShieldBreak = () => assert.fail('a retired character runtime cannot receive the notification');
  player.charRt = new CharRuntime(player);
  player.charRt.onShieldBreak = () => notifications.push('character-shield');
  player.charRt.onHurt = () => notifications.push('character-hurt');
  player.onShieldBreak = () => notifications.push('observer-shield');
  player.onHurt = () => notifications.push('observer-hurt');
  player.rng = { next: () => .99 }; // The live RNG reference is read after construction too.
  player.shield = 1;
  assert.equal(player.takeDamage(2, 0, 0, { fixedDamage: 2, ignoreIFrames: true }), 2);
  assert.deepEqual(reads, ['dodge'], 'fixed damage retains the dodge read and skips armor/multiplier reads');
  assert.deepEqual(notifications, ['character-shield', 'observer-shield', 'character-hurt', 'observer-hurt']);
});
