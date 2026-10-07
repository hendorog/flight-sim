// Diamond DA20-C1: mass and loadings, structural limits, the control system, the air-data calibration and the
// autopilot gains. Plain data.
//
// Figures from the type's engineering data sheet (aircraft-data/da20.md in the design work folder; "s.N" is its
// section N), which takes them from the flight manual DA202-C1 Rev 29 (AFM), the EASA TCDS and the maintenance
// manual. Positions are reference-point body axes (geometry.ts): da20DatumX(arm) for a handbook arm aft of the
// datum RD, da20FrlZ(up) for a height above the fuselage reference line FRL. What physics/controlSystem.ts reads
// is explained in aircraft/c172s/systems.ts; the DA20 differs in its trim (a spring, no tab), its stick and
// push-rod controls and its free-castering nosewheel.

import { DEG, KT } from '../../core/math';
import type { AirDataDef, AutopilotGains, ControlSystemDef, LimitsDef, MassDef, PayloadDef } from '../types';
import { DA20_GEOMETRY, da20DatumX, da20FrlZ } from './geometry';
import { DA20_POWERPLANT } from './powerplant';

const G = DA20_GEOMETRY;

/**
 * Empty mass: the standard equipped aircraft, 535 kg (s.6: brochure; the AFM's worked example is 523 kg, school
 * aircraft 540-560), at the AFM example's arm, 0.277 m aft of RD, with unusable fuel and full oil. Its height is
 * set so that the maximum-weight loading below balances at the reference point's height (the sheet's estimate
 * of the vertical CG, 0.07 m below FRL): the engine and the T-tail are high, the pilots sit low.
 */
const EMPTY = 535;
const EMPTY_ARM = 0.277;
const USABLE_FUEL = DA20_POWERPLANT.fuel.tanks.reduce((sum, t) => sum + t.capacity, 0);
const TANK = DA20_POWERPLANT.fuel.tanks[0].position;
const MAX_TAKEOFF = 800;
/** Payload that brings a full-fuel aircraft to maximum take-off mass, kg (about 200: two 100 kg occupants). */
const MAX_GROSS_PAYLOAD = MAX_TAKEOFF - EMPTY - USABLE_FUEL;
/**
 * The two seats: the occupants' arm 0.143 m aft of RD (AFM fig 6.5; s.6); reclined in fixed shells on the cabin
 * floor, their centre of gravity about 0.08 m below FRL (ESTIMATE from the sill and seat heights of s.12).
 */
const SEATS = { x: da20DatumX(0.143), y: 0, z: da20FrlZ(-0.08) };
/** Two 80 kg occupants (the sheet's typical training loading, s.6). */
const CREW = 160;
/** Height of the empty aircraft's centre of gravity that puts the maximum-weight loading at the reference height. */
const EMPTY_Z = -(USABLE_FUEL * TANK.z + MAX_GROSS_PAYLOAD * SEATS.z) / EMPTY;
const EMPTY_CG = { x: da20DatumX(EMPTY_ARM), y: 0, z: EMPTY_Z };

/**
 * The maximum-weight payload placed so that the centre of gravity, with full fuel, is `arm` metres aft of RD
 * (at the seats' height). The AFM's forward limit at 800 kg cannot be reached with real occupants and full fuel
 * (two 100 kg pilots put it at 0.288 m): its stall speeds were flown ballasted, so the forward and aft loadings
 * are notional payload centroids that put the CG on the limits.
 */
function atLimit(arm: number): PayloadDef {
  const moment = MAX_TAKEOFF * da20DatumX(arm) - EMPTY * EMPTY_CG.x - USABLE_FUEL * TANK.x;
  return { payload: MAX_GROSS_PAYLOAD, payloadPosition: { x: moment / MAX_GROSS_PAYLOAD, y: 0, z: SEATS.z } };
}

