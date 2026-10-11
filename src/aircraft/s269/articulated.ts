import { uniformBladeMoments, type ArticulatedParameters } from '../../physics/rotorcraft/articulated';
import * as D from './dimensions';

/** ESTIMATE: three 15 kg uniform blades from 0.65 m to the tip. No blade weighing/inertia
 * survey obtained. Separate integrals about the frozen estimated pins; never I_polar / B
 * silently substituted for flap inertia. Sensitivities use 12–18 kg and half/double damper loss. */
export const S269_BLADE_ROOT = 0.65;
export const S269_ARTICULATED: ArticulatedParameters = {
  flapOffset: D.FLAP_HINGE_OFFSET, lagOffset: D.LAG_HINGE_OFFSET,
  blade: uniformBladeMoments(15, S269_BLADE_ROOT, D.MAIN_ROTOR_RADIUS, D.FLAP_HINGE_OFFSET, D.LAG_HINGE_OFFSET),
  // ESTIMATES, not 269A1290-3 test data. Local tangential arm and positive Kelvin–Voigt
  // coefficients permit a dissipative research model, not ground-resonance certification.
  damper: { arm: 0.12, stiffness: 35000, damping: 8000 },
};
