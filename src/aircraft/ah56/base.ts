// Lockheed AH-56A Cheyenne: the base helicopter (no wing, no pusher). SCAFFOLD STUB (owner after the scaffold: AG).
// Plan revision 2, sections 2.3 and 7.2.
//
// Until AG lands the T64, the hingeless hub, the gyro and the wheels, this is the MD 500E's rotorcraft COMPLETELY (hub,
// rotor dynamics, rotor speed, skids, airframe, 250-C20B drive and governor) with only the main-rotor BLADE COUNT set
// to the AH-56A's four. The plan's first choice (the real 7.808 m rotor on MD 500E dynamics) was tried at S0 and
// rejected by the scaffold check: the stub's single 250-C20B ran out of power (governor throttle 1.0 at 120 kt with the
// rotor drooping), the hover hung 14 deg of roll, and the 3 m tail rotor struck the ground on a ground reset. The
// final AH-56A geometry is dimensions.ts and facts.ts; the exterior (AX) and the sound (AU) build to those (AU through
// imports, so its numbers follow when AG replaces this file).
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import { MD500_ROTORCRAFT as md } from '../md500/rotorcraft';
import { MAIN_ROTOR_BLADES } from './dimensions';

export const AH56_BASE: RotorcraftDefinition = {
  ...md,
  main: { ...md.main, blades: MAIN_ROTOR_BLADES },
};
