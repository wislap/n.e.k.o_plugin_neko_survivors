import test from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../../src/game/math/random.ts';
import { World } from '../../src/game/world/world.ts';
import { Player } from '../../src/game/actors/player.ts';
import { PurgeField, PURGE_RULES } from '../../src/game/encounters/purge-field.ts';
import { createEncounter } from '../../src/game/encounters/index.ts';
import { createController } from '../../src/game/encounters/controllers.ts';
import { createChallengeSession } from '../../src/game/encounters/challenge-session.ts';
import { CARD_POOL, EXTRA_SPELLS, FLANDRE_MAX_HP } from '../../src/game/encounters/flandre-definition.ts';
import { SPELLS } from '../../src/game/encounters/flandre-patterns.ts';
import { REMILIA_CARDS_INFO } from '../../src/game/encounters/remilia.ts';
import { WeatherSystem } from '../../src/game/encounters/weather.ts';
import { CometDisaster } from '../../src/game/encounters/comet.ts';
import { leaveChallenge } from '../../src/game/battle/challenge-entry.ts';
import { WEATHER_DEFS } from '../../src/game/content/weather.ts';

function setup(kind, seed = 19) {
  const rng = new RNG(seed), events = [], outcomes = [];
  const effects = { emit: event => events.push(event) };
  const world = new World(rng, { effects }), player = new Player('yui', rng, effects);
  world.player = player; player.world = world;
  player.invuln = 1e9;
  player.takeDamage = () => ({ blocked: true, dmg: 0 }); // Survival harness; damage semantics checked separately.
  const controller = kind ? createController(kind, { rng, world, player, effects, onDone: event => outcomes.push(event) }) : null;
  const challenge = controller ? createChallengeSession(controller, world) : null;
  world.challenge = challenge;
  return { rng, effects, events, outcomes, world, player, controller, challenge };
}
function advance(state, seconds, inspect = () => {}) {
  for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) {
    const controller = state.controller;
    state.challenge?.advance(1 / 60);
    state.world.update((controller?.timeScale ?? 1) / 60, state.player, frame / 60);
    inspect(controller);
    if (controller?.over) break;
  }
}

test('Flandre complete prologue, four time-limited cards, three Extra cards and survival result', () => {
  const state = setup('flandre');
  const phases = new Set(), cards = new Set();
  advance(state, 250, fight => { phases.add(fight.phase); if (fight.spell) cards.add(fight.spell.id); });
  assert.deepEqual([...phases], ['prologue', 'cards', 'extra', 'done']);
  for (const card of EXTRA_SPELLS) assert.ok(cards.has(card), card);
  assert.ok(cards.has('prologue'));
  assert.equal([...cards].filter(card => CARD_POOL.includes(card)).length, 4);
  assert.equal(state.outcomes[0].outcome, 'beat');
  assert.equal(state.outcomes.length, 1);
  assert.ok(state.events.some(event => event.type === 'music' && event.track === 'flandre_ex'));
  state.controller.finish('death');
  assert.equal(state.outcomes.length, 1, 'finish is idempotent');
});

test('every Flandre attack script emits real projectiles or collision lasers without browser globals', () => {
  for (const id of Object.keys(SPELLS)) {
    const state = setup('flandre');
    const fight = state.controller;
    fight._spawnFlandre();
    fight.lockLeft = 0;
    fight._beginSpell(id, 30);
    for (let i = 0; i < 300; i++) {
      fight._tickSpell(1 / 60);
      state.world.update(1 / 60, state.player, i / 60);
    }
    assert.ok(state.world.enemyBullets.items.length > 0 || fight.spell.st.lasers?.length > 0, id);
    const view = fight.readFrame();
    assert.equal(view.encounter.cardId, id);
    assert.ok(view.actors.every(actor => Number.isFinite(actor.x) && Number.isFinite(actor.y)));
  }
});