export const DA20_MASS: MassDef = {
  empty: EMPTY,
  maxTakeoff: MAX_TAKEOFF,
  maxLanding: MAX_TAKEOFF,
  // s.6, the sheet's picks at 800 kg: Roskam's single-engine class corrected for a light composite wing that
  // carries no fuel (Rx 0.216, Ry 0.365, Rz 0.383), +/-20 %; Ixz from the high, aft T-tail, +/-80. About the
  // CG of the maximum-weight loading.
  inertia: { about: 'cg', Ixx: 1100, Iyy: 1400, Izz: 2400, Ixz: 100 },
  inertiaLoading: { payload: MAX_GROSS_PAYLOAD, payloadPosition: SEATS },
  emptyCg: EMPTY_CG,
  // Pilot eye point, left seat (geometry.ts).
  seatY: Math.abs(G.fuselage.pilotEye.y),
  loadings: {
    // Two 80 kg occupants and full fuel: 760.5 kg, CG 0.296 m aft of RD, 25 % MAC (s.6's typical training loading).
    typical: { payload: CREW, payloadPosition: SEATS },
    // 800 kg on the forward limit, 0.205 m aft of RD (AFM 2.8; s.6), where AFM 5.3.4 gives its stall speeds.
    forward: atLimit(0.205),
    // 800 kg on the aft limit, 0.309 m aft of RD (AFM 2.8; s.6).
    aft: atLimit(0.309),
    // Two 100 kg occupants and full fuel: 800 kg at 0.288 m aft of RD.
    maxGross: { payload: MAX_GROSS_PAYLOAD, payloadPosition: SEATS },
  },
};

export const DA20_LIMITS: LimitsDef = {
  // Utility category (AFM 2.10; TCDS): +4.4 / -2.2 g flaps up, +2.0 / 0 g with flaps T/O or LDG; ultimate 1.5 x.
  // The flaps-down negative limit of 0 g is not written: the structure fails at limit x ultimateFactor, and 1.5 x 0
  // would break the wing at the first negative load with flap out (a brake check on the roll-out does it); the
  // flaps-up figure stands.
  loadFactorPositive: 4.4,
  loadFactorNegative: -2.2,
  ultimateFactor: 1.5,
  loadFactorPositiveFlaps: 2.0,
  // Design dive speed from Vne <= 0.9 Vd, Vne 159 KCAS (AFM 5.3.1), m/s.
  diveSpeedCas: (159 / 0.9) * KT,
  structureTime: 0.03,
  // Clean, then flaps T/O (100 KIAS) and LDG (78 KIAS) (AFM 2.2), as CAS by AFM 5.3.1: 101 and 81 KCAS.
  vfeCas: [Infinity, 101 * KT, 81 * KT],
  flapOverspeed: { consequence: 'none', margin: 0, time: 0 },
  gearOverspeed: { consequence: 'none', margin: 0, time: 0 },
};

/**
 * Electric spring trim (AFM 7.3.1; s.9): an actuator in the fin loads compression springs on the elevator
 * push-rod; there is no tab. Full nose-up trim would hold the elevator `springUp` trailing edge up with no air
 * load, full nose-down `springDown` down; the spring's moment equals the air's hinge moment at `springQ` (the
 * elevator's hinge-moment stiffness against the spring's, ESTIMATE). The travel covers the trimmed elevator from
 * Vx with flaps LDG to Vne at both CG limits (calibrated on the trim block); take-off trim is NEUTRAL.
 */
const PITCH_TRIM = { kind: 'spring', springUp: -20 * DEG, springDown: 10 * DEG, springQ: 2500 } as const;
// With these the trim holds the maximum-weight aircraft hands-off at 60 KTAS with flaps T/O at +0.24 and at Vno at
// -0.37, NEUTRAL at about 92 KTAS; the forward limit with flaps LDG at 52 KTAS takes +0.84, the aft limit at 165 KTAS
// -0.90.
const FLAP_MAX = G.wing.flap.maxDeflection;

