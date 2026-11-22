// design V: edge falls (falls.ts EDGE_FALLS) as shelf / terrace edges - a single fall on a stream, its lip water against
// the lowest drawn ground 150-800 m either side (lower ground beside: a shelf), what the line joins, and a camera from
// downstream looking up at the lip.  ES_SEEDS=42,1 npx vitest run --config scripts/probes/vitest.config.ts mrEdgeSites
// Round V: the causes read are ES_CAUSES (default edge,hanging,outlet): the base has no 'edge' cause (model-rivers'
// EDGE_FALLS); its break-of-slope falls are 'hanging' and 'outlet' (falls.ts FA2 / FA3).
// (Round V step 0: ported unchanged from design-V/model-rivers/prototype.patch, except as noted above)
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const CAUSES = (process.env.ES_CAUSES ?? 'edge,hanging,outlet').split(',');
it('edge sites', () => {
  for (const seed of (process.env.ES_SEEDS ?? '42,1').split(',')) {
    setWorldSeed(seed);
    type L = { north: Float64Array; east: Float64Array; s: Float64Array; level: Float64Array; kind?: number; area?: Float64Array; joins?: number; halfWidth: Float64Array };
    const rivers = (hydrology.rivers ?? []) as unknown as L[];
    const rows: Array<[number, string]> = [];
    for (const f of hydrology.falls ?? []) {
      if (!CAUSES.includes(f.cause) || f.flight >= 0) continue;
      const r = rivers[f.line];
      let lo = Infinity;
      for (const side of [-1, 1]) for (let d = 150; d <= 800; d += 50) lo = Math.min(lo, terrainHeight(f.north - side * f.dirE * d, f.east + side * f.dirN * d));
      const shelf = f.top - lo;
      // the line's water 300 m and 1 km below the foot
      const i = f.index;
      const sAt = (ds: number): string => { let k = i; while (k < r.s.length - 1 && r.s[k] - r.s[i] < ds) k++; return `${r.level[k].toFixed(0)}`; };
      const cam = `camPos=${Math.round(f.north + 450 * f.dirN - 200 * f.dirE)},${Math.round(f.east + 450 * f.dirE + 200 * f.dirN)},${Math.round(f.bottom + 160)}&camLook=${Math.round(f.north)},${Math.round(f.east)},${Math.round(0.5 * (f.top + f.bottom))}`;
      rows.push([shelf, `line ${f.line} kind ${r.kind ?? 0} A ${(r.area?.[i] ?? 0).toFixed(1)} hw ${r.halfWidth[i].toFixed(1)} joins ${r.joins} lip ${f.north.toFixed(0)},${f.east.toFixed(0)} ${f.top.toFixed(0)} -> ${f.bottom.toFixed(0)} (${f.height.toFixed(0)} m); level +300 m ${sAt(300)}, +1 km ${sAt(1000)}, end ${r.level[r.level.length - 1].toFixed(0)}; lowest beside ${lo.toFixed(0)} (${shelf.toFixed(0)} m under the lip) | seed=${seed}&${cam}`]);
    }
    rows.sort((a, b) => b[0] - a[0]);
    console.log(`seed ${seed}: single falls of cause ${CAUSES.join('/')} ${rows.length}, with ground > 15 m under the lip beside it ${rows.filter((r) => r[0] > 15).length}`);
    for (const r of rows.slice(0, 12)) console.log(`  ${r[1]}`);
  }
  setWorldSeed(0);
});
