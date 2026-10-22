// MBB Bo 105 CB-4: physical blade coning data of the hingeless rotor (the blade pose for the exterior, the ground rotor
// and hubModel.coning). Owner: BO. Plan revision 2, section 4 "(e, Kbeta) split" and section 6.2.
//
// The blade is the solver's: the uniform blade of the polar inertia over the aerofoil span (hub.ts), on the equivalent
// hinge at 0.12 R, its spring DERIVED from the rotating first flap frequency (hingelessSpring, RC's
// src/physics/rotorcraft/hingeless.ts; consistency: equal to 1e-6) about the 2.5 deg precone. NASA TM-85990 gives the
// rotating frequencies only (no non-rotating flap frequency), so e stays 0.12 R and the parked pose is set by two
// ESTIMATES: a droop stop and a bending rigidity (3V, below). Neither touches the airborne load solver.
import { DEG } from '../../core/math';
import type { BladeConingDefinition } from '../../physics/rotorcraft/coning';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import { hingelessBlade, hingelessSpring } from '../../physics/rotorcraft/hingeless';
import { BO105_HUB_SET, BO105_MAIN_ROTOR } from './hub';
import { BO105_NR_100 } from './facts';

/** The fields hingelessSpring / hingelessBlade read (hub, main rotor, 100 % rpm): the same objects the definition
 *  carries (rotorcraft.ts), so the spring here is the definition's (consistency checks it on the whole definition). */
const SPRING_DEF = { hubModel: { kind: 'hingeless', ...BO105_HUB_SET }, main: BO105_MAIN_ROTOR, referenceRpm: BO105_NR_100 } as
  Pick<RotorcraftDefinition, 'hubModel' | 'main' | 'referenceRpm'> as RotorcraftDefinition;
const blade = hingelessBlade(SPRING_DEF);
const e = BO105_HUB_SET.equivalentHingeOffset, R = BO105_MAIN_ROTOR.radius, root = BO105_MAIN_ROTOR.rootCutout;

/**
 * Bending rigidity of the parked blade, N m^2, over the flexible span from the equivalent hinge to the tip (4.33 m): set
 * so that a parked tip sits about 0.25 m below the hub plane (3V: parked Bo 105 blades in the reference photos sag
 * 0.2-0.3 m at the tip; plan 4). At rest the spring holds the rigid blade about 0.74 deg below the hinge plane (moment
 * balance, on the solver's uniform blade of the 850 kg m^2 polar inertia, 20.68 kg, and hingelessSpring's 8,685 N m/rad:
 * m g (r_cg - e) = 20.7 x 9.81 x 2.42 = 491 N m against K_beta x precone = 8.7e3 x 0.0436 = 379 N m), about 0.06 m at
 * the tip; the uniform-cantilever sag m g L^3 / (8 EI) makes up about 0.19 m: EI = 20.7 x 9.81 x 4.33^3 / (8 x 0.19) =
 * 1.08e4, rounded to 1.1e4 (sag 0.187 m; the tip 0.24 m below the hub plane in all). D check: a uniform cantilever with
 * this EI and the blade's 5.41 kg/m has a non-rotating first flap frequency of about 1.35 Hz (the plan's "about 1 Hz";
 * no measured value was found). ESTIMATE.
 */
export const BO105_BLADE_BENDING_RIGIDITY = 1.1e4;

export const BO105_BLADE_CONING: BladeConingDefinition = {
  mass: blade.mass, cgRadius: (root + R) / 2, inertia: blade.polar, hingeRadius: e,
  thrustRadius: 0.75 * R,
  precone: BO105_HUB_SET.precone,
  hingeStiffness: hingelessSpring(SPRING_DEF),
  /** The parked blade's lower limit at the equivalent hinge, rad: -1.5 deg (ESTIMATE, plan 4). The hingeless root has
   *  no mechanical stop; this keeps a stopped, unloaded blade from folding further under a gust or a hard landing. */
  droopStop: -1.5 * DEG,
  bending: { rootRadius: e, radius: R, rigidity: BO105_BLADE_BENDING_RIGIDITY },
};