test('Flandre damage floors prevent skipping cards/EP; extra death is a distinct reward outcome', () => {
  const state = setup('flandre'), fight = state.controller;
  fight._spawnFlandre(); fight.lockLeft = 0;
  fight.boss.takeDamage(1e9, { pierceArmor: true });
  assert.ok(fight.boss.hp >= FLANDRE_MAX_HP * 0.8);
  assert.equal(fight.boss.dead, false);
  fight._enterExtra();
  const before = fight.boss.hp;
  assert.equal(fight.boss.takeDamage(1e9).blocked, true);
  assert.equal(fight.boss.hp, before);
  state.player.dead = true; fight.update(1 / 60);
  assert.deepEqual(state.outcomes, [{ kind: 'flandre', outcome: 'extraDeath' }]);
});

test('challenge bodies apply their own card gate and never construct ordinary enemy behavior', () => {
  const state = setup('flandre'), fight = state.controller;
  fight._spawnFlandre();
  const boss = fight.boss;
  assert.equal('bossPhase' in boss, false);
  assert.equal('attackCooldown' in boss, false);
  assert.equal(Object.hasOwn(boss, 'takeDamage'), false);
  const hp = boss.hp;
  assert.equal(boss.takeDamage(1e9).blocked, true, 'card transition blocks damage');
  assert.equal(boss.hp, hp);
  fight.lockLeft = 0;
  const hit = boss.takeDamage(1e9, { pierceArmor: true });
  assert.equal(hit.dealt, FLANDRE_MAX_HP * .2);
  assert.equal(boss.hp, FLANDRE_MAX_HP * .8);
  assert.equal(boss.dead, false);
  assert.equal(boss.takeDamage(1).blocked, true, 'the current card floor owns the remaining HP');
  fight._nextCard(); fight.lockLeft = 0;
  const nextHp = boss.hp;
  assert.ok(boss.takeDamage(100).dealt > 0, 'the next card accepts damage at its own floor');
  assert.ok(boss.hp < nextHp);
  fight._enterExtra();
  assert.equal(boss.takeDamage(1e9).blocked, true, 'Extra cannot die through ordinary damage');
  assert.equal(boss.dead, false);
});

test('Flandre body retains contact damage, stun suppression and Four of a Kind contact removal', () => {
  const state = setup('flandre'), fight = state.controller;
  fight._spawnFlandre(); fight.lockLeft = 0;
  const boss = fight.boss, player = state.player;
  player.takeDamage = Player.prototype.takeDamage.bind(player);
  player.invuln = 0; player.stats.values.dodge = 0; player.stats.values.armor = 0;
  boss.x = player.x = 0; boss.y = player.y = 0;
  const hp = player.hp;
  boss.update(0, player, state.world);
  assert.ok(player.hp < hp, 'a controlled body still resolves real contact');
  player.invuln = 0; boss.stun = 1;
  const stunnedHp = player.hp;
  boss.update(.01, player, state.world);
  assert.equal(player.hp, stunnedHp, 'stun skips contact at the existing world update position');
  boss.stun = 0;
  fight._beginSpell('fourkind', 30); fight._tickSpell(0);
  assert.equal(boss.damage, 0);
  boss.update(0, player, state.world);
  assert.equal(player.hp, stunnedHp);
  fight._removeClones();
  assert.ok(boss.damage > 0, 'the following card restores body contact');
});

