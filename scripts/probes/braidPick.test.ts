// Braids: the picked braided-reach views (out/fs/W/B/PICK-RULE.txt, written before any picture was opened), per seed
// (BP_SEEDS): the two mountain-valley 1 km pieces with the highest braid share and the plains piece with the highest,
// and a plan and an oblique camera on each. Writes BP_OUT (a view list: name, query).
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: string): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Line = { north: Float64Array; east: Float64Array; level: Float64Array; s: Float64Array; area?: Float64Array; braidK?: Float32Array; braidShare?: Float32Array };
it('braid picks', () => {
  const S = makeSample();
  const g = (n: number, e: number): number => (sampleTerrain(n, e, S), S.ground);
  const out: string[] = [];
  for (const seed of (env.BP_SEEDS ?? '1,42,777777,7').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = (hydrology.rivers ?? []) as unknown as Line[];
    type Piece = { li: number; n: number; e: number; z: number; dn: number; de: number; A: number; b: number; cls: string };
    const pieces: Piece[] = [];
    for (let li = 0; li < L.length; li++) {
      const r = L[li];
      const m = r.s.length;
      const K = r.braidK;
      if (!K || m < 2) continue;
      const total = r.s[m - 1];
      for (let s0 = 0; s0 + 1000 <= total; s0 += 1000) {
        // The braid share at each sample (RiverLine.braidShare: formOf's, as smooth along the line as K), averaged.
        let sum = 0;
        let cnt = 0;
        let i0 = -1;
        let i1 = -1;
        let im = -1;
        for (let i = 0; i < m; i++) {
          if (r.s[i] < s0 || r.s[i] > s0 + 1000) continue;
          if (i0 < 0) i0 = i;
          i1 = i;
          if (im < 0 && r.s[i] >= s0 + 500) im = i;
          sum += r.braidShare![i];
          cnt++;
        }
        if (cnt === 0 || im < 0 || i1 <= i0) continue;
        const b = sum / cnt;
        if (b < 0.3) continue;
        const cl = Math.hypot(r.north[i1] - r.north[i0], r.east[i1] - r.east[i0]) || 1;
        const dn = (r.north[i1] - r.north[i0]) / cl;
        const de = (r.east[i1] - r.east[i0]) / cl;
        const n = r.north[im];
        const e = r.east[im];
        const z = r.level[im];
        // Right of the chord (-de, dn); 2500 m either side.
        const gR = g(n - de * 2500, e + dn * 2500);
        const gL = g(n + de * 2500, e - dn * 2500);
        const rise = [gR - z, gL - z];
        const cls = Math.min(...rise) >= 150 ? 'M' : Math.max(...rise) <= 40 && gR > 1 && gL > 1 ? 'P' : '';
        if (cls) pieces.push({ li, n, e, z, dn, de, A: r.area?.[im] ?? 0, b, cls });
      }
    }
    const order = (a: Piece, b: Piece): number => b.b - a.b || b.A - a.A;
    const mtn = pieces.filter((p) => p.cls === 'M').sort(order);
    const pln = pieces.filter((p) => p.cls === 'P').sort(order);
    const picks: Array<[string, Piece | undefined]> = [];
    const m1 = mtn[0];
    const m2 = m1 ? mtn.find((p) => Math.hypot(p.n - m1.n, p.e - m1.e) >= 10000) : undefined;
    picks.push(['M1', m1], ['M2', m2], ['P1', pln[0]]);
    for (const [slot, p] of picks) {
      if (!p) {
        console.log(`BP seed ${seed} ${slot}: none (mountain ${mtn.length}, plains ${pln.length} pieces with share >= 0.3)`);
        continue;
      }
      const cn = p.n - 2500 * p.dn;
      const ce = p.e - 2500 * p.de;
      const cz = Math.max(p.z + 1200, g(cn, ce) + 300);
      const R = (x: number): number => Math.round(x);
      console.log(`BP seed ${seed} ${slot}: line ${p.li} at ${R(p.n)},${R(p.e)} level ${p.z.toFixed(0)} A ${p.A.toFixed(0)} km2 share ${p.b.toFixed(2)}`);
      out.push(`bp${seed}-${slot}-plan seed=${seed}&camPos=${R(p.n)},${R(p.e)},${R(p.z + 3500)}&camLook=${R(p.n) + 1},${R(p.e)},${R(p.z)}&fov=55`);
      out.push(`bp${seed}-${slot}-obl seed=${seed}&camPos=${R(cn)},${R(ce)},${R(cz)}&camLook=${R(p.n)},${R(p.e)},${R(p.z)}&fov=55`);
    }
  }
  fs.writeFileSync(env.BP_OUT ?? 'out/fs/W/B/views-picks.txt', out.join('\n') + '\n');
  setWorldSeed(0);
});
