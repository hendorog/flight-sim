// Braids: the braided reaches of each seed (BS2_SEEDS) measured as NZREF-REPORT.md measured the Canterbury ones, on the
// drawn ground: at the middle of every 1 km piece of a line whose threads K (RiverLine.braidK) average 1.5 or more, a
// transect across the line every 1 m out to 3 km: the wet runs (ground under a line's water: sampleTerrain's river over
// its ground) at least 5 m wide (braid index), the wetted share of the bed (bedR + bedL), the bed against the floor
// (the ground within 10 m over the water, the run about the line) and the bar share (1 - wet).
//   BS2_SEEDS=1,42 BS2_OUT=out/fs/W/B/stats npx vitest run --config scripts/probes/vitest.config.ts braidStats
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { writeFileSync(p: string, d: string): void; mkdirSync(p: string, o: object): void };
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Line = { north: Float64Array; east: Float64Array; level: Float64Array; s: Float64Array; area?: Float64Array; kind?: number; bedR?: Float32Array; bedL?: Float32Array; wetR?: Float32Array; wetL?: Float32Array; braidK?: Float32Array; braidShare?: Float32Array };
const q = (v: number[], p: number): number => (v.length ? [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(p * v.length))] : NaN);
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '-');
it('braid stats', () => {
  const OUT = env.BS2_OUT ?? 'out/fs/W/B/stats';
  fs.mkdirSync(OUT, { recursive: true });
  const S = makeSample();
  for (const seed of (env.BS2_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = (hydrology.rivers ?? []) as unknown as Line[];
    let kmR = 0;
    let kmS = 0;
    let kmAll = 0;
    const rows: Array<{ li: number; kind: number; n: number; e: number; A: number; K: number; b: number; bi: number; wet: number; bed: number; floor: number; beltFloor: number }> = [];
    for (let li = 0; li < L.length; li++) {
      const r = L[li];
      const m = r.s.length;
      if (m < 2) continue;
      for (let i = 1; i < m; i++) kmAll += (r.s[i] - r.s[i - 1]) / 1000;
      const K = r.braidK;
      if (!K) continue;
      for (let i = 1; i < m; i++) {
        const ds = (r.s[i] - r.s[i - 1]) / 1000;
        if (0.5 * (K[i] + K[i - 1]) >= 1.5) {
          if ((r.kind ?? 0) === 0) kmR += ds;
          else kmS += ds;
        }
      }
      const total = r.s[m - 1];
      for (let s0 = 0; s0 + 1000 <= total; s0 += 1000) {
        let i0 = 0;
        while (i0 < m - 1 && r.s[i0] < s0) i0++;
        let i1 = i0;
        let kSum = 0;
        let kN = 0;
        while (i1 < m - 1 && r.s[i1] < s0 + 1000) kSum += K[i1++], kN++;
        if (kN === 0 || kSum / kN < 1.5) continue;
        let im = i0;
        while (im < m - 1 && r.s[im] < s0 + 500) im++;
        const a = Math.max(0, im - 1);
        const b = Math.min(m - 1, im + 1);
        const tl = Math.hypot(r.north[b] - r.north[a], r.east[b] - r.east[a]) || 1;
        const dn = (r.north[b] - r.north[a]) / tl;
        const de = (r.east[b] - r.east[a]) / tl;
        // Right of the flow: (-de, dn) in (north, east).
        const rn = -de;
        const re = dn;
        const lv = r.level[im];
        const bed = r.bedR![im] + r.bedL![im];
        // Wet runs across the bed (and 30 m past it), every 1 m.
        let runs = 0;
        let wetM = 0;
        let run = 0;
        for (let o = -r.bedL![im] - 30; o <= r.bedR![im] + 30; o += 1) {
          sampleTerrain(r.north[im] + rn * o, r.east[im] + re * o, S);
          const wet = S.ground < S.river && S.river > -Infinity;
          if (wet) {
            run++;
            if (o >= -r.bedL![im] && o <= r.bedR![im]) wetM++;
          } else {
            if (run >= 5) runs++;
            run = 0;
          }
        }
        if (run >= 5) runs++;
        // The floor: the run of ground within 10 m over the water about the line, each side out to 3 km.
        const out = (side: number): number => {
          let o = 0;
          for (o = 5; o <= 3000; o += 5) {
            sampleTerrain(r.north[im] + side * rn * o, r.east[im] + side * re * o, S);
            if (S.ground > lv + 10) break;
          }
          return o;
        };
        const floor = out(1) + out(-1);
        const A = Math.max(0.05, r.area?.[im] ?? 0);
        rows.push({ li, kind: r.kind ?? 0, n: Math.round(r.north[im]), e: Math.round(r.east[im]), A: Math.round(A), K: kSum / kN, b: r.braidShare![im], bi: runs, wet: wetM / Math.max(1, bed), bed, floor, beltFloor: bed / Math.max(1, floor) });
      }
    }
    fs.writeFileSync(`${OUT}/braid-s${seed}.json`, JSON.stringify(rows));
    const sum = (sel: typeof rows, tag: string): void => {
      const bi = sel.map((x) => x.bi);
      const wet = sel.map((x) => x.wet);
      const bf = sel.map((x) => x.beltFloor);
      const bed = sel.map((x) => x.bed);
      console.log(`BS2 seed ${seed} ${tag}: transects ${sel.length}; braid index p10/50/90 ${f2(q(bi, 0.1))}/${f2(q(bi, 0.5))}/${f2(q(bi, 0.9))} mean ${f2(bi.reduce((a, b) => a + b, 0) / Math.max(1, bi.length))}; wetted share ${f2(q(wet, 0.1))}/${f2(q(wet, 0.5))}/${f2(q(wet, 0.9))}; bar share p50 ${f2(1 - q(wet, 0.5))}; bed m ${q(bed, 0.1).toFixed(0)}/${q(bed, 0.5).toFixed(0)}/${q(bed, 0.9).toFixed(0)}; bed/floor(+10 m) ${f2(q(bf, 0.1))}/${f2(q(bf, 0.5))}/${f2(q(bf, 0.9))}`);
    };
    console.log(`BS2 seed ${seed}: line km ${kmAll.toFixed(0)}; braided (K >= 1.5) km: rivers ${kmR.toFixed(0)}, streams ${kmS.toFixed(0)}`);
    sum(rows, 'all K >= 1.5');
    sum(rows.filter((x) => x.b >= 0.6), 'share >= 0.6');
    sum(rows.filter((x) => x.b >= 0.6 && x.A >= 1000), 'share >= 0.6, A >= 1000 km2');
    sum(rows.filter((x) => x.b >= 0.6 && x.A >= 100 && x.A < 1000), 'share >= 0.6, A 100-1000 km2');
    sum(rows.filter((x) => x.b >= 0.6 && x.A < 100), 'share >= 0.6, A < 100 km2');
    sum(rows.filter((x) => x.b < 0.6), 'share < 0.6');
  }
  setWorldSeed(0);
});
