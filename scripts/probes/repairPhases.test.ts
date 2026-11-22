// Repair probe: where the streams' build time goes (StreamReport phases and sample counts), warm.
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('phases', () => {
  setWorldSeed(3);
  for (const seed of [1, 42, 777777]) {
    setWorldSeed(0);
    setWorldSeed(seed);
    const r = hydrology.streamReport! as any;
    console.log(`seed ${seed}: trace ${r.ms.toFixed(0)} ms phases [${r.tracePhases.map((x: number) => x.toFixed(0)).join(', ')}] network phases [${(r.phases ?? []).map((x: number) => x.toFixed(0)).join(', ')}]; samples ${r.samples} level ${r.levelSamples} steps ${r.steps} fills ${r.fills ?? "-"}`);
  }
  setWorldSeed(0);
});
