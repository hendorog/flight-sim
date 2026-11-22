// Probe (A1b): camera views of mountain lakes with an outlet stream: a stream line (kind 1) starting in a lake over
// OC_MIN m, its first OC_LOOK m in view from over the lake (OC_DIST m back from the outlet, OC_AGL over the highest
// ground near the camera). Prints shot lines for the longest few per seed.
//   OC_SEEDS=42,777777 OC_N=2
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('outlet cams', () => {
  for (const seed of (env.OC_SEEDS ?? '42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const mask = hydrology.lakeMask as unknown as { at(n: number, e: number): number; poolHit: number; pools: Array<{ north: number; east: number }> };
    const cand: Array<{ li: number; len: number; pool: number }> = [];
    (hydrology.rivers ?? []).forEach((r, li) => {
      if (r.kind !== 1 || !(r.level[0] > Number(env.OC_MIN ?? 900))) return;
      if (!(mask.at(r.north[0], r.east[0]) > -Infinity)) return;
      cand.push({ li, len: r.s[r.s.length - 1], pool: mask.poolHit });
    });
    cand.sort((a, b) => b.len - a.len);
    for (const c of cand.slice(0, Number(env.OC_N ?? 2))) {
      const r = hydrology.rivers![c.li];
      let k = 0;
      while (k < r.s.length - 1 && r.s[k] < Number(env.OC_LOOK ?? 500)) k++;
      const p = mask.pools[c.pool];
      const dn = r.north[0] - p.north, de = r.east[0] - p.east, dl = Math.hypot(dn, de) || 1;
      const dist = Number(env.OC_DIST ?? 2500);
      const cn = r.north[0] - (dn / dl) * dist, ce = r.east[0] - (de / dl) * dist;
      let hi = -Infinity;
      for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) hi = Math.max(hi, terrainHeight(cn + a * 200, ce + b * 200));
      const ln = (r.north[0] + r.north[k]) / 2, le = (r.east[0] + r.east[k]) / 2;
      console.log(`OCAM outlet${seed}l${c.li} seed=${seed}&camPos=${cn.toFixed(0)},${ce.toFixed(0)},${(hi + Number(env.OC_AGL ?? 450)).toFixed(0)}&camLook=${ln.toFixed(0)},${le.toFixed(0)},${terrainHeight(ln, le).toFixed(0)}   # level ${r.level[0].toFixed(0)} len ${c.len.toFixed(0)} end ${(r as unknown as { end?: string }).end}`);
    }
  }
  setWorldSeed(0);
});
