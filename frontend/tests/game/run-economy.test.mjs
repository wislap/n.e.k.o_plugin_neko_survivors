import test from 'node:test';
import assert from 'node:assert/strict';
import { RunEconomy } from '../../src/game/progression/run-economy.ts';
import { Player } from '../../src/game/actors/player.ts';
import { RNG } from '../../src/game/math/random.ts';

function attempt(economy = new RunEconomy(), count = 4) {
  const rng = new RNG(17);
  const players = Array.from({ length: count }, (_, index) => {
    const player = new Player('yui', rng);
    player.id = index + 1; player.materials = 100;
    return player;
  });
  const party = { players, rewards: [] };
  economy.beginAttempt(rng, 'normal', { players: () => party.players, rewards: () => party.rewards });
  return { economy, party, rng };
}
function shelf(economy, count, overrides = {}) {
  economy.market.restoreState({
    offers: Array.from({ length: count * 4 }, (_, index) => ({
      kind: 'item', id: 'warm_milk', price: 10, sold: false, meta: {}, ...overrides[index],
    })),
    locked: [], rerollCount: 0, mateRerolls: [],
  });
}
function reward(id, sellValue = 25) { return { id, name: id, price: 50, rare: true, sellValue }; }
function command(economy, type, details = {}) { return economy.execute({ type, revision: 0, ...details }); }

test('each party member can transact only on their own shelf and refresh only that segment', () => {
  const { economy, party } = attempt(); shelf(economy, 4);
  const before = economy.market.captureState();
  for (const type of ['buy-offer', 'toggle-lock']) {
    assert.equal(command(economy, type, { playerId: 1, offerId: economy.offerId(4) }).ok, false);
    assert.equal(command(economy, type, { playerId: 4, offerId: economy.offerId(8) }).ok, false);
  }
  assert.deepEqual(economy.market.captureState(), before);
  assert.deepEqual(party.players.map(player => player.materials), [100, 100, 100, 100]);
  const receipt = command(economy, 'buy-offer', { playerId: 3, offerId: economy.offerId(8) });
  assert.equal(receipt.ok, true); assert.equal(receipt.player, party.players[2]);
  assert.deepEqual(party.players.map(player => player.items.get('warm_milk') ?? 0), [0, 0, 1, 0]);
  assert.deepEqual(party.players.map(player => player.materials), [100, 100, 90, 100]);
  assert.equal(command(economy, 'toggle-lock', { playerId: 2, offerId: economy.offerId(5) }).ok, true);
  const locked = economy.market.captureState();
  const cost = economy.market.rerollCostFor(4);
  assert.equal(command(economy, 'reroll', { playerId: 2 }).ok, true);
  const refreshed = economy.market.captureState();
  assert.equal(party.players[1].materials, 100 - cost);
  assert.deepEqual(refreshed.offers.slice(0, 4), locked.offers.slice(0, 4));
  assert.deepEqual(refreshed.offers.slice(8), locked.offers.slice(8));
  assert.deepEqual(refreshed.offers[5], locked.offers[5]);
  assert.deepEqual(refreshed.mateRerolls, [[1, 1]]);
  assert.equal(refreshed.rerollCount, 0);
  assert.equal(command(economy, 'buy-offer', { playerId: 99, offerId: economy.offerId(0) }).ok, false);
});

test('market epochs survive preserved openings and new attempts invalidate old identities', () => {
  const { economy, party, rng } = attempt();
  economy.open(0, false);
  const offerId = economy.offerId(0), rewardId = economy.rewardId(0);
  const state = economy.market.captureState(), rngState = rng.state;
  economy.open(0, true);
  assert.equal(economy.offerId(0), offerId); assert.equal(economy.rewardId(0), rewardId);
  assert.equal(rng.state, rngState); assert.deepEqual(economy.market.captureState(), state);
  assert.equal(command(economy, 'reroll').ok, true);
  assert.equal(economy.offerId(0), offerId, 'a refresh uses the current shop epoch');
  economy.ensureWeaponIds();
  const previousWeaponIds = party.players.flatMap(player => player.weapons.map(weapon => weapon.instanceId));
  const next = attempt(economy, 1); economy.ensureWeaponIds(); economy.open(0, false);
  assert.notEqual(economy.offerId(0), offerId); assert.notEqual(economy.rewardId(0), rewardId);
  assert.ok(next.party.players[0].weapons[0].instanceId > Math.max(...previousWeaponIds));
  assert.equal(command(economy, 'buy-offer', { offerId }).ok, false);
  next.party.rewards.push(reward('yamato'));
  assert.equal(command(economy, 'claim-reward', { rewardId }).ok, false);
  assert.equal(next.party.rewards.length, 1);
});

