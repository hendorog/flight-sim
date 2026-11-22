// Organic map: every drawn line of a seeded world (hydrology.rivers) at its native samples, its water edge and banks
// every 10 m of arc, and a floor / relief / braid transect at the middle of every 1 km reach. Analysis: out/om/omStats.py.
//   OM_SEEDS=42 OM_OUT=out/om npx vitest run --config scripts/probes/vitest.config.ts organicMap
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { streamDebug } from '../../src/world/terrain/streams';
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: string): void; mkdirSync(p: string, o: object): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

type Line = { north: Float64Array; east: Float64Array; level: Float64Array; halfWidth: Float64Array; s: Float64Array; area?: Float64Array; kind?: number; joins?: number; end?: string; regime?: Uint8Array; bedR?: Float32Array; bedL?: Float32Array; steepness?: Float32Array };
const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;

it('organic map', () => {
  const OUT = env.OM_OUT ?? 'out/om';
  fs.mkdirSync(OUT, { recursive: true });
  const S = makeSample();
  const g = (n: number, e: number): number => {
    sampleTerrain(n, e, S);
    return S.ground;
  };
  const hit = { dist: Infinity, side: 0, line: -1, kind: 0, index: 0, s: 0, level: 0, halfWidth: 0, gradient: 0, steepness: 0, regime: 0, speed: 0, dirN: 0, dirE: 0 };
  for (const seed of (env.OM_SEEDS ?? '42').split(',').map(Number)) {
    const t0 = performance.now();
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = (hydrology.rivers ?? []) as unknown as Line[];
    const rep = hydrology.streamReport as unknown as { chains?: { traced: number } };
    const nR = L.filter((r) => (r.kind ?? 0) === 0).length;
    // The chain block (as feedCount / onStreams / cornerGate): after the outlets, heads (6 km²) and feeders (5 km²).
    let cs = nR;
    for (let i = nR; i < L.length; i++) {
      const a0 = L[i].area?.[0] ?? 0;
      if (Math.abs(a0 - 5) < 1e-6 || Math.abs(a0 - 6) < 1e-6) cs = i + 1;
      else if (a0 >= 9.95 && a0 < 10.05 && i > cs + 30) break;
    }
    const ce = cs + (rep.chains?.traced ?? 0);
    const src = streamDebug.src && streamDebug.src.length === L.length - nR ? streamDebug.src : undefined;
    // Each line's ends, for the braid count (a line within 300 m of its own source or mouth is not a braid).
    const lines: unknown[] = [];
    const stations: unknown[] = [];
    const reaches: unknown[] = [];
    for (let li = 0; li < L.length; li++) {
      const r = L[li];
      const N = r.north.length;
      const kind = r.kind ?? 0;
      // (Where the trace says which pass built each stream (streams.ts streamDebug.src), a chain is the chain pass's.)
      const cls = li < nR ? 'river' : src ? (src[li - nR] === 'chain' ? 'chain' : 'stream') : li >= cs && li < ce ? 'chain' : 'stream';
      lines.push({ li, kind, cls, joins: r.joins ?? -1, end: r.end ?? '', n: Array.from(r.north, Math.round), e: Array.from(r.east, Math.round), lv: Array.from(r.level, r2), hw: Array.from(r.halfWidth, r2), a: Array.from(r.area ?? new Float64Array(N), r1), s: Array.from(r.s, r1), rg: r.regime ? Array.from(r.regime) : [], st: r.steepness ? Array.from(r.steepness, r2) : [], bR: r.bedR ? Array.from(r.bedR, r2) : [], bL: r.bedL ? Array.from(r.bedL, r2) : [] });
      if (N < 2) continue;
      const total = r.s[N - 1];
      // Position, level, half-width and the segment's unit direction at arc length sv.
      let seg = 0;
      const at = (sv: number): { n: number; e: number; lv: number; hw: number; a: number; dn: number; de: number } => {
        while (seg < N - 2 && r.s[seg + 1] < sv) seg++;
        while (seg > 0 && r.s[seg] > sv) seg--;
        const i = seg;
        const ds = Math.max(1e-9, r.s[i + 1] - r.s[i]);
        const t = Math.min(1, Math.max(0, (sv - r.s[i]) / ds));
        const tn = r.north[i + 1] - r.north[i];
        const te = r.east[i + 1] - r.east[i];
        const tl = Math.hypot(tn, te) || 1;
        return { n: r.north[i] + tn * t, e: r.east[i] + te * t, lv: r.level[i] + (r.level[i + 1] - r.level[i]) * t, hw: r.halfWidth[i] + (r.halfWidth[i + 1] - r.halfWidth[i]) * t, a: (r.area?.[i] ?? 0) + ((r.area?.[i + 1] ?? 0) - (r.area?.[i] ?? 0)) * t, dn: tn / tl, de: te / tl };
      };
      // --- Water edge and banks every 10 m of arc.
      const st: number[][] = [];
      for (let sv = 0; sv <= total; sv += 10) {
        const p = at(sv);
        // Side -1: right of the flow, +1: left (normal (side·de, −side·dn) in north, east).
        const row: number[] = [r1(sv)];
        for (const side of [-1, 1]) {
          const nn = side * p.de;
          const ne = -side * p.dn;
          const step = p.hw < 8 ? 0.5 : 1;
          const maxOut = 1.5 * p.hw + 20;
          let o = 0;
          let wet = g(p.n, p.e) < p.lv;
          let edge = NaN;
          if (wet) {
            let prev = 0;
            for (o = step; o <= maxOut; o += step) {
              if (g(p.n + nn * o, p.e + ne * o) >= p.lv) break;
              prev = o;
            }
            if (o <= maxOut) {
              let lo = prev;
              let hi = o;
              for (let k = 0; k < 5; k++) {
                const m = 0.5 * (lo + hi);
                if (g(p.n + nn * m, p.e + ne * m) >= p.lv) hi = m;
                else lo = m;
              }
              edge = 0.5 * (lo + hi);
            }
          } else edge = 0;
          if (Number.isFinite(edge)) {
            const g2 = g(p.n + nn * (edge + 2), p.e + ne * (edge + 2));
            const g5 = g(p.n + nn * (edge + 5), p.e + ne * (edge + 5));
            const g15 = g(p.n + nn * (edge + 15), p.e + ne * (edge + 15));
            row.push(r2(edge), r2(g2 - p.lv), r2(g5 - p.lv), r2(g15 - p.lv));
          } else row.push(-1, 0, 0, 0);
          void wet;
        }
        row.push(r2(p.hw));
        st.push(row);
      }
      stations.push({ li, st });
      // --- Reaches: consecutive 1 km of arc (the last piece joined to the one before if under 500 m).
      const nReach = Math.max(1, Math.round(total / 1000));
      if (total < 300) continue;
      for (let k = 0; k < nReach; k++) {
        const s0 = (k * total) / nReach;
        const s1 = ((k + 1) * total) / nReach;
        const sm = 0.5 * (s0 + s1);
        const p0 = at(s0);
        const p1 = at(s1);
        const pm = at(sm);
        // The transect's direction: across the 200 m chord about the middle.
        const pa = at(Math.max(0, sm - 100));
        const pb = at(Math.min(total, sm + 100));
        let cn = pb.n - pa.n;
        let cE = pb.e - pa.e;
        const cl = Math.hypot(cn, cE) || 1;
        cn /= cl;
        cE /= cl;
        const nn = cE;
        const ne = -cn;
        // Floor: contiguous span about the line where the ground is under its level + 5 m; relief: highest ground.
        const fl = [0, 0];
        const rel = [-Infinity, -Infinity];
        const wall = [-Infinity, -Infinity];
        for (const [j, side] of [[0, -1], [1, 1]] as const) {
          let open = true;
          for (let o = 10; o <= 1500; o += 10) {
            const h = g(pm.n + side * nn * o, pm.e + side * ne * o) - pm.lv;
            if (open && h >= 5) {
              open = false;
              fl[j] = o;
            }
            if (!open && o <= fl[j] + 300) wall[j] = Math.max(wall[j], h);
            rel[j] = Math.max(rel[j], h);
          }
          if (open) fl[j] = 1500;
        }
        // Braid: the distinct lines with water over their ground across the floor (at least 3 half-widths out), every 3 m.
        const half = Math.min(1500, Math.max(3 * pm.hw, Math.max(fl[0], fl[1])));
        const ids = new Set<number>();
        const idsFar = new Set<number>();
        for (let o = -half; o <= half; o += 3) {
          const qn = pm.n + nn * o;
          const qe = pm.e + ne * o;
          hydrology.queryFlow!(qn, qe, hit as never);
          if (hit.line < 0 || !(hit.dist <= hit.halfWidth)) continue;
          if (g(qn, qe) >= hit.level) continue;
          ids.add(hit.line);
          const o2 = L[hit.line];
          const sEnd = o2.s[o2.s.length - 1];
          if (hit.line === li || (hit.s > 300 && sEnd - hit.s > 300)) idsFar.add(hit.line);
        }
        reaches.push({ li, k, s0: r1(s0), s1: r1(s1), n: Math.round(pm.n), e: Math.round(pm.e), dn: r2(cn), de: r2(cE), lv0: r2(p0.lv), lv1: r2(p1.lv), lv: r2(pm.lv), hw: r2(pm.hw), a: r1(pm.a), fl: fl, rel: rel.map(r1), wall: wall.map(r1), braid: ids.size, braidFar: idsFar.size, ids: [...idsFar].filter((x) => x !== li) });
      }
    }
    fs.writeFileSync(`${OUT}/lines-s${seed}.json`, JSON.stringify({ seed, nR, cs, ce, lines }));
    fs.writeFileSync(`${OUT}/stations-s${seed}.json`, JSON.stringify(stations));
    fs.writeFileSync(`${OUT}/reaches-s${seed}.json`, JSON.stringify(reaches));
    console.log(`seed ${seed}: ${L.length} lines (rivers ${nR}, chains ${cs}-${ce}), ${reaches.length} reaches, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  }
  setWorldSeed(0);
});
