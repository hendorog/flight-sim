// Piper PA-34-200 Seneca I: mass and loadings, structural limits, the control system, the air-data calibration and
// the autopilot gains. Plain data.
//
// Figures from the type's engineering data sheet (aircraft-data/pa34.md in the design work folder; "s.N" is its
// section N), which takes them from the AFM (Piper VB-423), the owner's handbook, the weight-and-balance report
// VB-424 and TCDS A7SO. Positions are reference-point body axes (geometry.ts: pa34StationX, pa34HeightZ). What
// physics/controlSystem.ts reads is explained in aircraft/c172s/systems.ts; the Seneca differs in its stabilator
// with an anti-servo tab that is also the pitch trim, its hand-lever flaps, its cockpit rudder trim and its pedals
// linked to the nosewheel.

import { DEG, KT, LB } from '../../core/math';
import type { AirDataDef, AutopilotGains, ControlSystemDef, LimitsDef, MassDef, PayloadDef } from '../types';
import { PA34_GEOMETRY, pa34HeightZ, pa34StationX } from './geometry';
import { PA34_POWERPLANT } from './powerplant';

/** Knots per statute mph: the Seneca I manuals give every speed in mph. */
const MPH = 0.868976;

/**
 * Empty mass: a typical equipped Seneca I, 2850 lb at FS 84.9 with oil and unusable fuel (s.6 ESTIMATE; the DSU
 * aircraft weighed 2827 lb at 84.87 in). Its height: the mass build-up of geometry.ts (the reference point 0.42 m
 * above the data sheet's origin at the two-crew loading) with the crew and fuel taken out, 0.42 m too.
 */
const EMPTY = 2850 * LB;
const EMPTY_CG = { x: pa34StationX(84.9), y: 0, z: pa34HeightZ(0.42) };
const USABLE_FUEL = PA34_POWERPLANT.fuel.tanks.reduce((sum, t) => sum + t.capacity, 0);
const MAX_TAKEOFF = 4200 * LB;
/** Payload that brings a full-fuel aircraft to maximum take-off weight, kg (about 359: two crew and two in the middle row). */
const MAX_GROSS_PAYLOAD = MAX_TAKEOFF - EMPTY - USABLE_FUEL;
/** Occupants' height: seat cushions and torsos about 0.45 m above the data sheet's origin (s.2.5). */
const SEAT_Z = pa34HeightZ(0.45);
/** Front seats, arm 85.5 in (TCDS). */
const FRONT = { x: pa34StationX(85.5), y: 0, z: SEAT_Z };
/** Two crew of 77 kg (the s.6 training loading is two of 170 lb). */
const CREW = 154;
/**
 * The maxGross payload: the crew in front and the rest in the centre seats (arm 118.1 in): centroid FS 104.1. With
 * full fuel the aircraft is then at 4200 lb, FS 89.7 (26 % of the 87.9-94.6 in envelope).
 */
const GROSS_CENTROID = { x: pa34StationX((CREW * 85.5 + (MAX_GROSS_PAYLOAD - CREW) * 118.1) / MAX_GROSS_PAYLOAD), y: 0, z: SEAT_Z };

/** Full fuel, `payload` kg with its centroid at fuselage station `fs`. */
const atStation = (payload: number, fs: number): PayloadDef => ({ payload, payloadPosition: { x: pa34StationX(fs), y: 0, z: SEAT_Z } });

export const PA34_MASS: MassDef = {
  empty: EMPTY,
  maxTakeoff: MAX_TAKEOFF,
  // s.6: 4000 lb; all weight above it must be fuel (the sim permits a heavier landing: contract 5.4).
  maxLanding: 4000 * LB,
  // s.6: the sheet's Roskam estimate at 4200 lb with full fuel and cabin (6850 / 3680 / 10170 kg m^2; +/-20 %; roll
  // falls with fuel, the tanks are far out). Ixz small and positive (the fin above the roll axis): 100.
  inertia: { about: 'cg', Ixx: 6850, Iyy: 3680, Izz: 10170, Ixz: 100 },
  inertiaLoading: { payload: MAX_GROSS_PAYLOAD, payloadPosition: GROSS_CENTROID },
  emptyCg: EMPTY_CG,
  // Pilot eye point, left seat (geometry.ts).
  seatY: Math.abs(PA34_GEOMETRY.fuselage.pilotEye.y),
  loadings: {
    // s.6's training loading: two crew and 60 of the 93 usable gallons, 3550 lb at FS 85.8 (11.8 % MAC).
    typical: { payload: CREW, payloadPosition: FRONT, fuelFraction: 60 / 93 },
    // 4200 lb on the forward limit, FS 87.9 (TCDS): a notional payload centroid with full fuel (FS 94.7).
    forward: atStation(MAX_GROSS_PAYLOAD, 94.74),
    // 4200 lb on the aft limit, FS 94.6 (TCDS): a notional payload centroid with full fuel (FS 130.3, the centre
    // and rear seats).
    aft: atStation(MAX_GROSS_PAYLOAD, 130.3),
    // Full fuel, two crew and two in the centre seats: 4200 lb at FS 89.7.
    maxGross: { payload: MAX_GROSS_PAYLOAD, payloadPosition: GROSS_CENTROID },
  },
};

