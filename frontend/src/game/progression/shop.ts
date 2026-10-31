import type { Player } from '../actors/player.ts';
import type { WeaponInstance } from '../actors/weapon.ts';
import type { RNG } from '../math/random.ts';
import type { ItemDefinition, WeaponDefinition, WeaponId, DifficultyId } from '../content/definitions.ts';
import type { Archetype } from '../content/archetypes.ts';
import type { ShopSave } from '../save/types.ts';
type OfferDefinitions = { weapon: WeaponDefinition; item: ItemDefinition };
/** Opaque plain-object metadata is round-tripped by saves; game rules never interpret its keys. */
export type OfferMeta = Record<string, unknown>;
export type Offer = ShopOffer<'weapon'> | ShopOffer<'item'>;
export interface BuyResult { ok: boolean; reason?: string; offer?: Offer; weapon?: WeaponInstance | null; upgraded?: boolean; combined?: boolean; target?: WeaponDefinition; upgradedExisting?: boolean; level?: number; autoReroll?: { offers: Offer[]; free: boolean } }
// 商店负责商品抽取、价格、购买与合成机制；玩家/AI交易入口共用合法性校验。

import { WEAPONS, RECIPE_MAP, getWeapon, weaponsByTier, LEGENDARY_BASE_PRICE } from '../content/weapons.ts';
import { ITEMS, getItem, itemTier } from '../content/items.ts';
import { MAX_WEAPONS } from '../actors/player.ts';
import { weaponArch, itemArch, archWeightMul, characterArch } from '../content/archetypes.ts';
import { luckBenefits, stealChance } from './luck-rules.ts';

export const SHOP_SLOTS = 4;

// 商品价格随波增加；噩梦11波起另加涨幅，刷新也有跨波永久附加费。
export const PRICE_WAVE_STEP = 0.10;     // 每回合商品涨价 10%
// 全局涨价系数按第11波最低传说价100锚定，保留实际舍入位置。
export const PRICE_GLOBAL_MUL = 100 / 86;
export const NIGHTMARE_EXTRA_STEP = 0.10; // 噩梦第 11 波起**额外**再涨 10%/波
export const NIGHTMARE_EXTRA_FROM = 10;   // w=10 即第 11 波
export const REROLL_STEP_WAVE = 10;       // w=10 即第 11 波
export const REROLL_STEP_AMOUNT = 5;      // 第 11 波起刷新永久 +5

export class ShopOffer<K extends keyof OfferDefinitions> {
  declare kind: K;
  declare data: OfferDefinitions[K];
  declare price: number;
  declare sold: boolean;
  declare meta: OfferMeta;
  declare pawMark?: number | boolean;
  constructor(kind: K, data: OfferDefinitions[K], price: number, meta: OfferMeta = {}) {
    this.kind = kind;          // 'weapon' | 'item'
    this.data = data;          // 定义对象
    this.price = price;
    this.sold = false;
    this.meta = meta;
  }
  get id() { return this.data.id; }
  get name() { return this.data.name; }
}

export class Shop {
  declare rng: RNG;
  declare _buyerMultipliers: Map<number, number>;
  declare offers: Offer[];
  declare locked: Set<number>;
  declare rerollCount: number;
  declare mateRerolls: Map<number, number>;
  declare rerollBaseCost: number;
  declare difficultyId: DifficultyId | null;
  declare currentWave?: number;
  constructor(rng: RNG) {
    this.rng = rng;
    this._buyerMultipliers = new Map();
    this.offers = [];
    this.locked = new Set();   // 被锁定的槽位索引
    this.rerollCount = 0;           // P1（段 0）本店的刷新次数 —— 刷新费只跟它走
    this.mateRerolls = new Map();   // 201 轮：队友（段 1..3）各自的刷新次数，不再和 P1 共用一个计数
    this.rerollBaseCost = 3;
    // 难度仅参与噩梦分段涨价，开局与恢复时由实际所有者设置。
    this.difficultyId = null;
  }

