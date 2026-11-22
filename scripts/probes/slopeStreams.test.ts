// Foundation stage 4: do the drawn streams and rivers run in the valleys the threshold hillslopes were built from? For
// every line sample inside the mountains (the pass's weight m >= 0.5): the share on a pass channel's floor (ch >= 0.5,
// within about half a fine cell of one of its channel nodes or a held valley floor), and how far the water stands
// under the ground 125 m either side across the line (a valley: both sides higher).
//   SS_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts slopeStreams
import { it } from 'vitest';
import { debugMacro, hydrology, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { setSlopeParams } from '../../src/world/terrain/hillslopes';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('slope streams', () => {
  if (env.SLOPE_PARAMS) setSlopeParams(JSON.parse(env.SLOPE_PARAMS));
  for (const seed of (env.SS_SEEDS ?? '1,42,777777').split(',')) {
    setWorldSeed(seed);
    for (const kind of [0, 1]) {
      let n = 0, on = 0, valley = 0, km = 0, shown = 0, offShown = 0, n1 = 0, on1 = 0;
      const fh = new Array(11).fill(0);
      const chh = new Array(11).fill(0);
      for (const r of hydrology.rivers ?? []) {
        if ((r.kind ?? 0) !== kind) continue;
        for (let k = 1; k + 1 < r.north.length; k += 2) {
          const d = debugMacro(r.north[k], r.east[k]);
          if (!d || d.s.m < 0.5) continue;
          n++;
          km += (r.s[k + 1] - r.s[k - 1]) / 2000;
          if (r.s[k] > 1000) {
            n1++;
            if (d.s.ch >= 0.5) on1++;
          }
          if (d.s.ch >= 0.5) on++;
          else if (env.SS_OFF && kind === 1 && d.s.ch < 0.1 && offShown < Number(env.SS_OFF)) {
            offShown++;
            console.log(`  offch ${r.north[k].toFixed(0)},${r.east[k].toFixed(0)} s ${r.s[k].toFixed(0)}/${r.s[r.s.length - 1].toFixed(0)} level ${r.level[k].toFixed(1)} ground ${naturalHeight(r.north[k], r.east[k]).toFixed(1)} A ${r.area?.[k].toFixed(1)} mg ${d.s.m.toFixed(2)}`);
          }
          fh[Math.min(10, Math.floor(d.s.f * 10))]++;
          chh[Math.min(10, Math.floor(d.s.ch * 10))]++;
          const tn = r.north[k + 1] - r.north[k - 1];
          const te = r.east[k + 1] - r.east[k - 1];
          const L = Math.hypot(tn, te) || 1;
          const nn = -te / L, ne = tn / L;
          const a = naturalHeight(r.north[k] + 125 * nn, r.east[k] + 125 * ne);
          const b = naturalHeight(r.north[k] - 125 * nn, r.east[k] - 125 * ne);
          if (a > r.level[k] + 5 && b > r.level[k] + 5) valley++;
          else if (env.SS_SHOW && kind === 1 && shown < Number(env.SS_SHOW)) {
            shown++;
            const g0 = naturalHeight(r.north[k], r.east[k]);
            console.log(`  off ${r.north[k].toFixed(0)},${r.east[k].toFixed(0)} level ${r.level[k].toFixed(1)} ground ${g0.toFixed(1)} sides ${a.toFixed(1)} ${b.toFixed(1)} m ${d.s.m.toFixed(2)} ch ${d.s.ch.toFixed(2)} f ${d.s.f.toFixed(2)} A ${r.area?.[k].toFixed(1)}`);
          }
        }
      }
      console.log(`seed ${seed} ${kind ? 'streams' : 'rivers'}: ${km.toFixed(0)} km in the mountains; on a channel floor ${((100 * on) / Math.max(1, n)).toFixed(1)} % (past their first km ${((100 * on1) / Math.max(1, n1)).toFixed(1)} %), in a valley (both sides 5 m over the water at 125 m) ${((100 * valley) / Math.max(1, n)).toFixed(1)} %`);
      if (env.SS_HIST) console.log(`  floor f deciles ${fh.map((v) => ((100 * v) / Math.max(1, n)).toFixed(0)).join(' ')}; channel ch deciles ${chh.map((v) => ((100 * v) / Math.max(1, n)).toFixed(0)).join(' ')}`);
    }
  }
  setWorldSeed(0);
});
