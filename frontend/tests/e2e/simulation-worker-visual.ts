/** Deterministic QA only: the production client/worker transports full frames;
 * the synchronous rule core is the reference, never a product fallback. */
import { PlayerBodyPreparation } from '../../src/render-data/player-bodies';
import { PlayerTrailPreparation } from '../../src/game';
import { RenderStream } from '../../src/game';
import { createSimulation } from '../../src/simulation/client';
import { createGameSession, GameFrameBuffer, GameDisplayBuffer, EMPTY_INPUT, type GameCommand, type GameFrame, type SessionOptions } from '../../src/game';
import { createGameRenderer } from '../../src/rendering';
import { encodeFrame } from '../../src/simulation/frame-packet';
import type { GameOutput } from '../../src/simulation/protocol';
const q = new URLSearchParams(location.search), mobile = q.has('mobile');
const options: SessionOptions = { platform: mobile ? 'mobile' : 'desktop' };
if (q.has('native')) {
  const natural = await fetch('/results/natural-wave50.json').then(r => r.json());
  options.save = { ...natural.save, run: natural.save.checkpoint }; options.meta = natural.meta;
}
const reference = createGameSession(options); reference.setViewport(1920, 1080);
const simulation = await createSimulation({ session: options, width: 1920, height: 1080, packed: !mobile, profile: true });
const actualOutputs: GameOutput[] = [...simulation.initial.outputs ?? []], expectedOutputs: GameOutput[] = [];
function commandOutputs(commandId: number) {
  for (const event of reference.drainEvents()) expectedOutputs.push({ event, step: 0, commandId,
    ...(['checkpoint', 'run-ended'].includes(event.type) ? { progress: structuredClone({ run: reference.exportSave(), meta: reference.getMeta() }) } : {}) });
  reference.readUi();
}
commandOutputs(1);
simulation.subscribe(message => {
  if (message.kind === 'failure') throw new Error(message.message);
  actualOutputs.push(...message.outputs);
});
if (!q.has('native')) {
  const run = { characterId: 'yui', difficulty: 'nightmare', partySize: q.has('party4') ? 4 : 1, seed: 69, pilot: true } as const;
  const challenge = q.get('challenge');
  const command: GameCommand = challenge ? { type: 'start-challenge', challenge: challenge as 'flandre', options: run } : { type: 'start-run', options: run };
  reference.dispatch(command); commandOutputs(2); const reply = await simulation.request({ kind: 'command', command }); actualOutputs.push(...reply.outputs ?? []);
}
const steps = Number(q.get('steps') ?? (q.has('native') ? 180 : 120));
for (let done = 0; done < steps;) {
  const count = Math.min(64, steps - done);
  for (let i = 0; i < count; i++) {
    const result = reference.advance(EMPTY_INPUT);
    for (const event of result.events) expectedOutputs.push({ event, step: done + i + 1,
      ...(['checkpoint', 'run-ended'].includes(event.type) ? { progress: structuredClone({ run: reference.exportSave(), meta: reference.getMeta() }) } : {}) });
    reference.readUi();
  }
  await simulation.request({ kind: 'advance', steps: count, input: EMPTY_INPUT }); done += count;
}
const inspected = await simulation.request({ kind: 'inspect' });
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
if (!equal(inspected.ui, reference.readUi()) || !equal(inspected.progress, { run: reference.exportSave(), meta: reference.getMeta() }) || !equal(actualOutputs, expectedOutputs)) throw new Error('Worker rule/event/save differential failed');
if (q.has('main')) await simulation.request({kind:'speed',speed:8});
simulation.requestFrame();
let actual: Readonly<GameFrame> | undefined;
let bodies: ReturnType<typeof simulation.takeFrame>;
for (let i = 0; i < 1000 && !actual; i++) { bodies = simulation.takeFrame(); actual = bodies?.frame; if (!actual) await new Promise(r => setTimeout(r, 5)); }
if (!actual) throw new Error('No worker frame');
let expected = reference.readFrame(new GameFrameBuffer({ packed: !mobile }));
if (!equal(encodeFrame(actual), encodeFrame(expected))) throw new Error('Worker frame differential failed');
// Explicit display-only geometry cases complement the genuine Worker frame above.
// They exercise the same public preparation/renderer boundary, not game outcomes.
if (q.has('styles')) {
  const stream = new RenderStream(), styles = ['shot','coin','orb','tracer'] as const;
  const origin = q.has('large') ? 100000 : 0;
  for (let i = 0; i < 144; i++) {
    const x = origin + (i % 12 - 5.5) * 70 + .3, y = origin + (Math.floor(i / 12) - 5.5) * 60 + .7;
    const history = Math.floor(i / 4) % 4, trail = history === 0 ? [] : history === 1 ? [{x:x-10,y,alpha:1},{x:x-20,y,alpha:1}]
      : history === 2 ? [{x:x-30,y:y-10,alpha:1},{x:x-20,y:y-10,alpha:0},{x:x-10,y,alpha:1}]
      : Array.from({length:6},(_,j)=>({x:x-(6-j)*9,y:y+Math.sin(j*.2)*8,alpha:1}));
    stream.playerView({ id:i, x,y,radius:[3,7.5,12][i%3], angle:.37+i*.11,
      age: q.has('long') ? 1000000000.123+i : .123+i*.01, alpha:[.3,.8,1][i%3],
      color:['#ff4d94','#ffc857','#5fd3e8','#b794f6'][i%4], hostile:false, playerStyle:styles[i%4], trail });
  }
  actual = expected = { ...expected, transients:stream, projectiles:[], pickups:[], effects:[], telegraphs:[], actors:[], weapons:[], terrain:[],
    camera:{x:origin,y:origin,zoom:1}, backgroundId:'lab', weather:q.has('filter') ? {id:'fog',strength:.8,fogStrength:.5,elapsed:2,flash:0,meteors:[],burnZones:[],typhoons:[]} : undefined };
  bodies = { ...bodies!, frame:actual, bodies:q.has('main') ? undefined : new PlayerBodyPreparation().prepare(stream), trails:q.has('main') ? undefined : new PlayerTrailPreparation().prepare(stream) };
  if (q.has('long')) {
    // The old GPU path stores age*8 / age*10 as huge Float32 angles and loses
    // the animation phase. Validate the intended period with a small-age reference.
    const folded = new RenderStream();
    for (let i = 0; i < stream.playerCount; i++) {
      const view = stream.readPlayer(i, {id:0,x:0,y:0,radius:0,angle:0,color:'',hostile:false,trail:[]});
      const factor = view.playerStyle === 'coin' ? 8 : view.playerStyle === 'orb' ? 5 : view.playerStyle === 'tracer' ? 40 : 0;
      if (factor) view.age = (view.age! * factor % (Math.PI * 2)) / factor;
      folded.playerView(view);
    }
    expected = {...expected,transients:folded};
  }

}

