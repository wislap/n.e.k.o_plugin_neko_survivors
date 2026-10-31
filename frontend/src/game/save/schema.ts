import { isPetSave } from './pet-state.ts';
import { isWaveSystems } from './wave-systems.ts';
import type { GameSaveData, RunSave, PlayerSave } from './types.ts';
import { isGameMeta, type GameMeta } from './meta.ts';
import { convertLegacyEnvelope, splitLegacyMeta, convertLegacyMeta } from './legacy-run.ts';
import { CHARACTERS } from '../content/characters.ts';
import { WEAPONS } from '../content/weapons.ts';
import { ITEMS } from '../content/items.ts';
import { UPGRADES } from '../content/upgrades.ts';
import { ENEMIES } from '../content/enemies.ts';
import { STAT_KEYS, CURSE_FLOOR } from '../progression/stats.ts';
import { DIFFICULTY_ORDER } from '../content/difficulty.ts';

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const WEAPON_IDS: ReadonlySet<string> = new Set(WEAPONS.map(definition => definition.id));
const ITEM_IDS: ReadonlySet<string> = new Set(ITEMS.map(definition => definition.id));
const UPGRADE_IDS: ReadonlySet<string> = new Set(UPGRADES.map(definition => definition.id));
const finite = (value: unknown, min = 0): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min;
const optionalNumber = (value: Record<string, unknown>, key: string, min = 0) =>
  value[key] == null || finite(value[key], min);
const optionalBoolean = (value: Record<string, unknown>, key: string) =>
  value[key] == null || typeof value[key] === 'boolean';
function validPlayer(player: unknown): player is PlayerSave {
  if (!object(player) || !CHARACTERS.some(char => char.id === player.characterId)) return false;
  const required = ['id', 'x', 'y', 'xpNeeded', 'materials', 'shield', 'maxShield', 'shieldFullBlock', 'apPierce',
    'kills', 'damageDealt', 'damageTaken', 'timeAlive', 'charMul', 'dealtFinalMul', 'takenFinalMul', 'xpDebt', 'materialDebt', 'pendingLevelUps'];
  if (!required.every(key => Object.hasOwn(player, key) && player[key] != null)) return false;
  if (!Number.isInteger(player.id) || !finite(player.id, 1) || player.id > 4 || !finite(player.xpNeeded, 1)) return false;
  if (!finite(player.dealtFinalMul, Number.MIN_VALUE) || !finite(player.takenFinalMul, Number.MIN_VALUE)) return false;
  if (!Number.isInteger(player.level) || !finite(player.level, 1) || player.level > 100000) return false;
  if (!finite(player.xp) || !finite(player.materials) || !finite(player.hp)) return false;
  if (!Array.isArray(player.weapons) || player.weapons.length > 6) return false;
  if (!player.weapons.every(w => object(w) && typeof w.id === 'string' && WEAPON_IDS.has(w.id) && Number.isInteger(w.level) && finite(w.level, 1)
    && (w.instanceId === undefined || Number.isSafeInteger(w.instanceId) && finite(w.instanceId, 1)))) return false;
  const entries = (value: unknown, ids: ReadonlySet<string>) => Array.isArray(value)
    && value.every(pair => Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string'
      && ids.has(pair[0]) && Number.isInteger(pair[1]) && finite(pair[1]));
  if (!entries(player.items, ITEM_IDS) || !entries(player.upgrades, UPGRADE_IDS)) return false;
  if (!object(player.stats)) return false;
  if (player.charMul != null && (!object(player.charMul) || Object.values(player.charMul).some(value => !finite(value)))) return false;
  for (const key of ['base', 'flat', 'pct', 'curse', 'finalMul', 'capBonus']) {
    if (!object(player.stats[key])
      || Object.entries(player.stats[key]).some(([key, value]) => !STAT_KEYS.some(statKey => statKey === key) || !finite(value, -Infinity))) return false;
  }
  if (Object.values(player.stats.curse as Record<string, unknown>).some(value => !finite(value, CURSE_FLOOR) || value > 1)) return false;
  if (Object.values(player.stats.finalMul as Record<string, unknown>).some(value => !finite(value, Number.MIN_VALUE))) return false;
  if (Object.values(player.stats.capBonus as Record<string, unknown>).some(value => !finite(value))) return false;
  if (!finite(player.stats.luckEffectMul, Number.MIN_VALUE)) return false;
  for (const key of ['id', 'xpNeeded', 'shield', 'maxShield', 'apPierce', 'kills', 'damageDealt', 'damageTaken',
    'timeAlive', 'xpDebt', 'materialDebt', 'pendingLevelUps', 'armorWave', 'dealtFinalMul', 'takenFinalMul']) {
    if (!optionalNumber(player, key)) return false;
  }
  if (player.armorWave !== undefined && (!Number.isSafeInteger(player.armorWave) || !finite(player.armorWave))) return false;
  if (!optionalBoolean(player, 'shieldFullBlock') || !optionalNumber(player, 'x', -Infinity) || !optionalNumber(player, 'y', -Infinity)) return false;
  return true;
}

