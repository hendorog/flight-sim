// MBB Bo 105 CB-4: the powerplant. SCAFFOLD STUB (owner after the scaffold: BO).
//
// Two Allison 250-C20B (P TCDS p9), the MD 500E's EngineDef imported unchanged (same engine; per-installation limits
// live in twin.ts and facts.ts). Two fuel feeds and two 150 A starter-generators (engine 0 and engine 1), as the
// Powerplant needs one feed per engine. The S0 stub keeps the MD 500E's single fuel tank (both feeds draw from it) so
// the MD 500E mass model and loadings stay valid; BO builds the supply (74 kg) and main (382 kg) tanks with LOW FUEL at
// 60 kg in the supply tank (facts.ts BO105_FUEL).
import type { PowerplantDef } from '../../physics/propulsion/defs';
import { ALLISON_250_C20B, MD500_POWERPLANT } from '../md500/powerplant';
import { BO105_GENERATOR_AMPS, BO105_N1_100_RPM } from './facts';

const md = MD500_POWERPLANT;

export const BO105_POWERPLANT: PowerplantDef = {
  ...md,
  engines: [
    { ...md.engines[0], engine: ALLISON_250_C20B },
    { ...md.engines[0], engine: ALLISON_250_C20B },
  ],
  fuel: { ...md.fuel, feeds: [md.fuel.feeds[0], md.fuel.feeds[0]] },
  electrical: { ...md.electrical,
    alternators: [0, 1].map((engine) => ({ engine, maxAmps: BO105_GENERATOR_AMPS, cutInRpm: 0.52 * BO105_N1_100_RPM,
      fullRpm: 0.6 * BO105_N1_100_RPM, efficiency: 0.6 })) },
};
