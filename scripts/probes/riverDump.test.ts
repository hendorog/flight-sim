// Foundation stage 4: every drawn river and stream line of a seeded world (hydrology.rivers), its samples' position,
// water level and the natural ground under them, to a JSON file (compare two builds: out/f4/tools/rivercmp.py).
//   RD_SEEDS=1,42,777777 RD_OUT=out/f4/data/rivers RD_TAG=-f4 npx vitest run --config scripts/probes/vitest.config.ts riverDump
import { it } from 'vitest';
import { hydrology, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: string): void; mkdirSync(p: string, o: object): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('river dump', () => {
  const dir = env.RD_OUT ?? '.';
  fs.mkdirSync(dir, { recursive: true });
  for (const seed of (env.RD_SEEDS ?? '42').split(',')) {
    setWorldSeed(seed);
    const lines = (hydrology.rivers ?? []).map((r) => {
      const n: number[] = [], e: number[] = [], lv: number[] = [], g: number[] = [], a: number[] = [];
      for (let k = 0; k < r.north.length; k += 2) {
        n.push(Math.round(r.north[k]));
        e.push(Math.round(r.east[k]));
        lv.push(Math.round(r.level[k] * 10) / 10);
        g.push(Math.round(naturalHeight(r.north[k], r.east[k]) * 10) / 10);
        a.push(Math.round(r.area?.[k] ?? 0));
      }
      return { kind: r.kind, n, e, lv, g, a };
    });
    fs.writeFileSync(`${dir}/s${seed}${env.RD_TAG ?? ''}.json`, JSON.stringify(lines));
    console.log(`seed ${seed}: ${lines.length} lines`);
  }
  setWorldSeed(0);
});
