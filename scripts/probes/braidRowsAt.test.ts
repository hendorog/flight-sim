// Braids: a braided line's rows near a point (BR_SEED, BR_N, BR_E): each row's sample, point, direction, bed and water
// edges and the right bed edge's point (debug).
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('braid rows at', () => {
  setWorldSeed(Number(env.BR_SEED ?? 42));
  terrainHeight(0, 0);
  const pn = Number(env.BR_N ?? -33900);
  const pe = Number(env.BR_E ?? -68650);
  type L = { north: Float64Array; east: Float64Array; s: Float64Array; bedR: Float32Array; bedL: Float32Array; wetR: Float32Array; wetL: Float32Array; braidK?: Float32Array; braidTn?: Float32Array; braidTe?: Float32Array; braidRow?: Uint8Array };
  const Ls = hydrology.rivers as unknown as L[];
  let best = -1, bi = -1, bd = Infinity;
  Ls.forEach((r, li) => { if (!r.braidK) return; for (let i = 0; i < r.s.length; i++) { const d = Math.hypot(r.north[i] - pn, r.east[i] - pe); if (d < bd) { bd = d; best = li; bi = i; } } });
  const r = Ls[best];
  console.log(`line ${best} nearest sample ${bi} at ${bd.toFixed(0)} m`);
  for (let i = Math.max(0, bi - 30); i < Math.min(r.s.length, bi + 30); i++) {
    const tn = r.braidTn![i], te = r.braidTe![i];
    const en = r.north[i] - te * r.bedR[i], ee = r.east[i] + tn * r.bedR[i];
    console.log(`${i} row ${r.braidRow![i]} s ${r.s[i].toFixed(0)} p ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)} dir ${tn.toFixed(3)},${te.toFixed(3)} K ${r.braidK![i].toFixed(2)} bedR ${r.bedR[i].toFixed(0)} bedL ${r.bedL[i].toFixed(0)} wet ${r.wetR[i].toFixed(1)}/${r.wetL[i].toFixed(1)} edgeR ${en.toFixed(0)},${ee.toFixed(0)}`);
  }
  setWorldSeed(0);
});
