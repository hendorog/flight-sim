// Wheeled rotorcraft (AH-56A: retractable tail-wheel gear): the contract and an S0 stub. Owner after the scaffold: AG.
// Plan revision 2, section 7.2.
//
// Seams placed at S0 in flightModel.ts (TW keeps them): a rotorcraft with `landingGear === 'wheels'` gets NO SkidGear
// (the ordinary wheel LandingGear from def.gear() carries it), a RotorClearance whose check() can crash the aircraft,
// and wheelRestingPose() in place of the skids' resting pose at a ground reset. `RotorcraftDefinition.skids` stays
// required and carries wheel-rest data (z = body z of the tyre contact at rest; consistency within 1 cm), because the
// hover start, the scripted pilot, the generic visual and heliHold read it.
import type { Vec3 } from '../../core/math';
import type { BodyState } from '../interfaces';
import type { RotorcraftDefinition, RotorcraftState } from './definition';

/** Stinger / fin / rotor-strike checks of a wheeled rotorcraft (AG extracts them bit-identically from skids.ts:155,
 *  212-214; the contactAirborne digest proves the skid path unchanged). S0 STUB: never strikes. */
export class RotorClearance {
  constructor(readonly def: RotorcraftDefinition) {}
  /** A crash reason, or null. Called once per derivative stage after the gear. */
  check(_b: BodyState, _state: RotorcraftState, _height: number): string | null {
    return null;
  }
}

/** Resting pose on the wheels: the reference point's height above the ground, m, and the attitude, rad.
 *  S0 STUB: level, on the main-wheel contact z (geometry.gear points, body FRD m). */
export function wheelRestingPose(gear: { nose: Vec3; leftMain: Vec3; rightMain: Vec3 }, _mass: number, _cg: Vec3):
  { height: number; pitch: number; roll: number } {
  return { height: (gear.leftMain.z + gear.rightMain.z) / 2, pitch: 0, roll: 0 };
}
