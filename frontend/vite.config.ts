import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transformWithOxc, type Plugin } from 'vite';

/** Compile the isolated iframe's own TS source before embedding executable JS. */
function avatarRuntime(): Plugin {
  const sourcePath = fileURLToPath(new URL('./src/host/avatar/legacy-avatar-frame.ts', import.meta.url));
  const query = '?avatar-runtime';
  return {
    name: 'neko-avatar-runtime', enforce: 'pre',
    async load(id) {
      if (id !== sourcePath + query) return;
      const source = await readFile(sourcePath, 'utf8');
      const result = await transformWithOxc(source, sourcePath, { lang: 'ts', target: 'es2022', sourceType: 'script' });
      return { code: `export default ${JSON.stringify(result.code)};`, map: null };
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [avatarRuntime(), react()],
  build: {
    // Existing game files and locally synced avatars remain intact until their
    // migration is verified. Final cleanup is a separate, audited batch.
    outDir: '../static',
    emptyOutDir: false,
    assetsDir: 'app',
    sourcemap: false,
    // Preserve the reference's standard + prefixed backdrop-filter fallbacks.
    // CSS optimization collapsed these to the unsupported prefixed property.
    cssMinify: false,
  },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,js}'] },
});
