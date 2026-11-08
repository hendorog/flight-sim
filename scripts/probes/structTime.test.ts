// Probe (foundation stage 3): what the structure costs at load. Per seed, min of ST_REPS: building it (structureFor,
// with buildFaults) and the steady-state model with and without it (erosion.ts steadyLattice).
//   ST_SEEDS=1,42,777777 ST_REPS=3
import { it } from 'vitest';
import { steadyLattice } from '../../src/world/terrain/erosion';
import * as hf from '../../src/world/terrain/heightfield';
import { buildFaults } from '../../src/world/terrain/faults';
import { structParams, structureFor } from '../../src/world/terrain/structure';
import { seeded, setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('structure cost', () => {
  const reps = Number(env.ST_REPS ?? 3);
  for (const seed of (env.ST_SEEDS ?? '42').split(',')) {
    setWorldSeed(Number(seed));
    const inp = hf.seededInputs;
    if (!inp) continue;
    let tS = Infinity, tWith = Infinity, tWithout = Infinity;
    for (let r = 0; r < reps; r++) {
      let t0 = performance.now();
      const st = structureFor(inp, buildFaults(), seeded(0x57c3), structParams());
      tS = Math.min(tS, performance.now() - t0);
      t0 = performance.now();
      steadyLattice({ ...inp, struct: st });
      tWith = Math.min(tWith, performance.now() - t0);
      t0 = performance.now();
      steadyLattice({ ...inp, struct: null });
      tWithout = Math.min(tWithout, performance.now() - t0);
    }
    console.log(`STRUCTTIME seed ${seed}: structure ${tS.toFixed(0)} ms; model with it ${tWith.toFixed(0)} ms, without ${tWithout.toFixed(0)} ms`);
  }
  setWorldSeed(0);
});
