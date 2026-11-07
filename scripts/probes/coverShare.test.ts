// Foundation stage 4: the CPU's surface classes (heightfield.ts terrainSurface: rock on faces over ~43 degrees and
// round the snow line, snow over it; the shader's twin reads the same slope and height) over a box, on a 100 m grid,
// and the share of land over 30 / 40 degrees.  CS_BOXES='42:-44250,6250,30000;1:1000,109000,30000' npx vitest run
// --config scripts/probes/vitest.config.ts coverShare
import { it } from 'vitest';
import { makeSample, sampleTerrain, terrainNormal, terrainSurface } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('cover share', () => {
  const step = Number(env.CS_STEP ?? 100);
  for (const b of (env.CS_BOXES ?? '42:-44250,6250,30000').split(';')) {
    const [seed, rest] = b.split(':');
    const [cn, ce, half] = rest.split(',').map(Number);
    setWorldSeed(seed);
    const counts: Record<string, number> = {};
    let land = 0, s30 = 0, s40 = 0;
    const s = makeSample();
    for (let n = cn - half + step / 2; n < cn + half; n += step) {
      for (let e = ce - half + step / 2; e < ce + half; e += step) {
        sampleTerrain(n, e, s);
        if (s.standing > s.ground && s.standing <= 0.5) continue;
        land++;
        const k = terrainSurface(n, e);
        counts[k] = (counts[k] ?? 0) + 1;
        const up = -terrainNormal(n, e).z;
        if (up < Math.cos((30 * Math.PI) / 180)) s30++;
        if (up < Math.cos((40 * Math.PI) / 180)) s40++;
      }
    }
    const pc = (v: number): string => ((100 * v) / Math.max(1, land)).toFixed(1);
    console.log(`seed ${seed} box ${rest}: ${Object.entries(counts).sort().map(([k, v]) => `${k} ${pc(v)} %`).join(', ')}; over 30 deg ${pc(s30)} %, over 40 deg ${pc(s40)} %`);
  }
});
