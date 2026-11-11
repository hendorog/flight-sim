// Checker A4p: a hollow B's fill and spill filled more than once: at each given point the drawn standing water and
// ground, LakeMask.at, every pool whose level the point lies under (its level), and the lines within 300 m with their
// water level there. CK_PTS="seed:n,e;..."
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('chk nested', () => {
  const s = makeSample();
  const bySeed = new Map<number, Array<[number, number]>>();
  for (const t of (env.CK_PTS ?? '').split(';').filter(Boolean)) {
    const [sd, p] = t.split(':');
    const [n, e] = p.split(',').map(Number);
    if (!bySeed.has(Number(sd))) bySeed.set(Number(sd), []);
    bySeed.get(Number(sd))!.push([n, e]);
  }
  for (const [seed, pts] of bySeed) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = hydrology.rivers!;
    for (const [n, e] of pts) {
      sampleTerrain(n, e, s);
      const near: string[] = [];
      L.forEach((r, li) => {
        let bd = Infinity, bi = -1;
        for (let i = 0; i < r.north.length; i++) { const d = Math.hypot(r.north[i] - n, r.east[i] - e); if (d < bd) { bd = d; bi = i; } }
        if (bd < 300) near.push(`${li}(k${r.kind}) ${bd.toFixed(0)} m lvl ${r.level[bi].toFixed(1)}`);
      });
      console.log(`NE seed ${seed} at ${n},${e}: ground ${s.ground.toFixed(1)} standing ${s.standing.toFixed(1)} river ${s.river.toFixed(1)}; lines within 300 m: ${near.join('; ')}`);
    }
  }
  setWorldSeed(0);
});
