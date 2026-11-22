// The nearest line's bed and water widths about a point (BA_SEED, BA_N, BA_E), every BA_EVERY samples over +-BA_SPAN (debug).
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('bed at', () => {
  setWorldSeed(Number(env.BA_SEED ?? 777777));
  terrainHeight(0, 0);
  const pn = Number(env.BA_N), pe = Number(env.BA_E);
  type L = { north: Float64Array; east: Float64Array; s: Float64Array; area?: Float64Array; bedR: Float32Array; bedL: Float32Array; wetR: Float32Array; wetL: Float32Array; braidShare?: Float32Array };
  const Ls = hydrology.rivers as unknown as L[];
  let best = -1, bi = 0, bd = Infinity;
  Ls.forEach((r, li) => { if ((r as unknown as { kind?: number }).kind) return; for (let i = 0; i < r.s.length; i++) { const d = Math.hypot(r.north[i] - pn, r.east[i] - pe); if (d < bd) { bd = d; best = li; bi = i; } } });
  const r = Ls[best];
  for (let i = Math.max(0, bi - 60); i < Math.min(r.s.length, bi + 60); i += 10) console.log(`BA line ${best} i ${i} at ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)} A ${r.area?.[i].toFixed(0)} bed ${(r.bedR[i] + r.bedL[i]).toFixed(0)} wet ${(r.wetR[i] + r.wetL[i]).toFixed(0)} share ${r.braidShare ? r.braidShare[i].toFixed(2) : '-'}`);
  setWorldSeed(0);
});
