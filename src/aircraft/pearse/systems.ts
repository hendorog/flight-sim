// Richard Pearse 1903 Monoplane: mass & balance, structural limits, control linkages, air data and autopilot gains.
//
// Because the elevator is hinged directly to the rear edge of the 2.0 m wing (no tail boom), the forward-mounted
// engine (+0.58 m) and pilot (+0.08 m) place the loaded CG slightly ahead of the wing quarter-chord (~+0.16 m), giving
// positive longitudinal and directional static stability with both the rear-edge elevator (-1.75 m) and the central
// wing-top sail (-0.68 m).

import { DEG, KT } from '../../core/math';
import type { AirDataDef, AutopilotGains, ControlSystemDef, LimitsDef, MassDef, PayloadDef } from '../types';
import { PEARSE_GEOMETRY } from './geometry';
import { PEARSE_POWERPLANT } from './powerplant';
import { PEARSE_REFERENCE } from './reference';

const EMPTY = 182;
const USABLE_FUEL = PEARSE_POWERPLANT.fuel.tanks.reduce((sum, t) => sum + t.capacity, 0);
const MAX_TAKEOFF = 276;
const MAX_GROSS_PAYLOAD = MAX_TAKEOFF - EMPTY - USABLE_FUEL;
const SINGLE_SEAT = [{ fraction: 1, offset: { x: 0, y: 0, z: 0 } }] as const;
const PILOT_POS = { x: 0.08, y: 0, z: 0.1 };

const singlePilot = (payload: number, x = PILOT_POS.x): PayloadDef => ({
  payload,
  payloadPosition: { x, y: 0, z: PILOT_POS.z },
  payloadDistribution: SINGLE_SEAT,
});

export const PEARSE_MASS: MassDef = {
  empty: EMPTY,
  maxTakeoff: MAX_TAKEOFF,
  maxLanding: MAX_TAKEOFF,
  // Short-coupled tailless-boom flying-wing layout: compact pitch/yaw inertia, wide spanwise roll inertia.
  inertia: { about: 'cg', Ixx: 205, Iyy: 175, Izz: 310, Ixz: 0 },
  inertiaLoading: singlePilot(MAX_GROSS_PAYLOAD),
  emptyCg: { x: 0.14, y: 0, z: -0.04 },
  seatY: 0,
  loadings: {
    typical: singlePilot(76),
    forward: singlePilot(68, 0.14),
    aft: singlePilot(MAX_GROSS_PAYLOAD, 0.03),
    maxGross: singlePilot(MAX_GROSS_PAYLOAD),
  },
};

export const PEARSE_LIMITS: LimitsDef = {
  loadFactorPositive: 3.0,
  loadFactorNegative: -1.2,
  ultimateFactor: 1.5,
  loadFactorPositiveFlaps: 2.5,
  diveSpeedCas: (PEARSE_REFERENCE.vne / 0.88) * KT,
  structureTime: 0.04,
  vfeCas: [Infinity, ...PEARSE_REFERENCE.vfe.map((kias) => kias * KT)],
  flapOverspeed: { consequence: 'warn', margin: 0.05, time: 1.5 },
  gearOverspeed: { consequence: 'none', margin: 0, time: 0 },
};

const FLAP_MAX = PEARSE_GEOMETRY.wing.flap.maxDeflection;
const PITCH_TRIM = { kind: 'spring', springUp: -13 * DEG, springDown: 11 * DEG, springQ: 320 } as const;

export const PEARSE_CONTROLS: ControlSystemDef = {
  elevator: {
    maxUp: PEARSE_GEOMETRY.hTail.elevator.maxUp,
    maxDown: PEARSE_GEOMETRY.hTail.elevator.maxDown,
    alphaFloat: 0.25,
    floatAlphaLimit: 14 * DEG,
    floatQHalf: 18,
  },
  aileron: {
    maxUp: PEARSE_GEOMETRY.wing.aileron.maxUp,
    maxDown: PEARSE_GEOMETRY.wing.aileron.maxDown,
    rigging: 0,
  },
  rudder: {
    maxDeflection: PEARSE_GEOMETRY.vTail.rudder.maxDeflection,
    tabOffset: -0.6 * DEG,
    alphaFloat: 0.35,
    floatLimit: 15 * DEG,
  },
  pitchTrim: PITCH_TRIM,
  trimRate: 18 * DEG,
  flaps: {
    maxDeflection: FLAP_MAX,
    detents: [0, 0.5 * FLAP_MAX, FLAP_MAX],
    drive: { kind: 'manual', rate: 30 * DEG },
  },
  stretchQ: { elevator: 18e3, aileron: 15e3, rudder: 15e3 },
  surfaceRate: 140 * DEG,
  steering: { kind: 'direct', restraintQ: 450, refLoad: 750 },
};

export const PEARSE_AIR_DATA: AirDataDef = {
  calibration: [],
  referenceMass: MAX_TAKEOFF,
  asiAliveKt: [10, 20],
};

export const PEARSE_AUTOPILOT: AutopilotGains = {
  qRef: 330,
  pitchKp: 1.25,
  pitchKi: 0.38,
  pitchKq: 0.5,
  rollKp: 1.0,
  rollKd: 0.24,
  rollKi: 0.08,
  headingK: 1.1,
  altitudeK: 0.11,
  vsKp: 0.03,
  vsKi: 0.01,
  speedKp: 0.045,
  speedKi: 0.009,
  throttleKp: 0.14,
  throttleKi: 0.035,
  ballKp: 0.55,
  ballKi: 0.45,
  yawKr: 0.75,
  rudderLimit: 0.75,
  trimRate: 0.08,
  pitchLimit: 18 * DEG,
  trimEquivalence: Math.abs(PITCH_TRIM.springUp) / PEARSE_GEOMETRY.hTail.elevator.maxUp,
  defaults: { airspeed: 23.5, verticalSpeed: 1.5, maxBank: 20 * DEG },
};
