// Round V A3 fix: the floors' lines (hillslopes.ts FloorLines) passing within FA_R m of each point of FA="seed:n:e;..."
// and each one's profile every FA_STEP m: half-width, the model's ground, the drawn ground, the slopes' ground (debugMacro),
// the streams' tracing ground at the nearest 100 m raster point, the weight m.
import { it } from 'vitest';
import { terrainHeight, debugMacro } from '../../src/world/terrain/heightfield';
import { streamDebug } from '../../src/world/terrain/streams';
import { slopeStats } from '../../src/world/terrain/hillslopes';
import { DOMAIN_HALF } from '../../src/world/terrain/drainage';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('floor line at', () => {
  let cur = NaN;
  const step = Number(env.FA_STEP ?? 100), rad = Number(env.FA_R ?? 400);
  for (const t of (env.FA ?? '').split(';').filter(Boolean)) {
    const [seed, pn, pe] = t.split(':').map(Number);
    if (seed !== cur) { setWorldSeed(seed); terrainHeight(0, 0); cur = seed; }
    const L = slopeStats.lines!;
    for (let p = 0; p < L.start.length - 1; p++) {
      let near = Infinity, kn = -1;
      for (let k = L.start[p]; k < L.start[p + 1]; k++) { const d = Math.hypot(L.north[k] - pn, L.east[k] - pe); if (d < near) { near = d; kn = k; } }
      if (near > rad) continue;
      console.log(`FA seed ${seed} line ${p} cap ${L.cap[p]} points ${L.start[p]}..${L.start[p + 1] - 1} nearest ${near.toFixed(0)} m at k ${kn}`);
      let s = 0, last = -1e9;
      for (let k = L.start[p]; k < L.start[p + 1]; k++) {
        if (k > L.start[p]) s += Math.hypot(L.north[k] - L.north[k - 1], L.east[k] - L.east[k - 1]);
        if (Math.abs(k - kn) > 80 || s - last < step) continue;
        last = s;
        const n = L.north[k], e = L.east[k];
        const x = debugMacro(n, e)!;
        const rn = Math.round((n + DOMAIN_HALF) / 100) * 100 - DOMAIN_HALF, re = Math.round((e + DOMAIN_HALF) / 100) * 100 - DOMAIN_HALF;
        console.log(`FA ${p} k ${k} s ${s.toFixed(0)} ${n.toFixed(0)},${e.toFixed(0)} half ${L.half[k].toFixed(0)} model ${x.model.toFixed(1)} drawn ${terrainHeight(n, e).toFixed(1)} slope ${Number.isFinite(x.slope) ? x.slope.toFixed(1) : '-'} routeR ${streamDebug.route!(rn, re).toFixed(1)} m ${x.s.m.toFixed(2)} fin ${x.s.fin}`);
      }
    }
  }
  setWorldSeed(0);
});
