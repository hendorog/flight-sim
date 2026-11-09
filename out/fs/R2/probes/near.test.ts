// Round T repairs 2: the lines passing within NR_R m of NR_AT (north,east) on seed NR_SEED: their nearest sample, its
// water, half-width, and the terrain there (ground, blend).
import { it } from 'vitest';
import { hydrology, terrainHeight, sampleTerrain, makeSample } from '../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('near', () => {
  setWorldSeed(Number(env.NR_SEED ?? 777777));
  terrainHeight(0, 0);
  const [n0, e0] = (env.NR_AT ?? '-14950,32650').split(',').map(Number);
  const R = Number(env.NR_R ?? 300);
  const s = makeSample();
  hydrology.rivers!.forEach((r, li) => {
    let bd = Infinity, bk = -1;
    for (let k = 0; k < r.north.length; k++) { const d = Math.hypot(r.north[k] - n0, r.east[k] - e0); if (d < bd) { bd = d; bk = k; } }
    if (bd > R) return;
    sampleTerrain(r.north[bk], r.east[bk], s);
    console.log(`line ${li} kind ${r.kind} joins ${r.joins} nearest i ${bk} of ${r.north.length} at ${r.north[bk].toFixed(0)},${r.east[bk].toFixed(0)} (${bd.toFixed(0)} m): water ${r.level[bk].toFixed(2)} hw ${r.halfWidth[bk].toFixed(1)} ground ${s.ground.toFixed(2)} blend ${s.airportBlend.toFixed(2)} approach ${s.approach.toFixed(2)}`);
  });
  setWorldSeed(0);
});
