import { GameFrameBuffer } from '../../src/game';
const frameBuffer = new GameFrameBuffer({ packed: !new URLSearchParams(location.search).has('mobile') });
import { GameRenderer } from '../../src/rendering/game-renderer';
import { createRenderer } from '../../src/rendering/create-renderer';
import { SessionEngine } from '../../src/game/session-engine';
import { populatePlayerMix } from './player-mixed-fixture';
import type { GameAssets } from '../../src/rendering/assets';

const q = new URLSearchParams(location.search);
const device = await createRenderer({ width: 1920, height: 1080, resolution: 2 });
const renderer = new GameRenderer(device, { container: document.getElementById('game')!, presentation: { mobile: q.has('mobile'), resolution: 2 }, assetBaseUrl: '/community/assets' });
const engine = new SessionEngine({});
engine.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty: 'nightmare', partySize: 1, seed: 69, pilot: false } });
engine.setViewport(1920, 1080);
const battle = engine.battle!, world = battle.world;
Reflect.set(world, 'pet', null); battle.backgroundId = 'lab';
world.terrain = { rects: [], circles: [] };
window.addEventListener('pagehide', () => renderer.dispose(), { once: true });
let state = 123456;
const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
const items = populatePlayerMix(world, battle.player, 32, random);
const assets = Reflect.get(renderer, 'assets') as GameAssets;
await Promise.all([assets.request('character', 'yui'), assets.request('background', 'lab'), ...['ff4d94', 'ffc857', '5fd3e8', 'b794f6'].map(c => assets.requestFile(`ordinary/glow_${c}.png`))]);
function draw(pose = 2, opacity = 1) {
  for (const [i, { bullet }] of items.entries()) {
    const row = Math.floor(i / 4), column = i % 4;
    bullet.x = (column - 1.5) * 370 + 30; bullet.y = (row - 3.5) * 115;
    bullet.radius = row % 2 ? 9 : 4; bullet.angle = row * .33 + pose * .2; bullet.age = pose + row * .37;
    for (let j = 0; j < bullet.trail.length; j++) {
      const point = bullet.trail[j], distance = (6 - j) * 15;
      point.x = bullet.x - distance;
      point.y = bullet.y + (row < 4 ? Math.sin(j * .45 + pose * .2) * 15 : j === 0 ? 0 : (6 - j) * (row === 4 ? -9 : 9));
      // Last two rows include actual acute/reversing histories and filtered points.
      if (row >= 6 && j === 2) point.x = bullet.x + 30;
      point.a = row === 7 && j === 1 ? 0 : .8;
    }
  }
  battle.time = pose; renderer.setPlayerEffectOpacity(opacity);
  renderer.render(engine.readFrame(frameBuffer), pose * 1000);
}
draw(Number(q.get('pose') ?? 2), Number(q.get('opacity') ?? 1));
Object.assign(window, { __visualCheck: { ready: true, renderer, draw, assets: renderer.diagnostics.assets } });
