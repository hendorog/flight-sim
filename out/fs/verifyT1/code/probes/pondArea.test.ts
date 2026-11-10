// Checker T1: each pond's outlet area at its head against the summed end areas of the lines ending in that pond.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../../../../src/world/terrain/heightfield';
import { DOMAIN_HALF, LAKE_RASTER } from '../../../../../src/world/terrain/drainage';
import { setWorldSeed } from '../../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('pond area', () => {
  for (const seed of (env.SEEDS ?? '1,42,777777,7').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const rep = (hydrology as unknown as { streamReport?: { ponds?: number[] } }).streamReport ?? {};
    const pondIds = new Set<number>();
    for (let i = 0; i < (rep.ponds ?? []).length; i += 2) pondIds.add(rep.ponds![i]);
    const L = hydrology.rivers!;
    const mask = hydrology.lakeMask! as unknown as { poolAt(i: number, j: number): number };
    const poolOf = (n: number, e: number): number => mask.poolAt(Math.round((n + DOMAIN_HALF) / LAKE_RASTER), Math.round((e + DOMAIN_HALF) / LAKE_RASTER));
    const into = new Map<number, number[]>();
    const outs = new Map<number, number[]>();
    L.forEach((r, li) => {
      if ((r.kind ?? 0) === 0) return;
      const m = r.north.length - 1;
      const pe = poolOf(r.north[m], r.east[m]), ph = poolOf(r.north[0], r.east[0]);
      if (pe >= 0 && pe !== ph && pondIds.has(pe)) (into.get(pe) ?? into.set(pe, []).get(pe)!).push(li);
      if (ph >= 0 && pe !== ph && pondIds.has(ph)) (outs.get(ph) ?? outs.set(ph, []).get(ph)!).push(li);
    });
    console.log(`seed ${seed}: ponds ${pondIds.size}`);
    for (const p of [...pondIds].sort((a, b) => a - b)) {
      const o = outs.get(p) ?? [];
      const iv = into.get(p) ?? [];
      const sumIn = iv.reduce((a, li) => a + L[li].area![L[li].area!.length - 1], 0);
      const oa = o.map((li) => `${li}: head ${L[li].area![0].toFixed(1)} end ${L[li].area![L[li].area!.length - 1].toFixed(1)}`);
      const flag = o.length && Math.abs(L[o[0]].area![0] - Math.max(1, sumIn)) > 0.5 + 0.05 * sumIn ? '  <-- MISMATCH' : '';
      console.log(`  pond ${p}: in [${iv.map((li) => `${li}:${L[li].area![L[li].area!.length - 1].toFixed(1)}`).join(' ')}] sum ${sumIn.toFixed(1)}; out [${oa.join('; ')}]${flag}`);
    }
  }
  setWorldSeed(0);
});
