// Cessna 208 Caravan 675: mass and loadings, structural limits, the control system, the air-data calibration and
// the autopilot gains. Plain data.
//
// Figures from the 208 POH (sections 2 and 6) where it gives them; ESTIMATE where it does not. Positions are
// reference-point body axes (geometry.ts). The reference point is at 25 % of the 1.76 m MAC; the POH's CG range
// at 8000 lb is taken as about 20 % to 37 % MAC (ESTIMATE pending the weight and balance data).
// What physics/controlSystem.ts reads is explained in aircraft/c172s/systems.ts; the 208 differs in its numbers.

import { DEG, KT, LB } from '../../core/math';
import type { AirDataDef, AutopilotGains, ControlSystemDef, LimitsDef, MassDef, PayloadDef } from '../types';
import { C208_GEOMETRY, C208_THRUST_Z } from './geometry';
import { C208_POWERPLANT } from './powerplant';
import { C208_REFERENCE } from './reference';

const MAC = C208_GEOMETRY.wing.meanChord;
/** Body x of a CG at `percent` of the MAC (the reference point is at 25 %), m. */
const macX = (percent: number) => ((25 - percent) / 100) * MAC;

/**
 * Empty mass: a typical equipped 208 (POH sample: about 4600 lb with unusable fuel and full oil; 4570 lb standard
 * empty plus the usual avionics and interior). Its CG at about 22 % MAC (ESTIMATE): the turbine is far forward in
 * the long nose, the cabin and tail are light; 0.1 m below the thrust line.
 */
const EMPTY = 4600 * LB;
const EMPTY_CG = { x: macX(22), y: 0, z: C208_THRUST_Z + 0.1 };
const USABLE_FUEL = C208_POWERPLANT.fuel.tanks.reduce((sum, t) => sum + t.capacity, 0);
const MAX_TAKEOFF = 8000 * LB;
const MAX_LANDING = 7800 * LB;
/** Payload that brings a full-fuel aircraft to maximum take-off weight, kg (about 530). */
const MAX_GROSS_PAYLOAD = MAX_TAKEOFF - EMPTY - USABLE_FUEL;
/** The two crew seats: occupant CG 0.1 m aft of the eye point, 0.15 m below the thrust line. */
const SEATS = { x: C208_GEOMETRY.fuselage.pilotEye.x - 0.1, y: 0, z: C208_THRUST_Z + 0.15 };
/** Two crew of 77 kg. */
const CREW = 154;
/** Passengers and cargo in the cabin, centroid about 1.2 m aft of the reference point on the floor. */
const CABIN = { x: -1.2, y: 0, z: C208_THRUST_Z + 0.25 };

/** Payload made of the crew and the rest of `payload` in the cabin. */
function crewAndCabin(payload: number): PayloadDef {
  const cabin = payload - CREW;
  return {
    payload,
    payloadPosition: {
      x: (CREW * SEATS.x + cabin * CABIN.x) / payload,
      y: 0,
      z: (CREW * SEATS.z + cabin * CABIN.z) / payload,
    },
  };
}

/** Payload centroid x that puts the full-fuel aircraft at maximum weight on CG `x`. */
function payloadXFor(x: number): number {
  const fuelX = C208_POWERPLANT.fuel.tanks[0].position.x;
  return (MAX_TAKEOFF * x - EMPTY * EMPTY_CG.x - USABLE_FUEL * fuelX) / MAX_GROSS_PAYLOAD;
}

export const C208_MASS: MassDef = {
  empty: EMPTY,
  maxTakeoff: MAX_TAKEOFF,
  maxLanding: MAX_LANDING,
  // ESTIMATE: Roskam radii of gyration of a strut-braced high-wing single (0.196 / 0.300 / 0.316, as the 152's) on
  // the 208's span and length at 8000 lb, about the CG of the maximum-weight loading below.
  inertia: { about: 'cg', Ixx: 8800, Iyy: 10700, Izz: 16900, Ixz: 0 },
  inertiaLoading: crewAndCabin(MAX_GROSS_PAYLOAD),
  emptyCg: EMPTY_CG,
  seatY: Math.abs(C208_GEOMETRY.fuselage.pilotEye.y),
  loadings: {
    // Two crew and full fuel: about 3250 kg (7170 lb), CG about 20.7 % MAC, near the forward limit (a light cabin).
    typical: { payload: CREW, payloadPosition: SEATS },
    // Maximum weight on the forward limit (20 % MAC): cabin loaded forward.
    forward: { payload: MAX_GROSS_PAYLOAD, payloadPosition: { x: payloadXFor(macX(20)), y: 0, z: SEATS.z } },
    // Maximum weight on the aft limit (37 % MAC): cargo at the back of the cabin.
    aft: { payload: MAX_GROSS_PAYLOAD, payloadPosition: { x: payloadXFor(macX(37)), y: 0, z: CABIN.z } },
    // Crew and cabin load to 8000 lb.
    maxGross: crewAndCabin(MAX_GROSS_PAYLOAD),
  },
};

