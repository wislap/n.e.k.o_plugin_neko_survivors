import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { RNG } from '../../src/game/math/random.ts';
import { World } from '../../src/game/world/world.ts';
import { Player } from '../../src/game/actors/player.ts';
import { WEAPONS } from '../../src/game/content/weapons.ts';
import { WeaponInstance } from '../../src/game/actors/weapon.ts';

test('ordinary primitives exactly cover real player bullet/turret producers and match their exported hashes', () => {
  const colors = new Set();
  for (const definition of WEAPONS) {
    const rng = new RNG(69), world = new World(rng), player = new Player('yui', rng);
    world.player = player; player.world = world; world.waves.begin(0); world.noSpawn = true;
    const target = world.waves.spawnEnemyById('slime', 40, 0); target.hp = target.maxHp = 100000; world.grid.insert(target);
    const weapon = new WeaponInstance(definition); player.weapons = [weapon];
    weapon.update(.5, player, world); world.turrets.update(1, world);
    for (const turret of world.turrets.items) colors.add(turret.def.color);
    for (const bullet of world.bullets.items) colors.add(bullet.color);
  }
  assert.ok(colors.size > 0);
  const directory = new URL('../../public/assets/ordinary/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
  const required = new Set(['metal.png', ...[...colors].map(color => `glow_${color.slice(1).toLowerCase()}.png`)]);
  assert.deepEqual(new Set(manifest.files.map(file => file.name)), required);
  assert.deepEqual(new Set(readdirSync(directory).filter(name => name.endsWith('.png'))), required);
  for (const file of manifest.files) {
    const bytes = readFileSync(new URL(file.name, directory));
    assert.equal(bytes.readUInt32BE(16), 128); assert.equal(bytes.readUInt32BE(20), 128);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.name);
  }
});