test('Vergil owns intro immunity, accumulated locks and real/world clock ordering', () => {
  const state = setup('vergil'), fight = state.controller, boss = fight.boss;
  assert.equal('bossPhase' in boss, false);
  assert.equal('attackCooldown' in boss, false);
  assert.equal(Object.hasOwn(boss, 'takeDamage'), false);
  assert.equal(boss.readGuard().invulnerable, true);
  const hp = boss.hp;
  assert.equal(boss.takeDamage(4000).blocked, true);
  assert.equal(boss.hp, hp);
  advance(state, 9.1);
  assert.equal(boss.readGuard().invulnerable, false);
  assert.equal(boss.takeDamage(4000, { pierceArmor: true }).dealt, 4000);
  fight.update(0);
  assert.equal(boss.readGuard().invulnLeft, 1, 'two 2000-damage steps add two half-second locks');
  assert.equal(boss.takeDamage(100).blocked, true);
  fight.update(.1);
  assert.ok(Math.abs(boss.readGuard().invulnLeft - .9) < 1e-10, 'controller uses real time');
  state.world.update(.02, state.player, 0);
  assert.ok(Math.abs(boss.readGuard().invulnLeft - .88) < 1e-10, 'body lock then uses scaled world time');
  boss.hp = 43000; fight.update(0);
  assert.equal(fight.phase, 2);
  assert.ok(boss.readGuard().invulnLeft >= 5);
  boss.hp = 20000; fight.update(0);
  assert.equal(fight.phase, 3);
  assert.equal(boss.readGuard().invulnLeft, 5, 'P3 protection owns a fresh five-second performance lock');
  assert.equal(fight.timeScale, .2);
});

test('Flandre manual purge consumes cooldown and removes actual nearby bullets', () => {
  const state = setup('flandre'), fight = state.controller;
  const bullet = state.world.spawnEnemyBullet({ x: 100, y: 0, angle: 0, speed: 1, damage: 1, radius: 6, range: 400, hitProfile: fight.hitProfile });
  fight._hinted = true;
  fight.tryManualPurge();
  assert.ok(fight.purgeCd > 14);
  fight.purge.advance(.2);
  assert.equal(bullet.dead, true, 'the purge itself clears the valid projectile before collision/sweep');
  advance(state, 1);
  assert.equal(state.world.enemyBullets.items.length, 0);
});

test('Vergil executes every skill, damage locks, P3 slow-motion ultimate and seek exactly once', () => {
  const state = setup('vergil'), fight = state.controller;
  advance(state, 10);
  assert.equal(fight.chairVisible, true);
  assert.equal(fight.boss.readGuard().invulnerable, false);
  const skills = new Set();
  advance(state, 35, value => { if (value.skill?.name) skills.add(value.skill.name); });
  assert.ok(skills.size >= 2);
  fight.boss.hp = 43000; fight.update(1 / 60); assert.equal(fight.phase, 2);
  fight.boss.hp = 20000; fight.update(1 / 60); assert.equal(fight.phase, 3);
  const scales = new Set();
  advance(state, 20, value => scales.add(value.timeScale));
  assert.ok(scales.has(0.2)); assert.ok(scales.has(0.05)); assert.ok(scales.has(1));
  assert.ok(state.events.some(event => event.type === 'sound' && event.name === 'vergil_ult'));
  assert.equal(state.events.filter(event => event.type === 'music' && event.position === 120).length, 1);
  fight.boss.hp = 0; advance(state, 2);
  assert.deepEqual(state.outcomes, [{ kind: 'vergil', outcome: 'beat' }]);
});

test('Vergil timeout and team death have no victory outcome', () => {
  const timed = setup('vergil'); advance(timed, 105);
  assert.deepEqual(timed.outcomes, [{ kind: 'vergil', outcome: 'timeout' }]);
  const dead = setup('vergil'); advance(dead, 10); dead.player.dead = true; advance(dead, 1);
  assert.deepEqual(dead.outcomes, [{ kind: 'vergil', outcome: 'death' }]);
});

test('Remilia visits all six original cards, opposing actor positions, outro and completion', () => {
  const state = setup('remilia'), cards = new Set(); let opposing = false;
  advance(state, 70, fight => {
    if (fight.cardIdx >= 0) cards.add(fight.cardIdx);
    if (fight.phase === 'cards' && fight.b.flandre.x * fight.b.remilia.x < 0) opposing = true;
  });
  assert.equal(cards.size, REMILIA_CARDS_INFO.length);
  assert.ok(opposing);
  assert.deepEqual(state.outcomes, [{ kind: 'remilia', outcome: 'done' }]);
});

