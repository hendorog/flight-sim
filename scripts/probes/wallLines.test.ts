// Probe (Round V A4'+B join): waterWalls' river walls (a channel point whose 4-neighbour STEP m away lies outside any
// channel, dry, more than 2 m under the channel's water) on every WL_SUB-th row and column of its grid, each put on
// the nearest line (hydrology.queryRiver) and counted by the pass that built it (streams.ts streamDebug.src) and by
// the line's gradient there. WL_SEED, WL_SUB (2), STEP (50), HALF (150000).
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import * as ST from '../../src/world/terrain/streams';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('wall lines', () => {
  const seed = Number(env.WL_SEED ?? 42), HALF = Number(env.HALF ?? 150000), STEP = Number(env.STEP ?? 50), SUB = Number(env.WL_SUB ?? 2);
  setWorldSeed(seed);
  const s = makeSample();
  const L = hydrology.rivers as unknown as Array<{ kind?: number; level: Float64Array; s: Float64Array }>;
  const nR = L.filter((r) => (r.kind ?? 0) === 0).length;
  const src = (ST as unknown as { streamDebug?: { src?: string[] } }).streamDebug?.src;
  const net = hydrology.network as unknown as { channels(n: number, e: number, o: Array<{ line: number; dist: number; s: number }>): number };
  const outs: Array<{ line: number; dist: number; s: number }> = [];
  const edges = new Map<string, number>(), walls = new Map<string, number>();
  const at = (n: number, e: number) => { sampleTerrain(n, e, s); return { g: s.ground, r: s.river, w: s.standing > s.ground + 0.05 && s.standing > 0.5 }; };
  for (let n = -HALF; n <= HALF; n += STEP * SUB) for (let e = -HALF; e <= HALF; e += STEP * SUB) {
    const p = at(n, e);
    if (!(p.r > -Infinity)) continue;
    for (const [dn, de] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
      const q = at(n + dn, e + de);
      if (q.r > -Infinity || q.w) continue;
      const k = net.channels(n, e, outs);
      let li = -1, bd = Infinity, sv = 0;
      for (let j = 0; j < k; j++) if (outs[j].dist < bd) (bd = outs[j].dist), (li = outs[j].line), (sv = outs[j].s);
      const kind = li < 0 ? '?' : li < nR ? 'river' : src?.[li - nR] ?? 'stream';
      let g = 0;
      if (li >= 0) {
        const r = L[li];
        const lv = (x: number): number => { let i = 0; while (i < r.s.length - 2 && r.s[i + 1] < x) i++; const t = Math.min(1, Math.max(0, (x - r.s[i]) / Math.max(1e-9, r.s[i + 1] - r.s[i]))); return r.level[i] + (r.level[i + 1] - r.level[i]) * t; };
        const a0 = Math.max(0, sv - 100), a1 = Math.min(r.s[r.s.length - 1], sv + 100);
        g = a1 - a0 > 1 ? (lv(a0) - lv(a1)) / (a1 - a0) : 0;
      }
      const key = `${kind} ${g < 0.02 ? 'S<0.02' : g < 0.08 ? 'S 0.02-0.08' : 'S>=0.08'}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
      if (p.r - q.g > 2) walls.set(key, (walls.get(key) ?? 0) + 1);
    }
  }
  let te = 0, tw = 0;
  for (const v of edges.values()) te += v;
  for (const v of walls.values()) tw += v;
  console.log(`WL seed ${seed}: edges ${te}, walls > 2 m ${tw} (${((100 * tw) / Math.max(1, te)).toFixed(2)} %)`);
  for (const k of [...edges.keys()].sort()) console.log(`WL ${seed} ${k}: edges ${edges.get(k)}, walls ${walls.get(k) ?? 0} (${((100 * (walls.get(k) ?? 0)) / edges.get(k)!).toFixed(1)} %)`);
  setWorldSeed(0);
});
