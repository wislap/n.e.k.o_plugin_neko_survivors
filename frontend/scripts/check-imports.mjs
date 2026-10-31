import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('src');
const failures = [];
const edges = new Map();
const layers = {
  audio: new Set(['audio']), storage: new Set(['storage']), host: new Set(['host']),
  input: new Set(['input', 'game']), assets: new Set(['assets']),
  diagnostics: new Set(['diagnostics', 'game', 'simulation']),
  display: new Set(['display','rendering','simulation','game','render-data','diagnostics','presentation']),
  simulation: new Set(['simulation', 'game', 'render-data']),
  'render-data': new Set(['render-data', 'game']),
  presentation: new Set(['presentation']), i18n: new Set(['i18n']),
  rendering: new Set(['rendering', 'game', 'assets', 'presentation', 'render-data']),
  ui: new Set(['ui', 'game', 'audio', 'host', 'app', 'i18n', 'assets', 'presentation']),
};
async function visit(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) { await visit(file); continue; }
    if (!/\.[jt]sx?$/.test(file)) continue;
    const source = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const relative = path.relative(root, file).replaceAll(path.sep, '/');
    if (/\.jsx?$/.test(relative)) failures.push(`${relative}: production source must use TypeScript`);
    const imports = [...source.matchAll(/((?:\bimport\s+(?:type\s+)?[^;]*?\bfrom\s*|\bexport\s+(?:type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?)\s*from\s*|\bimport\s*\(\s*|\bimport\s*))['"]([^'"]+)['"]/g)]
      .map(([, declaration, imported]) => [declaration, imported, /^(?:import|export)\s+type\b/.test(declaration)]);
    const owner = relative.split('/')[0];
    const targets = [];
    for (const [, imported, typeOnly] of imports) {
      if (!imported.startsWith('.')) {
        if (owner !== 'ui' && owner !== 'app' && relative !== 'main.tsx' && /^react(?:-dom)?(?:\/|$)/.test(imported)) failures.push(`${relative}: React belongs to ui/app`);
        if (owner !== 'rendering' && imported === 'pixi.js') failures.push(`${relative}: Pixi belongs to rendering`);
        continue;
      }
      const resolved = path.resolve(path.dirname(file), imported.split('?')[0]);
      if (!resolved.startsWith(root + path.sep)) {
        const allowed = owner === 'i18n' && resolved.startsWith(path.resolve('../i18n') + path.sep)
          || owner === 'host' && resolved === path.resolve('../protocol/commentary.json')
          || owner === 'ui' && resolved === path.resolve('package.json');
        if (!allowed) failures.push(`${relative}: undeclared external source ${imported}`);
        continue;
      }
      const target = path.relative(root, resolved).replaceAll(path.sep, '/');
      const targetOwner = target.split('/')[0];
      if (owner === 'app' && relative !== 'app/GameApp.tsx' && targetOwner === 'ui') failures.push(`${relative}: runtime implementation must not depend on UI`);
      if (layers[owner] && !layers[owner].has(targetOwner)) failures.push(`${relative}: ${owner} must not depend on ${targetOwner}`);
      if (owner === 'ui' && targetOwner === 'app' && target !== 'app/hud-display') failures.push(`${relative}: UI may only consume the HUD display contract from app`);
      if (owner === 'ui' && targetOwner === 'audio' && target !== 'audio/types') failures.push(`${relative}: UI may only consume audio contracts`);
      if (!typeOnly) targets.push(resolved);
    }
    edges.set(file, targets);
    if (relative.startsWith('game/')) {
      for (const [, imported] of imports) {
        const resolved = imported.startsWith('.') ? path.resolve(path.dirname(file), imported) : imported;
        if (!imported.startsWith('.') || !resolved.startsWith(path.join(root, 'game') + path.sep)) {
          failures.push(`${relative}: game must be independent of ${imported}`);
        }
      }
      if (/^game\/(?:battle|run)\//.test(relative) && imports.some(([, imported]) =>
        imported.startsWith('.') && /game\/session-engine\.ts$/.test(path.resolve(path.dirname(file), imported).replaceAll(path.sep, '/')))) {
        failures.push(`${relative}: combat and run owners must not depend on SessionEngine`);
      }
      if (relative.startsWith('game/run/') && imports.some(([, imported]) => imported.startsWith('.')
        && /game\/(?:battle|actors|world|progression)\//.test(path.resolve(path.dirname(file), imported).replaceAll(path.sep, '/')))) {
        failures.push(`${relative}: run flow must not own or update combat and economy entities`);
      }
      if (/^game\/(?:world\/wave-director|progression\/run-economy|save\/run-archive)\.ts$/.test(relative)
        && imports.some(([, imported]) => imported.startsWith('.')
          && /game\/session-engine\.ts$/.test(path.resolve(path.dirname(file), imported).replaceAll(path.sep, '/')))) {
        failures.push(`${relative}: subsystem ownership must not depend on SessionEngine`);
      }
      if (/^game\/(?:world\/wave-director|progression\/run-economy)\.ts$/.test(relative)
        && imports.some(([, imported]) => imported.startsWith('.')
          && /game\/world\/world\.ts$/.test(path.resolve(path.dirname(file), imported).replaceAll(path.sep, '/')))) {
        failures.push(`${relative}: accept concrete entity dependencies instead of a whole World`);
      }
      if (relative === 'game/encounters/challenge-session.ts' && imports.some(([, imported]) => imported.startsWith('.')
        && /game\/encounters\/(?:controllers|flandre|vergil|remilia|halloween)\.ts$/.test(path.resolve(path.dirname(file), imported).replaceAll(path.sep, '/')))) {
        failures.push(`${relative}: the common challenge lifetime must not inspect concrete controllers`);
      }
      const ownsCombatRules = /^game\/(?:abilities\/|combat\/(?:outgoing|death|player-health|incoming-hit)\.ts$)/.test(relative);
      if (ownsCombatRules && imports.some(([, imported]) => imported.startsWith('.')
        && path.resolve(path.dirname(file), imported) === path.join(root, 'game/world/world.ts'))) {
        failures.push(`${relative}: combat rules must use their explicit capabilities, not World`);
      }
      if (relative === 'game/actors/enemy.ts' && imports.some(([, imported]) =>
        imported.startsWith('.') && path.resolve(path.dirname(file), imported).startsWith(path.join(root, 'game/enemies') + path.sep))) {
        failures.push(`${relative}: targetable bodies must not construct ordinary enemy behavior`);
      }
      if (relative.startsWith('game/encounters/') && imports.some(([, imported]) => imported.startsWith('.')
        && /game\/enemies\/(?:create-enemy|behavior|boss-behavior|boss-phases)\.ts$/.test(path.resolve(path.dirname(file), imported).replaceAll(path.sep, '/')))) {
        failures.push(`${relative}: challenge controllers must own their behavior and damage gates`);
      }
      // Excludes comments; these constructs are forbidden in the simulation.
      const executable = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
      if (!relative.startsWith('game/encounters/') && (/\b(?:flandreFight|vergilFight|remiliaFight|halloweenFight)\b/.test(executable)
        || /\.\s*spell\s*\.\s*st\b/.test(executable))) {
        failures.push(`${relative}: encounter implementation must stay inside game/encounters`);
      }
      if (/^game\/actors\/(?:player|bullet)\.ts$/.test(relative)
        && /\b(?:flandreHit|halloweenHit|remiliaHit|flandreSpeed|flandreEase|onFlandrePlayerHit|noHeal|noAttack)\b/.test(executable)) {
        failures.push(`${relative}: challenge policies belong to encounters, not generic actors`);
      }
      if (relative.startsWith('game/save/') && /\bReflect\s*\.\s*(?:get|set)\s*\(/.test(executable)) {
        failures.push(`${relative}: snapshot state must be captured and restored by its owner`);
      }
      if (!relative.startsWith('game/enemies/') && /\.\s*bossPhase\b/.test(executable)) {
        failures.push(`${relative}: ordinary Boss phase state is private to its behavior`);
      }
      if (relative.startsWith('game/encounters/') && /\.\s*(?:takeDamage|update)\s*=/.test(executable)) {
        failures.push(`${relative}: inject a damage gate rather than replace actor methods`);
      }
      if (/\b(window|document|localStorage|sessionStorage|requestAnimationFrame)\s*[.(]/.test(executable)) {
        failures.push(`${relative}: browser globals in simulation`);
      }
    } else {
      for (const [, imported] of imports) {
        if (/\/game\//.test(imported) && !/\/game\/(index|commands|events|views)(\.[jt]s)?$/.test(imported)) {
          failures.push(`${relative}: private game import ${imported}`);
        }
      }
    }
  }
}
await visit(root);
const visited = new Set(), active = new Set();
function checkCycles(file, chain = []) {
  if (active.has(file)) { failures.push(`Import cycle: ${[...chain, file].map(item => path.relative(root, item)).join(' -> ')}`); return; }
  if (visited.has(file)) return;
  active.add(file);
  for (const target of edges.get(file) ?? []) {
    const found = [target, `${target}.ts`, `${target}.tsx`, `${target}.js`, path.join(target, 'index.ts')].find(candidate => edges.has(candidate));
    if (found) checkCycles(found, [...chain, file]);
  }
  active.delete(file); visited.add(file);
}
for (const file of edges.keys()) checkCycles(file);
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log('Module import constraints passed.');