  /** Configure buyer-specific pricing without exposing the internal Map. */
  setBuyers(players: readonly Player[]) {
    this._buyerMultipliers = new Map(players.map((player, slot) => [slot, player.char.rerollCostMul ?? 1]));
  }

  /** Save only shop-owned persistent state; RNG and buyer setup belong to session assembly. */
  captureState() {
    return {
      offers: this.offers.map(offer => ({ kind: offer.kind, id: offer.data.id, price: offer.price,
        sold: offer.sold, ...(offer.pawMark === undefined ? {} : { pawMark: offer.pawMark }), meta: structuredClone(offer.meta) })),
      locked: [...this.locked], rerollCount: this.rerollCount, mateRerolls: [...this.mateRerolls],
    };
  }

  restoreState(snapshot: ShopSave) {
    this.offers = snapshot.offers.map(offer => {
      const definition = offer.kind === 'weapon' ? getWeapon(offer.id) : getItem(offer.id);
      if (!definition) throw new TypeError('存档包含未知商品');
      const instance = offer.kind === 'weapon'
        ? new ShopOffer('weapon', getWeapon(offer.id)!, offer.price, structuredClone(offer.meta))
        : new ShopOffer('item', getItem(offer.id)!, offer.price, structuredClone(offer.meta));
      instance.sold = offer.sold;
      if (offer.pawMark !== undefined) instance.pawMark = offer.pawMark;
      return instance;
    });
    this.locked = new Set(snapshot.locked);
    this.rerollCount = snapshot.rerollCount;
    this.mateRerolls = new Map(snapshot.mateRerolls);
  }

  // 刷新费由基础、波次附加和当前买家刷新次数构成，角色折扣使用实际买家。
  get rerollCost() { return this.rerollCostFor(0); }

  // 每位买家独立记录刷新次数和四格货架，避免队友刷新影响P1。
  rerollCostFor(slotIndex = 0) {
    const k = this._segOf(slotIndex);
    const n = k === 0 ? this.rerollCount : (this.mateRerolls.get(k) ?? 0);
    // 刷新折扣按买家角色倍率，向上取整保证材料整数。
    const base = this.rerollBaseCost + this._waveRerollBonus + n * 2;
    return Math.ceil(base * (this._buyerMultipliers.get(k) ?? 1));
  }

  /** 槽位下标所属的段（0 = P1，1..3 = 队友） */
  _segOf(slotIndex: number) { return Math.max(0, Math.floor((slotIndex || 0) / SHOP_SLOTS)); }

  // 第11波起刷新费永久每波增加5；与本店内多次刷新的费用分开。
  get _waveRerollBonus() {
    const w = this.currentWave ?? 0;
    return Math.max(0, w) + (w >= REROLL_STEP_WAVE ? REROLL_STEP_AMOUNT : 0);
  }

  // 商品价格逐波增长，噩梦中期另加增幅；各乘区与逐次舍入顺序保持。
  get priceWaveMul() {
    const w = this.currentWave ?? 0;
    let mul = 1 + w * PRICE_WAVE_STEP;
    if (this.difficultyId === 'nightmare' && w >= NIGHTMARE_EXTRA_FROM) {
      mul += (w - NIGHTMARE_EXTRA_FROM) * NIGHTMARE_EXTRA_STEP;
    }
    // 无尽每波额外1.1倍复利涨价，与普通波涨幅叠加。
    const wave1 = w + 1;
    if (wave1 > 20) mul *= Math.pow(1.1, wave1 - 20);
    return mul;
  }

