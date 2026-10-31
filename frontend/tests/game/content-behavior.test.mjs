import test from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../../src/game/math/random.ts';
import { World } from '../../src/game/world/world.ts';
import { Player } from '../../src/game/actors/player.ts';
import { Pet } from '../../src/game/actors/pet.ts';
import { Shop, ShopOffer } from '../../src/game/progression/shop.ts';
import { getWeapon } from '../../src/game/content/weapons.ts';
import { getItem } from '../../src/game/content/items.ts';
import { WeaponInstance } from '../../src/game/actors/weapon.ts';
import { Turret } from '../../src/game/actors/turret.ts';
import { Pickup } from '../../src/game/actors/pickup.ts';
import { SessionEngine } from '../../src/game/session-engine.ts';
import { settleWave } from '../../src/game/progression/wave-settlement.ts';
import { createEncounter } from '../../src/game/encounters/index.ts';
import { createGameSession, EMPTY_INPUT } from '../../src/game/index.ts';

// These are bounded trigger fixtures, not campaign-strength changes. Real entities,
// damage/collection paths and rule clocks run unchanged. A large target HP pool
// lets successive hits be observed without a kill terminating the scenario.
const idle = { moveAxis: () => ({ x: 0, y: 0 }), isDown: () => false };
const right = { ...idle, moveAxis: () => ({ x: 1, y: 0 }) };
const options = { characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69, pilot: false };
function close(actual, expected, message = '') { assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`); }
function setup(character = 'yui') {
  const rng = new RNG(69), events = [], effects = { emit: event => events.push(event) };
  const world = new World(rng, { effects }), player = new Player(character, rng, effects);
  player.id = 1; player.world = world; player.weapons = []; world.player = player;
  world.waves.setDifficulty('normal'); world.waves.begin(0); world.noSpawn = true;
  rng.next = () => .99; // No ordinary crit, dodge, lucky proc or extra follow-up.
  return { rng, world, player, events };
}
function target(state, x = 80, y = 0) {
  const enemy = state.world.waves.spawnEnemyById('slime', x, y);
  enemy.hp = enemy.maxHp = 100000;
  state.world.grid.insert(enemy);
  return enemy;
}
function weapon(id = 'cat_paw') { return new WeaponInstance(getWeapon(id)); }
function attack(state, enemy, instance = weapon(), extra = {}) {
  const before = enemy.hp;
  state.world.dealDamage(state.player, instance, enemy, instance.computeDamage(state.player), { pierceArmor: true, ...extra });
  return before - enemy.hp;
}
function ordinaryHit(state, enemy, amount = 10, extra = {}) {
  const before = enemy.hp;
  state.world.dealDamage(state.player, weapon(), enemy, amount, { pierceArmor: true, ...extra });
  return before - enemy.hp;
}
function fire(state, id, enemy) {
  const instance = weapon(id);
  if (instance.def.kind === 'turret') new Turret(instance.def, 0, 0, instance, state.player).update(1, state.world);
  else instance._fire(state.player, state.world, enemy);
  const bullet = state.world.bullets.items.at(-1);
  assert.ok(bullet, `${id} fired a real projectile`);
  return bullet;
}
function teammate(state, id, character = 'mimi') {
  const player = new Player(character, state.rng); player.id = id; player.world = state.world; player.weapons = [];
  player.duoMode = true; state.player.duoMode = true; state.world[`player${id}`] = player;
  return player;
}

test('Yui earns actual XP/round income and her once-per-round lethal save expires and resets', () => {
  const state = setup(), { player, world } = state;
  player.gainXp(5); close(player.xp, 6);
  const money = player.materials; player.charRt.onRoundEnd(); assert.equal(player.materials - money, 2);
  player.takeDamage(1000, 100, 0, { ignoreIFrames: true });
  assert.equal(player.hp, 1); assert.equal(player.dead, false);
  player.update(.1, idle, world); assert.ok(player.x < 0, 'backflip moves away from the real damage source');
  for (let i = 0; i < 37; i++) player.update(.1, idle, world);
  assert.equal(player.speedBonusMul, 1); assert.equal(player._backflip, null);
  player.takeDamage(1000, 100, 0, { ignoreIFrames: true });
  assert.equal(player.dead, true, 'the same round cannot save a second lethal hit');
  const next = setup(); next.player.takeDamage(1000, 100, 0, { ignoreIFrames: true });
  next.world.waves.begin(1); next.player.charRt.onRoundStart();
  next.player.takeDamage(1000, 100, 0, { ignoreIFrames: true });
  assert.equal(next.player.dead, false);
});

test('Mimi melee follow-up deals its second real hit, heals five HP, and cannot recursively follow itself', () => {
  const state = setup('mimi'), enemy = target(state);
  state.player.hp = 3;
  const normal = ordinaryHit(state, enemy);
  state.rng.next = () => .05;
  close(ordinaryHit(state, enemy), normal * 3); // First hit plus its 200% follow-up.
  close(state.player.hp, 8);
  state.world.dealDamage(state.player, weapon('pebble_toss'), enemy, 10, { pierceArmor: true });

  state.rng.next = () => .99;
  for (const [id, ratio] of [['cat_paw', 1.2], ['pebble_toss', .8]]) {
    const instance = weapon(id), empowered = attack(state, enemy, instance);
    const modifiers = state.player.charMul; state.player.charMul = {};
    const neutral = attack(state, enemy, instance); state.player.charMul = modifiers;
    close(empowered / neutral, ratio, `${id} specialization reaches actual HP loss`);
  }
});

test('Luna projectile damage uses impact-time distance and her ranged/element specialization reaches combat', () => {
  const state = setup('luna'), enemy = target(state, 80);
  const bullet = fire(state, 'star_wand', enemy);
  state.player.x = 720; // Move after firing: the impact is now at full bonus distance.
  bullet.x = enemy.x; bullet.y = enemy.y;
  const before = enemy.hp; bullet.checkEnemyHit(state.world);
  close(before - enemy.hp, bullet.damage * 1.4);
  state.player.x = enemy.x;
  close(ordinaryHit(state, enemy), 10, 'standing beside the target removes distance bonus');
  for (const [id, ratio] of [['cat_paw', .8], ['pebble_toss', 1.2], ['star_wand', 1.2]]) {
    const instance = weapon(id), enhanced = attack(state, enemy, instance);
    const modifiers = state.player.charMul; state.player.charMul = {};
    const neutral = attack(state, enemy, instance); state.player.charMul = modifiers;
    close(enhanced / neutral, ratio);
  }
});

test('Shiro hurt stacks change actual damage/movement, refresh on hurt, expire after five seconds and reset each round', () => {
  const state = setup('shiro'), enemy = target(state), instance = weapon();
  const base = attack(state, enemy, instance);
  state.player.update(.01, right, state.world); const speed = state.player.curSpeed;
  const money = state.player.materials;
  for (let i = 0; i < 2; i++) state.player.takeDamage(1, 100, 0, { ignoreIFrames: true });
  close(attack(state, enemy, instance) / base, 1.1);
  state.player.update(.01, right, state.world); close(state.player.curSpeed / speed, 1.1);
  assert.equal(state.player.materials - money, 2);
  state.player.charRt.update(4, state.world);
  state.player.takeDamage(1, 100, 0, { ignoreIFrames: true });
  state.player.charRt.update(4, state.world); close(attack(state, enemy, instance) / base, 1.15);
  state.player.charRt.update(1.01, state.world); close(attack(state, enemy, instance), base);
  assert.equal(state.player.materials - money, 3, 'expiry never removes earned currency');
  state.player.takeDamage(1, 100, 0, { ignoreIFrames: true });
  state.player.charRt.onRoundStart(); close(attack(state, enemy, instance), base);
});

test('Nana lucky attacks/guards affect actual health, chance caps at 30%, and luck pays real round income', () => {
  const state = setup('nana'), enemy = target(state);
  state.rng.next = () => .12; close(ordinaryHit(state, enemy), 15);
  state.rng.next = () => .14; close(ordinaryHit(state, enemy), 10);
  state.player.invuln = 0; state.rng.next = () => .05;
  const hp = state.player.hp; state.player.takeDamage(4, 100, 0);
  close(hp - state.player.hp, 2);
  state.player.stats.addPct('luck', 1000);
  state.rng.next = () => .29; close(ordinaryHit(state, enemy), 15);
  state.rng.next = () => .31; close(ordinaryHit(state, enemy), 10);
  const lucky = setup('nana'), neutral = setup('nana'); neutral.player.stats.addPct('luck', -35);
  settleWave(lucky.world, 0); settleWave(neutral.world, 0);
  assert.equal(lucky.player.materials - neutral.player.materials, 3);
});

test('Kuro curses only in-range living enemies, throttles/reapplies without stacking, and debuffs expire', () => {
  const state = setup('kuro'), near = target(state, 60), far = target(state, 700), dead = target(state, 50);
  dead.dead = true;
  state.rng.next = () => 0;
  state.player.update(.01, idle, state.world);
  assert.equal(far.curseTimer, 0); assert.equal(dead.curseTimer, 0);
  assert.ok(near.curseTimer > 0);
  // Real enemy movement must slow, rather than only displaying a debuff flag.
  const control = setup('kuro'), normal = target(control, 60);
  state.rng.next = control.rng.next = () => .99;
  const x = near.x, cx = normal.x;
  near.update(.1, state.player, state.world); normal.update(.1, control.player, control.world);
  close((x - near.x) / (cx - normal.x), .8);
  state.rng.next = () => 0; state.player.update(2.8, idle, state.world);
  close(near.curseTimer, 4.9);
  state.player.update(.21, idle, state.world);
  close(near.curseTimer, 5);
  assert.equal(near.curseDamageMul, .8); assert.equal(near.curseSpeedMul, .8); assert.equal(near.curseRateMul, .8);
  state.player.x = 1000; near.update(5.01, state.player, state.world);
  assert.equal(near.curseTimer, 0); assert.equal(near.curseDamageMul, 1); assert.equal(near.curseSpeedMul, 1);
  state.player.charRt.onRoundStart(); assert.equal(state.player.charRt.curseTimers.size, 0);
});

test('Youyi overflow shield caps at 30%, blocks a larger real hit, locks for five seconds and then regains shield', () => {
  const state = setup('youyi'), { player } = state;
  player.heal(1000); close(player.shield, player.maxHp * .3);
  const hp = player.hp;
  player.takeDamage(1000, 100, 0, { ignoreIFrames: true });
  assert.equal(player.shield, 0); assert.equal(player.hp, hp); assert.equal(player.dead, false);
  player.heal(1000); assert.equal(player.shield, 0);
  player.charRt.update(4.99, state.world); player.heal(1000); assert.equal(player.shield, 0);
  player.charRt.update(.02, state.world); player.heal(1000); close(player.shield, player.maxHp * .3);
  player.heal(1000); close(player.shield, player.maxHp * .3, 'overflow cannot stack past the cap');
});

test('Neon actual turret projectiles grow target-specific damage up to 30%, with expiry and round cleanup', () => {
  const state = setup('neon_party'), enemy = target(state), other = target(state, 200);
  function turretHit() {
    const bullet = fire(state, 'toy_turret', enemy);
    bullet.x = enemy.x; bullet.y = enemy.y;
    const before = enemy.hp; bullet.checkEnemyHit(state.world);
    return before - enemy.hp;
  }
  const first = turretHit(); close(turretHit() / first, 1.01);
  for (let i = 0; i < 40; i++) ordinaryHit(state, enemy, 10, { fromTurret: true });
  close(turretHit() / first, 1.3);
  close(ordinaryHit(state, other, 10, { fromTurret: true }), 10, 'another enemy starts with no stacks');
  close(ordinaryHit(state, enemy), 10, 'body weapon damage neither gains nor applies turret stacks');
  state.player.charRt.update(5.01, state.world); close(turretHit(), first);
  state.player.charRt.onRoundStart(); assert.equal(state.player.charRt.turretStacks.size, 0);
});

test('Doctor notes retaliation uses the hurt player armor and actual 300px enemy set', () => {
  const engine = new SessionEngine(); engine.start(options); engine.battle.player.weapons = [];
  engine.rng.next = () => .99;
  engine.battle.player.stats.addFlat('armor', 2); engine.battle.player.addItem('dr_m_notes');
  const state = { world: engine.battle.world }, near = target(state, 100), outside = target(state, 301);
  const nearHp = near.hp, farHp = outside.hp;
  engine.battle.player.invuln = 0; engine.battle.player.takeDamage(1, 100, 0);
  close(nearHp - near.hp, 100); assert.equal(outside.hp, farHp);
  const after = near.hp;
  engine.battle.player.takeDamage(1, 100, 0); assert.equal(near.hp, after, 'blocked repeat hurt does not retaliate again');
});

test('Lobster pillow doubles actual on-hit healing and dynamically multiplies damage by lifesteal', () => {
  const state = setup(), enemy = target(state), instance = weapon();
  state.player.stats.addPct('lifesteal', 10); state.rng.next = () => 0;
  state.player.hp = 5; const plain = attack(state, enemy, instance); close(state.player.hp, 6);
  state.player.addItem('lobster_pillow'); state.player.hp = 5;
  close(attack(state, enemy, instance) / plain, 1.1); close(state.player.hp, 7);
  state.player.stats.addPct('lifesteal', 10);
  close(attack(state, enemy, instance) / plain, 1.2, 'later lifesteal upgrades affect damage without re-equipping');
  createEncounter('remilia', { world: state.world, player: state.player }); const before = state.player.hp;
  attack(state, enemy, instance); assert.equal(state.player.hp, before);
});

test('Cat taffy doubles healing only below half health and respects max HP and challenge healing policy', () => {
  const { player, world } = setup(); player.addItem('cat_taffy');
  player.hp = player.maxHp * .25; const low = player.hp; close(player.heal(2), 4); close(player.hp, low + 4);
  player.hp = player.maxHp * .5; close(player.heal(2), 2);
  player.heal(1000); assert.equal(player.hp, player.maxHp);
  player.hp = 1; createEncounter('remilia', { world, player }); assert.equal(player.heal(2), 0); assert.equal(player.hp, 1);
  close(player.heal(2, { force: true }), 4, 'documented pet-heal exemption still reaches the item');
});

for (const [id, ratios] of [['pebble_toss', [1, .6, .36]], ['star_wand', [1, 1, .6, .36]], ['toy_turret', [1, .6, .36]]]) {
  test(`AP rounds retain native piercing and apply 60 percent decay only to item segments (${id})`, () => {
    const state = setup(); state.player.addItem('ap_round'); state.player.addItem('ap_round');
    const enemies = ratios.map((_, i) => target(state, 40 + i * 70));
    const bullet = fire(state, id, enemies[0]);
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i], before = enemy.hp;
      bullet.x = enemy.x; bullet.y = enemy.y; bullet.checkEnemyHit(state.world);
      close(before - enemy.hp, bullet.damage * ratios[i]);
    }
    assert.equal(bullet.dead, true);
  });
}

test('Overload chip increases subsequent real hits, caps at 30%, and cannot leak to next-wave entities', () => {
  const state = setup(), enemy = target(state); state.player.addItem('overload_chip');
  close(ordinaryHit(state, enemy), 10); close(ordinaryHit(state, enemy), 10.1);
  for (let i = 0; i < 35; i++) ordinaryHit(state, enemy);
  close(ordinaryHit(state, enemy), 13); assert.equal(enemy.debuffTakenPct, 30);
  state.world.waves.begin(1);
  const fresh = target(state); close(ordinaryHit(state, fresh), 10); assert.equal(fresh.debuffTakenPct, 1);
});

test('Lucky cat paw creates exactly one extra real critical hit and its separate guard can fail', () => {
  const state = setup(), enemy = target(state); state.player.addItem('lucky_cat_paw');
  state.player.stats.addPct('critChance', 100); state.rng.next = () => 0;
  close(ordinaryHit(state, enemy), 30, 'two 150% hits, with no recursive re-crit');
  const hp = state.player.hp; state.player.invuln = 0;
  state.rng.next = () => .1; state.player.takeDamage(4, 100, 0); assert.equal(state.player.hp, hp);
  state.rng.next = () => .2; state.player.takeDamage(4, 100, 0); close(hp - state.player.hp, 4);
});


test('remaining character final damage/movement modifiers are consumed by real attacks and movement', () => {
  for (const [character, ratio] of [['shiro', .88], ['youyi', .9], ['neon_party', .8]]) {
    const state = setup(character), enemy = target(state), instance = weapon();
    const specialized = attack(state, enemy, instance);
    const modifiers = state.player.charMul; state.player.charMul = {};
    const neutral = attack(state, enemy, instance); state.player.charMul = modifiers;
    close(specialized / neutral, ratio, character);
  }
  for (const [character, ratio] of [['shiro', .88], ['kuro', 1.2]]) {
    const state = setup(character);
    state.player.update(.01, right, state.world); const specialized = state.player.curSpeed;
    state.player.charMul = {}; state.player.update(.01, right, state.world);
    close(specialized / state.player.curSpeed, ratio, character);
  }
});

test('Kuro extends actual melee reach and accepts the documented extra damage risk', () => {
  for (const character of ['yui', 'kuro']) {
    const state = setup(character), enemy = target(state);
    enemy.x = 68 + enemy.radius; state.world.grid.clear(); state.world.grid.insert(enemy);
    const before = enemy.hp; weapon()._fire(state.player, state.world, enemy);
    assert.equal(enemy.hp < before, character === 'kuro');
  }
  const state = setup('kuro'); state.player.invuln = 0;
  const hp = state.player.hp; state.player.takeDamage(4, 100, 0, { ignoreIFrames: true });
  close(hp - state.player.hp, 4.48);
});

test('Neon specialization changes actual turret damage and shot count without strengthening body attacks', () => {
  const enabled = setup('neon_party'), neutral = setup('neon_party'); neutral.player.charMul = {};
  const a = target(enabled), b = target(neutral);
  const enhancedBullet = fire(enabled, 'toy_turret', a), normalBullet = fire(neutral, 'toy_turret', b);
  enhancedBullet.x = a.x; enhancedBullet.y = a.y; normalBullet.x = b.x; normalBullet.y = b.y;
  const ahp = a.hp, bhp = b.hp;
  enhancedBullet.checkEnemyHit(enabled.world); normalBullet.checkEnemyHit(neutral.world);
  close((ahp - a.hp) / (bhp - b.hp), 1.2);
  function shots(state) {
    const instance = weapon('toy_turret'), turret = new Turret(instance.def, 0, 0, instance, state.player);
    const before = state.world.bullets.length;
    for (let step = 0; step < 120; step++) turret.update(1 / 60, state.world);
    return state.world.bullets.length - before;
  }
  assert.ok(shots(enabled) > shots(neutral));
});

test('pet emergency heal restores the living squad, excludes downed/dead mates, and recharges after fifteen seconds', () => {
  const state = setup(), pet = new Pet('kitten', state.player);
  const mate = teammate(state, 2), downed = teammate(state, 3), dead = teammate(state, 4);
  state.player.hp = state.player.maxHp * .4; mate.hp = mate.maxHp * .3;
  downed.down(); dead.dead = true; dead.hp = 0;
  createEncounter('remilia', { world: state.world, player: state.player }); // Real squad healing restriction, with the documented pet exception.
  const hp = state.player.hp, mateHp = mate.hp;
  const lines = []; state.world.onPetSay = (_pet, _text, kind) => lines.push(kind);
  pet.update(.01, state.player, state.world);
  close(state.player.hp - hp, state.player.maxHp * .2); close(mate.hp - mateHp, mate.maxHp * .2);
  assert.equal(downed.hp, 0); assert.equal(dead.hp, 0); assert.equal(pet.healsGiven, 1);
  assert.deepEqual(lines, ['heal']);
  state.player.takeDamage(state.player.maxHp * .3, 100, 0, { fixedDamage: state.player.maxHp * .3, ignoreIFrames: true });
  const wounded = state.player.hp;
  pet.update(14.9, state.player, state.world); assert.equal(state.player.hp, wounded);
  pet.update(.11, state.player, state.world); assert.equal(pet.healsGiven, 2); assert.ok(state.player.hp > wounded);
});

test('pet vacuum collects real XP/materials in its own radius, leaves healing/outside drops, and honors cooldown', () => {
  const state = setup('mimi'), pet = new Pet('kitten', state.player);
  const xp = new Pickup('xp', pet.x + 100, pet.y, 2);
  const material = new Pickup('material', pet.x + 300, pet.y, 3);
  const heal = new Pickup('heal', pet.x + 100, pet.y, 5);
  const outside = new Pickup('xp', pet.x + 421, pet.y, 1);
  state.world.pickups.add(xp); state.world.pickups.add(material); state.world.pickups.add(heal); state.world.pickups.add(outside);
  pet.vacuumCd = 0;
  const beforeXp = state.player.xp, money = state.player.materials;
  const lines = []; state.world.onPetSay = (_pet, _text, kind) => lines.push(kind);
  pet.update(.01, state.player, state.world);
  assert.equal(xp.dead, true); assert.equal(material.dead, true); assert.equal(heal.dead, false); assert.equal(outside.dead, false);
  close(state.player.xp - beforeXp, 2); assert.equal(state.player.materials - money, 3);
  assert.equal(pet.vacuumsUsed, 1); assert.ok(lines.includes('vacuum'));
  const next = new Pickup('material', pet.x + 200, pet.y, 1); state.world.pickups.add(next);
  pet.update(.01, state.player, state.world); assert.equal(pet.vacuumsUsed, 1); assert.equal(next.dead, false);
});

test('pet vacuum requires six nearby drops during combat and does not waste cooldown below that threshold', () => {
  const state = setup(), pet = new Pet('kitten', state.player); target(state, pet.x + 100, pet.y);
  pet.vacuumCd = 0;
  const drops = Array.from({ length: 5 }, () => new Pickup('material', pet.x - 180, pet.y, 1));
  for (const drop of drops) state.world.pickups.add(drop);
  pet.update(.001, state.player, state.world);
  assert.equal(pet.vacuumsUsed, 0); assert.equal(pet.vacuumCd, 0); assert.ok(drops.every(drop => !drop.dead));
  const last = new Pickup('material', pet.x - 180, pet.y, 1); state.world.pickups.add(last);
  pet.update(.001, state.player, state.world);
  assert.equal(pet.vacuumsUsed, 1); assert.ok([...drops, last].every(drop => drop.dead));
});

test('pet attacks deal real buff-scaled damage and the pet remains invulnerable', () => {
  const state = setup(), pet = new Pet('kitten', state.player), enemy = target(state, 80, pet.y);
  const hp = enemy.hp; pet.update(.01, state.player, state.world);
  const plain = hp - enemy.hp; assert.ok(plain > 0);
  state.player.stats.addPct('damage', 100);
  const before = enemy.hp; pet.update(2, state.player, state.world);
  close(before - enemy.hp, plain * 2); assert.equal(pet.takeDamage(10000), 0); assert.equal(pet.dead, false);
});

test('pet free shop item applies its real stats and sells its stock without charging the wallet', () => {
  const state = setup(), pet = new Pet('kitten', state.player), shop = new Shop(state.rng);
  const offer = new ShopOffer('item', getItem('warm_milk'), 50);
  shop.offers = [offer, new ShopOffer('weapon', getWeapon('cat_paw'), 1)];
  const money = state.player.materials, max = state.player.maxHp, lines = [];
  state.world.onPetSay = (_pet, _text, kind) => lines.push(kind);
  const got = shop.tryStealItem(state.player, { next: () => 0 }); assert.ok(got); pet.sayFreeItem(state.world);
  assert.equal(state.player.hasItem('warm_milk'), true); assert.ok(state.player.maxHp > max);
  assert.equal(offer.sold, true); assert.equal(state.player.materials, money); assert.deepEqual(lines, ['freeItem']);
  assert.equal(shop.tryStealItem(state.player, { next: () => 0 }), null, 'sold stock cannot be granted twice');
  const blocked = new Shop(state.rng); blocked.offers = [new ShopOffer('item', getItem('warm_milk'), 50)];
  assert.equal(blocked.tryStealItem(state.player, { next: () => .99 }), null); assert.equal(blocked.offers[0].sold, false);
});

for (const [rare, health] of [[false, 13], [true, 17]]) test(`real ${rare ? 'rare' : 'ordinary'} medical chest breaks once, heals immediately and grants no kill/loot`, () => {
  const state = setup(); state.player.hp = 5;
  const chest = state.world.waves.spawnChest(state.player, { x: 160, y: 0, rare }); assert.equal(chest.reward.kind, 'heal');
  chest.update(1); assert.equal(chest.x, 160); assert.equal(chest.y, 0);
  state.world.dealDamage(state.player, weapon(), chest, 100, { pierceArmor: true });
  assert.equal(chest.dead, true); assert.equal(state.player.hp, health);
  assert.equal(state.world.pickups.length, 0); assert.equal(state.world.pendingItemRewards.length, 0);
  state.world.dealDamage(state.player, weapon(), chest, 100); assert.equal(state.player.hp, health);
});

test('actual item chest queues a reward for public claim/sale and rejects repeating either settlement', () => {
  const state = setup(); state.rng.next = () => .1;
  const chest = state.world.waves.spawnChest(state.player, { x: 160, y: 0 }); assert.equal(chest.reward.kind, 'item');
  state.world.dealDamage(state.player, weapon(), chest, 100, { pierceArmor: true });
  assert.equal(state.world.pendingItemRewards.length, 1); assert.equal(state.player.items.size, 0);
  const reward = state.world.pendingItemRewards[0]; assert.ok(getItem(reward.id));
  assert.equal(getItem(reward.id).bossDropOnly, undefined); assert.equal(getItem(reward.id).flandreOnly, undefined);
  state.world.dealDamage(state.player, weapon(), chest, 100); assert.equal(state.world.pendingItemRewards.length, 1);
  for (const action of ['claim-reward', 'sell-reward']) {
    const seed = createGameSession(); seed.dispatch({ type: 'start-run', options });
    const save = seed.exportSave(); save.run.phase = 'shop'; save.run.pendingItemRewards = [reward];
    const session = createGameSession({ save }), ui = session.readUi(), money = ui.players[0].materials;
    const command = { type: action, rewardId: ui.rewards[0].id, revision: ui.revision };
    assert.equal(session.dispatch(command).ok, true); assert.equal(session.readUi().rewards.length, 0);
    assert.equal(session.dispatch({ ...command, revision: session.readUi().revision }).ok, false);
    if (action === 'claim-reward') assert.ok(session.exportSave().run.player.items.some(([id]) => id === reward.id));
    else assert.equal(session.readUi().players[0].materials, money + reward.sellValue);
  }
});

test('actual treasure mimic death grants one pending item and uses its distinct treasure kill branch', () => {
  const state = setup(), enemy = state.world.waves.spawnTreasureMimic(state.player, { x: 400, y: 0 });
  assert.ok(enemy.def.treasure);
  state.world.dealDamage(state.player, weapon(), enemy, 100000, { pierceArmor: true });
  assert.equal(enemy.dead, true); assert.equal(state.world.pendingItemRewards.length, 1);
  state.world.dealDamage(state.player, weapon(), enemy, 100000); assert.equal(state.world.pendingItemRewards.length, 1);
});

test('real allied projectiles rescue through 5/10/30 strike tiers, shared cooldown, aggro exclusion and round reset', () => {
  const state = setup(), ally = teammate(state, 2); ally.x = 100;
  function rescue(owner = state.player) {
    const bullet = state.world.spawnBullet({ x: ally.x, y: ally.y, angle: 0, speed: 100, damage: 5, range: 100,
      owner: weapon('pebble_toss'), ownerPlayer: owner, kind: 'ranged' });
    bullet.checkEnemyHit(state.world); return bullet;
  }
  for (const required of [5, 10, 30]) {
    ally.down(); assert.equal(ally.rescueNeed, required); assert.equal(state.world.nearestPlayerTo(100, 0), state.player);
    rescue(ally); assert.equal(ally.rescueProgress, required, 'own projectile cannot self-rescue');
    for (let strike = 0; strike < required; strike++) {
      assert.equal(rescue().dead, true);
      if (strike < required - 1) {
        const progress = ally.rescueProgress; rescue(); assert.equal(ally.rescueProgress, progress);
        ally.update(.21, idle, state.world);
      }
    }
    assert.equal(ally.downed, false); close(ally.hp, Math.round(ally.maxHp * .3));
    assert.equal(state.world.nearestPlayerTo(100, 0), ally);
  }
  settleWave(state.world, 0); assert.equal(ally.downCount, 0); assert.equal(ally.hp, ally.maxHp);
});

test('a real four-player all-downed squad reaches defeat through the public step result', () => {
  const engine = new SessionEngine(); engine.start({ ...options, partySize: 4 }); engine.advance(EMPTY_INPUT);
  for (const player of engine.battle.world.players()) player.down();
  const events = engine.advance(EMPTY_INPUT).events;
  assert.equal(engine.readUi().phase, 'result'); assert.ok(events.some(event => event.type === 'run-ended' && !event.won));
});


test('pet vacuum does not spend an empty cooldown and recharges for the next real collection', () => {
  const state = setup(), pet = new Pet('kitten', state.player); pet.vacuumCd = 0;
  pet.update(.01, state.player, state.world); assert.equal(pet.vacuumCd, 0); assert.equal(pet.vacuumsUsed, 0);
  state.world.pickups.add(new Pickup('material', pet.x + 300, pet.y, 1));
  pet.update(.01, state.player, state.world); assert.equal(pet.vacuumsUsed, 1);
  for (let step = 0; step < 901; step++) pet.update(1 / 60, state.player, state.world);
  assert.ok(pet.vacuumCd <= 0); assert.equal(pet.vacuumsUsed, 1, 'no empty proc while waiting');
  const next = new Pickup('material', pet.x + 300, pet.y, 1); state.world.pickups.add(next);
  pet.update(.01, state.player, state.world); assert.equal(pet.vacuumsUsed, 2); assert.equal(next.dead, true);
});
