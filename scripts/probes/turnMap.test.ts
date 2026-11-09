// Round S: a map of the painted lines (blue wet, brown dry), the gully chains (red, >= 0.25 km²), the traced lines
// (cyan) and the painted network's right-angle turns (yellow rings, rillGate's rule) over the drawn ground's hillshade,
// on TM_PATCHES x TM_PATCHES rill patches about TM_AT (north,east). Prints each turn with its ground slope and whether
// the chain beside it runs in a V.
//   TM_SEED=42 TM_AT=-13500,-41500 TM_PATCHES=2 TM_OUT=out/fs/shots/tm.png npx vitest run --config scripts/probes/vitest.config.ts turnMap
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { gullyNear, gullyNet, inV, receiverOf, type GullyHit } from '../../src/world/terrain/gullies';
import { RILL_PATCH, rillPatchLines, rillWaterHalf, rillBedHalf, type RillSegment } from '../../src/world/terrain/rills';
import { setWorldSeed } from '../../src/world/worldSeed';
import { png } from './png';
import { hash2i } from '../../src/world/terrain/noise';
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: Uint8Array | string): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('turn map', () => {
  setWorldSeed(Number(env.TM_SEED ?? 42));
  const [N0, E0] = (env.TM_AT ?? '-13500,-41500').split(',').map(Number);
  const P = Number(env.TM_PATCHES ?? 2);
  const pi0 = Math.floor(E0 / RILL_PATCH) - Math.floor((P - 1) / 2), pj0 = Math.floor(N0 / RILL_PATCH) - Math.floor((P - 1) / 2);
  const e0 = pi0 * RILL_PATCH, n0 = pj0 * RILL_PATCH, SPAN = P * RILL_PATCH, step = Number(env.TM_STEP ?? 4) * P / 2, W = Math.round(SPAN / step);
  const s = makeSample();
  const g = new Float64Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { sampleTerrain(n0 + SPAN - (y + 0.5) * step, e0 + (x + 0.5) * step, s); g[y * W + x] = s.ground; }
  const rgb = new Uint8Array(W * W * 3);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const hx = g[y * W + Math.min(W - 1, x + 1)] - g[y * W + Math.max(0, x - 1)];
    const hy = g[Math.max(0, y - 1) * W + x] - g[Math.min(W - 1, y + 1) * W + x];
    const sh = Math.min(1.2, Math.max(0.2, 0.8 + ((-hx + hy) / (2 * step)) * 0.6));
    const i = (y * W + x) * 3; rgb[i] = 190 * sh; rgb[i + 1] = 180 * sh; rgb[i + 2] = 160 * sh;
  }
  const plot = (e: number, n: number, r: number, c: number[], ring = false): void => {
    const cx = (e - e0) / step, cy = (n0 + SPAN - n) / step, rr = Math.max(0.6, r / step);
    for (let y = Math.floor(cy - rr); y <= Math.ceil(cy + rr); y++) for (let x = Math.floor(cx - rr); x <= Math.ceil(cx + rr); x++) {
      if (x < 0 || y < 0 || x >= W || y >= W) continue;
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 > rr * rr || (ring && d2 < (rr - 1.2) * (rr - 1.2))) continue;
      const i = (y * W + x) * 3; rgb[i] = c[0]; rgb[i + 1] = c[1]; rgb[i + 2] = c[2];
    }
  };
  const gn = gullyNet()!;
  for (let y = 0; y < gn.n; y++) for (let x = 0; x < gn.n; x++) {
    const q = y * gn.n + x; if (!gn.dir[q] || gn.area[q] < 0.25) continue;
    const n = gn.origin + y * gn.cell, e = gn.origin + x * gn.cell;
    if (n < n0 || n > n0 + SPAN || e < e0 || e > e0 + SPAN) continue;
    const r = receiverOf(gn, q), rn = gn.origin + Math.floor(r / gn.n) * gn.cell, re = gn.origin + (r % gn.n) * gn.cell;
    for (let t = 0; t <= 1; t += 0.02) plot(e + (re - e) * t, n + (rn - n) * t, 0.5, inV(gn, q) ? [220, 30, 30] : [230, 120, 200]);
  }
  for (const r of hydrology.rivers ?? []) for (let i = 0; i < r.north.length; i++) if (r.north[i] > n0 && r.north[i] < n0 + SPAN && r.east[i] > e0 && r.east[i] < e0 + SPAN) plot(r.east[i], r.north[i], Math.max(2, r.halfWidth[i]), [0, 200, 220]);
  const K = (e: number, n: number): string => `${e.toFixed(2)},${n.toFixed(2)}`;
  // (TM_GATE=1: rillGate's patches instead, no map, the turns counted by class.)
  const list: [number, number][] = [];
  if (env.TM_GATE) {
    const set = new Set<string>();
    const cand: number[] = [];
    for (let q = 0; q < gn.n * gn.n; q++) if (gn.dir[q] && gn.area[q] >= 5 && gn.area[q] < 40) cand.push(q);
    const seed = Number(env.TM_SEED ?? 42);
    cand.sort((a, b) => (hash2i(a, seed) >>> 0) - (hash2i(b, seed) >>> 0));
    for (const q of cand) {
      if (set.size >= 20) break;
      const n = gn.origin + Math.floor(q / gn.n) * gn.cell, e = gn.origin + (q % gn.n) * gn.cell;
      const key = `${Math.floor(e / RILL_PATCH)},${Math.floor(n / RILL_PATCH)}`;
      if (!set.has(key)) { set.add(key); list.push([Math.floor(e / RILL_PATCH), Math.floor(n / RILL_PATCH)]); }
    }
  } else for (let pj = pj0; pj < pj0 + P; pj++) for (let pi = pi0; pi < pi0 + P; pi++) list.push([pi, pj]);
  const cls: Record<string, number> = {};
  const hit: GullyHit = { dist: 0, area: 0, node: -1, t: 0 };
  let km = 0, turns = 0;
  const sites: string[] = [];
  const perPatch: string[] = [];
  for (const [pi, pj] of list) {
    const t0 = turns;
    const { segs } = rillPatchLines({ pi, pj });
    const pe0 = pi * RILL_PATCH, pn0 = pj * RILL_PATCH;
    const from = new Map<string, RillSegment[]>(), toSeg = new Map<string, RillSegment>();
    const nIn = new Map<string, number>();
    for (const sg of segs) nIn.set(K(sg.e1, sg.n1), (nIn.get(K(sg.e1, sg.n1)) ?? 0) + 1);
    for (const sg of segs) { const k = K(sg.e0, sg.n0); (from.get(k) ?? from.set(k, []).get(k)!).push(sg); const k1 = K(sg.e1, sg.n1); const o = toSeg.get(k1); if (!o || sg.s0 > o.s0) toSeg.set(k1, sg); }
    for (const sg of segs) {
      const me = (sg.e0 + sg.e1) / 2, mn = (sg.n0 + sg.n1) / 2;
      if (me < pe0 || me >= pe0 + RILL_PATCH || mn < pn0 || mn >= pn0 + RILL_PATCH) continue;
      const L = Math.hypot(sg.e1 - sg.e0, sg.n1 - sg.n0);
      km += L / 1000;
      for (let t = 0; t <= 1; t += 1 / Math.max(1, L / 2)) {
        const sz = sg.s0 + (sg.s1 - sg.s0) * t, wh = rillWaterHalf(sz);
        plot(sg.e0 + (sg.e1 - sg.e0) * t, sg.n0 + (sg.n1 - sg.n0) * t, Math.max(1, wh > 0 ? wh : rillBedHalf(sz)), wh > 0 ? [30, 80, 230] : [110, 80, 40]);
      }
      let junc = false, longSeg = false;
      const back = (() => { let e = sg.e0, n = sg.n0, len = 0, k = K(e, n); for (let g2 = 0; g2 < 20 && len < 50; g2++) { const prev = toSeg.get(k); if (!prev) break; const l = Math.hypot(prev.e1 - prev.e0, prev.n1 - prev.n0); if (l > 24) longSeg = true; len += l; e = prev.e0; n = prev.n0; k = K(e, n); } return len >= 40 ? [e, n] : null; })();
      const ahead = (() => { let e = sg.e0, n = sg.n0, len = 0, cur: RillSegment | undefined = sg; for (let g2 = 0; g2 < 20 && cur && len < 50; g2++) { const l = Math.hypot(cur.e1 - cur.e0, cur.n1 - cur.n0); if (l > 24) longSeg = true; len += l; e = cur.e1; n = cur.n1; if ((nIn.get(K(e, n)) ?? 0) >= 2) junc = true; cur = from.get(K(e, n))?.[0]; } return len >= 40 ? [e, n] : null; })();
      if ((nIn.get(K(sg.e0, sg.n0)) ?? 0) >= 2) junc = true;
      if (back && ahead) {
        const h1 = Math.atan2(sg.e0 - back[0], sg.n0 - back[1]), h2 = Math.atan2(ahead[0] - sg.e0, ahead[1] - sg.n0);
        let dh = Math.abs(h2 - h1); if (dh > Math.PI) dh = 2 * Math.PI - dh;
        if (dh > Math.PI / 3) {
          turns += L / 100;
          // Ground slope over 100 m about the turn; the chain beside it.
          sampleTerrain(sg.n0 + 50, sg.e0, s); const a = s.ground; sampleTerrain(sg.n0 - 50, sg.e0, s); const b = s.ground;
          sampleTerrain(sg.n0, sg.e0 + 50, s); const c = s.ground; sampleTerrain(sg.n0, sg.e0 - 50, s); const d = s.ground;
          const slope = Math.hypot(a - b, c - d) / 100;
          gullyNear(gn, sg.n0, sg.e0, 0.25, 250, hit);
          const cl = `${slope < 0.05 ? 'flat<0.05' : slope < 0.15 ? 'gentle<0.15' : slope < 0.4 ? 'mid<0.4' : 'steep'} ${Number.isFinite(hit.dist) ? (inV(gn, hit.node) ? 'V' : 'floor') : 'nochain'} ${sg.s0 > 0.558 ? 'A>1' : 'A<1'}`;
          const kind = junc ? 'junction' : longSeg ? 'spill' : 'course';
          cls['KIND ' + kind] = (cls['KIND ' + kind] ?? 0) + L / 100;
          cls[cl] = (cls[cl] ?? 0) + L / 100;
          sites.push(`turn ${sg.n0.toFixed(0)},${sg.e0.toFixed(0)} ${((dh * 180) / Math.PI).toFixed(0)} deg slope ${slope.toFixed(2)} chain ${Number.isFinite(hit.dist) ? `${hit.dist.toFixed(0)} m A ${hit.area.toFixed(1)} ${inV(gn, hit.node) ? 'V' : 'floor'}` : 'none'}`);
          plot(sg.e0, sg.n0, 14, [250, 230, 0], true);
        }
      }
    }
    perPatch.push(`patch at ${(pj + 0.5) * RILL_PATCH},${(pi + 0.5) * RILL_PATCH}: ${(turns - t0).toFixed(1)}`);
  }
  for (const pp of perPatch) console.log(pp);
  console.log(`turnMap: painted ${km.toFixed(1)} km, turns ${turns.toFixed(1)} (${((100 * turns) / Math.max(1e-6, km)).toFixed(1)} per 100 km)`);
  for (const [c, v] of Object.entries(cls).sort((a, b) => b[1] - a[1])) console.log(`class ${c}: ${v.toFixed(1)}`);
  if (env.TM_GATE) return;
  for (const t of sites) console.log(t);
  fs.writeFileSync(env.TM_OUT ?? 'out/fs/shots/tm.png', png(W, W, rgb));
});
