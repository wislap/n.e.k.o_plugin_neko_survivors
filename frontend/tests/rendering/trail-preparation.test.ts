import { afterEach, expect, it, vi } from 'vitest';
import { RenderStream } from '../../src/game';
import { TrailPreparation } from '../../src/game';
afterEach(() => vi.restoreAllMocks());
it('prepares the six-point straight reference with one length calculation per segment', () => {
  const stream = new RenderStream();
  stream.playerView({ id: 1, x: 60, y: 0, radius: 5, angle: 0, color: '#ff4d94', hostile: false, playerStyle: 'shot',
    trail: Array.from({ length: 6 }, (_, i) => ({ x: i * 10, y: 0, alpha: .8 })) });
  const scratch = new TrailPreparation(), hypot = vi.spyOn(Math, 'hypot');
  expect(scratch.prepare(stream, 0, 0xff4d94, .4)).toBe(896);
  expect(hypot).toHaveBeenCalledTimes(6);
  expect(scratch.data[9]).toBe(7);
  expect(Array.from(scratch.data.slice(12, 26))).toEqual([-60,0,-50,0,-40,0,-30,0,-20,0,-10,0,0,0]);
  expect(scratch.data[7]).toBe(Math.fround(.4 * .34)); expect(scratch.data[8]).toBe(Math.fround(.4 * .5));
});
