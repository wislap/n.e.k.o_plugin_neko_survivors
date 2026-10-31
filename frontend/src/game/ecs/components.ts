export const MOTION_FIELDS = ['x', 'y', 'vx', 'vy', 'radius', 'age', 'dead'] as const;
export const PLAYER_SHOT_FIELDS = [...MOTION_FIELDS, 'angle', 'speed', 'damage', 'pierce', 'itemPierce', 'innatePierce', 'itemUsed', 'homing', 'bounces', 'bounced', 'explosionRadius', 'maxRange', 'traveled', 'trailTimer'] as const;
export const ENEMY_SHOT_FIELDS = [...MOTION_FIELDS, 'angle', 'speed', 'damage', 'maxRange', 'traveled', 'rotation', 'hitRadius', 'laserLength', 'decel', 'floorSpeed', 'trueTier', 'hwPhase'] as const;
export const PICKUP_FIELDS = [...MOTION_FIELDS, 'value', 'attracted', 'bobPhase', 'life', 'variant'] as const;
export type ComponentColumns = Record<string, Float64Array>;

export const PICKUP_TYPE = { XP: 'xp', MATERIAL: 'material', HEAL: 'heal' } as const;

const EMPTY_COLUMN = new Float64Array(0);
/** Fixed schemas use literal property layouts: dictionary-mode column lookups
 * in every numeric operation defeat the purpose of dense component storage. */
export function createComponentColumns(fields: readonly string[]): ComponentColumns {
  if (fields === PLAYER_SHOT_FIELDS) return { x: EMPTY_COLUMN, y: EMPTY_COLUMN, vx: EMPTY_COLUMN, vy: EMPTY_COLUMN, radius: EMPTY_COLUMN, age: EMPTY_COLUMN, dead: EMPTY_COLUMN, angle: EMPTY_COLUMN, speed: EMPTY_COLUMN, damage: EMPTY_COLUMN, pierce: EMPTY_COLUMN, itemPierce: EMPTY_COLUMN, innatePierce: EMPTY_COLUMN, itemUsed: EMPTY_COLUMN, homing: EMPTY_COLUMN, bounces: EMPTY_COLUMN, bounced: EMPTY_COLUMN, explosionRadius: EMPTY_COLUMN, maxRange: EMPTY_COLUMN, traveled: EMPTY_COLUMN, trailTimer: EMPTY_COLUMN };
  if (fields === ENEMY_SHOT_FIELDS) return { x: EMPTY_COLUMN, y: EMPTY_COLUMN, vx: EMPTY_COLUMN, vy: EMPTY_COLUMN, radius: EMPTY_COLUMN, age: EMPTY_COLUMN, dead: EMPTY_COLUMN, angle: EMPTY_COLUMN, speed: EMPTY_COLUMN, damage: EMPTY_COLUMN, maxRange: EMPTY_COLUMN, traveled: EMPTY_COLUMN, rotation: EMPTY_COLUMN, hitRadius: EMPTY_COLUMN, laserLength: EMPTY_COLUMN, decel: EMPTY_COLUMN, floorSpeed: EMPTY_COLUMN, trueTier: EMPTY_COLUMN, hwPhase: EMPTY_COLUMN };
  if (fields === PICKUP_FIELDS) return { x: EMPTY_COLUMN, y: EMPTY_COLUMN, vx: EMPTY_COLUMN, vy: EMPTY_COLUMN, radius: EMPTY_COLUMN, age: EMPTY_COLUMN, dead: EMPTY_COLUMN, value: EMPTY_COLUMN, attracted: EMPTY_COLUMN, bobPhase: EMPTY_COLUMN, life: EMPTY_COLUMN, variant: EMPTY_COLUMN };
  return Object.fromEntries(fields.map(name => [name, EMPTY_COLUMN]));
}
