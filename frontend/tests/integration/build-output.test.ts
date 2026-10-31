import { expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prepareOutput } from '../../scripts/prepare-output.ts';

it('cleans stale bundles while preserving locally synchronized models and user configuration', async () => {
  const temporaryRoot = path.resolve('test-results');
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(path.join(temporaryRoot, 'build-output-'));
  try {
    for (const name of ['app', 'assets', 'vendor/model']) await mkdir(path.join(root, name), { recursive: true });
    await writeFile(path.join(root, 'app/old.js'), 'old chunk');
    await writeFile(path.join(root, 'assets/old.png'), 'generated image');
    await writeFile(path.join(root, 'vendor/model/current.json'), '{"name":"user model"}');
    await writeFile(path.join(root, 'local-config.json'), '{"volume":0.4}');
    await prepareOutput(root);
    await expect(stat(path.join(root, 'app'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(path.join(root, 'assets'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(root, 'vendor/model/current.json'), 'utf8')).toBe('{"name":"user model"}');
    expect(await readFile(path.join(root, 'local-config.json'), 'utf8')).toBe('{"volume":0.4}');
  } finally { await rm(root, { recursive: true, force: true }); }
});