test('Halloween preserves every section, split, tracking claws, candies and timed victory', () => {
  const state = setup('halloween'), fight = state.controller;
  const sections = new Set(); let split = false, claws = false, candies = false;
  advance(state, 120, value => {
    sections.add(value.sections[value.phaseIdx]?.name);
    split ||= !value.merged;
    claws ||= (value._claws?.length ?? value.claws?.length ?? 0) > 0;
    candies ||= (value._candies?.length ?? 0) > 0;
    const view = value.readFrame();
    assert.equal(view.encounter.kind, 'halloween');
  });
  for (const section of fight.sections) assert.ok(sections.has(section.name), section.name);
  assert.ok(split); assert.ok(claws); assert.ok(candies);
  assert.deepEqual(state.outcomes, [{ kind: 'halloween', outcome: 'beat' }]);
});

test('semantic projections copy positions rather than expose mutable world entities', () => {
  const state = setup('vergil'); advance(state, 10);
  const view = state.controller.readFrame();
  view.encounter.boss.x = 999999;
  assert.notEqual(state.controller.boss.x, 999999);
});

test('all ten weather types retain flags and lifecycle; challenges block weather', () => {
  const state = setup();
  for (const definition of WEATHER_DEFS) {
    const weather = new WeatherSystem(state.rng);
    const pick = weather.rng.int; weather.rng.int = () => WEATHER_DEFS.indexOf(definition);
    weather._start(state.player); weather.rng.int = pick;
    assert.equal(weather.id, definition.id);
    for (let i=0;i<120;i++) weather.update(1/60,state.world,state.player);
    assert.equal(weather.phase, 'active');
    if (definition.id === 'typhoon') assert.equal(weather.typhoons.length, 4);
    if (definition.id === 'riverFog') assert.equal(weather.fogClouds.length, 8);
    weather.forceEnd();
    for (let i=0;i<180;i++) weather.update(1/60,state.world,state.player);
    assert.notEqual(weather.phase, 'active');
  }
  for (const kind of ['flandre','vergil','remilia','halloween']) {
    const challenge = createEncounter(kind, state);
    assert.ok(WeatherSystem.blocked(state.world));
    challenge.dispose();
    assert.equal(state.world.challenge, null);
  }
});

test('comet runs every original phase, freezes during roar and applies nonlethal disaster damage', () => {
  const state = setup(), comet = new CometDisaster({ rng: state.rng, effects: state.effects });
  assert.ok(comet.roll(6,state.rng,true));
  const phases = new Set(); let freeze = false;
  const context = { world:state.world, rng:state.rng, speak: text => state.events.push({type:'speech',text}) };
  for (let i=0;i<2400;i++) {
    const frozen = comet.update(1/60, context); freeze = freeze || frozen;
    phases.add(comet.phase);
    if (comet.phase === 'done') break;
  }
  for (const phase of ['idle','banner','gap1','fly1','gap2','fly2','gap3','dive','boom','roar','takeoff','done']) assert.ok(phases.has(phase),phase);
  assert.ok(freeze); assert.ok(state.player.hp >= 1); assert.ok(state.player.hp < state.player.maxHp);
  assert.equal(comet.roll(7,state.rng,true),false);
  comet.onWaveEnd(); assert.equal(comet.pending,false);
});

test('each Vergil skill produces its corresponding live attack geometry', () => {
  for (const [index, name] of ['triple','dash','aoe','sphere','mirage'].entries()) {
    const state = setup('vergil'), fight = state.controller;
    advance(state, 9.1);
    const random = fight.rng.next;
    fight.rng.next = () => (index + 0.01) / 5;
    fight._pickSkill();
    fight.rng.next = random;
    assert.equal(fight.skill.name, name);
    let active = false;
    advance(state, 4, value => {
      active ||= name === 'triple' ? value.waves.length > 0 : name === 'dash' ? value.dashes.length > 0
        : name === 'aoe' ? value.aoe !== null : name === 'sphere' ? value.rifts.length > 0 : value.mirage !== null;
    });
    assert.ok(active, name);
  }
});