export const PA34_LIMITS: LimitsDef = {
  // Normal category (s.1): +3.8 g flaps up (AFM), +2.0 g with flaps (FAR 23, s.7 ESTIMATE); no negative figure is
  // published, so FAR 23.337's 0.4 x the positive. Ultimate 1.5 x.
  loadFactorPositive: 3.8,
  loadFactorNegative: -1.52,
  ultimateFactor: 1.5,
  loadFactorPositiveFlaps: 2.0,
  // Design dive speed from Vne <= 0.9 Vd: Vne is 217 mph CAS (s.7), m/s.
  diveSpeedCas: ((217 * MPH) / 0.9) * KT,
  structureTime: 0.03,
  // Clean, then flaps 10, 25 and 40 degrees: the handbook's 160 / 140 / 125 mph (s.7; only 125 is a limitation).
  vfeCas: [Infinity, 160 * MPH * KT, 140 * MPH * KT, 125 * MPH * KT],
  // Gear: 150 mph extended and extending, 125 mph retracting (s.3, s.7).
  vleCas: 150 * MPH * KT,
  vloExtendCas: 150 * MPH * KT,
  vloRetractCas: 125 * MPH * KT,
  // The HUD chip above Vfe and Vle / Vlo, as on the retractable test-bed; no structural consequence this round.
  flapOverspeed: { consequence: 'warn', margin: 0.03, time: 1 },
  gearOverspeed: { consequence: 'warn', margin: 0.03, time: 1 },
};

/**
 * Stabilator anti-servo tab gearing: the tab moves the same way as the stabilator, about 1.5 times as far (s.2.2,
 * s.9; the ratio is the sheet's ESTIMATE, low confidence).
 */
export const PA34_TAB_GEARING = 1.5;
/**
 * Pitch trim: the tab's offset (s.2.2, TCDS): 10.5 degrees trailing edge down (nose-up trim) and 6.5 up, with the
 * stabilator neutral. The surface floats at -offset / gearing, a little with the tail's angle of attack (pivot at
 * 26-30 % chord, near the aerodynamic centre).
 */
const PITCH_TRIM = { kind: 'antiServoTab', tabDown: 10.5 * DEG, tabUp: 6.5 * DEG, floatRatio: 1 / PA34_TAB_GEARING, gearing: PA34_TAB_GEARING } as const;
const FLAP_MAX = PA34_GEOMETRY.wing.flap.maxDeflection;
const RUDDER_TRAVEL = PA34_GEOMETRY.vTail.rudder.maxDeflection;

