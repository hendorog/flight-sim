// Round V A3 fix: one line's profile (LW="seed:line[:from:to];..."), every LW_STEP m: its level, the drawn ground, the
// streams' tracing ground (streamDebug.route), the model's own ground and the slopes' ground there (debugMacro), the pass
// weight m; and the line's kind, pool, chain, end, join, area.
import { it } from 'vitest';
import { hydrology, terrainHeight, debugMacro } from '../../src/world/terrain/heightfield';
import { streamDebug } from '../../src/world/terrain/streams';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Line = { north: Float64Array; east: Float64Array; s: Float64Array; level: Float64Array; halfWidth: Float64Array; kind?: number; end?: string; joins?: number; pool?: number; chainS?: number; area?: Float64Array; continued?: boolean };
it('line why', () => {
  let cur = NaN;
  const step = Number(env.LW_STEP ?? 100);
  for (const t of (env.LW ?? '').split(';').filter(Boolean)) {
    const [sd, ln, f, to] = t.split(':').map(Number);
    if (sd !== cur) { setWorldSeed(sd); terrainHeight(0, 0); cur = sd; }
    const L = (hydrology.rivers as unknown as Line[])[ln];
    const m = L.north.length;
    const a0 = Number.isFinite(f) ? f : 0, a1 = Number.isFinite(to) ? Math.min(m - 1, to) : m - 1;
    console.log(`LW seed ${sd} line ${ln} kind ${L.kind ?? 0} end ${L.end ?? '-'} joins ${L.joins ?? -1} pool ${L.pool ?? '-'} chainS ${L.chainS ?? '-'} cont ${L.continued ?? '-'} pts ${m} len ${L.s[m - 1].toFixed(0)} area ${L.area ? L.area[0].toFixed(1) + '..' + L.area[m - 1].toFixed(1) : '-'}`);
    let last = -1e9;
    for (let i = a0; i <= a1; i++) {
      if (L.s[i] - last < step && i !== a1) continue;
      last = L.s[i];
      const n = L.north[i], e = L.east[i];
      const x = debugMacro(n, e);
      const r = streamDebug.route ? streamDebug.route(n, e) : NaN;
      console.log(`LW ${ln} i ${i} s ${L.s[i].toFixed(0)} ${n.toFixed(0)},${e.toFixed(0)} level ${L.level[i].toFixed(1)} drawn ${terrainHeight(n, e).toFixed(1)} route ${r.toFixed(1)} model ${x ? x.model.toFixed(1) : '-'} slope ${x && Number.isFinite(x.slope) ? x.slope.toFixed(1) : '-'} m ${x ? x.s.m.toFixed(2) : '-'} area ${L.area ? L.area[i].toFixed(1) : '-'}`);
    }
  }
  setWorldSeed(0);
});