test('Vergil damage ignores armour/evasion/invulnerability but honors the 0.2 second internal cooldown', () => {
  const state = setup('vergil'), fight = state.controller;
  state.player.takeDamage = Player.prototype.takeDamage.bind(state.player);
  state.player.stats.values.armor = 1e6;
  state.player.stats.values.dodge = 100;
  const hp = state.player.hp;
  assert.ok(fight._hitPlayer());
  assert.ok(state.player.hp < hp);
  assert.ok(Math.abs((hp - state.player.hp) - state.player.maxHp * 0.05) <= 1);
  const after = state.player.hp;
  assert.equal(fight._hitPlayer(), false);
  assert.equal(state.player.hp, after);
});

test('Remilia and Halloween team death return failure, while dispose never awards a result', () => {
  for (const kind of ['remilia', 'halloween']) {
    const state = setup(kind); advance(state, 5); state.player.dead = true; advance(state, 1);
    assert.deepEqual(state.outcomes, [{ kind, outcome: 'death' }]);
    const abandoned = setup(kind); abandoned.challenge.dispose();
    assert.equal(abandoned.outcomes.length, 0);
    assert.equal(abandoned.world.challenge, null);
  }
});


test('shared purge owns cooldown, manual invulnerability, filtered radius and automatic-hit differences', () => {
  const { world, player } = setup();
  player.invuln = 0;
  const calls = { ready: 0, cooldown: 0, sounds: 0, shake: 0 };
  const profile = { hit: () => 0 }, anotherProfile = { hit: () => 0 };
  const purge = new PurgeField({ world, player, accepts: bullet => bullet.hitProfile === profile,
    cues: { play: () => calls.sounds++ }, shake: () => calls.shake++,
    onReady: () => calls.ready++, onCooldown: () => calls.cooldown++ });
  const allowed = world.spawnEnemyBullet({ x: 100, y: 0, angle: 0, speed: 0, damage: 1, radius: 6, range: 400, hitProfile: profile });
  const other = world.spawnEnemyBullet({ x: 100, y: 0, angle: 0, speed: 0, damage: 1, radius: 6, range: 400, hitProfile: anotherProfile });
  const outside = world.spawnEnemyBullet({ x: 300, y: 0, angle: 0, speed: 0, damage: 1, radius: 6, range: 400, hitProfile: profile });
  assert.equal(purge.manual(), true); assert.equal(player.invuln, PURGE_RULES.manualInvulnerability);
  assert.equal(purge.cooldown, PURGE_RULES.cooldown);
  assert.equal(purge.manual(), false); assert.equal(calls.cooldown, 1);
  purge.advance(.2);
  assert.equal(allowed.dead, true); assert.equal(other.dead, false); assert.equal(outside.dead, false);
  purge.advance(PURGE_RULES.cooldown);
  assert.equal(calls.ready, 1); assert.equal(purge.nova, null);
  player.invuln = 0; purge.start(true);
  assert.equal(purge.cooldown, 0); assert.equal(player.invuln, 0);
  assert.equal(purge.nova.hold, PURGE_RULES.autoHold);
  assert.equal(calls.shake, 1); assert.equal(calls.sounds, 1);
});


