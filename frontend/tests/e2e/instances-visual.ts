import type { GameFrame, ProjectileView } from '../../src/game';
import { GameRenderer } from '../../src/rendering/game-renderer';
import { createRenderer } from '../../src/rendering/create-renderer';
import { visualFixture } from '../../src/rendering/dev/visual-fixtures';
import type { GameAssets } from '../../src/rendering/assets';
const q = new URLSearchParams(location.search), scene = q.get('scene') ?? 'enemies', mobile = q.has('mobile');
const device = await createRenderer({ width: 1920, height: 1080, resolution: 2 });
const renderer = new GameRenderer(device, { container: document.getElementById('game')!, presentation: { mobile, resolution: 2 }, assetBaseUrl: '/community/assets' });
window.addEventListener('pagehide', () => renderer.dispose(), { once: true });
const assets = Reflect.get(renderer, 'assets') as GameAssets;
await Promise.all([assets.request('background', 'lab'), ...['xp', 'heal', 'coin_1', 'coin_2'].map(id => assets.request('pickup', id))]);
await document.fonts.ready;
let frame: GameFrame;
function draw(pose = 2, opacity = .35) {
  frame = visualFixture('weapons', pose);
  frame.actors = []; frame.effects = []; frame.projectiles = []; frame.pickups = [];
  frame.camera = { x: 0, y: 0, zoom: 1 };
  const shapes: NonNullable<ProjectileView['shape']>[] = ['circle','needle','orb','laser','star','rice','drop','shard','petal','ring','blade','jade','paw','bead'];
  if (scene === 'enemies' || scene === 'overlap') {
    frame.projectiles = Array.from({ length: scene === 'overlap' ? 100 : 56 }, (_, i) => ({ id: i, hostile: i % 7 !== 0, x: scene === 'overlap' ? Math.sin(i * .37) * 120 : (i % 7 - 3) * 250, y: scene === 'overlap' ? Math.cos(i * .71) * 90 : (Math.floor(i / 7) - 3.5) * 125, angle: i * .37 + pose * .2, shape: shapes[i % shapes.length], radius: i % 2 ? 14 : 6, length: i % 3 ? undefined : 170, width: i % 3 ? undefined : 11, anchor: i % 4 ? 'center' : 'head', hitRadius: i % 2 ? 7 : undefined, color: ['#ff4060','#70a1ff','cyan','gold'][i % 4], alpha: i % 2 ? .35 : 1 }));
  } else if (scene === 'pickups') {
    frame.pickups = Array.from({ length: 48 }, (_, i) => ({ id: i, kind: (['xp','material','heal'] as const)[i % 3], variant: i % 2 ? 1 : 2, bobPhase: pose + i, x: (i % 8 - 3.5) * 120, y: (Math.floor(i / 8) - 2.5) * 100 }));
  } else {
    const source = visualFixture('weapons', pose).effects;
    frame.effects = Array.from({ length: source.length * 3 }, (_, i) => {
      const v = source[i % source.length], x = (i % 7 - 3) * 240, y = (Math.floor(i / 7) - 2.5) * 160;
      const dx = x - v.x, dy = y - v.y;
      return { ...v, id: i, x, y, radius: Math.min(v.radius, 55), progress: [0,.4,.85][Math.floor(i / source.length)], alpha: i % 2 ? .35 : 1, playerOwned: i % 3 === 0, angle: i * .13,
        end: v.end ? { x: v.end.x + dx, y: v.end.y + dy } : undefined,
        points: v.points?.map(p => ({ x: p.x + dx, y: p.y + dy })) };
    });
    // Interleave normal text/shards and additive particles to exercise ordering.
    if (scene === 'effect-overlap') frame.effects = frame.effects.map((v, i) => ({ ...v, x: Math.sin(i) * 110, y: Math.cos(i) * 80 }));
  }
  renderer.setPlayerEffectOpacity(opacity);
  // Populate an insertion order, then force row swaps/removal before the captured frame.
  renderer.render(frame, pose * 1000);
  if (q.has('swap')) {
    frame = { ...frame, projectiles: [...frame.projectiles].reverse().filter(v => v.id !== 3), pickups: [...frame.pickups].reverse().filter(v => v.id !== 3), effects: [...frame.effects].reverse().filter(v => v.id !== 3) };
    renderer.render(frame, pose * 1000);
  }
}
draw(Number(q.get('pose') ?? 2), Number(q.get('opacity') ?? .35));
Object.assign(window, { __visualCheck: { ready: true, renderer, draw, assets: renderer.diagnostics.assets } });