// The control system (physics/controlSystem.ts; the model as aircraft/c172s/systems.ts describes it):
//  - Stabilator: 12.5 degrees trailing edge up, 7.5 down (TCDS); its tab geared to it 1.5 : 1 is the trim.
//  - Rigging: none. The engines turn opposite ways, so there is no power yaw or roll to rig out: the ground-
//    adjustable rudder tab and the aileron rigging are zero (contract 5.4; the left / right equality rows hold by
//    construction only then).
//  - Rudder trim on the tunnel (s.9): a tab of 22 degrees to the right and 17 to the left (TCDS), "essential for
//    single-engine flight". `authority`: the rudder the tab holds at full trim, set so that the one-engine climb at
//    Vyse with the dead engine feathered trims to zero pedal force inside the travel (contract 5.4).
//  - Flaps: a floor lever between the front seats with a release button, 0 / 10 / 25 / 40 degrees (s.2.1).
//  - Steering: the pedals are linked to the nosewheel, 21 degrees each way (geometry.ts).
export const PA34_CONTROLS: ControlSystemDef = {
  elevator: {
    maxUp: PA34_GEOMETRY.hTail.elevator.maxUp,
    maxDown: PA34_GEOMETRY.hTail.elevator.maxDown,
    // Small: the pivot is near the stabilator's aerodynamic centre (contract 3.4, the stabilator test-bed's 0.15).
    alphaFloat: 0.15,
    floatAlphaLimit: 14 * DEG,
    floatQHalf: 30,
  },
  aileron: { maxUp: PA34_GEOMETRY.wing.aileron.maxUp, maxDown: PA34_GEOMETRY.wing.aileron.maxDown, rigging: 0 },
  rudder: {
    maxDeflection: RUDDER_TRAVEL,
    tabOffset: 0,
    alphaFloat: 0.5,
    floatLimit: 15 * DEG,
    trim: { authority: 16 * DEG, tabDeflection: 22 * DEG, tabDeflectionLeft: 17 * DEG, rate: 0.2 },
  },
  pitchTrim: PITCH_TRIM,
  trimRate: 20 * DEG,
  flaps: {
    maxDeflection: FLAP_MAX,
    detents: [0, 10 * DEG, 25 * DEG, FLAP_MAX],
    // A pull of about a second and a half from up to full.
    drive: { kind: 'manual', rate: 25 * DEG },
  },
  // Cables throughout (s.9): the 172's stretch.
  stretchQ: { elevator: 50e3, aileron: 40e3, rudder: 30e3 },
  surfaceRate: 150 * DEG,
  // The nose load at the design loading is about 4.2 kN (23 % of the weight, gear.ts).
  steering: { kind: 'direct', restraintQ: 1500, refLoad: 4200 },
};

/** Knots of an mph row. */
const kt = (mph: readonly number[]) => mph.map((v) => v * MPH);

// Static-source position error (s.7, OH-6), mph: flaps up the indicator reads about 2 mph low below 140 mph (70 IAS
// = 72 CAS, 100 = 102, 140 = 142, 180 = 181, 200 = 200) and the clean stall is 76 CAS at about 74 IAS (s.8); flaps
// 40 it reads true at 70-80 mph and 1-2 mph high above 90 (100 IAS = 99 CAS, 120 = 118; the landing stall 69 = 69).
// Between rows the error is interpolated in flap degrees; below the stall each row carries on at its last slope
// (physics/airData.ts).
export const PA34_AIR_DATA: AirDataDef = {
  calibration: [
    { flapDeg: 0, cas: kt([72, 76, 102, 142, 181, 200, 217]), ias: kt([70, 74, 100, 140, 180, 200, 217]) },
    { flapDeg: 40, cas: kt([69, 80, 89, 99, 118]), ias: kt([69, 80, 90, 100, 120]) },
  ],
  referenceMass: MAX_TAKEOFF,
  asiAliveKt: [18, 35],
};

// Autopilot gains (physics/autopilot.ts; drive the scripted pilot and the hold keys; the optional Piper AltiMatic
// is not modelled). The 172's scaled by control power over inertia (contract 3.4): the stabilator's pitch power per
// unit Iyy is about 0.9 of the 172's elevator's (an all-moving surface of 3.6 m^2 on a 4.85 m arm against Iyy 3680),
// the narrow Frise ailerons' per unit Ixx about half ("heavy ailerons, slow roll response", s.11), so the roll gains
// are raised; then tuned on the flown checks. The yaw damper: the rudder's power per unit Izz is about the 172's.
// The rudder integrator may reach full travel, so the hold keys can hold an engine out (contract 5.4).
export const PA34_AUTOPILOT: AutopilotGains = {
  // About 100 KTAS at sea level, Pa.
  qRef: 1600,
  pitchKp: 2.2,
  pitchKi: 0.6,
  pitchKq: 0.9,
  rollKp: 2.4,
  rollKd: 0.5,
  rollKi: 0.2,
  headingK: 1.2,
  altitudeK: 0.12,
  vsKp: 0.02,
  vsKi: 0.008,
  speedKp: 0.03,
  speedKi: 0.006,
  throttleKp: 0.12,
  throttleKi: 0.03,
  ballKp: 0.6,
  ballKi: 0.5,
  yawKr: 0.8,
  rudderLimit: 1.0,
  trimRate: 0.08,
  pitchLimit: 20 * DEG,
  // Yoke travel equivalent to one unit of trim wheel: the nose-up float over the nose-up stabilator travel.
  trimEquivalence: (PITCH_TRIM.floatRatio * PITCH_TRIM.tabDown) / PA34_GEOMETRY.hTail.elevator.maxUp,
  // Settings: 105 KIAS, 500 ft/min, bank limit 25 deg.
  defaults: { airspeed: 54, verticalSpeed: 2.5, maxBank: 25 * DEG },
};
