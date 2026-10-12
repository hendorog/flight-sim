import { DEG } from '../../core/math';
import type { BladeConingDefinition } from '../../physics/rotorcraft/coning';
import { MAIN_ROTOR_RADIUS } from './dimensions';

const rotor = { radius: MAIN_ROTOR_RADIUS, rootCutout: 0.75, inertia: 146, blades: 2 };
/** Engineering estimates, not measured blade/stop data; see docs/rotor-coning.md.
 * Keep mass distribution and inertia consistent with the existing flight model estimate.
 * POH 1-4's 1°11′ is TAIL precone. No fixed MAIN precone is established for its free hinges. */
export const R22_BLADE_CONING: BladeConingDefinition = {
  mass: 12, cgRadius: (rotor.rootCutout + rotor.radius) / 2,
  inertia: rotor.inertia / rotor.blades, hingeRadius: 0.12, thrustRadius: 0.75 * rotor.radius,
  precone: 0, hingeStiffness: 0, droopStop: -1 * DEG,
  bending: { rootRadius: rotor.rootCutout, radius: rotor.radius, rigidity: 3600 },
};
