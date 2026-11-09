// (Copied from out/fs/verifyR1/pictures/tools/A, pointed at the worktree.) verifyR1: the terrain along a straight segment PR_A -> PR_B (north,east) every PR_STEP m on seed PR_SEED: ground, the
// stream's water (river), standing water (lake/sea), and the nearest line's distance - to see what a pilot sees at a shore.
import { it } from 'vitest';
import { terrainHeight, sampleTerrain, makeSample } from '../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('profile', () => {
  const s = makeSample();
  setWorldSeed(Number(env.PR_SEED ?? 1));
  terrainHeight(0, 0);
  const [an, ae] = (env.PR_A ?? '35951,41127').split(',').map(Number), [bn, be] = (env.PR_B ?? '35855,41116').split(',').map(Number);
  const L = Math.hypot(bn - an, be - ae), step = Number(env.PR_STEP ?? 5);
  for (let d = 0; d <= L + 1e-6; d += step) {
    const n = an + (bn - an) * d / L, e = ae + (be - ae) * d / L;
    sampleTerrain(n, e, s);
    const top = Math.max(s.ground, s.river, s.standing);
    console.log(`  d ${d.toFixed(0).padStart(4)} at ${n.toFixed(0)},${e.toFixed(0)} ground ${s.ground.toFixed(1)} river ${s.river.toFixed(1)} standing ${s.standing.toFixed(1)} surface ${top.toFixed(1)} riverDist ${s.riverDist.toFixed(1)}`);
  }
  setWorldSeed(0);
});
