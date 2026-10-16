// Pilatus PC-12/47: mass and loadings, structural limits, the control system (with the trimmed stabiliser, the
// aileron-rudder interconnect and the stick shaker / pusher), the air-data calibration and the autopilot gains.
// Plain data.
//
// Tags (docs/pc12-sources.md): TCDS = EASA A.089 sect. C; 47E-PROXY = PC-12/47E POH 02277 (same airframe family);
// PHOTO = /47 panel placards; DERIVED = arithmetic shown; ESTIMATE = no source. Positions are reference-point body
// axes (geometry.ts: x = 6.00 - station, the reference point at the MAC quarter-chord, ESTIMATE station 6.00).

import { DEG, KT } from '../../core/math';
import type { StickPusherDef } from '../../physics/aero/stickPusher';
import { STABILIZER_EQUIVALENCE } from '../../physics/controlSystem';
import type { AirDataDef, AutopilotGains, ControlSystemDef, LimitsDef, MassDef, PayloadDef } from '../types';
import { PC12_OVERSPEED } from './facts';
import { PC12_EYE, PC12_GEOMETRY, PC12_MAC } from './geometry';
import { PC12_POWERPLANT, PC12_PSI_PER_PT_NM } from './powerplant';

/** Body x of a station, m aft of the datum (TCDS C.III.14: 3.000 m forward of the firewall). */
const S = (station: number) => 6.0 - station;
const IN = 0.0254;

/**
 * Empty mass: the typical equipped aircraft, 2800 kg (47E-PROXY 1-8: 9 seats, standard interior), its CG at station
 * 5.85 (ESTIMATE: the 47E sample basic empty weight, 5613 lb at 225.16 in = 5.72 m, is a lighter fit; the seats and
 * interior lie aft of it), about 1.62 m above the ground (ESTIMATE from a component build-up: geometry.ts).
 */
const EMPTY = 2800;
const EMPTY_CG = { x: S(5.85), y: 0, z: -0.08 };
const USABLE_FUEL = PC12_POWERPLANT.fuel.tanks.reduce((sum, t) => sum + t.capacity, 0);
/** TCDS C.III.12: MTOW 4740 kg, MLW 4500 kg. */
const MAX_TAKEOFF = 4740;
const MAX_LANDING = 4500;
/** Payload that brings a full-fuel aircraft to the maximum take-off weight, kg (about 720). */
const MAX_GROSS_PAYLOAD = MAX_TAKEOFF - EMPTY - USABLE_FUEL;
/** Pilot (left seat) at the pilot arm, 160.27 in (47E-PROXY Fig 6-16), the occupant's CG about 0.55 m above the floor (1.73 m up). */
const PILOT = { x: S(160.27 * IN), y: 0, z: -0.19 };
const CREW = 85;
/** Passengers and cargo in the cabin: the STD-9S seat rows run from 212 to 344 in; centroid about station 7.0. */
const CABIN = { x: S(7.0), y: 0, z: -0.19 };
/** TCDS C.III.13 CG limits at 4740 kg: stations 5.898 (forward) and 6.107 (aft). */
const FORWARD_LIMIT = S(5.898);
const AFT_LIMIT = S(6.107);

/** Payload made of the pilot and the rest of `payload` in the cabin. */
function pilotAndCabin(payload: number): PayloadDef {
  const cabin = payload - CREW;
  return {
    payload,
    payloadPosition: { x: (CREW * PILOT.x + cabin * CABIN.x) / payload, y: 0, z: (CREW * PILOT.z + cabin * CABIN.z) / payload },
  };
}

/** Payload centroid x that puts the full-fuel aircraft at maximum weight on CG `x`. */
function payloadXFor(x: number): number {
  const fuelX = PC12_POWERPLANT.fuel.tanks[0].position.x;
  return (MAX_TAKEOFF * x - EMPTY * EMPTY_CG.x - USABLE_FUEL * fuelX) / MAX_GROSS_PAYLOAD;
}

export const PC12_MASS: MassDef = {
  empty: EMPTY,
  maxTakeoff: MAX_TAKEOFF,
  maxLanding: MAX_LANDING,
  // ESTIMATE (plan 5.2): Roskam's radii of gyration of a low-wing single turboprop on the PC-12's span and length,
  // raised for the 1200 kg of fuel in the wings (about 11 000 kg m^2 of roll inertia alone): Ixx 28 000, Iyy 30 000,
  // Izz 55 000 kg m^2 at maximum weight, about the CG of the maxGross loading.
  inertia: { about: 'cg', Ixx: 28_000, Iyy: 30_000, Izz: 55_000, Ixz: 0 },
  inertiaLoading: pilotAndCabin(MAX_GROSS_PAYLOAD),
  emptyCg: EMPTY_CG,
  seatY: Math.abs(PC12_EYE.y),
  loadings: {
    // Single pilot and full fuel: about 4100 kg (9050 lb), CG about station 5.82, near the forward limit there.
    typical: { payload: CREW, payloadPosition: PILOT },
    // MTOW on the forward limit (station 5.898): the POH's stall-speed condition (10 450 lb; the stall block flies it).
    forward: { payload: MAX_GROSS_PAYLOAD, payloadPosition: { x: payloadXFor(FORWARD_LIMIT), y: 0, z: CABIN.z } },
    // MTOW on the aft limit (station 6.107): cargo at the back of the cabin.
    aft: { payload: MAX_GROSS_PAYLOAD, payloadPosition: { x: payloadXFor(AFT_LIMIT), y: 0, z: CABIN.z } },
    // Pilot and cabin load to 4740 kg: CG about station 5.95.
    maxGross: pilotAndCabin(MAX_GROSS_PAYLOAD),
  },
};

