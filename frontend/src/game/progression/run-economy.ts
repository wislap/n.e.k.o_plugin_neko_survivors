import { Shop, SHOP_SLOTS, type BuyResult } from './shop.ts';
import { runShopDecisions } from '../ai/decisions.ts';
import type { Player } from '../actors/player.ts';
import type { PendingItemReward } from '../combat/death.ts';
import type { RNG } from '../math/random.ts';
import type { DifficultyId, GameCommand, CommandResult } from '../commands.ts';

interface PartyEconomy { players(): Player[]; rewards(): PendingItemReward[] }
type AiPurchase = ({ type: 'buy-offer'; offerId: string } | { type: 'combine'; weaponId: string } | { type: 'reroll' }) & { playerId: number };
export type EconomyReceipt = { ok: false; reason: string } | { ok: true; player: Player; combo: boolean; combined: boolean; autoReroll: boolean; weaponName?: string };

/** Owns market identities and validates every human and automatic inventory transaction. */
export class RunEconomy {
  market: Shop | null = null;
  private party: PartyEconomy | null = null;
  private shopEpoch = 0;
  private weaponSerial = 1;
  private automaticBuyer: boolean | undefined;

  beginAttempt(rng: RNG, difficulty: DifficultyId, party: PartyEconomy) {
    this.party = party;
    this.market = new Shop(rng); this.market.difficultyId = difficulty;
    this.market.setBuyers(party.players());
  }
  offerId(slot: number) { return `offer-${this.shopEpoch}-${slot}`; }
  rewardId(index: number) { return `reward-${this.shopEpoch}-${index}`; }
  ensureWeaponIds() {
    for (const player of this.party?.players() ?? []) for (const weapon of player.weapons) {
      if (!Number.isInteger(weapon.instanceId)) weapon.instanceId = this.weaponSerial++;
      else this.weaponSerial = Math.max(this.weaponSerial, weapon.instanceId! + 1);
    }
  }
  open(wave: number, preserve: boolean) {
    const { market, party } = this.active();
    market.currentWave = wave;
    if (preserve) return null;
    this.shopEpoch++;
    const [player, ...partners] = party.players();
    market.roll(player, wave, partners);
    const stolen = market.tryStealItem(player);
    if (stolen) stolen.offer.pawMark = 1;
    return stolen?.item.name ?? null;
  }
  runAi(player: Player, slotIndex: number, waveIndex: number, submit: (command: AiPurchase) => CommandResult) {
    const { market } = this.active();
    const previous = this.automaticBuyer;
    this.automaticBuyer = slotIndex > 0;
    try {
      runShopDecisions({ shop: market, player, waveIndex, slotIndex }, intent => {
        const command = intent.type === 'buy' ? { type: 'buy-offer' as const, offerId: this.offerId(intent.slot) }
          : intent.type === 'combine' ? { type: 'combine' as const, weaponId: intent.weaponId } : { type: 'reroll' as const };
        return submit({ ...command, playerId: player.id });
      });
    } finally { this.automaticBuyer = previous; }
  }
  execute(command: GameCommand): EconomyReceipt {
    const { market, party } = this.active();
    const players = party.players();
    const player = players.find(actor => actor.id === ('playerId' in command ? command.playerId ?? 1 : 1));
    if (!player) return { ok: false, reason: '玩家不存在' };
    const segment = players.indexOf(player);
    let result: BuyResult = { ok: false, reason: '未知操作' };
    if (command.type === 'buy-offer' || command.type === 'toggle-lock') {
      const slot = market.offers.findIndex((_, index) => this.offerId(index) === command.offerId);
      if (slot < segment * SHOP_SLOTS || slot >= (segment + 1) * SHOP_SLOTS) return { ok: false, reason: '商品不属于该玩家' };
      if (command.type === 'buy-offer') result = market.buy(player, slot);
      else { market.toggleLock(slot); result = { ok: true }; }
    } else if (command.type === 'reroll') result = market.reroll(player, segment * SHOP_SLOTS);
    else if (command.type === 'combine') result = market.combine(player, command.weaponId);
    else if (command.type === 'sell-weapon') {
      const weapon = player.weapons.find(instance => instance.instanceId === command.weaponInstanceId);
      if (weapon) { market.sellWeapon(player, weapon); result = { ok: true }; }
    } else if (command.type === 'claim-reward' || command.type === 'sell-reward') {
      const rewards = party.rewards();
      const index = rewards.findIndex((_, i) => this.rewardId(i) === command.rewardId);
      if (index < 0) return { ok: false, reason: '奖励不存在' };
      const reward = rewards[index];
      if (command.type === 'sell-reward') player.gainMaterials(reward.sellValue);
      else {
        if (!player.addItem(reward.id)) return { ok: false, reason: '道具已达叠加上限' };
        for (const mate of players) if (mate !== player && !mate.dead) mate.addItem(reward.id);
      }
      rewards.splice(index, 1); result = { ok: true };
    }
    return result.ok ? { ok: true, player, combined: !!result.combined, autoReroll: !!result.autoReroll, combo: !this.automaticBuyer && (command.type === 'combine' || !!result.combined), weaponName: result.target?.name }
      : { ok: false, reason: result.reason ?? '操作未完成' };
  }
  private active() {
    if (!this.market || !this.party) throw new TypeError('Economy requires an active party');
    return { market: this.market, party: this.party };
  }
}
