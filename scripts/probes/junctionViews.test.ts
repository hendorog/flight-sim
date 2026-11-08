// Junctions where a small stream joins a much bigger line in the mountains (catchment ratio over JV_RATIO), with a
// camera from down the receiver looking up at the junction and the tributary: views for the report.
//   JV_SEEDS=42,777777 JV_N=2 npx vitest run --config scripts/probes/vitest.config.ts junctionViews
import { it } from 'vitest';
import { debugMacro, hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('junction views', () => {
  for (const seed of (env.JV_SEEDS ?? '42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const R = hydrology.rivers!;
    const found: string[] = [];
    const used: Array<[number, number]> = [];
    R.forEach((r, li) => {
      if (found.length >= Number(env.JV_N ?? 2) || r.kind !== 1 || r.end !== 'channel' || (r.joins ?? -1) < 0) return;
      const m = r.north.length - 1, A = r.area![m];
      if (A < 10 || A > 20 || r.s[m] < 1500) return;
      const P = R[r.joins!];
      let bk = 0, bd = Infinity;
      for (let i = 0; i < P.north.length; i++) { const d = Math.hypot(P.north[i] - r.north[m], P.east[i] - r.east[m]); if (d < bd) { bd = d; bk = i; } }
      const AP = P.area![bk];
      if (bd > 30 || AP < Number(env.JV_RATIO ?? 8) * A || AP > 400) return;
      const d = debugMacro(r.north[m], r.east[m]);
      if (!d || d.s.mw < 0.5) return;
      if (used.some(([a, b]) => Math.hypot(a - r.north[m], b - r.east[m]) < 20000)) return;
      // From 500 m down the receiver, 250 m over its water, looking at a point 150 m up the tributary.
      let c = bk;
      while (c < P.s.length - 1 && P.s[c] - P.s[bk] < 600) c++;
      let k = m;
      while (k > 0 && r.s[m] - r.s[k] < 150) k--;
      used.push([r.north[m], r.east[m]]);
      const camAlt = Math.max(P.level[c] + 250, terrainHeight(P.north[c], P.east[c]) + 200);
      found.push(`s${seed}-junction-${li} seed=${seed}&camPos=${P.north[c].toFixed(0)},${P.east[c].toFixed(0)},${camAlt.toFixed(0)}&camLook=${r.north[k].toFixed(0)},${r.east[k].toFixed(0)},${r.level[k].toFixed(0)}   (tributary ${li} ${A.toFixed(1)} km2, hw ${r.halfWidth[m].toFixed(1)} m; receiver ${r.joins} kind ${P.kind} ${AP.toFixed(0)} km2, hw ${P.halfWidth[bk].toFixed(1)} m)`);
    });
    for (const f of found) console.log(`VIEW ${f}`);
  }
});