test('challenge restrictions belong to its session and disappear together on exit', () => {
  for (const kind of ['flandre', 'vergil', 'remilia', 'halloween']) {
    const state = setup(kind), { challenge, player, world } = state;
    const partner = new Player('yui', state.rng); partner.world = world; world.player2 = partner;
    assert.deepEqual(challenge.playerRules(player), { blocksHealing: true,
      blocksAttack: kind === 'flandre' || kind === 'vergil',
      speedMultiplier: kind === 'flandre' || kind === 'remilia' ? 1.2 : null });
    assert.equal(challenge.playerRules(partner).blocksAttack, false);
    player.hp = 1; assert.equal(player.heal(5), 0);
    if (kind === 'flandre') advance(state, 39);
    if (kind === 'vergil') advance(state, 10);
    assert.equal(challenge.playerRules(player).blocksAttack, false);
    leaveChallenge(challenge, world);
    player.hp = 1; assert.equal(player.heal(5), 5);
    assert.equal(world.challenge, null);
  }
});

test('Flandre projectiles read current max HP, pilot buff and teaching reduction at collision time', () => {
  const state = setup('flandre'), { player, world, controller: fight, challenge } = state;
  const partner = new Player('yui', state.rng); partner.world = world; world.player2 = partner;
  partner.stats.addFlat('maxHp', 200 - partner.maxHp); partner.hp = 200; partner.invuln = 0;
  const bullet = world.spawnEnemyBullet({ x: partner.x, y: partner.y, angle: 0, speed: 0,
    damage: 0, hitProfile: fight.hitProfile });
  challenge.advance(1 / 60); // Teaching policy starts after this projectile has been emitted.
  partner.pilotBuff = true;
  bullet.update(0, world, [partner]);
  assert.equal(partner.hp, 194, '200 * 22% * pilot 25% * teaching 50%, rounded');
  assert.equal(partner.invuln, 1);
  assert.ok(fight.nova?.auto);
  const lingering = world.spawnEnemyBullet({ x: partner.x, y: partner.y, angle: 0, speed: 0,
    damage: 0, hitProfile: fight.hitProfile });
  fight.t = 38.49; challenge.advance(1 / 60); // The same source now belongs to the formal cards.
  partner.invuln = 0; partner.pilotBuff = false;
  partner.stats.addFlat('maxHp', 100); partner.hp = 300;
  lingering.update(0, world, [partner]);
  assert.equal(partner.hp, 234, '300 * 22%, without the expired teaching/pilot modifiers');
  player.invuln = 0; player.hp = player.maxHp;
  const before = player.hp; fight.hitProfile.hit(player, 0, 0);
  assert.equal(before - player.hp, Math.max(1, Math.round(player.maxHp * .22)));
});

test('challenge profiles preserve direct-hit gates, shield bypass and callback-before-downed ordering', () => {
  for (const kind of ['flandre', 'remilia', 'halloween']) {
    const { player, controller } = setup(kind);
    player.invuln = 0; player.stats.addFlat('maxHp', 100 - player.maxHp); player.hp = 100;
    player.shield = 500; player.stats.addFlat('armor', 100000); player.stats.addFlat('dodge', 100);
    let ordinary = 0; player.takeDamage = () => { ordinary++; return { dmg: 0 }; };
    const expected = kind === 'flandre' ? 22 : 10;
    assert.equal(controller.hitProfile.hit(player, 0, 0), expected);
    assert.equal(player.hp, 100 - expected); assert.equal(player.shield, 500); assert.equal(ordinary, 0);
    assert.equal(controller.hitProfile.hit(player, 0, 0), 0, 'one second invulnerability is shared');
    player.invuln = 0; player.downed = true; player.hp = 100;
    assert.equal(controller.hitProfile.hit(player, 0, 0), kind === 'halloween' ? 10 : 0,
      'Halloween retains its historical direct-hit downed gate difference');
  }
  for (const kind of ['flandre', 'remilia']) {
    const { player, controller } = setup(kind); player.invuln = 0; player.hp = 1; player.duoMode = true;
    let downedAtPurge;
    controller.autoPurge = () => { downedAtPurge = player.downed; };
    controller.hitProfile.hit(player, 0, 0);
    assert.equal(downedAtPurge, false); assert.equal(player.downed, true);
  }
});
