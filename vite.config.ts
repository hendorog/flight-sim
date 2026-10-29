import { defineConfig } from 'vite';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Multi-page: index.html is the simulator; dev/*.html are per-module visual harness pages.
const devPages = Object.fromEntries(
  readdirSync(resolve(import.meta.dirname, 'dev'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => [`dev_${f.replace('.html', '')}`, resolve(import.meta.dirname, 'dev', f)]),
);

// FS_TEST_FAST=1 (npm run test:fast): leave out the slow test files (tests/slow-tests.txt, mostly long simulated
// flights), for quick runs while working on something they do not touch. The plain run keeps everything.
const slowTests = process.env.FS_TEST_FAST
  ? readFileSync(resolve(import.meta.dirname, 'tests/slow-tests.txt'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  : [];

export default defineConfig({
  build: {
    target: 'es2022',
    // The largest chunk is three.js itself (~590 kB minified, ~150 kB gzip); nothing to split there.
    chunkSizeWarningLimit: 700,
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), ...devPages } },
  },
  test: { include: ['tests/**/*.test.ts', 'src/**/*.test.ts'], exclude: ['**/node_modules/**', ...slowTests], environment: 'node' },
});