// The control system (physics/controlSystem.ts; the model as aircraft/c172s/systems.ts describes it):
//  - Elevator: 0.26-chord, mass-balanced, without a tab, on a T-tail (s.2.4): the plain elevator's float,
//    -Ch_alpha / Ch_delta about 0.45 as on the Cessnas (no aerodynamic balance either), up to the tailplane's stall.
//  - Push rods to the elevator and the ailerons, cables to the rudder (AFM 7.3; s.9): the push rods stretch less.
//  - Rigging. The ground-adjustable rudder tab (s.2.5) is bent so the ball is centred with the feet off in
//    full-throttle level flight at sea level, the top of the cruise range; the left aileron's fixed tab rigs the
//    wings level there (`rigging`).
//  - Flaps: an electric actuator, three positions, CRUISE / T/O / LDG = 0 / 15 / 45 degrees (AFM 7.3.3); about
//    6 s from CRUISE to LDG (s.9: 5-8 s, ESTIMATE), working while the 14 V bus is above 10 V.
//  - The nosewheel casters freely (AFM 7.5): the pedals move the rudder only.
export const DA20_CONTROLS: ControlSystemDef = {
  elevator: {
    maxUp: G.hTail.elevator.maxUp,
    maxDown: G.hTail.elevator.maxDown,
    alphaFloat: 0.45,
    floatAlphaLimit: 14 * DEG,
    floatQHalf: 30,
  },
  aileron: { maxUp: G.wing.aileron.maxUp, maxDown: G.wing.aileron.maxDown, rigging: 0 },
  rudder: {
    maxDeflection: G.vTail.rudder.maxDeflection,
    // The tab's rudder deflection (+ = trailing edge left): the ball centred with the feet off in level flight at
    // the 2800 rpm red line at sea level, about 128 KTAS (above). Re-rigged from -2.3 deg when the fin's share of the
    // slipstream's swirl was reduced (aero.ts SWIRL_BEHIND_WING, DECISIONS-D2).
    tabOffset: -0.8 * DEG,
    alphaFloat: 0.5,
    floatLimit: 15 * DEG,
  },
  pitchTrim: PITCH_TRIM,
  // The spring datum's actuator: about 8 s from NEUTRAL to full nose-up (s.9: "coarse, several blips").
  trimRate: 2 * DEG,
  trimDrive: { kind: 'electric', minVolts: 10 },
  flaps: {
    maxDeflection: FLAP_MAX,
    // CRUISE, T/O and LDG, written so that detents[i] / maxDeflection is exactly the lever value (0, 1/3, 1).
    detents: [0, (1 / 3) * FLAP_MAX, FLAP_MAX],
    drive: { kind: 'electric', rate: 7.5 * DEG, minVolts: 10 },
  },
  stretchQ: { elevator: 80e3, aileron: 60e3, rudder: 30e3 },
  surfaceRate: 150 * DEG,
  steering: { kind: 'castering' },
};

// Static-source position error: the AFM airspeed calibration (5.3.1, flaps CRUISE, KIAS -> KCAS) at 800 kg. The
// AFM gives no rows for flaps T/O and LDG: their bottom points are the stall table's (AFM 5.3.4: 40 KIAS = 50 KCAS
// with T/O, 36 = 45 with LDG), above it the clean row's error at the same angle of attack (the error is a function
// of the lift coefficient, physics/airData.ts). The probe under the left wing under-reads by 8-10 kt at the stall.
export const DA20_AIR_DATA: AirDataDef = {
  calibration: [
    { flapDeg: 0, cas: [54, 58, 66, 75, 83, 92, 101, 110, 120, 138, 159], ias: [44, 50, 60, 70, 80, 90, 100, 110, 120, 140, 164] },
    { flapDeg: 15, cas: [50, 58, 66, 75, 83, 92, 101], ias: [40, 50, 60, 70, 80, 90, 100] },
    { flapDeg: 45, cas: [45, 58, 66, 75, 81], ias: [36, 50, 60, 70, 78] },
  ],
  referenceMass: MAX_TAKEOFF,
  asiAliveKt: [18, 30],
};

// Autopilot gains (physics/autopilot.ts; the DA20 has none of its own as standard, these drive the scripted pilot
// and the hold keys). The 172's scaled by control power over inertia (contract 3.4): the T-tail's elevator power
// per unit Iyy is about that of the 172 and its aileron power per unit Ixx about 0.8 of it, then tuned on the
// flown checks. The spring trim's equivalence is its datum per unit trim at the reference dynamic pressure, where
// the spring carries half of it.
export const DA20_AUTOPILOT: AutopilotGains = {
  // About 85 KTAS at sea level, Pa.
  qRef: 1150,
  pitchKp: 2.0,
  pitchKi: 0.55,
  pitchKq: 0.8,
  rollKp: 1.6,
  rollKd: 0.35,
  rollKi: 0.15,
  headingK: 1.2,
  altitudeK: 0.12,
  vsKp: 0.02,
  vsKi: 0.008,
  // Gentler than the 172's 0.03: the DA20 lifts off 16 kt below its climb speed and its elevator power per unit
  // dynamic pressure is high, so the 172's gain pushed it 20 degrees nose-down at the hand-over.
  speedKp: 0.02,
  speedKi: 0.006,
  throttleKp: 0.12,
  throttleKi: 0.03,
  ballKp: 0.6,
  ballKi: 0.5,
  yawKr: 0.8,
  rudderLimit: 0.6,
  trimRate: 0.08,
  pitchLimit: 20 * DEG,
  trimEquivalence: Math.abs(PITCH_TRIM.springUp) / (1 + 1150 / PITCH_TRIM.springQ) / G.hTail.elevator.maxUp,
  // Settings: 90 KIAS, 500 ft/min, bank limit 25 deg.
  defaults: { airspeed: 46, verticalSpeed: 2.5, maxBank: 25 * DEG },
};

