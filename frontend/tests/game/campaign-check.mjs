/** Extended real-time-rule campaign probe; run separately from the quick unit suite. */
import assert from 'node:assert/strict';
import { createGameSession } from '../../src/game/index.ts';
const INPUT = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, manualAim: false, slow: false,
  clear: false, ultimate: false, p2MoveX: 0, p2MoveY: 0, p2Slow: false, p2Clear: false };
const results = [];
const partySize = Number(process.argv.find(argument => argument.startsWith('--party='))?.split('=')[1] ?? 1);
if (![1, 2, 3, 4].includes(partySize)) throw new TypeError('Invalid party size');
for (const difficulty of ['normal', 'nightmare']) {
  const started = performance.now();
  const session = createGameSession();
  session.dispatch({ type: 'start-run', options: { characterId: 'yui', difficulty, partySize, seed: 69, pilot: true } });
  const waves = new Set(), phases = new Set(), shops = new Set();
  let steps = 0, peakEntities = 0;
  for (; steps < 180000; steps++) {
    session.advance(INPUT);
    const ui = session.readUi();
    waves.add(ui.wave); phases.add(ui.phase);
    if (ui.phase === 'shop') shops.add(ui.wave);
    if (steps % 1000 === 0) {
      const frame = session.readFrame();
      peakEntities = Math.max(peakEntities, frame.actors.length + frame.projectiles.length + frame.pickups.length);
      if (frame.actors.some(actor => !Number.isFinite(actor.x) || !Number.isFinite(actor.y))) throw new Error('Non-finite actor position');
    }
    if (ui.phase === 'endless-prompt' || ui.phase === 'result' && !ui.pilot) break;
  }
  assert.equal(session.readUi().phase, 'endless-prompt', `${difficulty}/${partySize}P must complete the campaign`);
  assert.deepEqual([...waves], Array.from({ length: 20 }, (_, index) => index + 1));
  assert.deepEqual([...shops], Array.from({ length: 19 }, (_, index) => index + 1));
  if (difficulty === 'nightmare') for (const encounter of ['vergil', 'flandre', 'remilia', 'halloween']) assert.ok(phases.has(encounter));
  results.push({ difficulty, partySize, seed: 69, steps, simulatedSeconds: steps / 60,
    wallMilliseconds: performance.now() - started, endingPhase: session.readUi().phase,
    wave: session.readUi().wave, waves: [...waves], shops: [...shops], phases: [...phases],
    peakEntities, meta: session.getMeta(), exhausted: steps >= 180000 });
}
process.stdout.write(JSON.stringify({ kind: 'headless-rule-campaign', results }, null, 2) + '\n');