/** Current saves only. Legacy data must pass the explicit import converter. */
export function isSupportedSave(value: unknown): value is GameSaveData {
  return object(value) && Object.hasOwn(value, 'checkpoint') && value.format === 'neko-survivors-react' && value.version === 2 && validRun(value.run)
    && (value.checkpoint == null || validRun(value.checkpoint)) && (value.meta == null || isGameMeta(value.meta));
}
function validRun(run: unknown): run is RunSave {
  if (!object(run) || ['p1Ai', 'party', 'characterId'].some(key => key in run) || !Number.isInteger(run.waveIndex) || !finite(run.waveIndex) || run.waveIndex > 100000) return false;
  const required = ['difficulty', 'phase', 'rngState', 'waveStartRngState', 'mates', 'bossChoices', 'endless', 'won', 'pilot',
    'handoverHealth', 'retries', 'manualRetries', 'vergilFought', 'autoUpgrade', 'challenge', 'challengeChain', 'backgroundId',
    'pendingItemRewards', 'pet', 'afterUpgrade', 'upgradeOptions', 'aiProfiles', 'systems', 'diffHp', 'diffDmg', 'cometFired', 'waveStartRules', 'shop'];
  if (!required.every(key => Object.hasOwn(run, key) && (run[key] != null || key === 'handoverHealth' || key === 'challenge'))) return false;
  if (typeof run.backgroundId !== 'string') return false;
  if (run.difficulty != null && (typeof run.difficulty !== 'string' || !DIFFICULTY_ORDER.some(id => id === run.difficulty))) return false;
  if (!finite(run.seed) || !validPlayer(run.player) || run.player.id !== 1) return false;
  if (run.mates != null && (!Array.isArray(run.mates) || run.mates.length > 3 || !run.mates.every((mate, index) => validPlayer(mate) && mate.id === index + 2))) return false;
  if (run.phase != null && (typeof run.phase !== 'string' || !['playing', 'shop', 'upgrade', 'paused', 'result', 'endless-prompt', 'flandre', 'vergil', 'remilia', 'halloween'].includes(run.phase))) return false;
  for (const key of ['diffHp', 'diffDmg']) if (run[key] != null && (!finite(run[key]) || run[key] <= 0)) return false;
  if (run.pendingItemRewards != null && (!Array.isArray(run.pendingItemRewards)
    || !run.pendingItemRewards.every(reward => object(reward) && typeof reward.id === 'string' && ITEM_IDS.has(reward.id) && finite(reward.sellValue)
      && typeof reward.name === 'string' && finite(reward.price) && typeof reward.rare === 'boolean'))) return false;
  if (run.waveStartRules != null) {
    const rules = run.waveStartRules;
    if (!object(rules) || !Number.isInteger(rules.lastSpecialWave) || !isWaveSystems(rules.systems) || !Number.isInteger(rules.rngState) || typeof rules.backgroundId !== 'string'
      || !Array.isArray(rules.specialCache) || !rules.specialCache.every(pair => Array.isArray(pair) && Number.isInteger(pair[0])
        && (pair[1] === null || typeof pair[1] === 'string' && ['charge', 'bullet', 'tank', 'chaos', 'slack', 'payday', 'egg'].includes(pair[1])))) return false;
  }
  if (run.upgradeOptions != null && (!Array.isArray(run.upgradeOptions) || run.upgradeOptions.length > 3
    || !run.upgradeOptions.every(option => object(option) && typeof option.id === 'string' && UPGRADE_IDS.has(option.id)
      && typeof option.rarity === 'string' && ['common', 'rare', 'epic', 'legendary'].includes(option.rarity)))) return false;
  if (run.afterUpgrade != null && run.afterUpgrade !== 'playing' && run.afterUpgrade !== 'shop') return false;
  for (const key of ['endless', 'won', 'abandoned', 'pilot', 'vergilFought', 'autoUpgrade', 'challengeChain', 'cometFired']) {
    if (!optionalBoolean(run, key)) return false;
  }
  if (run.abandoned === true && run.phase !== 'result') return false;
  if (!optionalNumber(run, 'challengeStartRngState', -2147483648)) return false;
  if (run.aiProfiles != null && (!Array.isArray(run.aiProfiles) || run.aiProfiles.length > 4 || !run.aiProfiles.every(profile =>
    object(profile) && finite(profile.id, 1) && Number.isInteger(profile.id) && profile.id <= 4
      && typeof profile.skill === 'string' && ['pro', 'normal', 'rookie'].includes(profile.skill) && finite(profile.rngState, -2147483648)))) return false;
  if (run.bossChoices != null && (!object(run.bossChoices) || !Object.entries(run.bossChoices).every(([key, value]) =>
    typeof value === 'string' && ENEMIES.some(enemy => enemy.id === key) && ENEMIES.some(enemy => enemy.id === value)))) return false;
  for (const key of ['retries', 'manualRetries', 'rngState', 'waveStartRngState']) if (!optionalNumber(run, key, key.includes('State') ? -2147483648 : 0)) return false;
  if (run.aiAttempts !== undefined) {
    if (!Array.isArray(run.aiAttempts) || run.aiAttempts.length > 100001) return false;
    const waves = new Set<number>();
    for (const pair of run.aiAttempts) {
      if (!Array.isArray(pair) || pair.length !== 2 || !Number.isInteger(pair[0]) || !finite(pair[0]) || pair[0] > 100000
        || !Number.isInteger(pair[1]) || !finite(pair[1], 1) || pair[1] > 5 || waves.has(pair[0])) return false;
      waves.add(pair[0]);
    }
  }
  if (run.handoverHealth !== null && (!finite(run.handoverHealth) || run.handoverHealth > 1)) return false;
  if (run.challenge !== null && (typeof run.challenge !== 'string' || !['flandre', 'vergil', 'remilia', 'halloween'].includes(run.challenge))) return false;
  if (run.pet != null && !isPetSave(run.pet) || run.challengeStartPet != null && !isPetSave(run.challengeStartPet)) return false;
  if (run.systems != null && !isWaveSystems(run.systems)) return false;
  if (run.shop != null) {
    const shop = run.shop;
    if (!object(shop) || 'freeRerollUsed' in shop || !Array.isArray(shop.offers) || shop.offers.length > 16) return false;
    if (!shop.offers.every(offer => object(offer) && typeof offer.id === 'string' && finite(offer.price) && typeof offer.sold === 'boolean' && object(offer.meta)
      && (offer.pawMark === undefined || typeof offer.pawMark === 'boolean' || finite(offer.pawMark) && offer.pawMark <= 1)
      && (offer.kind === 'weapon' ? !!WEAPON_IDS.has(offer.id) : offer.kind === 'item' && !!ITEM_IDS.has(offer.id)))) return false;
    if (!finite(shop.rerollCount)) return false;
    const offerCount = shop.offers.length;
    if (!Array.isArray(shop.locked) || !shop.locked.every(slot => Number.isInteger(slot) && slot >= 0 && slot < offerCount)) return false;
    if (!Array.isArray(shop.mateRerolls) || !shop.mateRerolls.every(pair => Array.isArray(pair)
      && Number.isInteger(pair[0]) && pair[0] >= 1 && pair[0] <= 3 && finite(pair[1]))) return false;
  }
  return true;
}
export function decodeSave(value: unknown): GameSaveData {
  if (!isSupportedSave(value)) throw new TypeError('存档格式或内容无效');
  return structuredClone(value);
}
/** Used only by the user's explicit legacy import action. */
export function convertLegacyProgress(source: { run: unknown | null; meta: unknown | null }):
  { run: GameSaveData | null; meta: GameMeta | null; settings?: { playerEffectOpacity: number } } | null {
  try {
    const explicit = splitLegacyMeta(source.meta);
    const embedded = object(source.run) ? splitLegacyMeta(source.run.meta) : { meta: null };
    const meta = convertLegacyMeta(explicit.meta);
    const run = source.run == null ? null : decodeSave(convertLegacyEnvelope(source.run));
    const opacity = explicit.playerEffectOpacity ?? embedded.playerEffectOpacity;
    return { run, meta,
      ...(opacity === undefined ? {} : { settings: { playerEffectOpacity: opacity } }) };
  } catch { return null; }
}
