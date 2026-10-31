import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionEngine } from '../../src/game/session-engine.ts';
import { Pickup } from '../../src/game/actors/pickup.ts';
import { Turret } from '../../src/game/actors/turret.ts';
import { Bullet } from '../../src/game/actors/bullet.ts';
import { getWeapon } from '../../src/game/content/weapons.ts';
import { WeaponInstance } from '../../src/game/actors/weapon.ts';

function setup() {
  const session = new SessionEngine();
  session.start({ characterId: 'yui', difficulty: 'normal', partySize: 1, seed: 69, pilot: false });
  return { session, battle: session.battle, world: session.battle.world, player: session.battle.player };
}
test('ordinary frame carries actual character fallback, boss-facing and turret animation values', () => {
  const { session, world, player } = setup();
  player.blinkPhase = .08; player.wallFlash = .3;
  const boss = world.waves.spawnEnemyById('boss_acid_cat', 100, 40);
  const weapon = new WeaponInstance(getWeapon('toy_turret'));
  const turret = new Turret(weapon.def, 30, 20, weapon, player);
  turret.angle = 1.2; turret.recoil = .08; turret.spawnAnim = .15; world.turrets.items.push(turret);
  const frame = session.readFrame(), p = frame.actors.find(actor => actor.kind === 'player');
  assert.equal(p.accent, player.accent); assert.equal(p.blinkPhase, .08); assert.equal(p.age, player.age); assert.equal(p.wallFlash, .3);
  const b = frame.actors.find(actor => actor.id === boss.id);
  assert.equal(b.facePlayer, true); assert.equal(b.faceRotate, true);
  const t = frame.actors.find(actor => actor.kind === 'turret');
  assert.equal(t.angle, 1.2); assert.equal(t.recoil, .08); assert.equal(t.spawnProgress, .5);
});
test('frame exposes rule-owned projectile/orbit trails and pickup phase without mutable aliases', () => {
  const { session, world, player } = setup();
  const pickup = new Pickup('material', 40, 80); pickup.variant = 2; pickup.bobPhase = .45; world.pickups.add(pickup);
  player.weapons = [new WeaponInstance(getWeapon('mouse_toy'))];
  const orbit = player.weapons[0]; orbit.instanceId = 1;
  player.timeAlive = 1; orbit.update(.04, player, world);
  const bullet = new Bullet({ x: 0, y: 0, angle: 0, speed: 100, damage: 1, ownerPlayer: player, kind: 'element' });
  bullet.update(.04, world); world.bullets.add(bullet);
  const frame = session.readFrame(), projected = frame.projectiles.find(projectile => projectile.id === bullet.id);
  assert.equal(projected.playerStyle, 'orb'); assert.deepEqual(projected.trail, bullet.trail.map(point => ({ x: point.x, y: point.y, alpha: point.a })));
  const ball = frame.weapons[0]; assert.deepEqual(ball.trail, orbit._trail[0]); assert.equal(ball.orbitRadius, orbit.orbitRadius); assert.equal(ball.color, orbit.def.color);
  assert.equal(frame.pickups[0].variant, 2); assert.equal(frame.pickups[0].bobPhase, .45);
  bullet.trail[0].x = 999; orbit._trail[0][0].x = 999;
  assert.notEqual(projected.trail[0].x, 999); assert.notEqual(ball.trail[0].x, 999);
});
test('Flandre primary wall warning lights at a stationary boundary and fades after leaving it', () => {
  const { battle, player } = setup();
  battle.enterChallenge('flandre', false);
  const arena = battle.encounter.arena;
  player.x = arena.cx + arena.hw; player.y = arena.cy;
  const idle = { moveX: 0, moveY: 0, slow: false, clear: false, ultimate: false };
  battle.advance(idle); assert.equal(player.wallFlash, .45);
  player.x = arena.cx; player.y = arena.cy;
  battle.advance(idle); assert.ok(Math.abs(player.wallFlash - (.45 - 1 / 60)) < 1e-9);
});
