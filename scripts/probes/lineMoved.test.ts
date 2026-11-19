// Every line's points every LM_STEP m (default 50) with its braid share there (RiverLine.braidShare, 0 where it has
// none) into LM_OUT/lines-s<seed>.json, for two trees to be compared (out/fs/W/B/tools/moved.py: how far the lines moved
// where they do not braid).
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: string): void; mkdirSync(p: string, o: object): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type L = { north: Float64Array; east: Float64Array; s: Float64Array; kind?: number; braidShare?: Float32Array };
it('line moved dump', () => {
  const out = env.LM_OUT ?? 'out/fs/W/B/moved';
  const step = Number(env.LM_STEP ?? 50);
  fs.mkdirSync(out, { recursive: true });
  for (const seed of (env.LM_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const rows: number[][] = [];
    (hydrology.rivers as unknown as L[]).forEach((r, li) => {
      let next = 0;
      for (let i = 0; i < r.s.length; i++) {
        if (r.s[i] < next && i !== r.s.length - 1) continue;
        next = r.s[i] + step;
        rows.push([li, r.kind ?? 0, Math.round(r.north[i] * 10) / 10, Math.round(r.east[i] * 10) / 10, r.braidShare ? Math.round(r.braidShare[i] * 1000) / 1000 : 0]);
      }
    });
    fs.writeFileSync(`${out}/lines-s${seed}.json`, JSON.stringify(rows));
    console.log(`LM seed ${seed}: ${rows.length} points`);
  }
  setWorldSeed(0);
});
