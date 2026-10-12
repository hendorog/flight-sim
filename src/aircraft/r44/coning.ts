import { DEG } from '../../core/math';
import type { BladeConingDefinition } from '../../physics/rotorcraft/coning';
import { MAIN_ROTOR_RADIUS } from './dimensions';

const rotor = { radius: MAIN_ROTOR_RADIUS, rootCutout: 1.0, inertia: 450, blades: 2 };
/** Engineering estimates, not measured blade/stop data; see docs/rotor-coning.md.
 * Uses the existing 21 kg/blade distribution and rotor inertia. POH 1-4's 1° is TAIL precone. */
export const R44_BLADE_CONING: BladeConingDefinition = {
  mass: 21, cgRadius: (rotor.rootCutout + rotor.radius) / 2,
  inertia: rotor.inertia / rotor.blades, hingeRadius: 0.151, thrustRadius: 0.75 * rotor.radius,
  precone: 0, hingeStiffness: 0, droopStop: -1 * DEG,
  bending: { rootRadius: rotor.rootCutout, radius: rotor.radius, rigidity: 12000 },
};
