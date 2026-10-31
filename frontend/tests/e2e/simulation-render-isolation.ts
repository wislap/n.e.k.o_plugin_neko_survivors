/** Isolation diagnostic: the rendered fixed-pose world and the autonomous
 * simulated natural world are deliberately separate. Not product FPS. */
import { createSimulation } from '../../src/simulation/client';
const q = new URLSearchParams(location.search), speed = Number(q.get('simulationSpeed') ?? 1);
if (![1, 2, 4, 8].includes(speed) || !q.has('pose')) throw new Error('Isolation requires a fixed pose and valid simulationSpeed');
const natural = await fetch('/results/natural-wave50.json').then(r => {
  if (!r.ok) throw new Error('A generated natural-wave50.json fixture is required'); return r.json();
});
const simulation = await createSimulation({ session: { save: { ...natural.save, run: natural.save.checkpoint }, meta: natural.meta },
  width: 1920, height: 1080, packed: true, profile: true });
simulation.subscribe(message => { if (message.kind === 'failure') throw new Error(message.message); });
await simulation.request({ kind: 'speed', speed }); await simulation.request({ kind: 'start' });
Object.assign(window, { __simulationIsolation: {
  marker: async () => { const reply = await simulation.request({ kind: 'metrics' }); return { stats: reply.stats, phase: reply.ui.phase, wave: reply.ui.wave }; },
  dispose: () => simulation.dispose(),
} });
addEventListener('pagehide', () => simulation.dispose(), { once: true });
// This QA renderer has no gameplay simulation; its quantity/style/pose stay fixed.
await import('./stress-benchmark.mjs');
