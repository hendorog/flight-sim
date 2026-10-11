import { DEG } from '../../core/math';
import type { BladeConingDefinition } from '../../physics/rotorcraft/coning';
import { S269_ARTICULATED, S269_BLADE_ROOT } from './articulated';
import { MAIN_ROTOR_RADIUS } from './dimensions';

const p = S269_ARTICULATED;
/** ESTIMATES, not measured CB blade/stop data: docs/s269-sources.md.
 * Reuse the flight model's uniform 15 kg blade and shaft inertia. The flap pin is free;
 * the elastomeric damper acts in lead–lag, not as a flap spring or fixed precone.
 * Rigid span for now: no verified flapwise EI to support a separate elastic-sag claim. */
export const S269_BLADE_CONING: BladeConingDefinition = {
  mass: p.blade.mass, cgRadius: (S269_BLADE_ROOT + MAIN_ROTOR_RADIUS) / 2,
  inertia: p.blade.polar, hingeRadius: p.flapOffset, thrustRadius: 0.75 * MAIN_ROTOR_RADIUS,
  precone: 0, hingeStiffness: 0, droopStop: -2 * DEG,
};
