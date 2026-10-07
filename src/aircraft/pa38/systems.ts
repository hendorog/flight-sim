// Piper PA-38-112 Tomahawk II: mass and loadings, structural limits, the control system, the air-data calibration
// and the autopilot gains. Plain data.
//
// Figures from the type's engineering data sheet (aircraft-data/pa38.md in the design work folder; "s.N" is its
// section N), which takes them from the POH (Piper report VB-2126), the maintenance manual 761-660 and TCDS A18SO.
// Positions are reference-point body axes (geometry.ts): x = (77.25 - STA) x 0.0254 m, z = (36.5 - WL) x 0.0254 m.
// What physics/controlSystem.ts reads is explained in aircraft/c172s/systems.ts; the Tomahawk differs in its spring
// trim, its hand-lever flaps and its pedals linked straight to the nosewheel.

import { DEG, KT, LB } from '../../core/math';
import type { AirDataDef, AutopilotGains, ControlSystemDef, LimitsDef, MassDef, PayloadDef } from '../types';
import { PA38_GEOMETRY } from './geometry';
import { PA38_POWERPLANT } from './powerplant';

/** Metres per inch. */
const IN = 0.0254;
/** Body x of a fuselage station (inches aft of the Piper datum), m. */
const sta = (station: number) => (77.25 - station) * IN;
/** Body z of a water line (inches), m. */
const wl = (waterLine: number) => (36.5 - waterLine) * IN;

/**
 * Empty mass: the POH sample aeroplane, 1169 lb at STA 73.2 (s.6, POH fig 6-11: basic empty with unusable fuel and
 * full oil; the bare standard empty weight is 1128 lb). Its height is the one geometry.ts's build-up implies with
 * the crew and fuel taken out (WL 36.7).
 */
const EMPTY = 1169 * LB;
const EMPTY_CG = { x: sta(73.2), y: 0, z: wl(36.7) };
const USABLE_FUEL = PA38_POWERPLANT.fuel.tanks.reduce((sum, t) => sum + t.capacity, 0);
const MAX_TAKEOFF = 1670 * LB;
/**
 * Payload that brings a full-fuel aircraft to maximum take-off weight, kg (about 146: two light adults, no bags).
 * Full tanks and two 170 lb adults are 19 lb over gross (s.6).
 */
const MAX_GROSS_PAYLOAD = MAX_TAKEOFF - EMPTY - USABLE_FUEL;
/** The two seats, STA 85.5 (notch 4 of 1-6, STA 80.8-89.5; POH fig 6-14), occupant CG about WL 40. */
const SEATS = { x: sta(85.5), y: 0, z: wl(40) };
/** Two occupants of 77 kg (the C152's training loading; the sheet's is two of 170 lb). */
const CREW = 154;

/** Crew of `payload` kg in the seats. */
const seated = (payload: number, fuelFraction?: number): PayloadDef => ({ payload, payloadPosition: SEATS, ...(fuelFraction !== undefined ? { fuelFraction } : {}) });

export const PA38_MASS: MassDef = {
  empty: EMPTY,
  maxTakeoff: MAX_TAKEOFF,
  maxLanding: MAX_TAKEOFF,
  // s.6: the sheet's Roskam estimate (1271 / 1364 / 2187 kg m^2) and its verifier's bands (Ixx 1020-1270, Iyy
  // 1150-1420, Izz 1900-2300: the radii of a real light aircraft run below the class values, the T-tail and the
  // long tail arm push Iyy and Izz up): the middle of the bands, +/-20 %. Ixz: the T-tail's mass high and aft makes
  // it positive (sheet: about +55). Taken about the CG of the maximum-weight loading.
  inertia: { about: 'cg', Ixx: 1150, Iyy: 1300, Izz: 2100, Ixz: 55 },
  inertiaLoading: seated(MAX_GROSS_PAYLOAD),
  emptyCg: EMPTY_CG,
  // Pilot eye point, left seat (geometry.ts).
  seatY: Math.abs(PA38_GEOMETRY.fuselage.pilotEye.y),
  loadings: {
    // Two 77 kg occupants and 20 of the 30 usable gallons: 739 kg, CG STA 75.9 (s.6's typical training loading).
    typical: seated(CREW, 2 / 3),
    // Maximum weight with the CG on the forward limit, STA 73.5 at 1670 lb (s.6). A notional payload centroid
    // (STA 73.5): with this empty CG no cabin loading reaches the forward limit (the seats start at STA 80.8).
    forward: { payload: MAX_GROSS_PAYLOAD, payloadPosition: { x: sta(73.5), y: 0, z: SEATS.z } },
    // Maximum weight with the CG on the aft limit, STA 78.5 (s.6). A notional payload centroid (STA 99.5, between
    // the seats and the baggage shelf at STA 115).
    aft: { payload: MAX_GROSS_PAYLOAD, payloadPosition: { x: sta(99.5), y: 0, z: wl(42) } },
    // Full fuel and the crew the gross weight leaves: 1670 lb at STA 75.8 (21.7 % MAC).
    maxGross: seated(MAX_GROSS_PAYLOAD),
  },
};

