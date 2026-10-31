import test from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../../src/game/math/random.ts';
import { World } from '../../src/game/world/world.ts';
import { Player } from '../../src/game/actors/player.ts';
import { getWeapon } from '../../src/game/content/weapons.ts';
import { createController } from '../../src/game/encounters/controllers.ts';
import { createEncounter, WeatherSystem, CometDisaster } from '../../src/game/encounters/index.ts';
import { WEATHER_MAP } from '../../src/game/content/weather.ts';
import { WeaponInstance } from '../../src/game/actors/weapon.ts';
import { EnemyBullet } from '../../src/game/actors/bullet.ts';
import { applyTeammateLevel } from '../../src/game/ai/assistance.ts';
function setup(count = 4) {
  const rng = new RNG(815), world = new World(rng), players = [];
  for (let id = 1; id <= count; id++) {
    const p = new Player('yui', rng); p.id = id; p.world = world;
    p.stats.addFlat('maxHp', 100 - p.maxHp); p.stats.addFlat('dodge', -p.stats.get('dodge'));
    p.hp = 100; p._lastMaxHp = 100; p.invuln = 0; p.charMul = {}; p.charRt = null; p.x = 20; p.y = 0;
    players.push(p);
  }
  [world.player, world.player2, world.player3, world.player4] = players;
  world.noSpawn = true;
  const weather = new WeatherSystem(rng), comet = new CometDisaster({ rng });
  world.weather = weather; world.comet = comet;
  return { rng, world, players, weather, comet };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
for (const count of [1, 2, 3, 4]) test(`global weather applies once per living actor in a ${count}-player party`, () => {
  const { world, players, weather } = setup(count);
  weather._tickGlobalHp(world, players[0], WEATHER_MAP.scorch);
  for (const p of players) near(p.hp, 98);
  for (const p of players) p.hp = 50;
  weather._tickGlobalHp(world, players[0], WEATHER_MAP.calm);
  for (const p of players) near(p.hp, 55);
});
test('weather HP ticks preserve nonlethal/max-HP bounds and never heal a downed or dead player', () => {
  const { world, players, weather } = setup();
  players[0].hp = 1; players[1].hp = 99; players[2].hp = 0; players[2].downed = true; players[3].hp = 0; players[3].dead = true;
  weather._tickGlobalHp(world, players[0], WEATHER_MAP.scorch);
  assert.deepEqual(players.map(p => p.hp), [1, 97, 0, 0]);
  weather._tickGlobalHp(world, players[0], WEATHER_MAP.calm);
  assert.deepEqual(players.map(p => p.hp), [6, 100, 0, 0]);
});
test('meteor hits each actual player exactly once and never routes grid players through the enemy signature', () => {
  const { world, players, weather } = setup();
  const enemy = world.waves.spawnEnemyById('slime', 20, 0), enemyHp = enemy.hp;
  world.grid.insert(enemy); for (const p of players) world.grid.insert(p); // Defensive duplicate-grid regression.
  weather._impact(world, players[0], { x: 20, y: 0, r: 60 });
  for (const p of players) near(p.hp, 80);
  near(enemy.hp, enemyHp * .8);
  assert.deepEqual(weather.burns.filter(b => b.isPlayer).map(b => b.e.id).sort(), [1, 2, 3, 4]);
  assert.equal(weather.burns.filter(b => !b.isPlayer).length, 1);
});
test('blocked meteor hits do not create burns and inactive/outside players do not receive direct effects', () => {
  const { world, players, weather } = setup();
  players[1].invuln = 2; players[2].downed = true; players[2].hp = 0; players[3].x = 500;
  weather._impact(world, players[0], { x: 20, y: 0, r: 60 });
  assert.deepEqual(players.map(p => p.hp), [80, 100, 0, 100]);
  assert.deepEqual(weather.burns.map(b => b.e.id), [1]);
});
test('all player burn owners use Player.takeDamage and round-trip by player ID into fresh entities', () => {
  const first = setup(); first.weather._impact(first.world, first.players[0], { x: 20, y: 0, r: 60 });
  const saved = { weather: first.weather.captureState(), comet: first.comet.captureState() }, second = setup();
  assert.deepEqual(saved.weather.playerBurns.map(b => b.playerId).sort(), [1, 2, 3, 4]);
  second.weather.restoreState(saved.weather, second.players); second.comet.restoreState(saved.comet);
  for (const burn of second.weather.burns) assert.equal(burn.e, second.players[burn.e.id - 1]);
  second.players[2].downed = true; second.players[2].hp = 0; second.players[3].dead = true; second.players[3].hp = 0;
  second.weather._tickBurns(1);
  assert.deepEqual(second.players.map(p => p.hp), [98, 98, 0, 0]);
  assert.deepEqual(second.weather.burns.map(b => b.e.id).sort(), [1, 2]);
});
for (const id of ['typhoon', 'riverFog']) test(`${id} pushes every living player and leaves downed/dead players alone`, () => {
  const { world, players, weather } = setup();
  players[2].downed = true; players[3].dead = true;
  if (id === 'typhoon') {
    weather.typhoons.push({ x: 0, y: 0, r: 100, vx: 50, vy: -20, spin: 1, turnT: 100, parts: [] });
    weather._tickTyphoons(.1, world, players[0]);
  } else {
    weather.fogClouds.push({ x: 0, y: 0, r: 100, vx: 50, vy: -20, turnT: 100, blobs: [], parts: [], streaks: [] });
    weather._tickFogClouds(.1, world, players[0]);
  }
  assert.notEqual(players[0].x, 20); near(players[0].x, players[1].x); near(players[0].y, players[1].y);
  assert.deepEqual(players.slice(2).map(p => [p.x, p.y]), [[20, 0], [20, 0]]);
});
test('blood moon increases each player fire rate by the same documented factor as enemies', () => {
  const { players, weather } = setup();
  const weapons = players.map(() => new WeaponInstance(getWeapon('cat_paw')));
  const normal = weapons.map((w, i) => w.computeCooldown(players[i]));
  weather.id = 'bloodMoon'; weather.phase = 'active';
  for (const t of [0, 5, 10]) {
    weather.t = t; weather._applyFlags();
    for (let i = 0; i < players.length; i++) near(weapons[i].computeCooldown(players[i]), normal[i] / weather.enemyFireMul);
  }
  weather.forceEnd();
  for (let i = 0; i < players.length; i++) near(weapons[i].computeCooldown(players[i]), normal[i]);
});
test('NPC growth preserves each original package without an item, including absolute six-HP healing', () => {
  const { players } = setup(); const p = players[1];
  p.stats.addFlat('hpRegen', -p.stats.get('hpRegen')); p.stats.addFlat('armor', -p.stats.get('armor'));
  p.pendingLevelUps = 1; assert.equal(applyTeammateLevel(p), true); near(p.stats.get('hpRegen'), .5); near(p.hp, 100);
  p.stats.addFlat('hpRegen', .5); p.stats.addFlat('armor', 8); p.pendingLevelUps = 1; applyTeammateLevel(p); near(p.stats.get('armor'), 10);
  p.hp = 50; p.pendingLevelUps = 1; const damage = p.stats.get('damage'); applyTeammateLevel(p);
  near(p.maxHp, 106); near(p.hp, 56); near(p.stats.get('damage'), damage + 8);
  assert.equal(p.upgradesTaken.size, 0); assert.equal(p.pendingLevelUps, 0); assert.equal(applyTeammateLevel(p), false);
});
test('NPC fish rewards use the same Player upgrade path once per consumed level, without extra history IDs', () => {
  const { players } = setup(); const p = players[1]; p.addItem('dried_fish');
  p.stats.addFlat('hpRegen', -p.stats.get('hpRegen')); p.stats.addFlat('armor', -p.stats.get('armor'));
  const initial = { damage: p.stats.get('damage'), maxHp: p.maxHp, turretMax: p.stats.get('turretMax') };
  const original = p.applyUpgrade.bind(p); let calls = 0; p.applyUpgrade = (...args) => { calls++; return original(...args); };
  p.pendingLevelUps = 2; while (p.pendingLevelUps > 0) applyTeammateLevel(p);
  assert.equal(calls, 2); near(p.stats.get('damage'), initial.damage + 2); near(p.maxHp, initial.maxHp + 2);
  near(p.stats.get('hpRegen'), 2.5); near(p.stats.get('armor'), 4); near(p.stats.get('turretMax'), initial.turretMax);
  assert.equal(p.upgradesTaken.size, 0); assert.equal(p.pendingLevelUps, 0);
});

test('fixed NPC growth plus fish grants one passive package and keeps absolute healing instead of a free ratio heal', () => {
  const { players } = setup(); const p = players[2];
  p.stats.addFlat('hpRegen', 1 - p.stats.get('hpRegen')); p.stats.addFlat('armor', 10 - p.stats.get('armor'));
  p.addItem('dried_fish'); p.hp = 50; p.pendingLevelUps = 1; const damage = p.stats.get('damage');
  applyTeammateLevel(p);
  near(p.maxHp, 107); near(p.hp, 56); near(p.stats.get('damage'), damage + 9); near(p.stats.get('armor'), 11);
  assert.equal(p._lastMaxHp, p.maxHp); assert.equal(p.upgradesTaken.size, 0);
  p.pendingLevelUps = 1; p.downed = true; const snapshot = { hp: p.hp, stats: { ...p.stats.values } };
  assert.equal(applyTeammateLevel(p), false); assert.deepEqual({ hp: p.hp, stats: { ...p.stats.values } }, snapshot); assert.equal(p.pendingLevelUps, 1);
});

test('shared fog/rain/typhoon flags apply through every Player entry without permanent stat mutation', () => {
  const { world, players, weather } = setup(); const before = players.map(p => ({ ...p.stats.values }));
  weather.phase = 'active'; weather.id = 'fog'; weather._applyFlags(); weather.rng.next = () => 0;
  for (const player of players) { assert.equal(player.takeDamage(10, 0, 0), 0); near(player.hp, 100); }
  weather.id = 'rain'; weather._applyFlags();
  for (const player of players) {
    const target = world.waves.spawnEnemyById('slime', 80, 0), hp = target.hp;
    world.dealDamage(player, null, target, 10, { noCrit: true });
    near(hp - target.hp, 12.5);
  }
  weather.id = 'typhoon'; weather._applyFlags();
  for (const player of players) { player.takeDamage(5, 0, 0); near(player.invuln, 1.5); }
  assert.equal(weather.noKnockback, true);
  weather.forceEnd();
  assert.equal(weather.invulnMin, 0); assert.equal(weather.miss, 0); assert.equal(weather.playerOut, 1); assert.equal(weather.noKnockback, false);
  for (let i = 0; i < players.length; i++) assert.deepEqual(players[i].stats.values, before[i]);
});

test('breeze scales movement for every living player and clear vacuum retains full-health healing exclusions', async () => {
  const { Pickup } = await import('../../src/game/actors/pickup.ts');
  const { world, players, weather } = setup();
  const input = { moveAxis: () => ({ x: 1, y: 0 }), isDown: () => false };
  createEncounter('vergil', { world, player: players[0] });
  weather.phase = 'active'; weather.id = 'breeze'; weather._applyFlags();
  for (const p of players) {
    const before = p.x;
    p.update(.1, input, world); near(p.x - before, p.baseSpeed * p.stats.moveSpeedMultiplier * 1.25 * .1);
  }
  weather.id = 'clear'; weather._applyFlags();
  for (const p of players) {
    const material = new Pickup('material', p.x + 500, p.y, 1); material.update(.1, world, p); assert.equal(material.attracted, true);
    const fullHeal = new Pickup('heal', p.x + 500, p.y, 4); fullHeal.update(.1, world, p); assert.equal(fullHeal.attracted, false);
    p.hp = 50; const neededHeal = new Pickup('heal', p.x + 500, p.y, 4); neededHeal.update(.1, world, p); assert.equal(neededHeal.attracted, true);
  }
});

test('party iteration does not multiply meteor spawning, advance weather clocks four times or alter weather entropy', () => {
  const solo = setup(1), party = setup(4);
  for (const setup of [solo, party]) {
    setup.weather.id = 'meteor'; setup.weather.phase = 'active'; setup.weather.dur = 30;
    setup.weather.rng.state = 123456; setup.weather.visualRng.state = 654321; setup.weather.metAcc = 1.49;
    setup.weather.update(.02, setup.world, setup.players[0]);
  }
  near(solo.weather.t, party.weather.t); near(solo.weather.visT, party.weather.visT);
  assert.equal(solo.weather.rng.state, party.weather.rng.state);
  assert.ok(solo.weather.meteors.length >= 1 && solo.weather.meteors.length <= 2);
  assert.equal(solo.weather.meteors.length, party.weather.meteors.length);
  assert.deepEqual(solo.weather.meteors, party.weather.meteors);
});


function fogAttack(path, count, slot, weatherValues, { dodge = 0, lucky = false, ordinaryValues = [.99] } = {}) {
  const state = setup(count), { world, players, weather } = state;
  players.forEach((player, i) => { player.x = 100 + i * 100; });
  const player = players[slot];
  player.stats.addFlat('armor', -player.stats.get('armor'));
  player.stats.addFlat('dodge', dodge - player.stats.get('dodge'));
  if (lucky) player.addItem('lucky_cat_paw');
  player.rng = new RNG(924);
  let weatherCalls = 0, ordinaryCalls = 0, damageCalls = 0, damageOptions;
  weather.id = 'fog'; weather.phase = 'active'; weather._applyFlags();
  weather.rng.next = () => weatherValues[weatherCalls++] ?? .99;
  player.rng.next = () => ordinaryValues[ordinaryCalls++] ?? .99;
  const actualDamage = player.takeDamage.bind(player);
  player.takeDamage = (...args) => { damageCalls++; damageOptions = args[3]; return actualDamage(...args); };
  let attack;
  if (path === 'contact' || path === 'explosion') {
    attack = world.waves.spawnEnemyById(path === 'explosion' ? 'bomber' : 'slime', player.x - 1, player.y);
    if (path === 'contact') attack.damage = 10;
    attack.spawnAnimation = 0;
    attack.update(0, player, world);
  } else {
    attack = new EnemyBullet({ x: player.x, y: player.y, angle: 0, speed: 0, damage: 10 });
    attack.update(0, world, players);
  }
  return { ...state, attack, player, weatherCalls, ordinaryCalls, damageCalls, damageOptions };
}

for (const path of ['contact', 'projectile']) {
  for (const count of [1, 2, 3, 4]) test(`fog ${path} uses one weather roll for every target in a ${count}-player party`, () => {
    for (let slot = 0; slot < count; slot++) {
      // .5 passes the 20% outer check; a second accidental .0 roll would block it.
      const hit = fogAttack(path, count, slot, [.5, .0]);
      near(hit.player.hp, 90); assert.equal(hit.weatherCalls, 1); assert.equal(hit.damageCalls, 1);
      assert.equal(hit.damageOptions.weatherChecked, true); assert.notEqual(hit.damageOptions.noMiss, true);
      assert.equal(hit.ordinaryCalls, 0);
      for (let other = 0; other < count; other++) if (other !== slot) near(hit.players[other].hp, 100);
    }
  });
  test(`fog ${path} outer miss leaves health, invulnerability and contact knockback untouched`, () => {
    const result = fogAttack(path, 4, 2, [.1, .0]);
    near(result.player.hp, 100); near(result.player.invuln, 0);
    assert.equal(result.weatherCalls, 1); assert.equal(result.damageCalls, 0); assert.equal(result.ordinaryCalls, 0);
    if (path === 'contact') { near(result.attack.knockbackX, 0); near(result.attack.knockbackY, 0); }
    else assert.equal(result.attack.dead, true);
  });
  test(`fog ${path} still permits independent ordinary dodge and lucky-cat-paw rolls`, () => {
    const dodge = fogAttack(path, 4, 1, [.5, .0], { dodge: 80, ordinaryValues: [.5] });
    near(dodge.player.hp, 100); assert.equal(dodge.weatherCalls, 1); assert.equal(dodge.ordinaryCalls, 1);
    const lucky = fogAttack(path, 4, 2, [.5, .0], { lucky: true, ordinaryValues: [.1] });
    near(lucky.player.hp, 100); assert.equal(lucky.weatherCalls, 1); assert.equal(lucky.ordinaryCalls, 1);
    const both = fogAttack(path, 4, 3, [.5, .0], { dodge: 80, lucky: true, ordinaryValues: [.9, .1] });
    near(both.player.hp, 100); assert.equal(both.weatherCalls, 1); assert.equal(both.ordinaryCalls, 2);
    // An 80% ordinary dodge plus fog is independent, never an additive 100% immunity.
    const passed = fogAttack(path, 4, 0, [.5, .0], { dodge: 80, ordinaryValues: [.9] });
    near(passed.player.hp, 90); assert.equal(passed.weatherCalls, 1); assert.equal(passed.ordinaryCalls, 1);
  });
}

test('direct Player damage without an outer weather check retains its own single fog roll', () => {
  const { weather, players } = setup(); weather.id = 'fog'; weather.phase = 'active'; weather._applyFlags();
  let calls = 0; weather.rng.next = () => { calls++; return .5; };
  players[0].takeDamage(10, 0, 0); near(players[0].hp, 90); assert.equal(calls, 1);
});
test('actual challenge projectiles dispatch their owned hit profile without ordinary weather-checked damage', () => {
  for (const kind of ['flandre', 'halloween', 'remilia']) {
    const { world, players, rng } = setup(); players.forEach((p, i) => { p.x = 100 + i * 100; });
    const controller = createController(kind, { world, player: players[0], rng });
    const player = players[2], actual = player.receiveHit.bind(player); let specialCalls = 0, ordinaryCalls = 0;
    player.receiveHit = (...args) => { specialCalls++; return actual(...args); };
    const damage = player.takeDamage.bind(player); player.takeDamage = (...args) => { ordinaryCalls++; return damage(...args); };
    const bullet = new EnemyBullet({ x: player.x, y: player.y, angle: 0, speed: 0, damage: 10, hitProfile: controller.hitProfile });
    bullet.update(0, world, players);
    assert.equal(specialCalls, 1); assert.equal(ordinaryCalls, 0); assert.equal(bullet.dead, true);
    assert.equal(player.hp, kind === 'flandre' ? 78 : 90);
  }
});


for (const count of [1, 2, 3, 4]) test(`actual exploder update completes its explosion and uses one Player fog check in a ${count}-player party`, () => {
  for (let slot = 0; slot < count; slot++) {
    const result = fogAttack('explosion', count, slot, [.5, .0]);
    const expected = (result.attack.def.explosionDamage ?? 12) * result.attack.dmgScale;
    near(result.player.hp, 100 - expected);
    assert.equal(result.weatherCalls, 1); assert.equal(result.damageCalls, 1); assert.equal(result.ordinaryCalls, 0);
    assert.notEqual(result.damageOptions.weatherChecked, true); assert.notEqual(result.damageOptions.noMiss, true);
    assert.equal(result.attack.dead, true); assert.equal(result.attack.exploded, true);
    assert.ok(result.world.fx.items.some(effect => effect.type === 'explosion'));
    for (let other = 0; other < count; other++) if (other !== slot) near(result.players[other].hp, 100);
  }
});
test('actual exploder fog miss and independent ordinary dodge/lucky guards preserve the original explosion route', () => {
  const miss = fogAttack('explosion', 4, 2, [.1, .0]);
  near(miss.player.hp, 100); near(miss.player.invuln, 0); assert.equal(miss.weatherCalls, 1); assert.equal(miss.damageCalls, 1);
  assert.equal(miss.ordinaryCalls, 0); assert.equal(miss.attack.exploded, true);
  const dodge = fogAttack('explosion', 4, 1, [.5, .0], { dodge: 80, ordinaryValues: [.5] });
  near(dodge.player.hp, 100); assert.equal(dodge.weatherCalls, 1); assert.equal(dodge.ordinaryCalls, 1);
  const lucky = fogAttack('explosion', 4, 3, [.5, .0], { lucky: true, ordinaryValues: [.1] });
  near(lucky.player.hp, 100); assert.equal(lucky.weatherCalls, 1); assert.equal(lucky.ordinaryCalls, 1);
});