export const PC12_LIMITS: LimitsDef = {
  // TCDS C.III.5: +3.4 / -1.36 g flaps up, +2.0 / 0 g flaps down; ultimate 1.5 x.
  loadFactorPositive: 3.4,
  loadFactorNegative: -1.36,
  ultimateFactor: 1.5,
  loadFactorPositiveFlaps: 2.0,
  loadFactorNegativeFlaps: 0,
  // TCDS C.III.9: Vd 280 KCAS.
  diveSpeedCas: 280 * KT,
  structureTime: 0.03,
  // TCDS: Vfe 165 KCAS to 15 deg, 130 KCAS at 30 and 40.
  vfeCas: [Infinity, 165 * KT, 130 * KT, 130 * KT],
  // TCDS: Vle 240 KCAS, Vlo 180 KCAS (extend and retract).
  vleCas: 240 * KT,
  vloExtendCas: 180 * KT,
  vloRetractCas: 180 * KT,
  flapOverspeed: { consequence: 'warn', margin: 0.03, time: 1 },
  gearOverspeed: { consequence: 'warn', margin: 0.03, time: 1 },
  // The aural overspeed warning above Vmo 236 KIAS (placard; 240 KCAS) or Mmo 0.48 (TCDS).
  overspeedWarning: { kias: PC12_OVERSPEED.kias, mach: PC12_OVERSPEED.mach },
};

/**
 * Trimmed horizontal stabiliser (47E-PROXY 7-3: electric actuator, "the leading edge moves down for nose-up trim"):
 * incidence change -4 deg (nose up) to +2.5 deg (nose down) about the rigging, at 0.5 deg/s. Range and rate ESTIMATE
 * (not published): the range trims the forward-CG landing approach and the aft-CG Vmo dive with margin.
 */
const STAB_NOSE_UP = -4 * DEG;
const STAB_NOSE_DOWN = 2.5 * DEG;
const STAB_RATE = 0.5 * DEG;
const FLAP_MAX = PC12_GEOMETRY.wing.flap.maxDeflection;
const ELEVATOR_UP = PC12_GEOMETRY.hTail.elevator.maxUp;

/**
 * Stick shaker and pusher (47E-PROXY 7-21; the /47's system is believed the same). Trip angles of attack (body, deg)
 * against flap: CALIBRATED so that the push comes at the published stall (pusher) speeds at 10 450 lb, flight idle
 * (95 / 78 / 70 / 67 KIAS for flaps 0 / 15 / 30 / 40, CHART-READ Fig 5-2-1) and the shaker 5-10 kt before it (7-21).
 * Push: 60-65 lbf at the wheel against a 3/4 pull (7-21) is taken as 0.35 of the full nose-down travel, ramped in
 * 0.3 s (ESTIMATE). Inhibits (7-21): 5 s after lift-off, below 0.5 g; the computers are on the essential bus
 * (dead below 18 V, ESTIMATE). Torque input: the trip angles rise 0.03 deg per psi (ESTIMATE: the slipstream delays
 * the stall at power).
 */
export const PC12_STICK_PUSHER: StickPusherDef = {
  flapDeg: [0, 15, 30, 40],
  shakerAlphaDeg: [9.6, 9.0, 8.0, 7.6],
  pusherAlphaDeg: [11.6, 11.0, 10.0, 9.6],
  torqueBias: 0.03,
  psiPerPtNm: PC12_PSI_PER_PT_NM,
  pushElevator: 0.35,
  rampSeconds: 0.3,
  liftoffInhibitSeconds: 5,
  minLoadFactor: 0.5,
  minBusVolts: 18,
};

