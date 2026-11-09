// Round S: every traced stream ending in a sink in hills or mountains (drawnGate (iv)'s rule: relief over a 5 km
// window on a 1 km lattice, plain < 150 m, hill < 500 m, mountain), with why it stayed one (StreamReport.endWhy), its
// end's water, the lowest ground within 500 m and 2 km of the end, and the nearest other line's water within 2 km.
//   SK_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts sinkCases --reporter=verbose
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('sink cases', () => {
  for (const seed of (env.SK_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const R = (hydrology.rivers ?? []) as unknown as Array<{ north: Float64Array; east: Float64Array; level: Float64Array; area: Float64Array; halfWidth: Float64Array; kind?: number; end?: string }>;
    const why = hydrology.streamReport?.endWhy ?? {};
    let n = 0;
    R.forEach((r, li) => {
      if ((r.kind ?? 0) !== 1 || (r.end !== 'sink' && r.end !== 'stuck')) return;
      const m = r.north.length - 1;
      const n0 = Math.round(r.north[m] / 1000) * 1000, e0 = Math.round(r.east[m] / 1000) * 1000;
      let lo = Infinity, hi = -Infinity;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const h = Math.max(0, terrainHeight(n0 + a * 1000, e0 + b * 1000)); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      const k = hi - lo >= 500 ? 'mountain' : hi - lo >= 150 ? 'hill' : 'plain';
      if (k === 'plain') return;
      n++;
      const N = r.north[m], E = r.east[m], lvl = r.level[m];
      // The lowest ground about the end, and the nearest other line's water within 2 km.
      let low5 = Infinity, low20 = Infinity;
      for (let a = -40; a <= 40; a++) for (let b = -40; b <= 40; b++) { const d = Math.hypot(a, b) * 50; if (d > 2000) continue; const h = terrainHeight(N + a * 50, E + b * 50); if (d <= 500) low5 = Math.min(low5, h); low20 = Math.min(low20, h); }
      let best = Infinity, bl = -1, bw = 0;
      R.forEach((o, lj) => { if (lj === li) return; for (let i = 0; i < o.north.length; i += 2) { const d = Math.hypot(o.north[i] - N, o.east[i] - E); if (d < best) { best = d; bl = lj; bw = o.level[i]; } } });
      console.log(`seed ${seed} line ${li} (${k}, relief ${(hi - lo).toFixed(0)} m) end ${N.toFixed(0)},${E.toFixed(0)} A ${r.area[m].toFixed(1)} km2 (head ${r.area[0].toFixed(1)}): water ${lvl.toFixed(1)}; lowest ground within 500 m ${(low5 - lvl).toFixed(1)} m, 2 km ${(low20 - lvl).toFixed(1)} m against it; nearest line ${bl} ${best.toFixed(0)} m off, water ${(bw - lvl).toFixed(1)} m against it`);
      console.log(`   why: ${why[li] ?? '(no note)'}`);
    });
    console.log(`seed ${seed}: ${n} sink ends in hills and mountains`);
  }
  setWorldSeed(0);
});
