export interface Timed { t: number; life: number }
export interface Positioned { x: number; y: number }
export interface AngledTrail extends Timed, Positioned { angle: number; vx?: number; vy?: number }
export interface MovingSpark extends Timed, Positioned { vx: number; vy: number }
export interface SeededFlash extends Timed, Positioned { seed: number }
export interface MirageSword extends Timed, Positioned { angle: number; speed: number; seed: number; trail: Positioned[]; hitCd: number }
export interface Mirage { st: number; fired: number; orbitA: number; swords: { a: number; seed: number }[]; flying: MirageSword[] }
export type SkillName = 'triple' | 'dash' | 'aoe' | 'sphere' | 'mirage';
interface SkillBase { st: number; fired: number }
export type VergilSkill = SkillBase & (
  { name: 'triple' | 'mirage' } |
  { name: 'dash'; dashed?: boolean } |
  { name: 'aoe'; started?: boolean } |
  { name: 'sphere'; retreated?: boolean; lastSpot?: Positioned }
);
export interface VergilAoe extends Positioned { r: number; maxR: number; mode: 'grow' | 'hold' | 'collapse'; st: number; spawnT?: number; done?: boolean }
