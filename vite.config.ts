import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Multi-page: index.html is the simulator; dev/*.html are per-module visual harness pages.
const devPages = Object.fromEntries(
  readdirSync(resolve(import.meta.dirname, 'dev'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => [`dev_${f.replace('.html', '')}`, resolve(import.meta.dirname, 'dev', f)]),
);

export default defineConfig({
  build: {
    target: 'es2022',
    // The largest chunk is three.js itself (~590 kB minified, ~150 kB gzip); nothing to split there.
    chunkSizeWarningLimit: 700,
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), ...devPages } },
  },
  test: { include: ['tests/**/*.test.ts', 'src/**/*.test.ts'], environment: 'node' },
});
