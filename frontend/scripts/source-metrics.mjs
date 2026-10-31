import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const baseline = process.argv.find(value => value.startsWith('--baseline='))?.slice(11) ?? '85ac16e';
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const paths = revision => execFileSync('git', revision
  ? ['ls-tree', '-r', '--name-only', revision, '--', 'frontend/src', 'frontend/index.html']
  : ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'frontend/src', 'frontend/index.html'], { cwd: root, encoding: 'utf8' })
  .trim().split('\n').filter(path => path === 'frontend/index.html'
    || /^frontend\/src\/.*\.(?:ts|tsx|css|html)$/.test(path) && !path.startsWith('frontend/src/rendering/dev/'));
const lines = source => source.length === 0 ? [] : source.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
const count = source => {
  const rows = lines(source);
  return { physical: rows.length, nonblank: rows.filter(row => row.trim()).length };
};
const oldPaths = paths(baseline), currentPaths = paths();
const files = [];
for (const path of [...new Set([...oldPaths, ...currentPaths])].sort()) {
  const before = oldPaths.includes(path)
    ? execFileSync('git', ['show', `${baseline}:${path}`], { cwd: root, encoding: 'utf8' }) : '';
  let after = '';
  if (currentPaths.includes(path)) {
    try { after = await readFile(`${root}/${path}`, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  files.push({ path, baseline: count(before), current: count(after) });
}
const modules = {};
for (const file of files) {
  const name = file.path === 'frontend/index.html' ? 'entry' : file.path.split('/')[2];
  const item = modules[name] ??= { baseline: 0, current: 0, reduction: 0 };
  item.baseline += file.baseline.physical;
  item.current += file.current.physical;
  item.reduction = item.baseline - item.current;
}
const sum = (revision, field) => files.reduce((total, file) => total + file[revision][field], 0);
const before = sum('baseline', 'physical'), after = sum('current', 'physical');
process.stdout.write(JSON.stringify({
  baseline,
  scope: 'Tracked frontend/src TS/TSX/CSS/HTML excluding rendering/dev, plus frontend/index.html. Physical lines include comments and blank lines; tests, tools, docs, assets, dependencies and build output excluded.',
  baselineLines: before, currentLines: after, netReduction: before - after,
  nonblankReduction: sum('baseline', 'nonblank') - sum('current', 'nonblank'),
  target: 5000, remaining: Math.max(0, 5000 - (before - after)), modules,
  files: files.filter(file => file.baseline.physical !== file.current.physical),
}, null, 2) + '\n');