  // 新店兑现每个买家的锁定商品，再清本店刷新计数。
  roll(player: Player, waveIndex: number, partners: readonly Player[] = []) {
    // 保留锁定槽位
    const kept: Offer[] = [];
    for (let i = 0; i < this.offers.length; i++) {
      if (this.locked.has(i) && !this.offers[i].sold) kept[i] = this.offers[i];
    }

    this.offers = [];
    const buyers = [player, ...partners];
    for (let segment = 0; segment < buyers.length; segment++) {
      for (let i = 0; i < SHOP_SLOTS; i++) {
        const slot = segment * SHOP_SLOTS + i;
        this.offers[slot] = kept[slot] ?? this._makeOffer(buyers[segment], waveIndex);
      }
    }

    // 锁已经兑现，清掉；刷新次数也归零（这是新的一家商店）
    this.locked.clear();
    this.rerollCount = 0;
    this.mateRerolls.clear();
    return this.offers;
  }

  _makeOffer(player: Player, waveIndex: number) {
    const rng = this.rng;

    // 商品品质使用角色luckEff，包含全局0.8与角色倍率，不能读裸幸运。
    const luckBonus = luckBenefits(player.stats.luckEff).shopQualityBonus;

    // 决定是武器还是道具
    const wantWeapon = rng.next() < (player.hasWeaponSlot ? 0.55 : 0.45);

    if (wantWeapon) {
      return this._makeWeaponOffer(player, waveIndex, luckBonus);
    }
    return this._makeItemOffer(player, luckBonus);
  }

  // 武器栏满时先抽品质分布，再从相应持有武器池中抽取，避免稀有武器数量改变品质概率。
  _ownedUpgradeDist(ownedDefs: readonly WeaponDefinition[], luckBonus: number) {
    const b = Math.max(0, Math.min(1, luckBonus));
    const p = [
      0.70 - 0.65 * b,   // t1 白
      0.25 + 0.25 * b,   // t2 蓝
      0.04 + 0.26 * b,   // t3 紫
      0.01 + 0.14 * b,   // t4 金
    ];
    const countByTier = [0, 0, 0, 0];
    for (const d of ownedDefs) countByTier[Math.min(3, Math.max(0, d.tier - 1))]++;
    const bonus = countByTier[2] * 0.10 + countByTier[3] * 0.05;
    if (bonus > 0) {
      p[2] += countByTier[2] * 0.10;
      p[3] += countByTier[3] * 0.05;
      let need = bonus;
      const take1 = Math.min(p[0], need); p[0] -= take1; need -= take1;   // 先扣白
      const take2 = Math.min(p[1], need); p[1] -= take2; need -= take2;   // 白穿再扣蓝
      if (need > 1e-9) {
        const total34 = p[2] + p[3];   // 白蓝扣穿：紫金等比退回超额
        if (total34 > 1e-9) {
          const scale = (total34 - need) / total34;
          p[2] *= scale; p[3] *= scale;
        }
      }
    }
    return { p, countByTier };
  }

  // 抽到未持有的品质时向下寻找；不能因为缺候选而再抽品质改变概率。
  _pickOwnedUpgrade(ownedDefs: readonly WeaponDefinition[], luckBonus: number) {
    const rng = this.rng;
    const { p, countByTier } = this._ownedUpgradeDist(ownedDefs, luckBonus);
    const total = p.reduce((a, c) => a + c, 0);
    if (total <= 1e-9) return rng.pick(ownedDefs);   // 理论兜底
    let r = rng.next() * total;
    let tierIdx = 0;
    for (let i = 0; i < 4; i++) {
      r -= p[i];
      if (r <= 0) { tierIdx = i; break; }
      if (i === 3) tierIdx = 3;
    }
    // 阶梯回退：没持有的品质向下找下位；到底都没有 → 最低持有档
    while (countByTier[tierIdx] === 0) {
      tierIdx--;
      if (tierIdx < 0) {
        tierIdx = countByTier.findIndex((c) => c > 0);
        break;
      }
    }
    const pool = ownedDefs.filter((d) => d.tier - 1 === tierIdx);
    return rng.pick(pool.length ? pool : ownedDefs);
  }

