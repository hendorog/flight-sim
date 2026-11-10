// Round V B (item 2): every pool of standing water a seeded world draws (LakeMask.pools: the drainage's lakes, their
// sub-basins, and the ponds the streams fill), by place, for a pool-by-place match against another tree's dump
// (out/fs/B/tools/poolmatch.py). Not only the drainage's ponds (lakematch.py): every pool.
//   PM_SEEDS=1,42,777777,7 PM_OUT=dir npx vitest run --config scripts/probes/vitest.config.ts poolMatch --silent=false --disable-console-intercept
// Per pool: kind (main: a drainage lake's main pool; sub: its sub-basin; pond: one the streams filled), level, bottom,
// wet raster points, centroid, drained. PM_OUT gets pools-<seed>.tsv.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: string): void; mkdirSync(p: string, o: unknown): void };
type Pool = { lake: number; level: number; bottom: number; wet: number; north: number; east: number; drained?: boolean };
it('pool match dump', () => {
  const OUT = env.PM_OUT;
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  for (const seed of (env.PM_SEEDS ?? '1,42,777777,7').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const mask = hydrology.lakeMask as unknown as { pools: Pool[]; main: Int32Array };
    const nLakes = mask.main.length;
    const mains = new Set<number>(Array.from(mask.main).filter((x) => x >= 0));
    const rows = ['i\tkind\tnorth\teast\tlevel\tbottom\twet\tdrained'];
    const count: Record<string, number> = { main: 0, sub: 0, pond: 0 };
    mask.pools.forEach((p, i) => {
      const kind = p.lake >= nLakes ? 'pond' : mains.has(i) ? 'main' : 'sub';
      if (!p.drained) count[kind]++;
      rows.push(`${i}\t${kind}\t${p.north.toFixed(0)}\t${p.east.toFixed(0)}\t${p.level.toFixed(1)}\t${p.bottom.toFixed(1)}\t${p.wet}\t${p.drained ? 1 : 0}`);
    });
    console.log(`PM seed ${seed}: pools ${mask.pools.length} (standing: main ${count.main}, sub ${count.sub}, pond ${count.pond})`);
    if (OUT) fs.writeFileSync(`${OUT}/pools-${seed}.tsv`, rows.join('\n') + '\n');
  }
  setWorldSeed(0);
});
