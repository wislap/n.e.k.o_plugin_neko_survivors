/** Public runtime lifecycle fixture without React screens. No private state
 * injection, paid host calls or user-origin data. Use an isolated QA origin. */
import { createGameSession } from '../../src/game';
import { createRuntime, type GameRuntime } from '../../src/app/runtime';
import { createSaveRepository, browserStorage } from '../../src/storage';
import type { NekoHost } from '../../src/host';
const repository = createSaveRepository(browserStorage());
repository.writeSettings({ enabled: false, master: 0, music: 0, sfx: 0, playerEffectOpacity: 1 });
let active: GameRuntime | undefined;
const counts = { created: 0, disposed: 0, reports: 0, speech: 0, closes: 0 };
function host(): NekoHost {
  return { mode: 'standalone', resetSession: async () => ({ status: 'completed' }),
    closeSession: async () => { counts.closes++; return { status: 'completed' }; },
    report: async () => { counts.reports++; return { status: 'queued' }; },
    speak: async () => { counts.speech++; return { status: 'queued' }; },
    getAvatarState: async () => ({ status: 'unavailable' }), mountAvatar: async () => null,
    dispose() { counts.disposed++; } };
}
async function create() {
  active?.dispose();
  active = await createRuntime(document.getElementById('game')!, { host: host(), profile: true, capture: true });
  counts.created++; return active.getSnapshot();
}
async function native() {
  const natural = await fetch('/results/natural-wave50.json').then(r => r.json());
  const result = repository.writeProgress({ run: { ...natural.save, run: natural.save.checkpoint }, meta: natural.meta });
  if (!result.ok) throw new Error(result.reason);
  await active!.continueRun(); return active!.getSnapshot();
}
function summary(game: ReturnType<GameRuntime['getSnapshot']>['game']) {
  return { money: game.players[0].materials,
    weapons: game.players[0].weapons.map(w => [w.definitionId, w.level]),
    offers: game.offers.map(o => [o.definitionId, o.kind, o.price, o.sold, o.locked]) };
}
function referencePurchase(index: number) {
  const saved = repository.read('run'), meta = repository.read('meta');
  if (!saved.ok || !meta.ok) throw new Error('Missing saved reference input');
  const game = createGameSession({ save: saved.value, meta: meta.value }); game.setViewport(1920, 1080);
  const before = game.readUi(), offer = before.offers[index];
  const receipt = game.dispatch({ type: 'buy-offer', offerId: offer.id, revision: before.revision, playerId: before.players[0].id });
  if (!receipt.ok) throw new Error(receipt.reason);
  return summary(game.readUi());
}
await create();
Object.assign(window, { __runtimeQA: { ready: true, create, native, summary, referencePurchase, get runtime() { return active; }, counts } });
addEventListener('pagehide', () => active?.dispose(), { once: true });
