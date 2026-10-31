import test from 'node:test';
import assert from 'node:assert/strict';
import { projectEffect } from '../../src/game/project-effects.ts';
import { FXSystem } from '../../src/game/world/effects.ts';
import { RNG } from '../../src/game/math/random.ts';

test('all fourteen effect records preserve their drawing semantics and stable identities', () => {
  const effects = new FXSystem(new RNG(10), 200);
  effects.slash(1, 2, 1, 40, 120, '#fff'); effects.thrust(1, 2, 30, 40, 12, '#fff');
  effects.spin(1, 2, 30, '#fff'); effects.beam(1, 2, 50, 60, 10, '#fff');
  effects.nova(1, 2, 40, '#fff'); effects.explosion(1, 2, 40, '#fff');
  effects.chain([{ x: 1, y: 2 }, { x: 3, y: 4 }], '#fff'); effects.sparkle(1, 2, '#fff');
  effects.damageText(1, 2, 10, true); effects.ring(1, 2, 30, '#fff'); effects.hit(1, 2, '#fff');
  effects.impact(1, 2, 0.9, '#fff'); effects.shockwave(1, 2, 30, '#fff'); effects.shards(1, 2, 30, '#fff');
  const kinds = new Set(effects.items.map(effect => projectEffect(effect).kind));
  assert.deepEqual([...kinds].sort(), ['slash', 'thrust', 'spin', 'beam', 'nova', 'explosion', 'chain', 'sparkle', 'text', 'ring', 'hit', 'impact', 'shockwave', 'shard'].sort());
  assert.equal(new Set(effects.items.map(effect => effect.id)).size, effects.items.length);
  const chain = effects.items.find(effect => effect.type === 'chain');
  const view = projectEffect(chain); view.points[0].x = 999;
  assert.equal(chain.points[0].x, 1);
  const lastId = Math.max(...effects.items.map(effect => effect.id));
  effects.clear(); effects.hit(1, 2, '#fff');
  assert.ok(effects.items[0].id > lastId);
});

test('particle movement and delayed text fade match baseline time semantics', () => {
  const common = { id: 1, x: 10, y: 20, color: '#fff', t: 0.5, life: 1 };
  const shard = projectEffect({ ...common, type: 'shard', ox: 3, oy: 4, vx: 8, vy: -6, rot: 1, spin: 4 });
  assert.equal(shard.x, 17); assert.equal(shard.y, 43.5); assert.equal(shard.angle, 3);
  const sparkle = projectEffect({ ...common, type: 'sparkle', vx: 8, vy: -6 });
  assert.equal(sparkle.x, 14); assert.equal(sparkle.y, 17);
  const early = projectEffect({ ...common, type: 'damage_text', text: '10', vy: -10 });
  assert.equal(early.alpha, 1); assert.equal(early.y, 15);
  const late = projectEffect({ ...common, t: 0.85, type: 'damage_text', text: '10', vy: -10 });
  assert.ok(Math.abs(late.alpha - 0.5) < 1e-9);
});
