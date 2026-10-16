// MD 500E (369E): articulated-hub blade data. Owner: T2.
//
// No 369D21100 blade weighing or inertia survey was obtained (research-md500 sect. 17, gap 2). The one family number
// is the OH-6A blade's flap inertia, 63.49 kg m^2 about the flap hinge (Heffley et al., NASA CR-3144 p. 34, F): a
// uniform blade from the aerofoil root (MAIN_BLADE_ROOT, 0.480 m) to the tip with that flap inertia about the 0.140 m
// hinge weighs 11.5 kg, and five of them give a rotor polar inertia of 352 kg m^2 (the research ESTIMATE was
// 330-350 with a hub allowance). The rotor-energy derivation that uses it (tau about 4.9 s) is in
// docs/md500-flight-model.md ("Rotor energy"); a primary blade weight refits BLADE_MASS here and nothing else.
import { uniformBladeMoments, type ArticulatedParameters } from '../../physics/rotorcraft/articulated';
import * as D from './dimensions';

/** Start of the aerofoil (500C, CR-166256 p5: 1.576 ft). F / ESTIMATE. */
export const MD500_BLADE_ROOT = D.MAIN_BLADE_ROOT;
/** OH-6A blade flap inertia about the flap hinge, kg m^2 (Heffley CR-3144 p34). F */
export const OH6A_FLAP_INERTIA = 63.49;
/** Uniform-blade mass that reproduces OH6A_FLAP_INERTIA about the 0.140 m hinge. DERIVED / ESTIMATE. */
export const BLADE_MASS = OH6A_FLAP_INERTIA / uniformBladeMoments(1, MD500_BLADE_ROOT, D.MAIN_ROTOR_RADIUS,
  D.FLAP_HINGE_OFFSET, D.LAG_HINGE_OFFSET).flapInertia;

export const MD500_ARTICULATED: ArticulatedParameters = {
  flapOffset: D.FLAP_HINGE_OFFSET, lagOffset: D.LAG_HINGE_OFFSET,
  blade: uniformBladeMoments(BLADE_MASS, MD500_BLADE_ROOT, D.MAIN_ROTOR_RADIUS, D.FLAP_HINGE_OFFSET, D.LAG_HINGE_OFFSET),
  // Elastomeric lead-lag dampers (500D on; heli-archive, S). ESTIMATES scaled from the S269's: no damper data.
  damper: { arm: 0.12, stiffness: 40000, damping: 9000 },
};
