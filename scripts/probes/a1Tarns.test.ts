// Probe: the tarns of a seeded world (drainage.ts TARN_SPILL) with a camera looking at each from DIST m south-west at
// AGL m over the highest ground round the camera; and whether a stream ends in it.
//   STREAM_SEEDS=42,777777 DIST=2000 AGL=450
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('a1 tarns', () => {
  const dist = Number(env.DIST ?? 2000), agl = Number(env.AGL ?? 450);
  for (const seed of (env.STREAM_SEEDS ?? '42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const mask = hydrology.lakeMask as unknown as { d: { lakes: Array<{ tarn?: boolean }> }; main: Int32Array; pools: Array<{ lake: number; level: number; bottom: number; wet: number; centreNorth: number; centreEast: number }> };
    const lines = hydrology.rivers ?? [];
    for (let k = 0; k < mask.d.lakes.length; k++) {
      if (!mask.d.lakes[k].tarn || mask.main[k] < 0) continue;
      const p = mask.pools[mask.main[k]];
      let inflow = 0, outflow = 0;
      for (const r of lines) {
        const n = r.north.length - 1;
        if (Math.hypot(r.north[n] - p.centreNorth, r.east[n] - p.centreEast) < 900) inflow++;
        if (Math.hypot(r.north[0] - p.centreNorth, r.east[0] - p.centreEast) < 900) outflow++;
      }
      const b = (225 * Math.PI) / 180;
      const cn = p.centreNorth + Math.cos(b) * dist, ce = p.centreEast + Math.sin(b) * dist;
      let hi = -Infinity;
      for (let a = -3; a <= 3; a++) for (let c = -3; c <= 3; c++) hi = Math.max(hi, terrainHeight(cn + a * 200, ce + c * 200));
      (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write(`TARN seed ${seed} pond ${k} level ${p.level.toFixed(0)} depth ${(p.level - p.bottom).toFixed(0)} km² ${(p.wet * 0.0625).toFixed(2)} lines ending ${inflow} starting ${outflow}: seed=${seed}&camPos=${cn.toFixed(0)},${ce.toFixed(0)},${(hi + agl).toFixed(0)}&camLook=${p.centreNorth.toFixed(0)},${p.centreEast.toFixed(0)},${p.level.toFixed(0)}\n`);
    }
  }
  setWorldSeed(0);
});
