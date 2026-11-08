// Foundation streams: views for the report (out/fs/views.txt): tributary junctions in mountain valleys at cockpit height
// and from 1500 m, a close junction, and the size progression along one path from a gully head to the sea.
//   FV_SEEDS=42,777777 FV_OUT=out/fs/views.txt npx vitest run --config scripts/probes/vitest.config.ts fsViews
import { it } from 'vitest';
import { debugMacro, hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { gullyNet, receiverOf } from '../../src/world/terrain/gullies';
import { SLOPE_DI, SLOPE_DJ } from '../../src/world/terrain/hillslopes';
import { setWorldSeed } from '../../src/world/worldSeed';
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: string): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type L = NonNullable<typeof hydrology.rivers>[number];
const at = (r: L, s: number): number => { let k = 0; while (k < r.s.length - 1 && r.s[k] < s) k++; return k; };
/** The lowest a camera at (n, e) looking at (ln, le, lh) may fly: the sight line over the ground by 40 m. */
function clearAlt(n: number, e: number, ln: number, le: number, lh: number, agl: number): number {
  let alt = terrainHeight(n, e) + agl;
  for (let k = 0; k < 60 && alt < 6000; k++) {
    let ok = true;
    for (let t = 0.05; t < 0.95; t += 0.05) {
      const h = alt + (lh - alt) * t;
      if (h < terrainHeight(n + (ln - n) * t, e + (le - e) * t) + 40) { ok = false; break; }
    }
    if (ok) return alt;
    alt += 50;
  }
  return alt;
}
const q = (seed: number, cn: number, ce: number, ca: number, ln: number, le: number, la: number): string => `seed=${seed}&camPos=${cn.toFixed(0)},${ce.toFixed(0)},${ca.toFixed(0)}&camLook=${ln.toFixed(0)},${le.toFixed(0)},${la.toFixed(0)}`;
it('fs views', () => {
  const out: string[] = [];
  for (const seed of (env.FV_SEEDS ?? '42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const R = hydrology.rivers!;
    // Tributary junctions: a stream 3 km or longer, 15-80 km² at its mouth, joining a river in the mountains.
    const cand: Array<{ li: number; A: number }> = [];
    R.forEach((r, li) => {
      if (r.kind !== 1 || (r.joins ?? -1) < 0 || R[r.joins!].kind !== 0 || r.end !== 'channel') return;
      const A = r.area![r.area!.length - 1], L = r.s[r.s.length - 1];
      if (A < 15 || A > 80 || L < 3000) return;
      const m = r.north.length - 1;
      const d = debugMacro(r.north[m], r.east[m]);
      if (!d || d.s.mw < 0.5) return;
      cand.push({ li, A });
    });
    cand.sort((a, b) => Math.abs(a.A - 30) - Math.abs(b.A - 30));
    const used: Array<[number, number]> = [];
    let n = 0;
    for (const c of cand) {
      if (n >= 3) break;
      const r = R[c.li];
      const m = r.north.length - 1;
      const Mn = r.north[m], Me = r.east[m];
      if (used.some(([a, b]) => Math.hypot(a - Mn, b - Me) < 15000)) continue;
      used.push([Mn, Me]);
      n++;
      const k = at(r, r.s[m] - 500);
      const Un = r.north[k], Ue = r.east[k], Ul = r.level[k];
      // Down the river it joins from the junction, looking back up at the junction and the tributary's valley.
      const P = R[r.joins!];
      let bk = 0, bd = Infinity;
      for (let i = 0; i < P.north.length; i++) { const d = Math.hypot(P.north[i] - Mn, P.east[i] - Me); if (d < bd) { bd = d; bk = i; } }
      const down = (dist: number): number => at(P, Math.min(P.s[P.s.length - 1], P.s[bk] + dist));
      const c1 = down(2200), c2 = down(4000), c3 = down(500);
      out.push(`s${seed}-junction${n} ${q(seed, P.north[c1], P.east[c1], Math.max(P.level[c1] + 400, clearAlt(P.north[c1], P.east[c1], Un, Ue, Ul, 150)), Un, Ue, Ul)}`);
      out.push(`s${seed}-junction${n}-hi ${q(seed, P.north[c2], P.east[c2], Math.max(r.level[m] + 1500, clearAlt(P.north[c2], P.east[c2], Mn, Me, r.level[m], 300)), Mn, Me, r.level[m])}`);
      out.push(`s${seed}-junction${n}-close ${q(seed, P.north[c3], P.east[c3], Math.max(P.level[c3] + 180, clearAlt(P.north[c3], P.east[c3], Mn, Me, r.level[m], 100)), Mn, Me, r.level[m])}`);
      console.log(`seed ${seed} junction ${n}: line ${c.li} A ${c.A.toFixed(1)} at ${Mn.toFixed(0)},${Me.toFixed(0)} into ${r.joins}`);
    }
    // The size progression: from a gully head (painted) down a chain stream, its river, to the sea.
    if (env.FV_PATH !== '0') {
      const g = gullyNet()!;
      let best: { li: number; path: Array<{ n: number; e: number; A: number; lv: number }> } | null = null;
      for (let li = 0; li < R.length && !best; li++) {
        const r = R[li];
        if (r.kind !== 1 || r.area![0] < 4.9 || r.area![0] > 8) continue;
        // Follow the lines to the sea.
        const pts: Array<{ n: number; e: number; A: number; lv: number }> = [];
        let cur = li, s0 = 0, guard = 0, ok = false;
        while (guard++ < 30) {
          const L = R[cur];
          for (let i = at(L, s0); i < L.s.length; i += 4) pts.push({ n: L.north[i], e: L.east[i], A: L.area?.[i] ?? 0, lv: L.level[i] });
          if (L.end === 'sea' || ((L.joins ?? -1) < 0 && L.level[L.level.length - 1] < 3)) { ok = true; break; }
          if ((L.joins ?? -1) < 0) break;
          const P = R[L.joins!];
          const mN = L.north[L.north.length - 1], mE = L.east[L.east.length - 1];
          let bk = 0, bd = Infinity;
          for (let i = 0; i < P.north.length; i++) { const d = Math.hypot(P.north[i] - mN, P.east[i] - mE); if (d < bd) { bd = d; bk = i; } }
          cur = L.joins!; s0 = P.s[bk];
        }
        if (!ok || pts[pts.length - 1].A < 800) continue;
        // Up the chain from the stream's head to a gully head about 0.4 km².
        const hn = r.north[0], he = r.east[0];
        let node = Math.round((hn - g.origin) / g.cell) * g.n + Math.round((he - g.origin) / g.cell);
        const up: Array<{ n: number; e: number; A: number; lv: number }> = [];
        for (let k = 0; k < 200 && g.area[node] > 0.4; k++) {
          let bq = -1, ba = 0;
          const y = Math.floor(node / g.n), x = node % g.n;
          for (let d = 0; d < 8; d++) { const nb = (y + SLOPE_DI[d]) * g.n + x + SLOPE_DJ[d]; if (receiverOf(g, nb) === node && g.area[nb] > ba) { ba = g.area[nb]; bq = nb; } }
          if (bq < 0) break;
          node = bq;
          const nn = g.origin + Math.floor(node / g.n) * g.cell, ee = g.origin + (node % g.n) * g.cell;
          up.unshift({ n: nn, e: ee, A: g.area[node], lv: terrainHeight(nn, ee) });
        }
        if (!up.length || up[0].A > 0.8) continue;
        best = { li, path: [...up, ...pts] };
      }
      if (best) {
        const P = best.path;
        const targets = [0.4, 1.5, 5, 20, 200, 2000, 1e9];
        let j = 0;
        for (const T of targets) {
          while (j < P.length - 1 && P[j].A < T) j++;
          if (T > 1e8) j = Math.max(0, P.length - 6);
          const p0 = P[j];
          // From down the stream (on its course), looking back up it.
          const off = T < 10 ? 900 : T < 300 ? 1500 : 2500;
          let c = j;
          while (c < P.length - 1 && Math.hypot(P[c].n - p0.n, P[c].e - p0.e) < off) c++;
          const look = terrainHeight(p0.n, p0.e);
          out.push(`s${seed}-path-A${T} ${q(seed, P[c].n, P[c].e, Math.max(P[c].lv + (T < 10 ? 300 : 400), clearAlt(P[c].n, P[c].e, p0.n, p0.e, look, 150)), p0.n, p0.e, look)}`);
          console.log(`seed ${seed} path A ${T}: at ${p0.n.toFixed(0)},${p0.e.toFixed(0)} A ${p0.A.toFixed(2)}`);
        }
      }
    }
  }
  fs.writeFileSync(env.FV_OUT ?? 'out/fs/views.txt', out.join('\n') + '\n');
  setWorldSeed(0);
});
