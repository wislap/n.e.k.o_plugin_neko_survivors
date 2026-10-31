import type { WeatherSnapshot } from '../encounters/weather.ts';
import type { CometSnapshot } from '../encounters/comet.ts';
/** Data needed to restart a wave with the same independent environmental streams. */
type Scalar = number | boolean | string | null;
type Row = Record<string, Scalar>;
/** Explicit mechanic/projection fields; presentation-only buffers never enter saves. */
const WEATHER_ENTITIES = {
  meteors: ['x', 'y', 'r', 'warnT', 'side'],
  burnZones: ['x', 'y', 'r', 't', 'max'],
  typhoons: ['x', 'y', 'r', 'vx', 'vy', 'spin', 'turnT'],
  fogClouds: ['x', 'y', 'r', 'vx', 'vy', 'turnT', 'seed'],
} as const;
type WeatherCollection = keyof typeof WEATHER_ENTITIES;
export interface WaveSystemsSave { weather: WeatherSnapshot; comet: CometSnapshot }
const WEATHER_FIELDS = ['phase', 'id', 't', 'dur', 'cd', 'rollAcc', 'announceT', 'visT', 'justStarted',
  'miss', 'playerOut', 'enemyOut', 'moveMul', 'enemyFireMul', 'cooldownDiv', 'invulnMin', 'noKnockback',
  'vacuum', 'fogRamp', 'metAcc', 'flash', 'dotAcc', 'fadeT', '_fadeDur'] as const;
const WEATHER_ARRAYS = Object.keys(WEATHER_ENTITIES) as WeatherCollection[];
const COMET_FIELDS = ['phase', 't', 'age', 'fired', 'pending', 'dir', 'cx', 'cy', 'shake', 'flash', 'half', '_bgmDelay'] as const;
const WEATHER_BOOLEANS = new Set(['justStarted', 'noKnockback', 'vacuum']);
const COMET_BOOLEANS = new Set(['fired', 'pending']);
function typedFields(value: Record<string, unknown>, booleans: ReadonlySet<string>): boolean {
  return Object.entries(value).every(([key, field]) => key === 'phase' ? typeof field === 'string'
    : key === 'id' ? field === null || typeof field === 'string'
    : booleans.has(key) ? typeof field === 'boolean' : typeof field === 'number' && Number.isFinite(field));
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const scalar = (value: unknown): value is Scalar => value === null || typeof value === 'boolean' || typeof value === 'string'
  || typeof value === 'number' && Number.isFinite(value);
const row = (value: unknown): value is Row => record(value) && Object.values(value).every(scalar);
function validEntity(value: unknown, collection: WeatherCollection): value is Row {
  const keys: readonly string[] = WEATHER_ENTITIES[collection];
  return record(value) && Object.keys(value).length === keys.length
    && keys.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]));
}
export function isWaveSystems(value: unknown): value is WaveSystemsSave {
  if (!record(value) || !record(value.weather) || !record(value.comet)) return false;
  const { weather, comet } = value;
  const integer = (state: unknown) => typeof state === 'number' && Number.isSafeInteger(state);
  if (!record(weather.fields) || !record(comet.fields) || !record(weather.arrays)) return false;
  const weatherFields = weather.fields, cometFields = comet.fields, weatherArrays = weather.arrays;
  if (weather.fields.phase != null && (typeof weather.fields.phase !== 'string' || !['idle', 'active', 'fading', 'cooldown'].includes(weather.fields.phase))) return false;
  if (weather.fields.id != null && (typeof weather.fields.id !== 'string' || !['fog', 'bloodMoon', 'meteor', 'rain', 'breeze', 'typhoon', 'clear', 'scorch', 'calm', 'riverFog'].includes(weather.fields.id))) return false;
  if (comet.fields.phase != null && (typeof comet.fields.phase !== 'string' || !['idle', 'pending', 'banner', 'gap1', 'fly1', 'gap2', 'fly2', 'gap3', 'dive', 'boom', 'roar', 'takeoff', 'done'].includes(comet.fields.phase))) return false;
  if (!Array.isArray(weather.playerBurns) || !weather.playerBurns.every(burn => record(burn)
    && typeof burn.playerId === 'number' && typeof burn.t === 'number' && Number.isFinite(burn.t)
    && typeof burn.acc === 'number' && Number.isFinite(burn.acc))) return false;
  return integer(weather.rngState) && integer(weather.visualRngState) && integer(comet.rngState)
    && WEATHER_FIELDS.every(key => Object.hasOwn(weatherFields, key))
    && COMET_FIELDS.every(key => Object.hasOwn(cometFields, key))
    && typedFields(weather.fields, WEATHER_BOOLEANS) && row(weather.fields) && Object.keys(weather.fields).every(key => WEATHER_FIELDS.includes(key as typeof WEATHER_FIELDS[number]))
    && typedFields(comet.fields, COMET_BOOLEANS) && row(comet.fields) && Object.keys(comet.fields).every(key => COMET_FIELDS.includes(key as typeof COMET_FIELDS[number]))
    && record(weather.arrays) && WEATHER_ARRAYS.every(key => Array.isArray(weatherArrays[key])) && Object.entries(weather.arrays).every(([key, values]) =>
      WEATHER_ARRAYS.includes(key as typeof WEATHER_ARRAYS[number]) && Array.isArray(values) && values.length < 4096 && values.every(value => validEntity(value, key as WeatherCollection)));
}