const renderer = await createGameRenderer({ container: document.getElementById('game')!, presentation: { mobile, resolution: 2 }, assetBaseUrl: '/community/assets' });
const compactBuffer=new GameDisplayBuffer();compactBuffer.stream.prepareTrails=true;
async function draw(role: 'worker' | 'reference' | 'compact') {
  const frame = role === 'worker' ? actual! : expected;
  if(role==='compact')renderer.renderSnapshot(reference.readDisplay(compactBuffer),2000,999);else renderer.render(frame, 2000, role === 'worker' ? bodies : undefined);
  for (let i = 0; i < 1000 && renderer.diagnostics.assets.pending; i++) await new Promise(r => setTimeout(r, 5));
  if(role==='compact')renderer.renderSnapshot(reference.readDisplay(compactBuffer),2000,999);else renderer.render(frame, 2000, role === 'worker' ? bodies : undefined);
  if (renderer.diagnostics.assets.failed.length) throw new Error('Visual assets failed');
  return renderer.diagnostics;
}
await draw('worker');
Object.assign(window, { __workerVisual: { ready: true, renderer, draw, simulation, rulesEqual: true, outputs: actualOutputs.length, steps,
  metadata: { phase: actual.phase, actors: actual.actors.length, playerBullets: actual.transients?.playerCount ?? 0 } } });
addEventListener('pagehide', () => { simulation.dispose(); renderer.dispose(); }, { once: true });
