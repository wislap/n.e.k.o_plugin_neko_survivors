import { lstat, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Remove only reproducible frontend output; runtime avatar caches are separate. */
export async function prepareOutput(directory = fileURLToPath(new URL('../../static/', import.meta.url))) {
  const information = await lstat(directory).catch((error: unknown) => {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (information?.isSymbolicLink()) throw new Error('Refusing to clean a symlinked output directory');
  await mkdir(directory, { recursive: true });
  for (const child of ['app', 'assets']) await rm(path.join(directory, child), { recursive: true, force: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prepareOutput();
