// Probe (stage S): the streams' trace report - phases, ground samples taken, route() cost per call.
//   SS_SEEDS=42 npx vitest run --config scripts/probes/vitest.config.ts streamPhases --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

it('stream phases', () => {
  for (const seed of (process.env.SS_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const r: any = (hydrology as any).streamReport;
    console.log(`SP seed ${seed}: trace ${r.ms.toFixed(0)} ms, phases ${r.tracePhases.map((v: number) => v.toFixed(0)).join('/')}; net phases ${(r.phases ?? []).map((v: number) => v.toFixed(0)).join('/')}; samples ${r.samples} levelSamples ${r.levelSamples}`);
    setWorldSeed(0);
  }
});
