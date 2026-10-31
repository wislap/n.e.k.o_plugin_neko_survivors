import { getItem } from '../content/items.ts';
import { createEmptyMeta, isGameMeta, type GameMeta } from './meta.ts';
import { Player } from '../actors/player.ts';
import { CHARACTERS } from '../content/characters.ts';
import { RNG } from '../math/random.ts';
import { WeatherSystem } from '../encounters/weather.ts';
import { CometDisaster } from '../encounters/comet.ts';
import { Pet } from '../actors/pet.ts';
import { rollSkill } from '../ai/skills.ts';
/** One explicit data migration. Runtime restoration only receives the current shape. */
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const PLAYER_KEYS = ['characterId', 'id', 'x', 'y', 'level', 'xp', 'xpNeeded', 'materials', 'hp', 'weapons', 'items', 'upgrades',
  'stats', 'shield', 'maxShield', 'shieldFullBlock', 'apPierce', 'kills', 'damageDealt', 'damageTaken', 'timeAlive', 'charMul',
  'dealtFinalMul', 'takenFinalMul', 'xpDebt', 'materialDebt', 'pendingLevelUps', 'armorWave'];
/** Only explicit import recognizes the old presentation preference in growth metadata. */
export function splitLegacyMeta(value: unknown): { meta: unknown; playerEffectOpacity?: number } {
  if (value == null) return { meta: null };
  if (!record(value)) throw new TypeError('旧成长记录格式无效');
  const meta = structuredClone(value), alpha = meta.fxAlpha;
  if (alpha !== undefined && (typeof alpha !== 'number' || !Number.isFinite(alpha) || alpha < 0 || alpha > 100)) {
    throw new TypeError('旧特效透明度无效');
  }
  delete meta.fxAlpha;
  return { meta: Object.keys(meta).length ? meta : null,
    ...(typeof alpha === 'number' ? { playerEffectOpacity: alpha / 100 } : {}) };
}
/** Missing fields are accepted only while explicitly importing an older profile. */
export function convertLegacyMeta(value: unknown): GameMeta | null {
  if (value == null) return null;
  if (!record(value)) throw new TypeError('旧成长记录格式无效');
  const current = createEmptyMeta(), fields = Object.keys(current);
  if (!fields.some(key => Object.hasOwn(value, key))) throw new TypeError('旧成长记录没有有效字段');
  const merged = { ...current, ...Object.fromEntries(Object.entries(value).filter(([key]) => fields.includes(key))) };
  if (!isGameMeta(merged)) throw new TypeError('旧成长记录内容无效');
  return structuredClone(merged);
}
function convertPlayer(value: unknown, seed: number, slot: number): unknown {
  if (!record(value) || typeof value.characterId !== 'string' || !CHARACTERS.some(character => character.id === value.characterId)) return value;
  const initial = new Player(value.characterId, new RNG(seed)); initial.id = slot;
  const defaults = initial.captureState();
  const player: RecordValue = { ...defaults, ...value };
  if (record(value.stats)) player.stats = { ...defaults.stats, ...value.stats };
  delete player.slot;
  return player;
}
function cleanEnvironment(value: unknown): void {
  if (!record(value) || !record(value.weather) || !record(value.weather.arrays)) return;
  for (const rows of Object.values(value.weather.arrays)) if (Array.isArray(rows)) for (const entity of rows) {
    if (!record(entity)) continue;
    for (const field of ['parts', 'streaks', 'blobs', 'drops']) delete entity[field];
  }
}
function convertRun(value: unknown): unknown {
  if (!record(value)) return value;
  const run = structuredClone(value);
  if (!record(run.player)) {
    run.player = Object.fromEntries(PLAYER_KEYS.filter(key => key in run).map(key => [key, run[key]]));
    for (const key of PLAYER_KEYS) delete run[key];
  }
  if (run.pilot === undefined && run.p1Ai !== undefined) run.pilot = run.p1Ai;
  if (run.phase === 'play') run.phase = 'playing';
  delete run.p1Ai; delete run.party;
  if (record(run.shop)) {
    delete run.shop.freeRerollUsed;
    if (Array.isArray(run.shop.offers)) for (const offer of run.shop.offers) if (record(offer)) {
      if (offer.meta === undefined) offer.meta = {};
      if (offer.sold === undefined) offer.sold = false;
    }
  }
  cleanEnvironment(run.systems);
  if (record(run.waveStartRules)) cleanEnvironment(run.waveStartRules.systems);
  if (typeof run.seed !== 'number' || !Number.isFinite(run.seed) || !record(run.player)) return run;
  const seed = run.seed;
  run.player = convertPlayer(run.player, seed, 1);
  if (Array.isArray(run.mates)) run.mates = run.mates.map((mate, index) => convertPlayer(mate, seed, index + 2));
  const rng = new RNG(run.seed);
  const systems = { weather: new WeatherSystem(rng).captureState(), comet: new CometDisaster({ rng }).captureState() };
  // Missing historical fields receive the real subsystem defaults at this one import boundary.
  for (const candidate of [run.systems, record(run.waveStartRules) ? run.waveStartRules.systems : undefined]) {
    if (!record(candidate)) continue;
    for (const key of ['weather', 'comet'] as const) {
      if (!record(candidate[key])) continue;
      const section = candidate[key], initial = systems[key];
      if (record(section.fields)) for (const [field, value] of Object.entries(initial.fields)) {
        if (section.fields[field] === undefined) section.fields[field] = value;
      }
      if (key === 'weather') {
        if (section.playerBurns === undefined) section.playerBurns = [];
        if (record(section.arrays)) for (const collection of Object.keys(systems.weather.arrays)) {
          if (section.arrays[collection] === undefined) section.arrays[collection] = [];
        }
      }
    }
  }
  if (!record(run.player)) return run;
  const player = run.player;
  const pet = new Pet('kitten', { x: typeof player.x === 'number' ? player.x : 0,
    y: typeof player.y === 'number' ? player.y : 0 }).captureState();
  for (const key of ['pet', 'challengeStartPet']) {
    const previous = run[key];
    if (record(previous) && record(previous.fields)) run[key] = {
      ...pet, ...previous, fields: { ...pet.fields, ...previous.fields },
    };
  }
  const defaults: RecordValue = {
    difficulty: 'normal', phase: 'playing', rngState: rng.state, waveStartRngState: rng.state,
    mates: [], bossChoices: {}, endless: typeof run.waveIndex === 'number' && run.waveIndex >= 20, won: false,
    pilot: false, handoverHealth: null, retries: 0, manualRetries: run.retries ?? 0, vergilFought: false, autoUpgrade: false,
    challenge: null, challengeChain: false, backgroundId: 'plaza', pendingItemRewards: [],
    pet, afterUpgrade: 'playing', upgradeOptions: [], systems, diffHp: 1, diffDmg: 1, cometFired: false,
    shop: { offers: [], locked: [], rerollCount: 0, mateRerolls: [] },
  };
  for (const [key, value] of Object.entries(defaults)) if (run[key] === undefined) run[key] = value;
  if (Array.isArray(run.pendingItemRewards)) run.pendingItemRewards = run.pendingItemRewards.map(value => {
    if (!record(value) || typeof value.id !== 'string') return value;
    const item = getItem(value.id);
    if (!item) return value;
    return { name: item.name, price: item.price, rare: item.price >= 26, ...value };
  });
  if (run.aiProfiles === undefined) {
    const mates = Array.isArray(run.mates) ? run.mates : [];
    run.aiProfiles = [player, ...mates].map((_, slot) => {
      const stream = rng.fork(slot + 101), skill = slot === 0 ? 'pro' : rollSkill(() => stream.next());
      return { id: slot + 1, skill, rngState: stream.state };
    });
  }
  if (run.waveStartRules === undefined) run.waveStartRules = {
    rngState: run.waveStartRngState, backgroundId: run.backgroundId, lastSpecialWave: -999, specialCache: [], systems: structuredClone(run.systems),
  };
  if (record(run.waveStartRules)) {
    if (run.waveStartRules.lastSpecialWave === undefined) run.waveStartRules.lastSpecialWave = -999;
    if (run.waveStartRules.systems === undefined) run.waveStartRules.systems = structuredClone(run.systems);
  }
  return run;
}
export function convertLegacyEnvelope(value: unknown): unknown {
  if (!record(value)) throw new TypeError('旧存档格式无效');
  if ('format' in value) {
    if (value.format !== 'neko-survivors-react' || value.version !== 1) throw new TypeError('不支持的旧存档版本');
    const meta = convertLegacyMeta(splitLegacyMeta(value.meta).meta);
    return { format: 'neko-survivors-react', version: 2, run: convertRun(value.run),
      checkpoint: value.checkpoint == null ? null : convertRun(value.checkpoint), ...(meta == null ? {} : { meta }) };
  }
  return { format: 'neko-survivors-react', version: 2, run: convertRun(value), checkpoint: null };
}
