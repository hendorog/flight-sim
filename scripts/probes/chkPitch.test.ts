// Checker A4p (ported, Round W R): pitch-pool units found vs shaped (pitchPool.ts report: a unit is shaped where a sample of the line lies in its pool), and stream sample spacing. CK_SEEDS.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('chk pitch', () => {
  for (const seed of (env.CK_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const rep = (hydrology.streamReport as unknown as { pitch?: Record<string, unknown> }).pitch ?? {};
    const L = hydrology.rivers!;
    let onKm = 0, steepOnKm = 0, lineKm = 0, nSeg = 0;
    const segs: number[] = [];
    let onFlat = 0;
    for (const r of L) {
      const m = r.s.length;
      const on = (r as unknown as { pitchOn?: Float32Array }).pitchOn;
      for (let i = 0; i < m - 1; i++) {
        const ds = r.s[i + 1] - r.s[i];
        lineKm += ds / 1000;
        if ((r.kind ?? 0) === 1) { segs.push(ds); nSeg++; }
        if (on && on[i] > 0.5) {
          onKm += ds / 1000;
          const g = (r.level[i] - r.level[i + 1]) / Math.max(1e-6, ds);
          if (g < 0.01) onFlat += ds / 1000;
        }
      }
    }
    segs.sort((a, b) => a - b);
    const q = (p: number) => segs.length ? segs[Math.floor(p * (segs.length - 1))].toFixed(1) : '-';
    console.log(`seed ${seed}: pitch units shaped ${rep.units} of ${rep.found} found (${((100 * Number(rep.units)) / Math.max(1, Number(rep.found))).toFixed(1)} %), samples inserted ${rep.inserted}; pitchOn km ${onKm.toFixed(0)} of which segment gradient < 1 %: ${onFlat.toFixed(0)} km; stream segments ${nSeg} p50 ${q(0.5)} m p90 ${q(0.9)} m max ${q(1)} m; all lines ${lineKm.toFixed(0)} km`);
  }
  setWorldSeed(0);
});
