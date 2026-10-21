// Lockheed AH-56A Cheyenne (AMCS default, 1973 ship 7, 66-8832; ICS 1972 configuration selectable at runtime with
// config=ics): the aircraft definition. Owner: AG (stage 2). Node-safe assembly; every number lives in a file of this
// directory (dimensions, facts, reference, base/gyro through the frozen rotorcraft.ts assembly, powerplant, mass,
// limits, gear, input, sim). Ships available:false (the catalogue row): AGENT choice until the owner approves.
//
// Stage 2 is the pure helicopter with the control gyro, the T64 and the wheels: the wing and the pusher (AC, stages 3-4)
// and the high-advance-ratio aerodynamics (AH, stage 5) follow. The fixed-wing compatibility fields every
// AircraftDefinition carries (aero(), controls, autopilot) are the MD 500E's (the C152's): the rotorcraft runtime
// bypasses them; gear() is the AH-56A's own wheel gear (landingGear 'wheels').
import { KT } from '../../core/math';
import type { AircraftDefinition } from '../types';
import { MD500_DEFINITION as md } from '../md500';
import { AH56_ROTORCRAFT as rotor } from './rotorcraft';
import { AH56_POWERPLANT } from './powerplant';
import { AH56_INPUT } from './input';
import { AH56_SIM } from './sim';
import { AH56_MASS } from './mass';
import { AH56_REST_CONTACTS, ah56Gear } from './gear';
import { AH56_REFERENCE as V } from './reference';
import * as D from './dimensions';

export const AH56_DEFINITION: AircraftDefinition = {
  ...md,
  id: 'ah56',
  name: 'Lockheed AH-56A Cheyenne',
  shortName: 'AH-56A',
  variant: 'AH-56A AMCS (ship 7, 66-8832, T64-GE-716); ICS 1972 configuration selectable',
  icaoType: 'ZZZZ',
  engineCount: 1,
  rotorcraft: rotor, powerplant: AH56_POWERPLANT, input: AH56_INPUT, sim: AH56_SIM, mass: AH56_MASS, gear: ah56Gear,
  // A turbine starts with the igniters off; the condition grip OFF; the gear down; no clutch or governor switch.
  controlDefaults: { ...md.controlDefaults, gearLever: 'down', tailWheelLock: true },
  notModelled: [
    'The half-P hop is a scripted event (a 0.5P roll and plunge forcing triggered by cyclic stirring in the ICS), not emergent from blade lag and plunge dynamics; one blade section serves the whole span (the tip\'s Mach terms), and dynamic stall is only its moment break.',
    'Control gyro: precession only (no nutation); the gyro\'s gimbal and spring reactions on the airframe are neglected (its spin momentum is in the gyroscopic moments). The AMCS gyro\'s momentum, springs and flapping-feedback gain are estimates fitted to the measured responses.',
    'The pusher propeller\'s slipstream (reverse thrust included) reaches no surface (fin, tail rotor); the propeller is the generic blade-element model, not a Hamilton Standard performance map.',
    'Per-blade flap and lag transients (the in-plane modes behind the half-P hop and the 1P x 2P instability), the blade torsion and the feathering inertia.',
    'Weapons, the turrets\' motion and the directional trim switch; the APU (the engine start is the generic starter).',
    'Inertias, the flap frequency, the gear and the gas-generator speed are estimates; see KNOWN_ISSUES.md.',
  ],
  geometry: { ...md.geometry,
    wing: { ...md.geometry.wing, span: 2 * D.MAIN_ROTOR_RADIUS, area: Math.PI * D.MAIN_ROTOR_RADIUS ** 2 },
    fuselage: { length: D.FUSELAGE_LENGTH, noseX: D.NOSE_X, tailX: D.x(D.NOSE_FS + 656),
      maxWidth: 1.3, maxHeight: D.HEIGHT - 0.5, pilotEye: D.PILOT_EYE },
    // The rest contacts (wheelRestingPose); gear() holds the extended ones. The tail wheel in the "nose" slot.
    gear: { ...md.geometry.gear, nose: { ...AH56_REST_CONTACTS.tail }, leftMain: { ...AH56_REST_CONTACTS.left },
      rightMain: { ...AH56_REST_CONTACTS.right }, noseWheelRadius: D.TAIL_TYRE_RADIUS, mainWheelRadius: D.MAIN_TYRE_RADIUS,
      maxNoseSteer: 0, retractable: true },
    propellers: [{ hub: rotor.main.hub, diameter: 2 * rotor.main.radius, blades: rotor.main.blades, rotation: rotor.rotation }],
    restHeight: D.GROUND_Z,
    bounds: { radius: rotor.main.radius + 6, fitSize: 2 * (rotor.main.radius + 6) } },
  // Legacy wing/control fields are compatibility metadata. Gear: 130 KCAS extended and in operation (P).
  limits: { ...md.limits, diveSpeedCas: V.diveKt * KT, vfeCas: [Infinity], vleCas: V.gearKcas * KT,
    vloExtendCas: V.gearKcas * KT, vloRetractCas: V.gearKcas * KT, gearOverspeed: { consequence: 'warn', margin: 0, time: 1 } },
  controls: { ...md.controls, steering: { kind: 'castering' } },
  airData: { calibration: [], referenceMass: AH56_MASS.maxTakeoff, asiAliveKt: [0, 20] },
  reference: { ...md.reference, vy: 80, vx: 60, vglide: 90, vno: V.vne, vne: V.vne, vapp: 60, vcruise: 120, vdownwind: 80,
    vle: V.gearKcas, vloExtend: V.gearKcas, vloRetract: V.gearKcas, glideRatio: 3.5 },
};

export default AH56_DEFINITION;
