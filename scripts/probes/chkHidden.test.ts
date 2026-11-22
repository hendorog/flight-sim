// Checker A4p: dryNear's "hidden" points (a line's water not drawn at its own sample): what the terrain has there -
// ground, standing water (a lake or a filled pond), the drawn river level - and the line's own level. CK_PTS="seed:n,e;..."
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('chk hidden', () => {
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
    const mask = hydrology.lakeMask!;
    const L = hydrology.rivers!;
    for (const [n, e] of pts) {
      sampleTerrain(n, e, s);
      let best = -1, bd = Infinity, bi = 0;
      L.forEach((r, li) => { for (let i = 0; i < r.north.length; i++) { const d = Math.hypot(r.north[i] - n, r.east[i] - e); if (d < bd) { bd = d; best = li; bi = i; } } });
      const r = L[best];
      const end = (r as unknown as { end?: string }).end;
      console.log(`CH seed ${seed} at ${n},${e}: ground ${s.ground.toFixed(1)} standing ${s.standing.toFixed(1)} river ${s.river.toFixed(1)} mask ${mask.at(n, e).toFixed(1)}; nearest line ${best} (kind ${r.kind}, end ${end}) sample ${bi}/${r.north.length} ${bd.toFixed(1)} m away, its level ${r.level[bi].toFixed(1)}, halfWidth ${r.halfWidth[bi].toFixed(2)}`);
    }
  }
  setWorldSeed(0);
});
