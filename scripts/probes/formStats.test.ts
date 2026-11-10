// Organic channels (channelForm.ts): per seed, the build's time and the rivers' law in numbers - samples, km, the
// bed and water widths, the room, the share of km the fitted braid law would braid, white samples.
//   FS2_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts formStats
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const q = (a: number[], p: number): number => {
  const b = [...a].sort((x, y) => x - y);
  return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : NaN;
};
it('form stats', () => {
  for (const seed of (env.FS2_SEEDS ?? '42').split(',').map(Number)) {
    const t0 = performance.now();
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const ms = performance.now() - t0;
    const L = hydrology.rivers ?? [];
    const rep = hydrology.streamReport as unknown as { form?: { samples: number; braidLaw: number; white: number }; phases?: number[] };
    let nR = 0;
    let km = 0;
    let n = 0;
    const bed: number[] = [];
    const wet: number[] = [];
    for (const r of L) {
      if ((r.kind ?? 0) !== 0) continue;
      nR++;
      km += r.s[r.s.length - 1] / 1000;
      n += r.s.length;
      for (let i = 0; i < r.s.length; i += 5) {
        if (Number.isFinite(r.halfWidth[i])) wet.push(2 * r.halfWidth[i]);
        if (r.bedR && r.bedL && Number.isFinite(r.bedR[i] + r.bedL[i])) bed.push(r.bedR[i] + r.bedL[i]);
      }
    }
    let nanW = 0;
    let nanL = 0;
    let nanP = 0;
    for (const r of L) {
      for (let i = 0; i < r.s.length; i++) {
        if (!Number.isFinite(r.halfWidth[i])) {
          if (nanW < 6) console.log('nan at', L.indexOf(r), i, r.s.length, r.s[i].toFixed(1), r.area?.[i], r.bedR?.[i], r.depth?.[i], r.level[i], r.kind);
          nanW++;
        }
        if (!Number.isFinite(r.level[i])) nanL++;
        if (!Number.isFinite(r.north[i]) || !Number.isFinite(r.east[i])) nanP++;
      }
    }
    console.log(`NaN: width ${nanW} level ${nanL} position ${nanP}`);
    console.log(`seed ${seed}: build ${ms.toFixed(0)} ms (phases ${rep.phases?.map((x) => x.toFixed(0)).join('/')}); rivers ${nR}, ${km.toFixed(0)} km, ${n} samples (${((km * 1000) / n).toFixed(1)} m each); wet W p10/50/90 ${q(wet, 0.1).toFixed(1)}/${q(wet, 0.5).toFixed(1)}/${q(wet, 0.9).toFixed(1)}; bed W ${q(bed, 0.1).toFixed(1)}/${q(bed, 0.5).toFixed(1)}/${q(bed, 0.9).toFixed(1)}; form ${JSON.stringify(rep.form)}`);
  }
  setWorldSeed(0);
});
