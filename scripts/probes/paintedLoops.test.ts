// paintedLoops (round T, from inv-vjunctions' invVjunctionsLoops): does the painted network (rillPatchLines segs) contain cycles or reciprocal segment pairs, and what
// are invJunctionsPainted's "straight grid runs >= 300 m" when the downstream walk may not revisit a segment?
// Same patch choice as invJunctionsPainted (JV_PATCHES, default 8).
//   JV_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts paintedLoops --reporter=verbose
import { it } from 'vitest';
import { gullyNet } from '../../src/world/terrain/gullies';
import { RILL_PATCH, rillPatchLines, rillWaterHalf, type RillSegment } from '../../src/world/terrain/rills';
import { setWorldSeed } from '../../src/world/worldSeed';
import { hash2i } from '../../src/world/terrain/noise';
import { terrainHeight } from '../../src/world/terrain/heightfield';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const D = 180 / Math.PI;
const TOL = 2.5;
it('painted loops', () => {
  for (const seed of (env.JV_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const g = gullyNet()!;
    const patches: string[] = [];
    const cand: number[] = [];
    for (let q = 0; q < g.n * g.n; q++) if (g.dir[q] && g.area[q] >= 5 && g.area[q] < 40) cand.push(q);
    cand.sort((a, b) => (hash2i(a, seed) >>> 0) - (hash2i(b, seed) >>> 0));
    const set = new Set<string>();
    for (const q of cand) {
      if (set.size >= Number(env.JV_PATCHES ?? 8)) break;
      const n = g.origin + Math.floor(q / g.n) * g.cell, e = g.origin + (q % g.n) * g.cell;
      const k = `${Math.floor(e / RILL_PATCH)},${Math.floor(n / RILL_PATCH)}`;
      if (!set.has(k)) { set.add(k); patches.push(k); }
    }
    const axis = (h: number): number => { const deg = ((h * D) % 180 + 180) % 180; const k = Math.round(deg / 45); return Math.abs(deg - k * 45); };
    const K = (e: number, n: number): string => `${e.toFixed(2)},${n.toFixed(2)}`;
    let km = 0, runOld = 0, runNew = 0, recip = 0, dup = 0, zero = 0, cyc = 0;
    const longOld: string[] = [], longNew: string[] = [], recipAt: string[] = [];
    for (const key of patches) {
      const [pi, pj] = key.split(',').map(Number);
      const { segs } = rillPatchLines({ pi, pj });
      const e0 = pi * RILL_PATCH, n0 = pj * RILL_PATCH;
      const inCore = (e: number, n: number): boolean => e >= e0 && e < e0 + RILL_PATCH && n >= n0 && n < n0 + RILL_PATCH;
      const from = new Map<string, RillSegment[]>(), toSeg = new Map<string, RillSegment>();
      const edge = new Map<string, number>();
      for (const s of segs) {
        (from.get(K(s.e0, s.n0)) ?? from.set(K(s.e0, s.n0), []).get(K(s.e0, s.n0))!).push(s);
        const k1 = K(s.e1, s.n1);
        const o = toSeg.get(k1); if (!o || s.s0 > o.s0) toSeg.set(k1, s);
        const ek = `${K(s.e0, s.n0)}>${k1}`;
        edge.set(ek, (edge.get(ek) ?? 0) + 1);
        if (K(s.e0, s.n0) === k1) zero++;
      }
      for (const [ek, c] of edge) {
        if (c > 1) dup += c - 1;
        const [a, b] = ek.split('>');
        if (a < b && edge.has(`${b}>${a}`)) { recip++; if (recipAt.length < 12) { const [e, n] = a.split(',').map(Number); recipAt.push(`   reciprocal pair at ${n.toFixed(0)},${e.toFixed(0)} (patch ${key}) in core ${inCore(e, n)}`); } }
      }
      // Cycles along the "first outgoing" walk (the one invJunctionsPainted uses).
      const seenStart = new Set<RillSegment>();
      for (const s of segs) {
        if (seenStart.has(s)) continue;
        const vis = new Set<RillSegment>();
        let cur: RillSegment | undefined = s;
        for (let i = 0; i < 2000 && cur; i++) { if (vis.has(cur)) { cyc++; break; } vis.add(cur); seenStart.add(cur); cur = from.get(K(cur.e1, cur.n1))?.[0]; }
      }
      const back = (first: RillSegment, len0: number): [number, number] | null => { let cur: RillSegment | undefined = first, len = 0, e = first.e1, n = first.n1; for (let i = 0; i < 40 && cur && len < len0; i++) { len += Math.hypot(cur.e1 - cur.e0, cur.n1 - cur.n0); e = cur.e0; n = cur.n0; cur = toSeg.get(K(e, n)); } return len >= len0 * 0.8 ? [e, n] : null; };
      const ahead = (e: number, n: number, len0: number): [number, number] | null => { let len = 0, cur = from.get(K(e, n))?.[0]; for (let i = 0; i < 40 && cur && len < len0; i++) { len += Math.hypot(cur.e1 - cur.e0, cur.n1 - cur.n0); e = cur.e1; n = cur.n1; cur = from.get(K(e, n))?.[0]; } return len >= len0 * 0.8 ? [e, n] : null; };
      const hd = (a: [number, number], b: [number, number]): number => Math.atan2(b[0] - a[0], b[1] - a[1]);
      const onAxisRun = new Map<RillSegment, number>();
      for (const s of segs) {
        if (!inCore((s.e0 + s.e1) / 2, (s.n0 + s.n1) / 2)) continue;
        km += Math.hypot(s.e1 - s.e0, s.n1 - s.n0) / 1000;
        const prev = toSeg.get(K(s.e0, s.n0));
        const b = prev ? back(prev, 50) : null, a = ahead(s.e0, s.n0, 50);
        if (b && a) { const h = hd(b, a); if (axis(h) < TOL) onAxisRun.set(s, Math.round(((h * D) % 180 + 180) % 180 / 45) % 4); }
      }
      for (const [s, ax] of onAxisRun) {
        const prev = toSeg.get(K(s.e0, s.n0));
        if (prev && onAxisRun.get(prev) === ax) continue;
        // Old walk (as invJunctionsPainted: up to 400 steps, revisits allowed).
        let len = 0, cur: RillSegment | undefined = s;
        for (let g2 = 0; g2 < 400 && cur && onAxisRun.get(cur) === ax; g2++) { len += Math.hypot(cur.e1 - cur.e0, cur.n1 - cur.n0); cur = from.get(K(cur.e1, cur.n1))?.[0]; }
        if (len >= 300) { runOld += len / 1000; longOld.push(`${len.toFixed(0)} m axis ${ax * 45} at ${s.n0.toFixed(0)},${s.e0.toFixed(0)} wet ${rillWaterHalf(s.s1) > 0}`); }
        // New walk: no segment twice.
        const vis = new Set<RillSegment>();
        let len2 = 0; cur = s;
        for (let g2 = 0; g2 < 400 && cur && onAxisRun.get(cur) === ax && !vis.has(cur); g2++) { vis.add(cur); len2 += Math.hypot(cur.e1 - cur.e0, cur.n1 - cur.n0); cur = from.get(K(cur.e1, cur.n1))?.[0]; }
        if (len2 >= 300) { runNew += len2 / 1000; longNew.push(`${len2.toFixed(0)} m axis ${ax * 45} at ${s.n0.toFixed(0)},${s.e0.toFixed(0)} wet ${rillWaterHalf(s.s1) > 0}`); }
      }
    }
    console.log(`seed ${seed}: ${patches.length} patches ${patches.join(' ')}; painted ${km.toFixed(0)} km`);
    console.log(`seed ${seed}: segs graph: duplicate edges ${dup}, reciprocal pairs (A>B and B>A) ${recip}, zero-length ${zero}, cycles on the first-outgoing walk ${cyc}`);
    console.log(`seed ${seed}: straight grid runs >= 300 m: as invJunctionsPainted ${runOld.toFixed(1)} km (${((100 * runOld) / km).toFixed(2)} %), with no segment twice ${runNew.toFixed(1)} km (${((100 * runNew) / km).toFixed(2)} %)`);
    longOld.sort((a, b) => parseFloat(b) - parseFloat(a)); longNew.sort((a, b) => parseFloat(b) - parseFloat(a));
    console.log(`seed ${seed}: longest old: ${longOld.slice(0, 8).join(' | ')}`);
    console.log(`seed ${seed}: longest new: ${longNew.slice(0, 8).join(' | ')}`);
    for (const r of recipAt) console.log(r);
  }
  setWorldSeed(0);
});
