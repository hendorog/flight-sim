// Round S: the traced streams' course geometry (seeds ST_SEEDS).
//  - turns: samples where the heading over the 50 m before and the 50 m after differs by more than 60 degrees (rillGate's
//    rule), once per 100 m of course, per 100 km, for the gully-chain streams (kind 1, catchment from 9.9 km² at the
//    head) and the other streams, split by floor (the chain node by it not in a V) and V; plus the junction angle at
//    each stream's mouth (its last 100 m against the receiver's course there), and how many join at more than 60
//    degrees;
//  - sinuosity: over 1.5 km of course (path over chord), on the streams' reaches whose gradient over the window lies
//    under the braid line S = 0.083 A^-0.44 (validation.md "Rivers"; there the NZ single-thread rivers wind at 1.3-2.5),
//    p10 / p50 / p90, for floor reaches only.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { gullyNear, gullyNet, inV, type GullyHit } from '../../src/world/terrain/gullies';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('stream turns', () => {
  for (const seed of (env.ST_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const g = gullyNet();
    const L = (hydrology.rivers ?? []) as unknown as Array<{ north: Float64Array; east: Float64Array; s: Float64Array; level: Float64Array; area: Float64Array; kind?: number; joins?: number; joinS?: number }>;
    const hit: GullyHit = { dist: 0, area: 0, node: -1, t: 0 };
    const km: Record<string, number> = {}, turns: Record<string, number> = {};
    const sites: string[] = [];
    const sinu: number[] = [];
    let mouths = 0, sharp = 0;
    const heading = (r: (typeof L)[number], i: number, j: number): number => Math.atan2(r.east[j] - r.east[i], r.north[j] - r.north[i]);
    const at = (r: (typeof L)[number], s: number): number => { let lo = 0, hi = r.s.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.s[m] <= s) lo = m; else hi = m; } return lo; };
    L.forEach((r, li) => {
      if ((r.kind ?? 0) !== 1 || r.s.length < 3) return;
      const chain = (r.area?.[0] ?? 0) >= 9.9;
      const m = r.s.length;
      for (let i = 1; i < m - 1; i++) {
        const seg = r.s[i + 1] - r.s[i];
        let floor = 'nochain';
        if (g) { gullyNear(g, r.north[i], r.east[i], 1, 200, hit); if (Number.isFinite(hit.dist)) floor = inV(g, hit.node) ? 'V' : 'floor'; }
        const cls = `${chain ? 'chain' : 'other'} ${floor}`;
        km[cls] = (km[cls] ?? 0) + seg / 1000;
        if (r.s[i] < 50 || r.s[i] > r.s[m - 1] - 50) continue;
        const a = at(r, r.s[i] - 50), b = Math.min(m - 1, at(r, r.s[i] + 50) + 1);
        let dh = Math.abs(heading(r, i, b) - heading(r, a, i)); if (dh > Math.PI) dh = 2 * Math.PI - dh;
        if (dh > Math.PI / 3) { turns[cls] = (turns[cls] ?? 0) + seg / 100; if (sites.length < 12 && chain) sites.push(`   turn line ${li} at ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)} ${((dh * 180) / Math.PI).toFixed(0)} deg ${floor}`); }
      }
      // The mouth: its last 100 m against the receiver's course at the junction.
      if (r.joins !== undefined && r.joins >= 0 && r.s[m - 1] > 150) {
        const T = L[r.joins];
        if (T && T.s.length > 2) {
          const j = at(T, r.joinS ?? 0), j1 = Math.min(T.s.length - 1, at(T, (r.joinS ?? 0) + 100) + 1);
          const a = at(r, r.s[m - 1] - 100);
          let dh = Math.abs(heading(T, j, j1) - heading(r, a, m - 1)); if (dh > Math.PI) dh = 2 * Math.PI - dh;
          if (chain) { mouths++; if (dh > Math.PI / 3) sharp++; }
        }
      }
      // Sinuosity over 1.5 km windows, every 500 m, under the braid line, on floors.
      for (let s0 = 0; s0 + 1500 <= r.s[m - 1]; s0 += 500) {
        const i0 = at(r, s0), i1 = at(r, s0 + 1500);
        const chord = Math.hypot(r.north[i1] - r.north[i0], r.east[i1] - r.east[i0]);
        const A = r.area[i1], S = (r.level[i0] - r.level[i1]) / Math.max(1, r.s[i1] - r.s[i0]);
        if (!(A > 0) || S >= 0.083 * Math.pow(A, -0.44)) continue;
        if (g) { const im = at(r, s0 + 750); gullyNear(g, r.north[im], r.east[im], 1, 200, hit); if (Number.isFinite(hit.dist) && inV(g, hit.node)) continue; }
        sinu.push((r.s[i1] - r.s[i0]) / Math.max(1, chord));
      }
    });
    for (const c of Object.keys(km).sort()) console.log(`seed ${seed} ${c}: ${km[c].toFixed(0)} km, turns ${((100 * (turns[c] ?? 0)) / km[c]).toFixed(1)} per 100 km`);
    sinu.sort((a, b) => a - b);
    const q = (f: number): string => (sinu[Math.min(sinu.length - 1, Math.floor(f * sinu.length))] ?? NaN).toFixed(2);
    console.log(`seed ${seed}: chain stream mouths ${mouths}, joining at more than 60 degrees ${sharp}; floor sinuosity under the braid line (1.5 km windows, n ${sinu.length}) p10 ${q(0.1)} p50 ${q(0.5)} p90 ${q(0.9)}; in 1.3-2.5: ${((100 * sinu.filter((v) => v >= 1.3 && v <= 2.5).length) / Math.max(1, sinu.length)).toFixed(0)} %`);
    for (const s of sites) console.log(s);
  }
  setWorldSeed(0);
});
