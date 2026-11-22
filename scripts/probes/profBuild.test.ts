// Probe (profiling): builds seeds 1, 42 and 777777 three times each, for a CPU profile of the world build:
//   npx vitest run --config scripts/probes/vitest.config.ts profBuild --pool=forks --execArgv=--cpu-prof --execArgv=--cpu-prof-dir=<dir>
import { it } from 'vitest';
import { setWorldSeed } from '../../src/world/worldSeed';
import '../../src/world/terrain/heightfield';
it('prof build', () => {
  setWorldSeed(3); setWorldSeed(0);
  for (let r = 0; r < 3; r++) for (const s of [1, 42, 777777]) { setWorldSeed(s); setWorldSeed(0); }
});
