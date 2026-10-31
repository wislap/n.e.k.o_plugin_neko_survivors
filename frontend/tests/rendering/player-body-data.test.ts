import { expect, it } from 'vitest';
import { RenderStream } from '../../src/game';
import { PlayerBodyPreparation } from '../../src/render-data/player-bodies';
it('groups bases by style without losing exact descriptors or active orb history', () => {
  const stream = new RenderStream();
  stream.playerView({ id: 1, x: 10, y: 20, radius: 5, angle: .3, age: 2, alpha: .4, color: '#ff4d94', hostile: false, playerStyle: 'orb',
    trail: [{ x: 1, y: 2, alpha: .5 }, { x: 3, y: 4, alpha: -.1 }, { x: 5, y: 6, alpha: 1 }] });
  stream.playerView({ id: 2, x: 30, y: 40, radius: 7, angle: .6, age: 1, color: '#5fd3e8', hostile: false, playerStyle: 'shot', trail: [] });
  const prep = new PlayerBodyPreparation(), packet = prep.prepare(stream);
  expect(packet.counts).toEqual([1, 0, 1, 0]);
  expect(packet.appearances).toEqual([{ style: 2, radius: 5, color: '#ff4d94' }, { style: 0, radius: 7, color: '#5fd3e8' }]);
  expect(Array.from(packet.data.slice(0, 8))).toEqual([30,40,Math.fround(.6),0,1,0,7,1]);
  expect(Array.from(packet.data.slice(16,24))).toEqual([10,20,Math.fround(.3),Math.fround(10%(Math.PI*2)),Math.fround(.4),2,5,0]);
  expect(Array.from(packet.data.slice(24,28))).toEqual([5,6,1,2]);
  stream.reset(); const empty = prep.prepare(stream);
  expect(empty.counts).toEqual([0,0,0,0]); expect(empty.appearances).toEqual([]);
});

it('folds long-running animation before Float32 quantization', () => {
  const stream = new RenderStream(), prep = new PlayerBodyPreparation();
  for (const [id,playerStyle] of (['coin','orb','tracer'] as const).entries()) stream.playerView({id,x:0,y:0,radius:5,angle:0,
    age:1000000000.123,color:'#ff4d94',hostile:false,playerStyle,trail:[]});
  const packet = prep.prepare(stream);
  [8,5,40].forEach((factor,index) => {
    const phase = packet.data[index * 16 + 3];
    expect(phase).toBe(Math.fround(1000000000.123 * factor % (Math.PI * 2)));
    expect(phase).toBeGreaterThanOrEqual(0); expect(phase).toBeLessThan(Math.PI * 2);
  });
});