test('weapon identity remains stable through repeated scans and sales target a single owned instance', () => {
  const { economy, party } = attempt();
  party.players[0].weapons[0].instanceId = 700;
  economy.ensureWeaponIds();
  const ids = party.players.flatMap(player => player.weapons.map(weapon => weapon.instanceId));
  economy.ensureWeaponIds();
  assert.deepEqual(party.players.flatMap(player => player.weapons.map(weapon => weapon.instanceId)), ids);
  assert.equal(new Set(ids).size, ids.length);
  const player = party.players[0], second = player.addWeapon(player.weapons[0].def.id);
  economy.ensureWeaponIds(); assert.ok(second.instanceId > Math.max(...ids));
  const original = player.weapons[0], money = player.materials;
  assert.equal(command(economy, 'sell-weapon', { playerId: 2, weaponInstanceId: second.instanceId }).ok, false);
  assert.equal(command(economy, 'sell-weapon', { weaponInstanceId: second.instanceId }).ok, true);
  assert.ok(player.weapons.includes(original)); assert.ok(!player.weapons.includes(second));
  assert.ok(player.materials > money);
  assert.equal(command(economy, 'sell-weapon', { weaponInstanceId: second.instanceId }).ok, false);
});

test('reward claims distribute to the live party while respecting individual caps and death', () => {
  const { economy, party } = attempt();
  party.players[1].addItem('yamato'); party.players[2].dead = true; party.players[3].downed = true;
  party.rewards = [reward('yamato')];
  assert.equal(command(economy, 'claim-reward', { rewardId: economy.rewardId(0) }).ok, true);
  assert.deepEqual(party.players.map(player => player.items.get('yamato') ?? 0), [1, 1, 0, 1]);
  assert.equal(party.rewards.length, 0);
  const money = party.players.map(player => player.materials);
  party.rewards = [reward('yamato')];
  assert.equal(command(economy, 'claim-reward', { rewardId: economy.rewardId(0) }).ok, false);
  assert.equal(party.rewards.length, 1, 'a capped recipient does not consume the reward');
  assert.deepEqual(party.players.map(player => player.materials), money);
  assert.deepEqual(party.players.map(player => player.items.get('yamato') ?? 0), [1, 1, 0, 1]);
});

test('selling a reward pays only the recipient and observes a replaced reward queue', () => {
  const { economy, party } = attempt();
  party.rewards = [reward('yamato', 27)];
  const receipt = command(economy, 'sell-reward', { rewardId: economy.rewardId(0) });
  assert.equal(receipt.ok, true); assert.equal(receipt.player, party.players[0]);
  assert.deepEqual(party.players.map(player => player.materials), [127, 100, 100, 100]);
  assert.ok(party.players.every(player => !player.items.has('yamato')));
  assert.equal(party.rewards.length, 0);
  assert.equal(command(economy, 'sell-reward', { rewardId: economy.rewardId(0) }).ok, false);
});

test('unaffordable and capped operations leave balances, inventory and shelf unchanged', () => {
  const { economy, party } = attempt(new RunEconomy(), 1);
  const player = party.players[0]; player.materials = 1;
  shelf(economy, 1); const before = economy.market.captureState(), inventory = player.captureState();
  for (const [type, details] of [
    ['buy-offer', { offerId: economy.offerId(0) }], ['reroll', {}],
    ['combine', { weaponId: 'cat_paw' }], ['sell-weapon', { weaponInstanceId: 999 }],
  ]) assert.equal(command(economy, type, details).ok, false);
  assert.deepEqual(economy.market.captureState(), before); assert.deepEqual(player.captureState(), inventory);
  player.materials = 100; player.addItem('yamato');
  shelf(economy, 1, { 0: { id: 'yamato' } });
  assert.equal(command(economy, 'buy-offer', { offerId: economy.offerId(0) }).ok, false);
  assert.equal(player.materials, 100); assert.equal(player.items.get('yamato'), 1);
  assert.equal(economy.market.captureState().offers[0].sold, false);
});

for (const slot of [0, 1]) test(`AI buyer ${slot + 1} submits actual transactions and preserves combo narration ownership`, () => {
  const { economy, party } = attempt(new RunEconomy(), 2), player = party.players[slot];
  for (const weapon of [...player.weapons]) player.removeWeapon(weapon);
  for (const id of ['cat_paw', 'claw_glove', 'fish_shield', 'shadow_dagger', 'pebble_toss', 'star_wand']) player.addWeapon(id);
  player.materials = 60;
  shelf(economy, 2, Object.fromEntries(Array.from({ length: 8 }, (_, index) => [index,
    index === slot * 4 ? { kind: 'weapon', id: 'cat_paw', price: 1 } : { price: 1000 }])));
  const actions = [], receipts = [];
  economy.runAi(player, slot, 0, action => {
    actions.push(action);
    const receipt = economy.execute(action); receipts.push(receipt);
    return receipt;
  });
  assert.deepEqual(actions, [{ type: 'buy-offer', offerId: economy.offerId(slot * 4), playerId: player.id }]);
  assert.equal(receipts[0].ok, true); assert.equal(receipts[0].combo, slot === 0);
  assert.equal(player.findWeapons('tuna_blade').length, 1);
  assert.equal(player.findWeapons('cat_paw').length, 0);
  assert.equal(player.materials, 51, 'the shared transaction pays the offer and real combination fee');
  player.removeWeapon(player.findWeapons('claw_glove')[0]); player.addWeapon('tuna_blade');
  assert.equal(command(economy, 'combine', { playerId: player.id, weaponId: 'tuna_blade' }).combo, true,
    'teammate automatic suppression ends when the AI operation returns');
});
