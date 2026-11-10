// Round V B (item 3): the checker's chkUnder flat-run class, world-wide, as a committed gate with attribution. Every line
// of every kind, every 50 m, outside standing water: a flat run is a stretch over 1 km where the water level stays within
// 0.1 m, with the drawn ground more than 10 m under the model's own somewhere along it (chkUnder's measure, unchanged).
// Each run is attributed to the pass that built its line (streams.ts streamDebug.src) and reports the deepest notch the
// line's water cuts through the streams' tracing ground along it (route - level). Also the hidden-water km by kind.
//   FR_SEEDS=1,42,777777 [FR_TOP=8] npx vitest run --config scripts/probes/vitest.config.ts flatRuns --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight, debugMacro } from '../../src/world/terrain/heightfield';
import { streamDebug } from '../../src/world/terrain/streams';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Line = { north: Float64Array; east: Float64Array; s: Float64Array; level: Float64Array; kind?: number; area?: Float64Array };
it('flat runs', () => {
  const s = makeSample();
  const TOP = Number(env.FR_TOP ?? 8);
  for (const seed of (env.FR_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = (hydrology.rivers ?? []) as unknown as Line[];
    const nR = L.filter((r) => (r.kind ?? 0) === 0).length;
    const src = streamDebug.src ?? [];
    const route = streamDebug.route;
    const km = [[0, 0, 0], [0, 0, 0]];
    type Run = { len: number; deep: number; notch: number; li: number; t: string; src: string };
    const flats: Run[] = [];
    L.forEach((r, li) => {
      const k = (r.kind ?? 0) === 0 ? 0 : 1;
      const tag = li < nR ? 'river' : (src[li - nR] ?? '?');
      let last = -1e9, runFrom = -1, runLev = NaN, runDeep = 0, runNotch = 0;
      const close = (i: number): void => {
        if (runFrom >= 0) {
          const len = r.s[i] - r.s[runFrom];
          if (len > 1000 && runDeep > 10) flats.push({ len, deep: runDeep, notch: runNotch, li, src: tag, t: `line ${li} (${tag}, A ${r.area ? r.area[runFrom].toFixed(1) : '-'}) flat at ${runLev.toFixed(1)} for ${len.toFixed(0)} m from ${r.north[runFrom].toFixed(0)},${r.east[runFrom].toFixed(0)} to ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)}, drawn down to ${runDeep.toFixed(0)} m under the model's, notch through the tracing ground ${runNotch.toFixed(0)} m` });
        }
        runFrom = -1;
        runDeep = 0;
        runNotch = 0;
      };
      for (let i = 0; i < r.north.length; i++) {
        if (r.s[i] - last < 50) continue;
        last = r.s[i];
        sampleTerrain(r.north[i], r.east[i], s);
        const inLake = Number.isFinite(s.standing) && s.standing >= r.level[i] - 0.05 && s.standing > 0;
        const under = s.ground - r.level[i];
        if (!inLake) {
          if (under > 3) km[k][0] += 0.05;
          if (under > 10) km[k][1] += 0.05;
          if (under > 30) km[k][2] += 0.05;
        }
        if (!inLake && runFrom >= 0 && Math.abs(r.level[i] - runLev) < 0.1) {
          const dm = debugMacro(r.north[i], r.east[i]) as unknown as { model?: number };
          runDeep = Math.max(runDeep, dm.model === undefined ? 99 : dm.model - s.ground);
          if (route) runNotch = Math.max(runNotch, route(r.north[i], r.east[i]) - r.level[i]);
        } else {
          close(i);
          if (!inLake) {
            runFrom = i;
            runLev = r.level[i];
          }
        }
      }
      close(r.north.length - 1);
    });
    console.log(`FR seed ${seed} water under the drawn ground at its centre (outside standing water), km >3 / >10 / >30 m: rivers ${km[0].map((x) => x.toFixed(2)).join(' / ')}; streams ${km[1].map((x) => x.toFixed(2)).join(' / ')}`);
    const tot = flats.reduce((a, b) => a + b.len, 0) / 1000;
    console.log(`FR seed ${seed} TOTAL flat runs > 1 km with the drawn ground > 10 m under the model's: ${flats.length}, ${tot.toFixed(1)} km; with a notch > 10 m through the tracing ground ${flats.filter((f) => f.notch > 10).length}`);
    const by = new Map<string, [number, number]>();
    for (const f of flats) {
      const v = by.get(f.src) ?? [0, 0];
      v[0]++;
      v[1] += f.len / 1000;
      by.set(f.src, v);
    }
    console.log(`FR seed ${seed} by pass: ${[...by.entries()].sort((a, b) => b[1][1] - a[1][1]).map(([k, v]) => `${k} ${v[0]} (${v[1].toFixed(1)} km)`).join('; ')}`);
    const st = flats.filter((f) => f.src !== 'river');
    const stKm = st.reduce((a, b) => a + b.len, 0) / 1000;
    console.log(`FR seed ${seed} STREAMS flat runs ${st.length}, ${stKm.toFixed(1)} km; with a notch > 10 m through the tracing ground ${st.filter((f) => f.notch > 10).length}; RIVERS ${flats.length - st.length}, ${(tot - stKm).toFixed(1)} km`);
    flats.sort((a, b) => b.len * b.deep - a.len * a.deep);
    for (const [label, list] of [['worst', flats], ['worst stream', flats.filter((f) => f.src !== 'river')]] as const) {
      const seen = new Set<number>();
      let n = 0;
      for (const f of list) {
        if (seen.has(f.li)) continue;
        seen.add(f.li);
        console.log(`FR seed ${seed} ${label}: ${f.t}`);
        if (++n >= TOP) break;
      }
    }
  }
  setWorldSeed(0);
});
