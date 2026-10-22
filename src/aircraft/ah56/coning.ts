// Lockheed AH-56A Cheyenne: the hingeless hub's constants and the physical blade pose data. Owner: AG (stage 2).
//
// The hub (P ASTA-72 App B p 48): four blades on a fixed hub, feathering on the "door hinge", flap and lag by structural
// bending of the blade and hub (hingeless; soft flapwise, stiff in-plane). No flap frequency or blade mass distribution
// is published (gap): equivalent hinge offset 10 % R and nu_beta 1.12 per rev (ESTIMATE, research-ah56 sect. 5: Lockheed's
// "full-scale" 1.125-1.15 and NASA Langley's 10 % offset); precone 2 deg (P). The flap spring is DERIVED from nu
// (hingelessSpring, RC) on the blade set below, so the pose and the load solver agree (consistency: hingeStiffness ===
// hingelessSpring(def)).
import { DEG } from '../../core/math';
import { uniformBladeMoments, type BladeMassMoments } from '../../physics/rotorcraft/articulated';
import type { BladeConingDefinition } from '../../physics/rotorcraft/coning';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';
import { hingelessSpring } from '../../physics/rotorcraft/hingeless';
import { MAIN_ROTOR_BLADES, MAIN_ROTOR_CHORD, MAIN_ROTOR_PRECONE_DEG, MAIN_ROTOR_RADIUS, MAIN_ROTOR_ROOT_CUTOUT } from './dimensions';
import { AH56_NR_100, AH56_ROTOR_INERTIA } from './facts';

const R = MAIN_ROTOR_RADIUS, ROOT = MAIN_ROTOR_ROOT_CUTOUT;

/** Hub constants (HingelessHub fields): e = 10 % R and nu_beta 1.12 (ESTIMATE), precone 2 deg (P). */
export const AH56_HUB = { equivalentHingeOffset: 0.10 * R, flapFrequency: 1.12, precone: MAIN_ROTOR_PRECONE_DEG * DEG } as const;

/** Main-rotor lift slope, /rad (ESTIMATE: the 23012 family's 0.1 per deg; base.ts flies it). */
export const AH56_LIFT_SLOPE = 5.73;
/** Lock number of the AMCS rotor, about the shaft (P Hoh-74: 6.4). */
export const AH56_LOCK = 6.4;
/**
 * The blades' own mass moments (HingelessHub.blade): a uniform blade from the root cut-out to the tip whose polar
 * inertia gives the P Lock number 6.4 about the shaft with the 5.73 lift slope: I_b = rho a c R^4 / 6.4 = 2898 kg m^2,
 * 88 % of the rotor's per-blade 3304 kg m^2 (the P 9748 slug-ft^2 includes the fixed and movable hubs; D/ESTIMATE). Mass
 * 119 kg (263 lb) per blade (D). The true mass distribution is a gap.
 */
const square = (ROOT * ROOT + ROOT * R + R * R) / 3;
const bladeInertia = 1.225 * AH56_LIFT_SLOPE * MAIN_ROTOR_CHORD * R ** 4 / AH56_LOCK;
export const AH56_BLADE: BladeMassMoments = uniformBladeMoments(bladeInertia / square, ROOT, R,
  AH56_HUB.equivalentHingeOffset, AH56_HUB.equivalentHingeOffset);

/** The minimal definition hingelessSpring reads (the same numbers base.ts flies). */
const springDef = {
  hubModel: { kind: 'hingeless', ...AH56_HUB, blade: AH56_BLADE },
  main: { radius: R, rootCutout: ROOT, inertia: AH56_ROTOR_INERTIA, blades: MAIN_ROTOR_BLADES },
  referenceRpm: AH56_NR_100,
} as unknown as RotorcraftDefinition;

/**
 * Physical blade pose. Droop stop ESTIMATE -2 deg. Flapwise bending ESTIMATE: a uniform cantilever outboard of the root
 * cut-out with EI 300 kN m^2, which sags the parked tip about 0.15 m (3V: the museum ships' blades droop gently; the
 * spring alone holds a parked blade within a degree of level).
 */
export const AH56_BLADE_CONING: BladeConingDefinition = {
  mass: AH56_BLADE.mass, cgRadius: (ROOT + R) / 2, inertia: AH56_BLADE.polar,
  hingeRadius: AH56_HUB.equivalentHingeOffset, thrustRadius: 0.75 * R,
  precone: AH56_HUB.precone, hingeStiffness: hingelessSpring(springDef),
  droopStop: -2 * DEG,
  bending: { rootRadius: ROOT, radius: R, rigidity: 300e3 },
};
