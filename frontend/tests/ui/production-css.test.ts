import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';
import { expect, it } from 'vitest';

it('preserves the standard overlay blur through the actual production CSS pipeline', async () => {
  const results = path.resolve('test-results');
  await mkdir(results, { recursive: true });
  const directory = await mkdtemp(path.join(results, 'css-contract-'));
  try {
    const entry = path.join(directory, 'entry.js');
    await writeFile(entry, `import ${JSON.stringify(path.resolve('src/ui/styles/game.css'))};\n`);
    const output = await build({ configFile: path.resolve('vite.config.ts'), logLevel: 'silent',
      build: { write: false, rolldownOptions: { input: entry } } });
    const chunks = (Array.isArray(output) ? output : [output]).flatMap(result => 'output' in result ? result.output : []);
    const css = chunks.flatMap(chunk => chunk.type === 'asset' && chunk.fileName.endsWith('.css')
      ? [String(chunk.source)] : []).join('\n');
    const overlays = [...css.matchAll(/#overlay\s*\{([^}]+)\}/g)];
    expect(overlays.length).toBeGreaterThan(0);
    const finalOverlay = overlays.at(-1)![1]!;
    expect(finalOverlay).toMatch(/(?:^|;|\s)backdrop-filter\s*:\s*blur\(3px\)/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
