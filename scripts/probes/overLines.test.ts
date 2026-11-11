// Probe (Round V A4'+B join): overGround's points (every 3rd sample of every line, outside standing water, water more
// than OL_OVER m (10) over the natural ground) grouped by line: count, worst, where, how far from the mouth, the line's
// pass (streams.ts streamDebug.src where the tree has it), joins and end. OL_SEEDS.
import { it } from 'vitest';
import { hydrology, naturalHeight } from '../../src/world/terrain/heightfield';
import * as ST from '../../src/world/terrain/streams';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('over lines', () => {
  const OVER = Number(env.OL_OVER ?? 10);
  for (const seed of (env.OL_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    const mask = hydrology.lakeMask!;
    const L = hydrology.rivers as unknown as Array<{ north: Float64Array; east: Float64Array; level: Float64Array; s: Float64Array; kind?: number; joins?: number; end?: string }>;
    const nR = L.filter((r) => (r.kind ?? 0) === 0).length;
    const src = (ST as unknown as { streamDebug?: { src?: string[] } }).streamDebug?.src;
    const rows: Array<{ li: number; n: number; worst: number; at: string; fromMouth: number }> = [];
    let total = 0, km = 0, kmStreams = 0;
    L.forEach((r, li) => {
      let n = 0, worst = 0, at = '', fm = 0;
      const m = r.north.length - 1;
      // (Length over, every sample: the samples' spacing differs between trees.)
      for (let k = 0; k < m; k++) {
        const pn = 0.5 * (r.north[k] + r.north[k + 1]), pe = 0.5 * (r.east[k] + r.east[k + 1]);
        if (mask.at(pn, pe) > -Infinity) continue;
        const g = naturalHeight(pn, pe);
        if (g < 0.5 || 0.5 * (r.level[k] + r.level[k + 1]) - g <= OVER) continue;
        km += (r.s[k + 1] - r.s[k]) / 1000;
        if (li >= nR) kmStreams += (r.s[k + 1] - r.s[k]) / 1000;
      }
      for (let k = 0; k < r.north.length; k += 3) {
        if (mask.at(r.north[k], r.east[k]) > -Infinity) continue;
        const g = naturalHeight(r.north[k], r.east[k]);
        if (g < 0.5) continue;
        const over = r.level[k] - g;
        if (over <= OVER) continue;
        n++;
        if (over > worst) { worst = over; at = `${r.north[k].toFixed(0)},${r.east[k].toFixed(0)}`; fm = r.s[m] - r.s[k]; }
      }
      if (n) { rows.push({ li, n, worst, at, fromMouth: fm }); total += n; }
    });
    rows.sort((a, b) => b.n - a.n);
    console.log(`OL seed ${seed}: points over ${OVER} m ${total} on ${rows.length} lines; length over ${km.toFixed(2)} km (streams ${kmStreams.toFixed(2)} km)`);
    for (const r of rows.slice(0, Number(env.OL_TOP ?? 25))) {
      const l = L[r.li];
      console.log(`OL ${seed} line ${r.li} ${r.li < nR ? 'river' : src?.[r.li - nR] ?? 'stream'} n ${r.n} worst ${r.worst.toFixed(0)} m at ${r.at} ${(r.fromMouth / 1000).toFixed(1)} km from mouth; joins ${l.joins} end ${l.end} len ${(l.s[l.s.length - 1] / 1000).toFixed(1)} km`);
    }
  }
  setWorldSeed(0);
});
