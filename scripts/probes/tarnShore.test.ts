// Probe: how far the drawn ground round each tarn (drainage.ts TARN_SPILL) stands over the natural ground (a raised
// shore), on a 25 m grid over the tarn and 400 m round it: the largest raise on dry ground, and per tarn.
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('tarn shore', () => {
  const s = makeSample();
  for (const seed of (env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const mask = hydrology.lakeMask as unknown as { d: { lakes: Array<{ tarn?: boolean }> }; main: Int32Array; pools: Array<{ level: number; wet: number; centreNorth: number; centreEast: number }> };
    const raises: number[] = [];
    let worst = 0, where = '';
    for (let k = 0; k < mask.d.lakes.length; k++) {
      if (!mask.d.lakes[k].tarn || mask.main[k] < 0) continue;
      const p = mask.pools[mask.main[k]];
      const R = Math.sqrt((p.wet * 62500) / Math.PI) + 400;
      let m = 0;
      for (let a = -R; a <= R; a += 25) for (let b = -R; b <= R; b += 25) {
        const n = p.centreNorth + a, e = p.centreEast + b;
        sampleTerrain(n, e, s);
        if (s.standing > s.ground || s.river > s.ground) continue;
        const r = s.ground - naturalHeight(n, e);
        if (r > m) m = r;
        if (r > worst) { worst = r; where = `${n.toFixed(0)},${e.toFixed(0)}`; }
      }
      raises.push(m);
    }
    raises.sort((x, y) => x - y);
    (globalThis as unknown as { process: { stderr: { write(t: string): void } } }).process.stderr.write(`TARNSHORE seed ${seed}: ${raises.length} tarns; largest raise of the dry ground over the natural per tarn: p50 ${raises[raises.length >> 1]?.toFixed(2)} p90 ${raises[Math.floor(raises.length * 0.9)]?.toFixed(2)} max ${worst.toFixed(2)} m at ${where}\n`);
  }
  setWorldSeed(0);
});
