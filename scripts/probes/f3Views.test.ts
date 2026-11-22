// Probe (foundation stage 3): camera views for the pictures. Per seed: the biggest rivers crossing the front block
// (structure.ts; its band weight >= 0.5 over 4-16 km of the river), each with a cockpit-height camera downstream of the
// gorge looking up it; the longest reach of a river running along the block's back (weight 0.05-0.5 beside it, the
// strike valley the turned-aside streams follow to the gorge) with its tributaries; and the tallest fault falls.
//   FV_SEEDS=1,42,777777 FV_ABOVE=450
import { it } from 'vitest';
import { DOMAIN_HALF, DRAIN_CELL } from '../../src/world/terrain/drainage';
import * as hf from '../../src/world/terrain/heightfield';
import { hydrology, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const n = Math.round((2 * DOMAIN_HALF) / DRAIN_CELL) + 1;
const r0 = (x: number): string => x.toFixed(0);

it('stage 3 views', () => {
  const above = Number(env.FV_ABOVE ?? 450);
  for (const seed of (env.FV_SEEDS ?? '42').split(',')) {
    setWorldSeed(Number(seed));
    const st = hf.seededInputs?.struct;
    const dr = hf.seededDrainage;
    if (!st || !dr) continue;
    const cellOf = (pn: number, pe: number): number => Math.min(n - 1, Math.max(0, Math.round((pn + DOMAIN_HALF) / DRAIN_CELL))) * n + Math.min(n - 1, Math.max(0, Math.round((pe + DOMAIN_HALF) / DRAIN_CELL)));
    const bw = (pn: number, pe: number): number => st.block[cellOf(pn, pe)];
    /** A camera `back` m downstream of sample k (along the line), `above` m over the highest ground on the way, looking at sample k. */
    const cam = (r: { north: Float64Array; east: Float64Array; level: Float64Array; s: Float64Array }, k: number, kBack: number): string => {
      let top = -Infinity;
      for (let q = Math.min(k, kBack); q <= Math.max(k, kBack); q++) top = Math.max(top, naturalHeight(r.north[q], r.east[q]));
      const cz = Math.max(naturalHeight(r.north[kBack], r.east[kBack]) + above, r.level[k] + above);
      return `camPos=${r0(r.north[kBack])},${r0(r.east[kBack])},${r0(cz)}&camLook=${r0(r.north[k])},${r0(r.east[k])},${r0(r.level[k])}`;
    };
    const kAt = (r: { s: Float64Array }, sv: number): number => {
      let k = 0;
      while (k < r.s.length - 1 && r.s[k] < sv) k++;
      return k;
    };
    const gorges: Array<{ text: string; area: number }> = [];
    const strike: Array<{ text: string; len: number }> = [];
    for (let li = 0; li < hydrology.rivers.length; li++) {
      const r = hydrology.rivers[li];
      if ((r.kind ?? 0) !== 0) continue;
      let k0 = -1;
      for (let k = 0; k < r.s.length; k++) {
        const w = bw(r.north[k], r.east[k]);
        const end = k === r.s.length - 1;
        if (w >= 0.5 && k0 < 0) k0 = k;
        if (k0 >= 0 && (w < 0.5 || end)) {
          const len = r.s[k] - r.s[k0];
          const area = dr.area[cellOf(r.north[k0], r.east[k0])];
          // Through the band (not along it): the straight span is most of its length.
          const span = Math.hypot(r.north[k] - r.north[k0], r.east[k] - r.east[k0]);
          if (len >= 4000 && len <= 16000 && span > 0.6 * len && area >= 500) {
            const mid = kAt(r, (r.s[k0] + r.s[k]) / 2);
            const back = kAt(r, Math.min(r.s[r.s.length - 1], r.s[k] + 3500));
            let wall = 0;
            const dn = r.east[mid + 1] - r.east[mid], de = -(r.north[mid + 1] - r.north[mid]);
            const L = Math.hypot(dn, de) || 1;
            for (const sd of [-1, 1]) for (const d of [600, 1200, 2000]) wall = Math.max(wall, naturalHeight(r.north[mid] + (sd * d * dn) / L, r.east[mid] + (sd * d * de) / L) - r.level[mid]);
            gorges.push({ area, text: `gorge line ${li} A ${r0(area)} km²: through the block over ${(len / 1000).toFixed(1)} km from ${r0(r.north[k0])},${r0(r.east[k0])} (level ${r0(r.level[k0])}) to ${r0(r.north[k])},${r0(r.east[k])} (level ${r0(r.level[k])}); walls up to ${r0(wall)} m over the water within 2 km; view seed=${seed}&${cam(r, mid, back)}` });
          }
          k0 = -1;
        }
      }
      // Strike valley: a stretch where the river runs along the block's back (weight 0.02-0.5 at the river, the block
      // rising to >= 0.8 within 4 km on one side) for at least 6 km.
      let a0 = -1;
      for (let k = 0; k < r.s.length; k++) {
        const w = bw(r.north[k], r.east[k]);
        let side = 0;
        const k1 = Math.min(r.s.length - 1, k + 1);
        const dn = r.east[k1] - r.east[k], de = -(r.north[k1] - r.north[k]);
        const L = Math.hypot(dn, de) || 1;
        for (const sd of [-1, 1]) for (const d of [2000, 3000, 4000]) side = Math.max(side, bw(r.north[k] + (sd * d * dn) / L, r.east[k] + (sd * d * de) / L));
        const on = w < 0.5 && side >= 0.8;
        const end = k === r.s.length - 1;
        if (on && a0 < 0) a0 = k;
        if (a0 >= 0 && (!on || end)) {
          const len = r.s[k] - r.s[a0];
          if (len >= 6000) {
            const tribs = hydrology.rivers.filter((t, ti) => ti !== li && t.joins === li && (t.joinS ?? -1) >= r.s[a0] && (t.joinS ?? -1) <= r.s[k]).length;
            const mid = kAt(r, (r.s[a0] + r.s[k]) / 2);
            const back = kAt(r, Math.min(r.s[r.s.length - 1], r.s[mid] + 3000));
            strike.push({ len, text: `strike line ${li} A ${r0(dr.area[cellOf(r.north[a0], r.east[a0])])}-${r0(dr.area[cellOf(r.north[k], r.east[k])])} km²: along the block's back over ${(len / 1000).toFixed(1)} km from ${r0(r.north[a0])},${r0(r.east[a0])} to ${r0(r.north[k])},${r0(r.east[k])}, ${tribs} rivers join it there; view seed=${seed}&${cam(r, mid, back)}` });
          }
          a0 = -1;
        }
      }
    }
    gorges.sort((a, b) => b.area - a.area);
    strike.sort((a, b) => b.len - a.len);
    console.log(`seed ${seed}: ${gorges.length} big rivers through the front block\n${gorges.slice(0, 8).map((g) => '  ' + g.text).join('\n')}`);
    console.log(`seed ${seed}: ${strike.length} stretches along the block's back\n${strike.slice(0, 6).map((g) => '  ' + g.text).join('\n')}`);
    const falls = hydrology.falls.filter((f) => f.cause === 'fault').sort((a, b) => b.height - a.height);
    for (const f of falls.slice(0, 4)) {
      const r = hydrology.rivers[f.line];
      const back = kAt(r, Math.min(r.s[r.s.length - 1], r.s[f.index] + 700));
      console.log(`  fault fall line ${f.line} (kind ${r.kind ?? 0}) ${f.height.toFixed(1)} m at ${r0(f.north)},${r0(f.east)} (top ${r0(f.top)}); view seed=${seed}&${cam(r, f.index, back)}`);
    }
  }
  setWorldSeed(0);
});
