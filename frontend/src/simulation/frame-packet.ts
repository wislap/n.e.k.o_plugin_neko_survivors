import { readPlayerView, readEnemyView, readPickupView, type RenderStreamData, type RenderStreamView, type GameFrame, type DisplayFrame } from '../game/index.ts';

import type { PreparedTrails } from '../game';
import type { PreparedBodies } from '../render-data/player-bodies';
export type FrameBuffers = Pick<RenderStreamData, 'players' | 'enemies' | 'pickups'> & { bodies?: Float32Array; trails?: Float32Array; groups?: readonly Float32Array[]; ids?: Float64Array };
export type TransientPacket = RenderStreamData;
export interface CanonicalFramePacket {kind?:'canonical';compact?:never;frame:Omit<GameFrame,'transients'>;transients?:TransientPacket;bodies?:PreparedBodies;trails?:PreparedTrails}
export interface CompactFramePacket {kind:'compact';compact:DisplayFrame;frame?:never;transients?:never;bodies?:never;trails?:never}
export type FramePacket=CanonicalFramePacket|CompactFramePacket;
export function encodeFrame(frame: Readonly<GameFrame>): CanonicalFramePacket {
  const { transients: stream, ...rest } = frame;
  return { frame: rest, transients: stream ? {
    players: stream.players, enemies: stream.enemies, pickups: stream.pickups,
    playerIds: stream.playerIds, enemyIds: stream.enemyIds, pickupIds: stream.pickupIds, colors: stream.colors,
    playerCount: stream.playerCount, enemyCount: stream.enemyCount, pickupCount: stream.pickupCount,
  } : undefined };
}
export function frameBuffers(packet: FramePacket): FrameBuffers | undefined {
  const s = packet.compact?.transients ?? packet.transients;
  return s ? { players: s.players, enemies: s.enemies, pickups: s.pickups, bodies: packet.bodies?.data, trails: packet.compact?.trails?.data??packet.trails?.data, groups: packet.compact?.bodies.groups, ids: packet.compact?.bodies.ids } : undefined;
}
export function transfers(buffers?: FrameBuffers): ArrayBuffer[] {
  return buffers ? [...new Set([buffers.players.buffer, buffers.enemies.buffer, buffers.pickups.buffer, ...(buffers.bodies ? [buffers.bodies.buffer] : []), ...(buffers.trails ? [buffers.trails.buffer] : []), ...(buffers.groups?.map(a => a.buffer) ?? []), ...(buffers.ids ? [buffers.ids.buffer] : [])])] as ArrayBuffer[] : [];
}
/** Pure readers are attached to serialized values. Producer state and mutators
 * never cross the worker port, and no class instance is forged. */
export function decodeFrame(packet: FramePacket): Readonly<GameFrame> {
  if (packet.compact) throw new Error('Compact display must be consumed by the display renderer');
  const data = packet.transients;
  const transients: RenderStreamView | undefined = data ? { ...data,
    readPlayer(index, target) { return readPlayerView(data, index, target); },
    readEnemy(index, target) { return readEnemyView(data, index, target); },
    readPickup(index, target) { return readPickupView(data, index, target); },
  } : undefined;
  return { ...packet.frame, ...(transients ? { transients } : {}) };
}
