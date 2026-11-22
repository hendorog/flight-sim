// Lines ending within MA_R m of a point (MA_SEED, MA_N, MA_E): their last sample, receiver, distance from the receiver's
// line there, the receiver's braid share and water width there, and the line's own water at its end (debug).
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('mouth at', () => {
  setWorldSeed(Number(env.MA_SEED ?? 1));
  terrainHeight(0, 0);
  const pn = Number(env.MA_N), pe = Number(env.MA_E), R = Number(env.MA_R ?? 2000);
  type L = { north: Float64Array; east: Float64Array; s: Float64Array; level: Float64Array; kind?: number; joins?: number; end?: string; wetR: Float32Array; wetL: Float32Array; braidShare?: Float32Array; bedR: Float32Array; bedL: Float32Array };
  const Ls = hydrology.rivers as unknown as L[];
  Ls.forEach((r, li) => {
    const m = r.s.length - 1;
    if (Math.hypot(r.north[m] - pn, r.east[m] - pe) > R) return;
    const P = r.joins !== undefined && r.joins >= 0 ? Ls[r.joins] : null;
    let d = Infinity, k = -1;
    if (P) for (let i = 0; i < P.s.length; i++) { const x = Math.hypot(P.north[i] - r.north[m], P.east[i] - r.east[m]); if (x < d) { d = x; k = i; } }
    console.log(`MA line ${li} kind ${r.kind} end ${r.end} at ${r.north[m].toFixed(0)},${r.east[m].toFixed(0)} level ${r.level[m].toFixed(1)} wet ${(r.wetR[m] + r.wetL[m]).toFixed(0)} joins ${r.joins}` + (P ? ` receiver dist ${d.toFixed(0)} level ${P.level[k].toFixed(1)} share ${P.braidShare ? P.braidShare[k].toFixed(2) : '-'} wet ${(P.wetR[k] + P.wetL[k]).toFixed(0)} bed ${(P.bedR[k] + P.bedL[k]).toFixed(0)}` : ''));
  });
  setWorldSeed(0);
});
