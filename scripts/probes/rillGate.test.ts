// Gate D for the painted network (rills.ts): in RG_PATCHES patches about the mountains' chains (and the patches about
// RG_AT, if given), the painted lines joined end to end:
//  (ii) wet line ends (the water drawn there: rillWaterHalf > 0) more than 30 m from water (a traced line's water, a
//       lake), and how many of them end in a sink (a hollow of the detail ground);
// (iii) right-angle turns: points where the course's heading over the 50 m before and the 50 m after differs by more
//       than 60 degrees, once per 100 m, per 100 km of painted course;
//  and, with RG_CAM / RG_LOOK, every wet segment's points projected into that camera (PL lines for bandwidth.py,
//  li = the catchment band: 0 under 0.25 km², 1 to 1, 2 to 3, 3 to 10).
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { gullyNet } from '../../src/world/terrain/gullies';
import { RILL_PATCH, rillArea, rillPatchLines, rillWaterHalf, type RillSegment } from '../../src/world/terrain/rills';
import { bedWidth } from '../../src/world/terrain/streams';
import { setWorldSeed } from '../../src/world/worldSeed';
import { hash2i } from '../../src/world/terrain/noise';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('rill gate', async () => {
  for (const seed of (env.RG_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    const g = gullyNet()!;
    const patches = new Set<string>();
    const cand: number[] = [];
    for (let q = 0; q < g.n * g.n; q++) if (g.dir[q] && g.area[q] >= 5 && g.area[q] < 40) cand.push(q);
    cand.sort((a, b) => (hash2i(a, seed) >>> 0) - (hash2i(b, seed) >>> 0));
    for (const q of cand) {
      if (patches.size >= Number(env.RG_PATCHES ?? 20)) break;
      const n = g.origin + Math.floor(q / g.n) * g.cell, e = g.origin + (q % g.n) * g.cell;
      patches.add(`${Math.floor(e / RILL_PATCH)},${Math.floor(n / RILL_PATCH)}`);
    }
    if (env.RG_AT) {
      const [an, ae] = env.RG_AT.split(',').map(Number);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) patches.add(`${Math.floor(ae / RILL_PATCH) + a},${Math.floor(an / RILL_PATCH) + b}`);
    }
    const hit = { dist: 0, level: 0, halfWidth: 0, s: 0, side: 0, beyondSource: 0 };
    let ends = 0, endsFar = 0, km = 0, turns = 0;
    const farAt: string[] = [];
    const proj: string[] = [];
    let cam: ((e: number, y: number, n: number) => [number, number, number]) | null = null;
    let kpx = 0;
    if (env.RG_CAM) {
      const [cn, ce, ca] = env.RG_CAM.split(',').map(Number), [ln, le, la] = (env.RG_LOOK ?? '').split(',').map(Number);
      const C = [ce, ca, -cn], L = [le, la, -ln];
      const f = [L[0] - C[0], L[1] - C[1], L[2] - C[2]]; const fl = Math.hypot(...f); for (let i = 0; i < 3; i++) f[i] /= fl;
      const r = [-f[2], 0, f[0]]; const rl = Math.hypot(...r); for (let i = 0; i < 3; i++) r[i] /= rl;
      const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      kpx = 450 / Math.tan(Math.PI / 6);
      cam = (e, y, n) => { const d = [e - C[0], y - C[1], -n - C[2]]; const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2]; return [800 + (kpx * (d[0] * r[0] + d[1] * r[1] + d[2] * r[2])) / z, 450 - (kpx * (d[0] * u[0] + d[1] * u[1] + d[2] * u[2])) / z, z]; };
    }
    for (const key of patches) {
      const [pi, pj] = key.split(',').map(Number);
      const { segs } = rillPatchLines({ pi, pj });
      const e0 = pi * RILL_PATCH, n0 = pj * RILL_PATCH;
      const inCore = (s: RillSegment): boolean => { const me = (s.e0 + s.e1) / 2, mn = (s.n0 + s.n1) / 2; return me >= e0 && me < e0 + RILL_PATCH && mn >= n0 && mn < n0 + RILL_PATCH; };
      const K = (e: number, n: number): string => `${e.toFixed(2)},${n.toFixed(2)}`;
      const from = new Map<string, RillSegment[]>();
      const into = new Map<string, number>();
      const toSeg = new Map<string, RillSegment>();
      for (const s of segs) { const k = K(s.e0, s.n0); (from.get(k) ?? from.set(k, []).get(k)!).push(s); into.set(K(s.e1, s.n1), (into.get(K(s.e1, s.n1)) ?? 0) + 1); const k1 = K(s.e1, s.n1); const o = toSeg.get(k1); if (!o || s.s0 > o.s0) toSeg.set(k1, s); }
      for (const s of segs) {
        if (!inCore(s)) continue;
        const L = Math.hypot(s.e1 - s.e0, s.n1 - s.n0);
        km += L / 1000;
        const wet = rillWaterHalf(s.s1) > 0;
        // An end: nothing goes on from its far end.
        if (!from.has(K(s.e1, s.n1)) && wet) {
          ends++;
          hydrology.queryRiver(s.n1, s.e1, hit);
          const lake = hydrology.lakeMask?.at(s.n1, s.e1, terrainHeight(s.n1, s.e1)) ?? -Infinity;
          const d = lake > -Infinity ? 0 : hit.dist - hit.halfWidth;
          if (!(d <= 30)) { endsFar++; if (farAt.length < 6) farAt.push(`${s.n1.toFixed(0)},${s.e1.toFixed(0)} d ${Number.isFinite(d) ? d.toFixed(0) : 'inf'}`); }
        }
        // Turns: heading over 50 m before this segment's start and 50 m after it (following the main next segment).
        const back = (() => { let e = s.e0, n = s.n0, len = 0, k = K(e, n); for (let g2 = 0; g2 < 20 && len < 50; g2++) { const prev = toSeg.get(k); if (!prev) break; len += Math.hypot(prev.e1 - prev.e0, prev.n1 - prev.n0); e = prev.e0; n = prev.n0; k = K(e, n); } return len >= 40 ? [e, n] : null; })();
        const ahead = (() => { let e = s.e0, n = s.n0, len = 0, cur: RillSegment | undefined = s; for (let g2 = 0; g2 < 20 && cur && len < 50; g2++) { len += Math.hypot(cur.e1 - cur.e0, cur.n1 - cur.n0); e = cur.e1; n = cur.n1; cur = from.get(K(e, n))?.[0]; } return len >= 40 ? [e, n] : null; })();
        if (back && ahead) {
          const h1 = Math.atan2(s.e0 - back[0], s.n0 - back[1]), h2 = Math.atan2(ahead[0] - s.e0, ahead[1] - s.n0);
          let dh = Math.abs(h2 - h1); if (dh > Math.PI) dh = 2 * Math.PI - dh;
          if (dh > Math.PI / 3) turns += L / 100; // (counted once per 100 m of course turning that sharply)
        }
        if (cam && wet) {
          const A = rillArea((s.s0 + s.s1) / 2);
          const band = A < 0.25 ? 0 : A < 1 ? 1 : A < 3 ? 2 : 3;
          for (let t = 0; t <= 1; t += 30 / Math.max(30, L)) {
            const e = s.e0 + (s.e1 - s.e0) * t, n = s.n0 + (s.n1 - s.n0) * t;
            const [px, py, z] = cam(e, terrainHeight(n, e), n);
            if (z <= 0 || px < 20 || px > 1580 || py < 20 || py > 880) continue;
            const [qx, qy] = cam(s.e1, terrainHeight(s.n1, s.e1), s.n1);
            proj.push(`PL ${JSON.stringify({ li: band, s: 0, A, px, py, dx: qx - px, dy: qy - py, dist: Math.round(z), water: (2 * rillWaterHalf((s.s0 + s.s1) / 2)) / (z / kpx), bed: bedWidth(A) / (z / kpx) })}`);
          }
        }
      }
    }
    console.log(`seed ${seed}: ${patches.size} patches, painted course ${km.toFixed(0)} km; wet line ends ${ends}, more than 30 m from water ${endsFar}; right-angle turns ${((100 * turns) / Math.max(1, km)).toFixed(1)} per 100 km`);
    for (const f of farAt) console.log(`   far end ${f}`);
    if (env.RG_OUT) (await import(/* @vite-ignore */ 'node:fs' as string)).writeFileSync(env.RG_OUT, proj.join('\n') + '\n');
  }
  setWorldSeed(0);
});
