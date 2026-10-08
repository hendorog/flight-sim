import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(resolve(root, 'build'), { recursive: true });
execFileSync(process.execPath, [resolve(root, 'node_modules/assemblyscript/bin/asc.js'),
  resolve(root, 'solver.ts'), '--outFile', resolve(root, 'build/solver.wasm'),
  '--optimizeLevel', '3', '--shrinkLevel', '0', '--runtime', 'stub',
  '--initialMemory', '1', '--maximumMemory', '1'], { stdio: 'inherit' });

for (const mode of ['js', 'wasm', 'profile']) {
  await build({
    entryPoints: [resolve(root, 'flight.ts')], outfile: resolve(root, `build/flight-${mode}.mjs`),
    bundle: true, platform: 'node', format: 'esm', target: 'node22',
    define: { BENCH_MODE: JSON.stringify(mode) },
    plugins: mode === 'js' ? [] : [{ name: 'experiment-only-linalg', setup(b) {
      b.onResolve({ filter: /\/linalg$/ }, () => ({ path: resolve(root, mode === 'wasm' ? 'adapter.ts' : 'profile.ts') }));
    } }],
  });
}
await build({ entryPoints: [resolve(root, 'verify.ts')], outfile: resolve(root, 'build/verify.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22' });
