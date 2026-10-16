// MD 500E (369E): physical blade coning data. Owner: T2. The uniform 11.5 kg blade of articulated.ts (OH-6A flap
// inertia, F / ESTIMATE). The V-strap pack carries flap through its own bending; it is modelled as a free flap hinge
// at the 0.140 m offset with a droop stop (ESTIMATE -2 deg), like the S269's elastomeric hub. No precone data.
import { DEG } from '../../core/math';
import type { BladeConingDefinition } from '../../physics/rotorcraft/coning';
import { MD500_ARTICULATED, MD500_BLADE_ROOT } from './articulated';
import { MAIN_ROTOR_RADIUS } from './dimensions';

const p = MD500_ARTICULATED;
export const MD500_BLADE_CONING: BladeConingDefinition = {
  mass: p.blade.mass, cgRadius: (MD500_BLADE_ROOT + MAIN_ROTOR_RADIUS) / 2,
  inertia: p.blade.polar, hingeRadius: p.flapOffset, thrustRadius: 0.75 * MAIN_ROTOR_RADIUS,
  precone: 0, hingeStiffness: 0, droopStop: -2 * DEG,
};
