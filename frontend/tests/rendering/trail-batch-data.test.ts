import { expect, it } from 'vitest';
import { RenderStream } from '../../src/game';
import { PlayerTrailPreparation } from '../../src/game';
it('groups GPU histories and preserves reverse histories for the reference painter', () => {
  const stream = new RenderStream(), base = { id: 1, x: 60, y: 0, radius: 5, angle: 0, color: '#ff4d94', hostile: false, playerStyle: 'shot' as const };
  stream.playerView({ ...base, trail: Array.from({ length: 6 }, (_, i) => ({ x: i * 10, y: 0, alpha: .8 })) });
  stream.playerView({ ...base, id: 2, x: 0, trail: [{ x: -30, y: 0, alpha: 1 }, { x: 20, y: 0, alpha: 1 }, { x: 10, y: 0, alpha: 1 }] });
  stream.playerView({ ...base, id: 3, playerStyle: 'orb', trail: [] });
  const prep = new PlayerTrailPreparation(), packet = prep.prepare(stream);
  expect(packet.runs).toEqual([{ key: 896, offset: 0, count: 1 }]);
  expect(packet.referenceIndices).toEqual([1]); expect(packet.data[4]).toBe(0);
  expect(Array.from(packet.data.slice(12,26))).toEqual([-60,0,-50,0,-40,0,-30,0,-20,0,-10,0,0,0]);
  stream.reset(); const empty = prep.prepare(stream); expect(empty.runs).toEqual([]); expect(empty.referenceIndices).toEqual([]);
});
