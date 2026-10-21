// Wheeled rotorcraft (AH-56A: retractable tail-wheel gear). Owner: AG (stage 2). Plan revision 2, section 7.2.
//
// Seams placed at S0 in flightModel.ts (TW keeps them): a rotorcraft with `landingGear === 'wheels'` gets NO SkidGear
// (the ordinary wheel LandingGear from def.gear() carries it, with its own airframe structure points and propeller
// discs), a RotorClearance whose check() can crash the aircraft, and wheelRestingPose() in place of the skids' resting
// pose at a ground reset. `RotorcraftDefinition.skids` stays required and carries wheel-rest data (z = body z of the tyre
// contact at rest; consistency within 1 cm), because the hover start, the scripted pilot, the generic visual and
// heliHold read it.
import type { Vec3 } from '../../core/math';
import type { BodyState } from '../interfaces';
import type { RotorcraftDefinition, RotorcraftState } from './definition';
import { clearanceStrike } from './skids';

/**
 * Cabin, fin, tail-rotor and main-rotor strike checks of a wheeled rotorcraft: the skids' checks (skids.ts
 * clearanceContacts / clearanceStrike, extracted unchanged so the skid path is bit-identical) over level ground at the
 * reference point's height above the terrain. No forces: the gear's own structure points (gear().structure) carry the
 * airframe on the ground; this only ends the flight when a rotor or the cabin meets it. The latched tail-contact report
 * (RotorcraftState.tailContact) is raised as on the skids. A stinger (tailProtection) has no wheeled user and is not
 * checked here; the ground-rotor pose (blade sailing, droop-stop strike: groundRotor.ts) does not run on wheels.
 */
export class RotorClearance {
  constructor(readonly def: RotorcraftDefinition) {}
  /** A crash reason, or null. Called once per derivative stage after the gear; `height` = the reference point's height
   *  above the terrain under it, m. */
  check(b: BodyState, state: RotorcraftState, height: number): string | null {
    const ground = -b.position.z - height;
    const severity = ['none', 'stinger-touch', 'stinger-impact', 'fin-strike', 'rotor-strike'];
    const strike = clearanceStrike(this.def, b, state, () => ground, (kind) => {
      if (severity.indexOf(kind) > severity.indexOf(state.tailContact)) state.tailContact = kind;
    });
    return strike || null;
  }
}

/**
 * Resting pose on the wheels: the reference point's height above level ground, m, and the attitude, rad. The gear points
 * (geometry.gear, body FRD m) are the tyre contacts AT REST at the type's design loading (the gear().wheels positions are
 * the extended contacts; ah56/gear.ts derives one from the other with the springs), so this is exact at that loading and
 * a few millimetres off at others (the springs settle it within a second). The tail wheel sits in the "nose" slot.
 */
export function wheelRestingPose(gear: { nose: Vec3; leftMain: Vec3; rightMain: Vec3 }, _mass: number, _cg: Vec3):
  { height: number; pitch: number; roll: number } {
  const main = { x: (gear.leftMain.x + gear.rightMain.x) / 2, z: (gear.leftMain.z + gear.rightMain.z) / 2 };
  // The slope, not atan2: the "nose" contact may lie AFT of the mains (a tail wheel). A contact lower in body axes
  // (larger z) raises its end: nose up for a wheel ahead of the mains, nose down for one behind; the right main lower
  // raises the right side (left wing down, roll negative).
  const pitch = Math.atan((gear.nose.z - main.z) / (gear.nose.x - main.x));
  const roll = -Math.atan((gear.rightMain.z - gear.leftMain.z) / (gear.rightMain.y - gear.leftMain.y));
  // World z (down) of a body point at this attitude, relative to the reference point; the mains' centre on the ground.
  const height = -main.x * Math.sin(pitch) + main.z * Math.cos(pitch) * Math.cos(roll);
  return { height, pitch, roll };
}