export const PA38_LIMITS: LimitsDef = {
  // Utility category, the same weight and CG limits as the Normal (POH sect. 2, s.7): +4.4 g flaps up (Normal
  // +3.8), +2.0 g flaps down; no negative figure is published, so FAR 23.337's 0.4 x the positive. Ultimate 1.5 x.
  loadFactorPositive: 4.4,
  loadFactorNegative: -1.76,
  ultimateFactor: 1.5,
  loadFactorPositiveFlaps: 2.0,
  // Design dive speed from Vne <= 0.9 Vd: Vne is 143 KCAS (138 KIAS, s.7), m/s.
  diveSpeedCas: (143 / 0.9) * KT,
  structureTime: 0.03,
  // Clean, then flaps 21 and 34 degrees: 87 KCAS (89 KIAS) at either setting (POH 2.3, s.7).
  vfeCas: [Infinity, 87 * KT, 87 * KT],
  flapOverspeed: { consequence: 'none', margin: 0, time: 0 },
  gearOverspeed: { consequence: 'none', margin: 0, time: 0 },
};

/**
 * Spring (bungee) trim, no tab (POH 7.9, s.2.4): the wheel between the seats moves the anchor of a spring in the
 * elevator circuit. The spring is soft against the elevator's hinge moment at flying speeds, so it acts as a bias
 * force: hands-off the elevator floats where spring and air balance, and the trimmed speed drifts with power and
 * configuration more than on a tab aircraft ("the spring trim needs frequent re-trimming", s.11). springQ: the
 * dynamic pressure at which the spring's stiffness equals the air's, about 60 KIAS. The datums: at either end of the
 * wheel the unloaded spring pulls the elevator to its stop (32 up, 20 down). With the tailplane's incidence
 * (geometry.ts) that puts the take-off trim of the typical loading (Vy, full power) at about a third of the nose-up
 * travel, "slightly aft of neutral" (POH 4.5, s.10), the cruise near neutral, and the forward-limit approach with full
 * flap and the aft-limit dive at Vne inside the travel.
 */
const PITCH_TRIM = { kind: 'spring', springUp: -PA38_GEOMETRY.hTail.elevator.maxUp, springDown: PA38_GEOMETRY.hTail.elevator.maxDown, springQ: 700 } as const;
const FLAP_MAX = PA38_GEOMETRY.wing.flap.maxDeflection;

// The control system (physics/controlSystem.ts; the model as aircraft/c172s/systems.ts describes it):
//  - Elevator: 0.44-chord plain elevator on the T-tail, mass-balanced (s.2.4); the 172's float law, -Ch_alpha /
//    Ch_delta about 0.45.
//  - Rigging. The ground-adjustable rudder tab (s.2.5) is bent so the ball is centred with the feet off in
//    full-throttle level flight at sea level, the top of the cruise range; slower, the slipstream asks for right
//    pedal. The wings are rigged to fly level hands-off there.
//  - Flaps: a hand lever between the seats with a ratchet, 0 / 21 / 34 degrees (POH 7.9): a pull of about a second.
//  - Steering: the pedals are linked straight to the nosewheel, 30 degrees each way (POH 7.7): the rudder is held by
//    the loaded nosewheel more firmly than through the Cessnas' bungee.
export const PA38_CONTROLS: ControlSystemDef = {
  elevator: {
    maxUp: PA38_GEOMETRY.hTail.elevator.maxUp,
    maxDown: PA38_GEOMETRY.hTail.elevator.maxDown,
    alphaFloat: 0.45,
    floatAlphaLimit: 14 * DEG,
    floatQHalf: 30,
  },
  aileron: { maxUp: PA38_GEOMETRY.wing.aileron.maxUp, maxDown: PA38_GEOMETRY.wing.aileron.maxDown, rigging: 0 },
  rudder: {
    maxDeflection: PA38_GEOMETRY.vTail.rudder.maxDeflection,
    // The tab's rudder deflection (+ = trailing edge left): the ball centred in full-throttle level flight (above).
    tabOffset: -1.0 * DEG,
    alphaFloat: 0.5,
    floatLimit: 15 * DEG,
  },
  pitchTrim: PITCH_TRIM,
  // The spring datum follows the wheel directly; nominal rate of the datum.
  trimRate: 20 * DEG,
  flaps: {
    maxDeflection: FLAP_MAX,
    // 0, 21 and 34 degrees: the lever's two notches (POH 7.9; 21 +/-2, 34 +/-2, MM 27-50-00).
    detents: [0, 21 * DEG, FLAP_MAX],
    drive: { kind: 'manual', rate: 30 * DEG },
  },
  // Cables to the ailerons, elevator and rudder (POH 7.9): the 172's stretch.
  stretchQ: { elevator: 50e3, aileron: 40e3, rudder: 30e3 },
  surfaceRate: 150 * DEG,
  // The nose load at the design loading is about 1.9 kN (s.3: 25 % of the weight).
  steering: { kind: 'direct', restraintQ: 1500, refLoad: 1900 },
};