  _makeWeaponOffer(player: Player, waveIndex: number, luckBonus: number) {    const rng = this.rng;

    // 槽位已满时：只提供玩家"已经拥有"的武器。
    // 这样每次购买都能升级那把武器，商店在后期依然有意义；
    // 否则会刷出既买不了、又没用的武器，白白浪费商品位。
    if (!player.hasWeaponSlot) {
      const ownedDefs = player.weapons.map((w) => w.def);
      if (ownedDefs.length > 0) {
        // 满栏品质按幸运分布抽取；持有紫/金武器额外增加对应品质概率。
        const def = this._pickOwnedUpgrade(ownedDefs, luckBonus)!;
        return new ShopOffer('weapon', def, this._weaponPrice(def, luckBonus), { upgradeOffer: true });
      }
    }

    // 可用层数：随波数开放
    const maxTier = waveIndex < 3 ? 1 : waveIndex < 7 ? 2 : 3;

    // 如果玩家有可合成的武器，优先给同款（帮助合成）
    const combinable = player.weapons
      .filter((w) => RECIPE_MAP[w.def.id])
      .map((w) => w.def);
    const tryCombo = combinable.length > 0 && rng.next() < 0.42;
    if (tryCombo && player.hasWeaponSlot) {
      const def = rng.pick(combinable)!;
      return new ShopOffer('weapon', def, this._weaponPrice(def, luckBonus), { combo: true });
    }

    // 普通抽取：按 tier 加权
    const weights = [];
    for (let t = 1; t <= maxTier; t++) {
      let w = t === 1 ? 10 : t === 2 ? 6 : 3;
      if (t >= 2) w *= 1 + luckBonus * 1.6;
      weights.push(w);
    }
    let total = 0;
    for (const w of weights) total += w;
    let r = rng.next() * total;
    let tier = 1;
    for (let t = 1; t <= maxTier; t++) {
      r -= weights[t - 1];
      if (r <= 0) { tier = t; break; }
    }

    const pool = weaponsByTier(tier);
    // 流派加权（用户要求 120%）：本命流派的武器更容易刷出来
    const def = this._pickWeighted(pool.length ? pool : WEAPONS, player, weaponArch)!;
    return new ShopOffer('weapon', def, this._weaponPrice(def, luckBonus));
  }

  // 候选商品按角色本命流派加权，权重只应用一次。
  _pickWeighted<T extends WeaponDefinition | ItemDefinition>(pool: readonly T[], player: Player | null | undefined, archOf: (definition: T) => Archetype | null) {
    if (!pool || pool.length === 0) return null;
    if (!player) return this.rng.pick(pool);
    const playerArch = characterArch(player.characterId);
    if (playerArch.length === 0) return this.rng.pick(pool);

    const weights = pool.map((d) => archWeightMul(archOf(d), playerArch));
    let total = 0;
    for (const w of weights) total += w;
    let r = this.rng.next() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  _makeItemOffer(player: Player, luckBonus: number) {
    const rng = this.rng;
    // 过滤叠加已满及专属战利品；后者只能从对应挑战/击杀结算获得。
    const pool = ITEMS.filter((it) => {
      if (it.flandreOnly || it.bossDropOnly) return false;
      const count = player.items.get(it.id) || 0;
      return count < (it.maxStacks ?? 99);
    });
    if (pool.length === 0) {
      // 兜底也不能把莱万汀/专属红品摇出来：从"非专属"里挑
      const def = rng.pick(ITEMS.filter((it) => !it.flandreOnly && !it.bossDropOnly))!;
      return new ShopOffer('item', def, this._itemPrice(def, luckBonus));
    }

    // 先按价格层与幸运加权，再乘本命流派匹配权重。
    const playerArch = characterArch(player.characterId);
    const weights = pool.map((it) => {
      const t = itemTier(it);
      let w = t === 1 ? 10 : t === 2 ? 6 : 3;
      if (t >= 2) w *= 1 + luckBonus * 1.4;
      return w * archWeightMul(itemArch(it), playerArch);
    });
    let total = 0;
    for (const w of weights) total += w;
    let r = rng.next() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) { idx = i; break; }
    }