// The control system:
//  - Elevator, ailerons, rudder by cables and push rods (47E-PROXY 7-3); the C208's stretch.
//  - Pitch trim: the stabiliser (above), electric: it moves only with the bus above 20 V (ESTIMATE).
//  - Rudder trim: an electric tab on the rudder (the switch on the PCL); its authority ESTIMATE 8 deg of rudder.
//  - Aileron-rudder interconnect springs (47E-PROXY 7-3): 0.15 of rudder travel per unit aileron (ESTIMATE, plan 5.2).
//    The elevator down-spring is not modelled (notModelled; KNOWN_ISSUES).
//  - Flaps: an electric power drive unit, 0 to 40 deg in about 20 s (ESTIMATE; not published), above 20 V.
//  - Nosewheel steered from the pedals through a spring link, 12 deg each way, castoring to 60 deg (47E 7-4).
export const PC12_CONTROLS: ControlSystemDef = {
  elevator: {
    maxUp: ELEVATOR_UP,
    maxDown: PC12_GEOMETRY.hTail.elevator.maxDown,
    // Read by the tab kinds only (the stabiliser law applies no float: controlSystem.ts).
    alphaFloat: 0.45,
    floatAlphaLimit: 14 * DEG,
    floatQHalf: 30,
  },
  aileron: { maxUp: PC12_GEOMETRY.wing.aileron.maxUp, maxDown: PC12_GEOMETRY.wing.aileron.maxDown, rigging: 0 },
  rudder: {
    maxDeflection: PC12_GEOMETRY.vTail.rudder.maxDeflection,
    tabOffset: 0,
    alphaFloat: 0.5,
    floatLimit: 15 * DEG,
    trim: { authority: 8 * DEG, tabDeflection: 15 * DEG, rate: 0.15 },
  },
  pitchTrim: { kind: 'stabilizer', noseUp: STAB_NOSE_UP, noseDown: STAB_NOSE_DOWN, rate: STAB_RATE },
  trimRate: STAB_RATE,
  trimDrive: { kind: 'electric', minVolts: 20 },
  flaps: {
    maxDeflection: FLAP_MAX,
    // 0 / 15 / 30 / 40 deg (47E-PROXY 7-3): detents[i] / maxDeflection is the lever value.
    detents: [0, (15 / 40) * FLAP_MAX, (30 / 40) * FLAP_MAX, FLAP_MAX],
    drive: { kind: 'electric', rate: 2 * DEG, minVolts: 20 },
  },
  stretchQ: { elevator: 80e3, aileron: 60e3, rudder: 50e3 },
  surfaceRate: 120 * DEG,
  steering: { kind: 'bungee', restraintQ: 900, refLoad: 7000 },
  stickPusher: PC12_STICK_PUSHER,
  aileronRudderInterconnect: 0.15,
};

// Static-source position error: ESTIMATE from the /47 placards in KIAS against the TCDS in KCAS (Vmo 236 / 240, Vlo
// 177 / 180, Vfe 163 / 165, 130 / 130): 2-4 kt, IAS reading low; near the stall about 2 kt low (assumed).
export const PC12_AIR_DATA: AirDataDef = {
  calibration: [
    { flapDeg: 0, cas: [80, 97, 130, 165, 180, 240], ias: [78, 95, 128, 163, 177, 236] },
    { flapDeg: 15, cas: [70, 80, 100, 130, 165], ias: [68, 78, 98, 128, 163] },
    { flapDeg: 40, cas: [60, 69, 85, 100, 130], ias: [58, 67, 84, 99, 130] },
  ],
  referenceMass: MAX_TAKEOFF,
  asiAliveKt: [20, 40],
};

// Autopilot gains (physics/autopilot.ts; drives the scripted pilot and the hold keys): the C208's, at the reference
// dynamic pressure of the PC-12's circuit speeds (about 130 KTAS), tuned on the flown checks.
export const PC12_AUTOPILOT: AutopilotGains = {
  qRef: 2700,
  pitchKp: 1.8,
  pitchKi: 0.5,
  pitchKq: 0.9,
  rollKp: 1.3,
  rollKd: 0.35,
  rollKi: 0.12,
  headingK: 1.2,
  altitudeK: 0.12,
  vsKp: 0.02,
  vsKi: 0.008,
  speedKp: 0.03,
  speedKi: 0.006,
  throttleKp: 0.06,
  throttleKi: 0.015,
  ballKp: 0.6,
  ballKi: 0.5,
  yawKr: 0.8,
  rudderLimit: 0.8,
  trimRate: 0.06,
  pitchLimit: 20 * DEG,
  // Yoke-equivalent of full nose-up trim: the stabiliser's travel as elevator (controlSystem.ts STABILIZER_EQUIVALENCE).
  trimEquivalence: -STAB_NOSE_UP / STABILIZER_EQUIVALENCE / ELEVATOR_UP,
  // Settings: 160 KIAS, 1000 ft/min, bank limit 25 deg.
  defaults: { airspeed: 160 * KT, verticalSpeed: 5.08, maxBank: 25 * DEG },
};

/** The reference point's MAC (for the docs and the tests): 1.64 m DERIVED. */
export { PC12_MAC };