export const C208_LIMITS: LimitsDef = {
  // Normal category (POH sect. 2): +3.8 / -1.52 g flaps up, +2.4 g flaps down; ultimate 1.5 x.
  loadFactorPositive: 3.8,
  loadFactorNegative: -1.52,
  ultimateFactor: 1.5,
  loadFactorPositiveFlaps: 2.4,
  // Design dive speed: Vmo 175 KIAS is at most 0.8 VD (CS-23 for a turboprop), taken as CAS.
  diveSpeedCas: (C208_REFERENCE.vne / 0.8) * KT,
  structureTime: 0.03,
  vfeCas: [Infinity, ...C208_REFERENCE.vfe.map((kias) => kias * KT)],
  flapOverspeed: { consequence: 'none', margin: 0, time: 0 },
  gearOverspeed: { consequence: 'none', margin: 0, time: 0 },
};

/** Elevator trim tabs (electric and manual wheel): 20 degrees trailing edge down (nose-up trim), 10 up (ESTIMATE). */
const PITCH_TRIM = { kind: 'tab', tabDown: 20 * DEG, tabUp: 10 * DEG, floatRatio: 1.0 } as const;
const FLAP_MAX = C208_GEOMETRY.wing.flap.maxDeflection;

// The control system:
//  - Elevator, ailerons, rudder by cables; the 172's float and hinge-moment behaviour.
//  - Rigging: no ground-adjustable rudder tab (tabOffset 0): the cockpit rudder trim takes out the propeller's
//    yaw, which is large at take-off power (POH: rudder trim set for take-off).
//  - Rudder trim wheel on the pedestal: a tab of about 20 degrees each way (ESTIMATE); `authority` the rudder it
//    holds at full trim.
//  - Flaps: an electric actuator, about 18 s from UP to FULL (ESTIMATE), while the bus is above 20 V.
//  - Nosewheel steered from the pedals through a spring link (POH sect. 7).
export const C208_CONTROLS: ControlSystemDef = {
  elevator: {
    maxUp: C208_GEOMETRY.hTail.elevator.maxUp,
    maxDown: C208_GEOMETRY.hTail.elevator.maxDown,
    alphaFloat: 0.45,
    floatAlphaLimit: 14 * DEG,
    floatQHalf: 30,
  },
  aileron: { maxUp: C208_GEOMETRY.wing.aileron.maxUp, maxDown: C208_GEOMETRY.wing.aileron.maxDown, rigging: 0 },
  rudder: {
    maxDeflection: C208_GEOMETRY.vTail.rudder.maxDeflection,
    tabOffset: 0,
    alphaFloat: 0.5,
    floatLimit: 15 * DEG,
    trim: { authority: 10 * DEG, tabDeflection: 20 * DEG, rate: 0.2 },
  },
  pitchTrim: PITCH_TRIM,
  trimRate: 15 * DEG,
  flaps: {
    maxDeflection: FLAP_MAX,
    // UP, 10, 20, FULL (30): written so that detents[i] / maxDeflection is exactly the lever value.
    detents: [0, (1 / 3) * FLAP_MAX, (2 / 3) * FLAP_MAX, FLAP_MAX],
    drive: { kind: 'electric', rate: (30 / 18) * DEG, minVolts: 20 },
  },
  // Long cable runs of a larger aircraft.
  stretchQ: { elevator: 80e3, aileron: 60e3, rudder: 50e3 },
  surfaceRate: 120 * DEG,
  steering: { kind: 'bungee', restraintQ: 900, refLoad: 6500 },
};

// Static-source position error: ESTIMATE pending the POH airspeed calibration (sect. 5), a few knots near the
// stall, about none in the cruise.
export const C208_AIR_DATA: AirDataDef = {
  calibration: [
    { flapDeg: 0, cas: [62, 70, 80, 100, 120, 140, 160, 180], ias: [58, 68, 79, 100, 121, 141, 161, 181] },
    { flapDeg: 10, cas: [58, 65, 80, 100, 120, 140, 175], ias: [54, 63, 79, 100, 121, 141, 176] },
    { flapDeg: 30, cas: [54, 60, 70, 80, 100, 125], ias: [50, 58, 69, 80, 101, 126] },
  ],
  referenceMass: MAX_TAKEOFF,
  asiAliveKt: [20, 40],
};

// Autopilot gains (physics/autopilot.ts; drives the scripted pilot and the hold keys). The 172's, with the
// reference dynamic pressure of the 208's circuit speeds (about 115 KTAS) and the surface gains reduced for its
// larger control power per unit inertia at those speeds; tuned on the flown checks.
export const C208_AUTOPILOT: AutopilotGains = {
  qRef: 2100,
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
  trimEquivalence: (PITCH_TRIM.floatRatio * PITCH_TRIM.tabDown) / C208_GEOMETRY.hTail.elevator.maxUp,
  // Settings: 120 KIAS, 500 ft/min, bank limit 25 deg.
  defaults: { airspeed: 120 * KT, verticalSpeed: 2.54, maxBank: 25 * DEG },
};
