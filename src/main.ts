// Simulator entry point. Everything lives in src/sim; see Simulator.ts for the boot order and frame loop
// and params.ts for the URL parameters.

import { showBootError } from './sim/overlays';
import { Simulator } from './sim/Simulator';

const sim = new Simulator();
sim.boot().catch((err: unknown) => {
  console.error('[sim] boot failed', err);
  showBootError(err);
});
