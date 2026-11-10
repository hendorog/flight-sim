// Organic channels: every river (kind 0) walked every FW_STEP m of arc - the lowest drawn ground beside it (square to
// it, from its bed's edge + 15 m out to 400 m each side, every 20 m) minus its water level (the checker's lineWalk over
// every river, not only the ones in view). Negative: ground beside the river lower than its water.
//   FW_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts floorWalk
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('floor walk', () => {
  const step = Number(env.FW_STEP ?? 250);
  for (const seed of (env.FW_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const S = makeSample();
    const g = (n: number, e: number): number => sampleTerrain(n, e, S).ground;
    let n = 0, b36 = 0, b5 = 0, b10 = 0, worst = 0, worstAt = '';
    const L = hydrology.rivers ?? [];
    for (let li = 0; li < L.length; li++) {
      const r = L[li] as unknown as { north: Float64Array; east: Float64Array; level: Float64Array; halfWidth: Float64Array; s: Float64Array; kind?: number; bedR?: Float32Array; bedL?: Float32Array };
      if ((r.kind ?? 0) !== 0) continue;
      let last = -1e9;
      for (let i = 1; i < r.north.length - 1; i++) {
        if (r.s[i] - last < step) continue;
        last = r.s[i];
        const pn = r.north[i], pe = r.east[i];
        // (Not in a lake: the water there is the lake's.)
        if (hydrology.lakeMask && hydrology.lakeMask.at(pn, pe) > -Infinity) continue;
        let dn = r.north[i + 1] - r.north[i - 1], de = r.east[i + 1] - r.east[i - 1];
        const dl = Math.hypot(dn, de) || 1;
        dn /= dl;
        de /= dl;
        let lo = Infinity;
        let loAt = 0;
        for (const sd of [-1, 1]) {
          // side +1: right of the flow (-de, dn).
          const bed = sd > 0 ? (r.bedR?.[i] ?? r.halfWidth[i]) : (r.bedL?.[i] ?? r.halfWidth[i]);
          for (let o = bed + 15; o <= 400; o += 20) {
            const v = g(pn - de * o * sd, pe + dn * o * sd) - r.level[i];
            if (v < lo) {
              lo = v;
              loAt = o * sd;
            }
          }
        }
        n++;
        if (lo < -3.6) b36++;
        if (lo < -5) b5++;
        if (lo < -10) b10++;
        if (lo < worst) {
          worst = lo;
          worstAt = `line ${li} ${pn.toFixed(0)},${pe.toFixed(0)} off ${loAt.toFixed(0)} m`;
        }
      }
    }
    console.log(`FW seed ${seed}: ${n} river points every ${step} m; lowest ground beside under the water by > 3.6 m: ${b36}, > 5 m: ${b5}, > 10 m: ${b10}; worst ${worst.toFixed(1)} m at ${worstAt}`);
  }
  setWorldSeed(0);
});
