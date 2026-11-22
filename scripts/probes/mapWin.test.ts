// Round V A3 fix: a window's grids for a picture (tools in out/fs/A3f): MW="seed:n0:e0:size:step:out.json". Per sample:
// the drawn ground, the streams' tracing ground (streamDebug.route), the model's own ground, the slopes' ground, the pass
// weight m, the floor drawing's weight fw and whether on a floor (fin); the slope field's floor nodes and pass routing
// (dir) at its 250 m nodes in the window; and every line's points in it (kind, level).
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { hydrology, terrainHeight, debugMacro, seededModel } from '../../src/world/terrain/heightfield';
import { streamDebug } from '../../src/world/terrain/streams';
import { DOMAIN_HALF } from '../../src/world/terrain/drainage';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Line = { north: Float64Array; east: Float64Array; level: Float64Array; halfWidth: Float64Array; kind?: number };
it('map window', () => {
  let cur = NaN;
  for (const t of (env.MW ?? '').split(';').filter(Boolean)) {
    const [sd, a, b, c, d, out] = t.split(':');
    const seed = Number(sd), n0 = Number(a), e0 = Number(b), size = Number(c), step = Number(d);
    if (seed !== cur) { setWorldSeed(seed); terrainHeight(0, 0); cur = seed; }
    const k = Math.round(size / step) + 1;
    const g: Record<string, number[]> = { drawn: [], route: [], model: [], slope: [], m: [], fw: [], fin: [] };
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
      const n = n0 + i * step, e = e0 + j * step;
      g.drawn.push(+terrainHeight(n, e).toFixed(1));
      g.route.push(streamDebug.route ? +streamDebug.route(n, e).toFixed(1) : NaN);
      const x = debugMacro(n, e)!;
      g.model.push(+x.model.toFixed(1));
      g.slope.push(Number.isFinite(x.slope) ? +x.slope.toFixed(1) : NaN);
      g.m.push(+x.s.m.toFixed(3));
      g.fw.push(+x.s.fw.toFixed(3));
      g.fin.push(x.s.fin ? 1 : 0);
    }
    const sl = seededModel()?.slopes;
    const nodes: number[][] = [];
    if (sl) {
      const cell = 250, nn = Math.round(Math.sqrt(sl.h.length));
      for (let y = Math.ceil((n0 + DOMAIN_HALF) / cell); y * cell - DOMAIN_HALF <= n0 + size; y++) for (let xx = Math.ceil((e0 + DOMAIN_HALF) / cell); xx * cell - DOMAIN_HALF <= e0 + size; xx++) {
        const q = y * nn + xx;
        nodes.push([y * cell - DOMAIN_HALF, xx * cell - DOMAIN_HALF, +sl.h[q].toFixed(1), sl.w[q], sl.floor[q], sl.dir ? sl.dir[q] : 0, sl.area ? +sl.area[q].toFixed(2) : 0]);
      }
    }
    const lines: { li: number; kind: number; pts: number[][] }[] = [];
    (hydrology.rivers as unknown as Line[]).forEach((r, li) => {
      const pts: number[][] = [];
      for (let i = 0; i < r.north.length; i++) if (r.north[i] >= n0 - 200 && r.north[i] <= n0 + size + 200 && r.east[i] >= e0 - 200 && r.east[i] <= e0 + size + 200) pts.push([+r.north[i].toFixed(0), +r.east[i].toFixed(0), +r.level[i].toFixed(1), +r.halfWidth[i].toFixed(1)]);
      if (pts.length) lines.push({ li, kind: r.kind ?? 0, pts });
    });
    writeFileSync(out, JSON.stringify({ seed, n0, e0, size, step, k, g, nodes, lines }));
    console.log(`MW wrote ${out}`);
  }
  setWorldSeed(0);
});