    const def = pool[idx];
    return new ShopOffer('item', def, this._itemPrice(def, luckBonus));
  }

  _weaponPrice(def: WeaponDefinition, luckBonus: number) {
    // 传说售价读取武器内容表唯一常量，与传说合成成本使用同一涨价规则。
    const base = def.tier === 4 ? LEGENDARY_BASE_PRICE
      : def.tier === 3 ? 26 : def.tier === 2 ? 16 : 9;
    const jitter = 0.9 + this.rng.next() * 0.25;
    return Math.max(3, Math.round(base * jitter * this.priceWaveMul * (1 - luckBonus * 0.22) * PRICE_GLOBAL_MUL));
  }

  _itemPrice(def: ItemDefinition, luckBonus: number) {
    const jitter = 0.92 + this.rng.next() * 0.2;
    return Math.max(3, Math.round(def.price * jitter * this.priceWaveMul * (1 - luckBonus * 0.22) * PRICE_GLOBAL_MUL));
  }

  // 购买
  /**
   */
  buy(player: Player, slotIndex: number) {
    const offer = this.offers[slotIndex];
    if (!offer || offer.sold) return { ok: false, reason: '该商品已售出' };
    if (player.materials < offer.price) return { ok: false, reason: '材料不足' };

    if (offer.kind === 'weapon') {
      const owned = player.findWeapons(offer.data.id);

      // 满栏时优先立即合成，其次升级同名武器，否则拒绝购买。
      if (!player.hasWeaponSlot) {
        if (owned.length >= 1 && RECIPE_MAP[offer.data.id]) {
          const auto = this._tryAutoCombine(player, offer);
          if (auto) {
            player.materials -= offer.price;
            offer.sold = true;
            return this._finishBuy(player, { ok: true, offer, ...auto }, slotIndex);
          }
        }
        if (owned.length > 0) {
          player.materials -= offer.price;
          offer.sold = true;
          owned[0].level++;
          return this._finishBuy(player, { ok: true, offer, weapon: owned[0], upgraded: true }, slotIndex);
        }
        return { ok: false, reason: `武器栏已满（最多 ${MAX_WEAPONS} 把），先卖掉一把` };
      }
    }

    player.materials -= offer.price;
    offer.sold = true;

    if (offer.kind === 'weapon') {
      const inst = player.addWeapon(offer.data.id, 1);
      return this._finishBuy(player, { ok: true, offer, weapon: inst }, slotIndex);
    }
    // 道具添加失败须退材料且不标售，与偷取交易保持同一回滚语义。
    if (!player.addItem(offer.data.id)) {
      player.materials += offer.price;
      offer.sold = false;
      return { ok: false, reason: '已达叠加上限' };
    }
    return this._finishBuy(player, { ok: true, offer }, slotIndex);
  }

  // 购买成功统一标售并处理自动合成/补货，避免UI和AI产生不同副作用。
  _finishBuy(player: Player, result: BuyResult, slotIndex = 0) {
    const auto = this._maybeAutoReroll(player, slotIndex);
    if (auto) result.autoReroll = auto;
    return result;
  }

  /** 是否所有槽位都已售出 */
  get allSold() {
    if (this.offers.length === 0) return false;
    return this.offers.every((o) => !o || o.sold);
  }

  // 每个买家只操作自己四格货架，买空与免费补货不能扫描他人商品。
  _buyerRange(slotIndex: number) {
    if (this.offers.length <= SHOP_SLOTS) return [0, Math.max(1, this.offers.length)];
    // 201 轮：原来只分"前半/后半"（half = slotIndex>=4 ? 1 : 0），3P/4P 时 P3、P4 的买家被算成 P2 的段 [4,8) ——
    // 他们买空自己那段时检查的是 P2 的货架，并且错把 P2 的货架整段重建。现在按段号（每段 4 格）。
    const maxSeg = Math.floor((this.offers.length - 1) / SHOP_SLOTS);
    const k = Math.min(this._segOf(slotIndex), maxSeg);
    return [k * SHOP_SLOTS, k * SHOP_SLOTS + SHOP_SLOTS];
  }

  // 宠物免费道具从合法池抽取并交给真实领取者；成功后才标记与反馈。
  tryStealItem(player: Player, rng = this.rng) {
    // 先掷骰子 —— 概率不过就什么都不发生（也不消耗货架）
    // 传 luckEff（含角色幸运倍率），不是面板值 —— 见 stealChance 的注释。
    const chance = stealChance(player?.stats?.luckEff ?? 0);
    if (rng.next() >= chance) return null;

    // 找出所有未售出的**道具**槽位
    const candidates = [];
    for (let i = 0; i < this.offers.length; i++) {
      const o = this.offers[i];
      if (o && !o.sold && o.kind === 'item') candidates.push(o);
    }
    if (candidates.length === 0) return null;

    // 随机挑一件，并**逐个尝试**：如果挑中的那件已经叠满，
    // 换下一件再试，而不是直接放弃本次机会。
    // （否则玩家道具全满时这个功能会静默失效，很难排查）
    const order = candidates.slice();
    for (let n = order.length; n > 1; n--) {
      const k = Math.floor(rng.next() * n);
      [order[n - 1], order[k]] = [order[k], order[n - 1]];
    }
    for (const offer of order) {
      if (!player.addItem(offer.data.id)) continue;
      // 偷到手 → 从货架上消失（免费，所以不扣材料）
      offer.sold = true;
      // 偷完如果货架空了，走和"买空"同一条自动补货路径，
      // 否则玩家会面对一个空商店且没有免费刷新按钮可点。
      this._maybeAutoReroll(player);
      return { offer, item: offer.data };
    }
    return null;
  }

  // 买空本买家货架后免费补货；保留其他买家商品和刷新计数。
  _maybeAutoReroll(player: Player, slotIndex = 0) {
    // 买空与补货仅作用当前买家的四格，其他队员不阻挡也不受影响。
    const [from, to] = this._buyerRange(slotIndex);
    let hasOffer = false;
    for (let i = from; i < to; i++) {
      const o = this.offers[i];
      if (!o) continue;
      hasOffer = true;
      if (!o.sold) return null;   // 这半边还有货 → 不补
    }
    if (!hasOffer) return null;

    // 保留锁定（虽然买空了通常没有锁，但逻辑上保持一致）
    const kept: Offer[] = [];
    for (let i = from; i < to; i++) {
      if (this.locked.has(i) && !this.offers[i].sold) kept[i] = this.offers[i];
    }
    for (let i = from; i < to; i++) {
      if (kept[i]) { this.offers[i] = kept[i]; continue; }
      this.offers[i] = this._makeOffer(player, this.currentWave ?? 0);
    }
    // 免费补货后清旧锁，避免新商品继承旧下标的锁定权益。
    for (let i = from; i < to; i++) this.locked.delete(i);
    return { offers: this.offers, free: true };
  }

  // 满栏购买只有能立即合成腾位时合法；合成判断与实际购买共用条件。
  _tryAutoCombine(player: Player, offer: ShopOffer<'weapon'>) {
    const recipe = RECIPE_MAP[offer.data.id];
    if (!recipe) return null;
    // 买这把需要的钱 + 合成费
    if (player.materials < offer.price + recipe.cost) return null;

    const owned = player.findWeapons(offer.data.id);
    if (owned.length < 1) return null;

    // 先把这把「买进来」临时凑成两把：直接吃掉一把已有的 + 这次买的
    const consumed = owned[0];
    player.removeWeapon(consumed);

    const target = getWeapon(recipe.to);
    player.materials -= recipe.cost;

    const existing = player.findWeapons(recipe.to);
    if (existing.length > 0) {
      existing[0].level++;
      return { combined: true, target, upgradedExisting: true, level: existing[0].level };
    }
    const inst = player.addWeapon(recipe.to, 1);
    return { combined: true, target, weapon: inst };
  }

  /**
   * 武器合成：需要两把同名武器 + 材料
   */
  canCombine(player: Player, weaponId: string) {
    const recipe = Object.hasOwn(RECIPE_MAP, weaponId) ? RECIPE_MAP[weaponId as WeaponId] : undefined;
    if (!recipe) return null;
    const owned = player.findWeapons(weaponId);
    if (owned.length < 2) return null;
    if (player.materials < recipe.cost) return { recipe, needMaterials: recipe.cost - player.materials, owned: owned.length };
    const target = getWeapon(recipe.to);
    // 合成本身会释放一个武器槽，所以槽位不是问题
    return { recipe, target, owned: owned.length, ok: true };
  }

  combine(player: Player, weaponId: string) {
    const info = this.canCombine(player, weaponId);
    if (!info || !info.ok) return { ok: false, reason: '无法合成' };
    const { recipe, target } = info;

    const owned = player.findWeapons(weaponId);
    // 移除两把
    player.removeWeapon(owned[0]);
    player.removeWeapon(owned[1]);
    // 扣材料
    player.materials -= recipe.cost;
    // 给新武器：如果已经拥有同款，升级它
    const existing = player.findWeapons(recipe.to);
    if (existing.length > 0) {
      existing[0].level++;
      return { ok: true, upgraded: true, target, level: existing[0].level };
    }
    const inst = player.addWeapon(recipe.to, 1);
    return { ok: true, upgraded: false, target, weapon: inst };
  }

  // 刷新只改当前买家四格，保留该段锁定商品；计数按买家分别维护。
  reroll(player: Player, slotIndex = 0) {
    const k = this._segOf(slotIndex);
    const cost = this.rerollCostFor(slotIndex);
    if (player.materials < cost) return { ok: false, reason: '材料不足' };
    player.materials -= cost;
    if (k === 0) this.rerollCount++;
    else this.mateRerolls.set(k, (this.mateRerolls.get(k) ?? 0) + 1);
    const from = k * SHOP_SLOTS, to = from + SHOP_SLOTS;
    // 保留锁定（锁只存在于 P1 段，但按下标通用处理）
    const kept: Offer[] = [];
    for (let i = from; i < to; i++) {
      if (this.locked.has(i) && this.offers[i] && !this.offers[i].sold) kept[i] = this.offers[i];
    }
    for (let i = from; i < to; i++) {
      if (kept[i]) { this.offers[i] = kept[i]; continue; }
      this.offers[i] = this._makeOffer(player, this.currentWave ?? 0);
    }
    return { ok: true, cost };
  }

  toggleLock(index: number) {
    if (this.locked.has(index)) this.locked.delete(index);
    else if (!this.offers[index]?.sold) this.locked.add(index);
    return this.locked.has(index);
  }

  /**
   * 卖出武器换材料。
   * 价格按 tier 与等级给，保证「卖了不亏太多」——玩家不该因为
   * 想换流派而受到惩罚性损失。
   */
  sellValue(weaponInst: WeaponInstance) {
    const def = weaponInst.def;
    const base = def.tier === 4 ? 30 : def.tier === 3 ? 20 : def.tier === 2 ? 12 : 6;
    return Math.max(2, Math.round(base + (weaponInst.level - 1) * 6));
  }

  sellWeapon(player: Player, weaponInst: WeaponInstance) {
    const value = this.sellValue(weaponInst);
    player.removeWeapon(weaponInst);
    player.materials += value;
    return value;
  }
}
