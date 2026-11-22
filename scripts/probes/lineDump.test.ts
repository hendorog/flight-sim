// Dump every drawn line (rivers and streams) as JSON: kind, catchment and points every ~100 m (probes: course moves).
//   LD_SEEDS=1,42,777777 LD_OUT=out/fs/lines npx vitest run --config scripts/probes/vitest.config.ts lineDump
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { streamHeads } from '../../src/world/terrain/streams';
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: string): void; mkdirSync(p: string, o: object): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('line dump', () => {
  const out = env.LD_OUT ?? 'out/fs/lines';
  fs.mkdirSync(out, { recursive: true });
  // (LD_BESIDE: streams.ts streamHeads.beside, for a rule's trade.)
  if (env.LD_BESIDE) streamHeads.beside = env.LD_BESIDE === '1';
  for (const seed of (env.LD_SEEDS ?? '42').split(',')) {
    setWorldSeed(seed);
    const lines = (hydrology.rivers ?? []).map((r) => {
      const pts: number[][] = [];
      let last = -Infinity;
      for (let i = 0; i < r.north.length; i++) {
        if (r.s[i] - last < 100 && i < r.north.length - 1) continue;
        last = r.s[i];
        pts.push([Math.round(r.north[i]), Math.round(r.east[i]), Math.round((r.area?.[i] ?? 0) * 10) / 10, Math.round(r.halfWidth[i] * 10) / 10]);
      }
      return { kind: r.kind ?? 0, pts };
    });
    fs.writeFileSync(`${out}/s${seed}.json`, JSON.stringify(lines));
    console.log(`seed ${seed}: ${lines.length} lines`);
  }
  setWorldSeed(0);
});
