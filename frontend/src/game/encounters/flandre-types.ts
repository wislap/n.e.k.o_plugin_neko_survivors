import type { BulletShape, BulletWall } from '../actors/bullet.ts';
import type { FlandreFight } from './flandre.ts';
export type SpellId = 'prologue' | 'ripples' | 'cranberry' | 'kagome' | 'maze' | 'starbow' | 'catadioptric' | 'clock' | 'fragile' | 'bloodstain' | 'heart' | 'laevateinn' | 'fourkind';
export interface SpellGlow { x: number; y: number; r: number; color: string; age: number; a: number; kind: 'glow'; alpha?: number }
export interface SpellLaser { x: number; y: number; angle: number; angVel: number; len: number; width: number; age: number; life: number; fade: number; warn: number; sweep: number }
export interface SpellClone { x: number; y: number; spriteId: string; radius: number }
interface CommonState { _cardNo?: number; think?: number; tx?: number; ty?: number; vis?: SpellGlow[] }
interface SpellStates {
  prologue: { phase?: number; dir?: number; rot?: number; acc?: number; ringAcc?: number };
  ripples: { wall?: BulletWall; acc?: number; gap?: number; wave?: number; inner?: number };
  cranberry: { tp?: number; flip?: number; aim?: number; ems?: { x: number; y: number; dir: number; rot: number; acc: number; age: number; ring: number; bead: number }[] };
  kagome: { bird?: number; spawn?: number; n?: number; fl?: { h: boolean; x: number; y: number; vx: number; vy: number; acc: number; dirShot: number; phase: number }[] };
  maze: { ring?: number; gapAng?: number; n?: number; rot?: number; spi?: number };
  starbow: { beat?: number; big?: number; n?: number };
  catadioptric: { acc?: number; n?: number; tAcc?: number; vAcc?: number; vIdx?: number; wall?: BulletWall };
  clock: { aim?: number; chime?: number; hands?: { ang: number; w: number; rs: number[]; acc: number; col: string; shape: BulletShape }[] };
  fragile: { acc?: number; slot?: number; seed?: number; burst?: boolean; burstT?: number; bacc?: number; bslot?: number; burstDone?: boolean };
  bloodstain: { n?: number; aim?: number; ems?: { x: number; y: number; a: number; spin: number; fire: number; ring: number }[] };
  heart: { init?: boolean; beat?: number; n?: number; rot?: number; fire?: number; aim?: number };
  laevateinn: { n?: number; lasers?: SpellLaser[]; seg?: { phase: 'move' | 'warn' | 'sweep' | 'rest'; t: number; dur: number; fx: number; fy: number; tx: number; ty: number } | null; spray?: number; fan?: number; ring2?: number };
  fourkind: { clones?: SpellClone[]; rot?: number; shift?: number; shiftT?: number; hush?: number; acc?: number[]; sp?: number };
}
export type Spell<K extends SpellId = SpellId> = { [I in K]: { id: I; name: string; t: number; dur: number; speedMul: number; st: SpellStates[I] & CommonState } }[K];
export type SpellScript<K extends SpellId> = { tick(spell: Spell<K>, dt: number, fight: FlandreFight): void };
export type SpellScripts<K extends SpellId = SpellId> = { [I in K]: SpellScript<I> };
export function createSpell(id: SpellId, name: string, dur: number, speedMul: number): Spell {
  const base = { name, t: 0, dur, speedMul };
  switch (id) {
    case 'prologue': return { ...base, id, st: {} };
    case 'ripples': return { ...base, id, st: {} };
    case 'cranberry': return { ...base, id, st: {} };
    case 'kagome': return { ...base, id, st: {} };
    case 'maze': return { ...base, id, st: {} };
    case 'starbow': return { ...base, id, st: {} };
    case 'catadioptric': return { ...base, id, st: {} };
    case 'clock': return { ...base, id, st: {} };
    case 'fragile': return { ...base, id, st: {} };
    case 'bloodstain': return { ...base, id, st: {} };
    case 'heart': return { ...base, id, st: {} };
    case 'laevateinn': return { ...base, id, st: {} };
    case 'fourkind': return { ...base, id, st: {} };
  }
}
