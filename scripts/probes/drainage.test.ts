// Drainage statistics of a seed (probe): build time, lines, total channel length, lakes.
//   DRAIN_SEEDS=7,42 npx vitest run --config scripts/probes/vitest.config.ts drainage
import { it } from 'vitest';
import { naturalHeight } from '../../src/world/terrain/heightfield';
import { buildDrainage, DRAIN_CELL } from '../../src/world/terrain/drainage';
import { setWorldSeed } from '../../src/world/worldSeed';

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { appendFileSync(p: string, d: string): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

it('drainage', () => {
  const out = env.DRAIN_OUT ?? 'drainage.txt';
  for (const seed of (env.DRAIN_SEEDS ?? '7,42').split(',')) {
    setWorldSeed(seed);
    const t0 = performance.now();
    const d = buildDrainage(naturalHeight);
    const dt = performance.now() - t0;
    let cells = 0;
    let big = 0;
    for (const l of d.lines) {
      cells += l.cells.length - 1;
      if (l.area[l.area.length - 1] > 500) big++;
    }
    fs.appendFileSync(out, `seed ${seed}: ${dt.toFixed(0)} ms, ${d.lines.length} lines (${big} > 500 km2), ~${((cells * DRAIN_CELL * 1.15) / 1000).toFixed(0)} km of channel, ${d.lakes.length} lakes (cells ${d.lakes.map((l) => l.cells.length).join(',')}), main river area ${d.lines[0]?.area.at(-1)?.toFixed(0)} km2 length ${d.lines[0]?.cells.length} km\n`);
  }
  setWorldSeed(0);
});
