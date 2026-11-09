// Round S: rillGate's wet line ends far from water, with the raster cell each runs to (its receiver, network flag,
// persistence, steps to a sink) - why the line stops there.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { gullyNet } from '../../src/world/terrain/gullies';
import { RILL_PATCH, rillPatchLines, rillWaterHalf, rillArea, type RillSegment } from '../../src/world/terrain/rills';
import { setWorldSeed } from '../../src/world/worldSeed';
import { hash2i } from '../../src/world/terrain/noise';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('wet ends', () => {
  const seed = Number(env.WE_SEED ?? 1);
  setWorldSeed(seed);
  const g = gullyNet()!;
  const patches = new Set<string>();
  const cand: number[] = [];
  for (let q = 0; q < g.n * g.n; q++) if (g.dir[q] && g.area[q] >= 5 && g.area[q] < 40) cand.push(q);
  cand.sort((a, b) => (hash2i(a, seed) >>> 0) - (hash2i(b, seed) >>> 0));
  for (const q of cand) { if (patches.size >= 20) break; const n = g.origin + Math.floor(q / g.n) * g.cell, e = g.origin + (q % g.n) * g.cell; patches.add(`${Math.floor(e / RILL_PATCH)},${Math.floor(n / RILL_PATCH)}`); }
  const hit = { dist: 0, level: 0, halfWidth: 0, s: 0, side: 0, beyondSource: 0 };
  const K = (e: number, n: number): string => `${e.toFixed(2)},${n.toFixed(2)}`;
  for (const key of patches) {
    const [pi, pj] = key.split(',').map(Number);
    const { graph: gr, segs } = rillPatchLines({ pi, pj });
    const e0 = pi * RILL_PATCH, n0 = pj * RILL_PATCH;
    const from = new Set<string>(segs.map((s: RillSegment) => K(s.e0, s.n0)));
    for (const s of segs) {
      const me = (s.e0 + s.e1) / 2, mn = (s.n0 + s.n1) / 2;
      if (!(me >= e0 && me < e0 + RILL_PATCH && mn >= n0 && mn < n0 + RILL_PATCH)) continue;
      if (from.has(K(s.e1, s.n1)) || !(rillWaterHalf(s.s1) > 0)) continue;
      hydrology.queryRiver(s.n1, s.e1, hit);
      const lake = hydrology.lakeMask?.at(s.n1, s.e1, terrainHeight(s.n1, s.e1)) ?? -Infinity;
      const d = lake > -Infinity ? 0 : hit.dist - hit.halfWidth;
      if (d <= 30) continue;
      const j = s.cj ?? -1;
      const info = j >= 0 ? `hidden ${s.hid} cell to ${gr.to[j]} net ${gr.net[j]} persist ${gr.persist[j]} toSink ${gr.toSink[j]} cells ${gr.cells[j]} areaR ${gr.areaR[j]}; its receiver: ${gr.to[j] >= 0 ? `net ${gr.net[gr.to[j]]} persist ${gr.persist[gr.to[j]]}` : '-'}` : 'no cell';
      console.log(`END ${s.n1.toFixed(0)},${s.e1.toFixed(0)} A ${rillArea(s.s1).toFixed(2)} d ${Number.isFinite(d) ? d.toFixed(0) : 'inf'}: ${info}`);
    }
  }
});
