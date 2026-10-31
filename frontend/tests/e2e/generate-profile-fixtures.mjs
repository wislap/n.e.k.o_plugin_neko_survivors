/** Optional natural-campaign benchmark saves; no private engine/world access. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameSession, isGameSave } from '../../src/game/index.ts';

const frontend = fileURLToPath(new URL('../..', import.meta.url));
const args = new Map(process.argv.slice(2).map(argument => {
  const match = /^--(party|difficulty|wave)=(.+)$/.exec(argument);
  if (!match) throw new TypeError(`Unknown argument: ${argument}`);
  return [match[1], match[2]];
}));
const partySize = Number(args.get('party') ?? 4);
const selected = args.get('difficulty') ?? 'all';
const targetWave = Number(args.get('wave') ?? 18);
if (![1, 2, 3, 4].includes(partySize)) throw new TypeError('party must be 1, 2, 3 or 4');
if (!['all', 'normal', 'nightmare'].includes(selected)) throw new TypeError('difficulty must be all, normal or nightmare');
if (!Number.isInteger(targetWave) || targetWave < 1 || targetWave > 19) throw new TypeError('wave must be a shop wave between 1 and 19 (wave 20 ends the campaign)');
const difficulties = selected === 'all' ? ['normal', 'nightmare'] : [selected];
const seed = 69;
const input = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, manualAim: false, slow: false,
  clear: false, ultimate: false, p2MoveX: 0, p2MoveY: 0, p2Slow: false, p2Clear: false };
const output = path.join(frontend, 'test-results/performance-fixtures');

async function gameFingerprint() {
  const hash = createHash('sha256');
  async function visit(directory) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (/\.[jt]s$/.test(entry.name)) {
        hash.update(path.relative(frontend, file)).update('\0').update(await readFile(file)).update('\0');
      }
    }
  }
  await visit(path.join(frontend, 'src/game'));
  return hash.digest('hex');
}

await mkdir(output, { recursive: true });
for (const difficulty of difficulties) {
  const sourceSha256 = await gameFingerprint();
  const started = performance.now();
  const session = createGameSession();
  assert.deepEqual(session.dispatch({ type: 'start-run', options: {
    characterId: 'yui', difficulty, partySize, seed, pilot: true,
  } }), { ok: true });
  const waves = new Set(), phases = new Set(), shops = new Set();
  let steps = 0;
  for (; steps < 180000;) {
    session.advance(input);
    steps++;
    const ui = session.readUi();
    waves.add(ui.wave); phases.add(ui.phase);
    if (ui.phase === 'shop') shops.add(ui.wave);
    if (ui.phase === 'shop' && ui.wave === targetWave) break;
    if (ui.phase === 'endless-prompt' || ui.phase === 'result' && !ui.pilot) break;
  }
  const ui = session.readUi();
  assert.equal(ui.phase, 'shop', `${difficulty}/${partySize}P did not naturally reach the requested shop`);
  assert.equal(ui.wave, targetWave);
  assert.deepEqual([...waves], Array.from({ length: targetWave }, (_, index) => index + 1));
  assert.deepEqual([...shops], Array.from({ length: targetWave }, (_, index) => index + 1));
  assert.equal(ui.players.length, partySize);
  const save = session.exportSave();
  assert.ok(isGameSave(save), 'exportSave must be accepted by the production decoder');
  const restored = createGameSession({ save });
  assert.equal(restored.readUi().phase, 'shop');
  assert.equal(restored.readUi().wave, targetWave);
  assert.equal(restored.readUi().players.length, partySize);
  assert.equal(await gameFingerprint(), sourceSha256, 'Game rules changed during generation; discard and regenerate after the edit freezes');
  const fixture = {
    kind: 'neko-survivors-react-natural-profile', version: 1,
    metadata: {
      difficulty, partySize, seed, characterId: 'yui', pilot: true, targetWave,
      phase: ui.phase, naturalSteps: steps, simulatedSeconds: steps / 60,
      generationWallMs: performance.now() - started, generatedAt: new Date().toISOString(),
      gameSourceSha256: sourceSha256, waves: [...waves], shops: [...shops], phases: [...phases],
      progression: 'Public createGameSession/advance only; no health edits, wave skips or added buffs. Production pilot controls combat, upgrades and shopping.',
    },
    save, meta: session.getMeta(),
  };
  const file = path.join(output, `${difficulty}-${partySize}p-seed${seed}-wave${targetWave}.json`);
  await writeFile(file, JSON.stringify(fixture, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ file, ...fixture.metadata }) + '\n');
}