// Static-source position error: POH fig 5-1a (s.7, s.8, read by the sheet's verifier at 300 dpi; knots), flaps up
// and flaps 34 degrees, flown at maximum weight. The handbook pairs: stalls 52 / 49 KIAS = 54.3 / 52.0 KCAS (and
// the outboard-strips-only 48 / 47 = 50.9 / 48.9, the same angle of attack band), Va 103 = 101, 90 = 88, Vno
// 110 = 108, Vne 138 = 143, Vfe 89 = 87 (POH 2.3). The error changes sign above Vno, as the handbook prints it;
// between the printed pairs the error is interpolated. The error is a function of the angle of attack
// (physics/airData.ts): below the stall pairs each row is carried on at the slope of its last two points.
export const PA38_AIR_DATA: AirDataDef = {
  calibration: [
    { flapDeg: 0, cas: [47.5, 50.9, 54.3, 61.4, 70.3, 79.1, 88, 101, 108, 119.5, 143], ias: [44, 48, 52, 60, 70, 80, 90, 103, 110, 120, 138] },
    { flapDeg: 34, cas: [45.8, 48.9, 52.0, 61.6, 70.4, 79.1, 87], ias: [45, 47, 49, 60, 70, 80, 89] },
  ],
  referenceMass: MAX_TAKEOFF,
  asiAliveKt: [18, 35],
};

// Autopilot gains (physics/autopilot.ts; the Tomahawk has none, these drive the scripted pilot and the hold keys).
// The 172's scaled by control power over inertia (contract 3.4): the T-tail's elevator power per unit Iyy is about
// the 172's (tail volume 0.69, a 0.44-chord elevator, Iyy about the same), the ailerons' per unit Ixx somewhat
// less (narrow plain ailerons on a heavier wing); then tuned on the flown checks.
export const PA38_AUTOPILOT: AutopilotGains = {
  // About 90 KTAS at sea level, Pa.
  qRef: 1300,
  pitchKp: 2.0,
  pitchKi: 0.55,
  pitchKq: 0.85,
  rollKp: 1.6,
  rollKd: 0.35,
  rollKi: 0.15,
  headingK: 1.2,
  altitudeK: 0.12,
  vsKp: 0.02,
  vsKi: 0.008,
  speedKp: 0.03,
  speedKi: 0.006,
  throttleKp: 0.12,
  throttleKi: 0.03,
  // The yaw damper: the 172's gains at 0.4, the inverse of the rudder's power. The big rudder gives 2.6 times the
  // 172's sideslip per unit of pedal (dutch-roll doublet at 90 KIAS); the 172's own gains limit-cycle it from stop
  // to stop, and the boundary lies between 0.65 and 0.8 of them.
  ballKp: 0.24,
  ballKi: 0.2,
  yawKr: 0.32,
  rudderLimit: 0.6,
  trimRate: 0.08,
  pitchLimit: 20 * DEG,
  // Yoke travel equivalent to one unit of trim wheel: the spring datum's hands-off elevator at qRef over the
  // elevator's nose-up travel.
  trimEquivalence: Math.abs(PITCH_TRIM.springUp) / (1 + 1300 / PITCH_TRIM.springQ) / PA38_GEOMETRY.hTail.elevator.maxUp,
  // Settings: 80 KIAS, 500 ft/min, bank limit 25 deg.
  defaults: { airspeed: 41, verticalSpeed: 2.5, maxBank: 25 * DEG },
};
