// Cessna 172S: mass and loadings, structural limits, the control system, the air-data calibration and the
// autopilot gains. Plain data.
//
// The physics modules read these numbers (their C172S defaults) and export the old constant names as views of
// them. The geometric travels (elevator, aileron, rudder, flaps) and the masses are those of core/c172.ts.

import { C172 } from '../../core/c172';
import { DEG, KT } from '../../core/math';
import type { AirDataDef, AutopilotGains, ControlSystemDef, LimitsDef, MassDef } from '../types';
import { C172S_REFERENCE } from './reference';

const M = C172.mass;
const FLAP_MAX = C172.wing.flap.maxDeflection;
/** Rear seats and baggage area, where the payload beyond the front-seat occupants goes, m. */
const REAR_X = -0.8;
/** Payload that brings a full-fuel aircraft to maximum take-off weight, kg. */
const MAX_GROSS_PAYLOAD = M.maxTakeoff - M.empty - M.usableFuel;
/**
 * Default loading: the two front-seat occupants of core/c172.ts plus 40 kg of bags and jackets on the rear
 * seat and in the baggage area (1.3 m behind the front seats' centroid). With full fuel that is ~1100 kg and a
 * CG at ~28 % MAC, a typical C172 loading; the forward limit (~26 % MAC at max gross) is where the POH
 * stall speeds are measured.
 */
const DEFAULT_PAYLOAD = M.crew + 40;
/** Elevator trim tab travel, trailing edge down (nose-up trim) and up, rad, and the elevator float per unit tab. */
const PITCH_TRIM = { kind: 'tab', tabDown: 19 * DEG, tabUp: 22 * DEG, floatRatio: 1.0 } as const;

export const C172S_MASS: MassDef = {
  empty: M.empty,
  maxTakeoff: M.maxTakeoff,
  // The 172S may land at its maximum take-off weight.
  maxLanding: M.maxTakeoff,
  // core/c172.ts gives the inertia of the aircraft with the front-seat occupants and full fuel, taken to
  // balance at the reference point (physics/massModel.ts).
  inertia: { about: 'referencePoint', Ixx: M.Ixx, Iyy: M.Iyy, Izz: M.Izz, Ixz: M.Ixz },
  inertiaLoading: { payload: M.crew, payloadPosition: M.crewPos },
  // Front-seat occupants sit this far either side of the centreline (pilot eye point, core/c172.ts).
  seatY: Math.abs(C172.fuselage.pilotEye.y),
  loadings: {
    typical: {
      payload: DEFAULT_PAYLOAD,
      payloadPosition: {
        x: (M.crew * M.crewPos.x + 40 * (M.crewPos.x - 1.3)) / DEFAULT_PAYLOAD,
        y: 0,
        z: M.crewPos.z,
      },
    },
    // Maximum weight with everything in the front seats: the forward limit, where the POH stall speeds are measured.
    forward: { payload: MAX_GROSS_PAYLOAD, payloadPosition: M.crewPos },
    // Everything in the rear seats and baggage area: CG ~36 % MAC, the aft limit.
    aft: { payload: MAX_GROSS_PAYLOAD, payloadPosition: { x: REAR_X, y: 0, z: -0.05 } },
    // The front-seat occupants and the rest behind them.
    maxGross: {
      payload: MAX_GROSS_PAYLOAD,
      payloadPosition: { x: (M.crew * M.crewPos.x + (MAX_GROSS_PAYLOAD - M.crew) * REAR_X) / MAX_GROSS_PAYLOAD, y: 0, z: -0.05 },
    },
  },
};

export const C172S_LIMITS: LimitsDef = {
  // Normal category (POH): +3.8 / -1.52 g flaps up; ultimate = 1.5 x limit.
  loadFactorPositive: 3.8,
  loadFactorNegative: -1.52,
  ultimateFactor: 1.5,
  // Design dive speed: 14 CFR 23 sets Vne <= 0.9 Vd. Structural failure (flutter, overload) beyond it, m/s.
  diveSpeedCas: (C172S_REFERENCE.vne / 0.9) * KT,
  // Response time of the wing structure to a load (first bending mode ~6-8 Hz), s.
  structureTime: 0.03,
  // Clean, then flaps 10, 20 and 30 degrees: the placard speeds (KIAS), taken as CAS like the dive speed.
  vfeCas: [Infinity, ...C172S_REFERENCE.vfe.map((kias) => kias * KT)],
  // Flap overspeed is not monitored.
  flapOverspeed: { consequence: 'none', margin: 0, time: 0 },
  gearOverspeed: { consequence: 'none', margin: 0, time: 0 },
};

// The control system (physics/controlSystem.ts explains the model):
//  - Elevator: -Ch_alpha / Ch_delta_e of ~0.45 for a 40 %-chord, horn-balanced, unsealed elevator (NACA TR 721
//    and Toll, NACA TR 868, 3-D values), up to the tailplane's stall at 14 deg, half developed at 30 Pa.
//  - Rigging. The ground-adjustable rudder tab is bent so the ball is centred with the pedals neutral at the top
//    of the cruise range (full-throttle level flight at sea level, ~128 KTAS), and the wings are rigged (the
//    "heavy wing" adjustment) so the aircraft holds its wings level there hands-off. Below that speed the
//    slipstream's swirl outgrows the tab: a little right pedal at normal cruise (~0.03 at 110 KIAS, ~0.06 at 100
//    KIAS) and a quarter of the travel or more in a full-power climb. The tab's rudder deflection (+ = trailing
//    edge left), rad, and the aileron rigging expressed as the equivalent yoke input.
//  - Free (feet-off) rudder: float per unit fin angle of attack for the horn-balanced rudder (~0.4c, like the
//    elevator's), up to 15 deg of fin angle.
//  - Trim tab: 19 deg trailing edge down (nose-up trim), 22 deg up; the horn-balanced elevator floats about
//    one-for-one with it. The wheel turns the tab at 20 deg/s.
//  - Flaps: a 28 V motor at 3 deg/s while the bus is above 20 V.
//  - Cable stretch halves a deflection at these dynamic pressures, Pa; surfaces move at most 150 deg/s.
//  - Steering bungee: the loaded nose tyre restrains a feet-off rudder (q / (q + 600 Pa x nose load / 2000 N)).
export const C172S_CONTROLS: ControlSystemDef = {
  elevator: {
    maxUp: C172.hTail.elevator.maxUp,
    maxDown: C172.hTail.elevator.maxDown,
    alphaFloat: 0.45,
    floatAlphaLimit: 14 * DEG,
    floatQHalf: 30,
  },
  aileron: { maxUp: C172.wing.aileron.maxUp, maxDown: C172.wing.aileron.maxDown, rigging: 0.0094 },
  rudder: {
    maxDeflection: C172.vTail.rudder.maxDeflection,
    tabOffset: -1.5 * DEG,
    alphaFloat: 0.5,
    floatLimit: 15 * DEG,
  },
  pitchTrim: PITCH_TRIM,
  trimRate: 20 * DEG,
  flaps: {
    maxDeflection: FLAP_MAX,
    // 0, 10, 20 and 30 degrees, written as the thirds of the lever travel that select them: detents[i] /
    // maxDeflection is then exactly the lever value, and detents[i] exactly the deflection the motor drives to
    // (10 * DEG differs from that in the last bit).
    detents: [0, (1 / 3) * FLAP_MAX, (2 / 3) * FLAP_MAX, FLAP_MAX],
    drive: { kind: 'electric', rate: 3 * DEG, minVolts: 20 },
  },
  stretchQ: { elevator: 50e3, aileron: 40e3, rudder: 30e3 },
  surfaceRate: 150 * DEG,
  steering: { kind: 'bungee', restraintQ: 600, refLoad: 2000 },
};

// Static-source position error: the C172S POH airspeed calibration table (normal static source; knots, flaps up,
// 10 and 30 degrees), flown in steady 1-g flight at maximum weight.
export const C172S_AIR_DATA: AirDataDef = {
  calibration: [
    { flapDeg: 0, cas: [56, 62, 70, 78, 87, 97, 107, 117, 127, 137, 147, 157], ias: [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160] },
    { flapDeg: 10, cas: [51, 57, 63, 71, 80, 84], ias: [40, 50, 60, 70, 80, 85] },
    { flapDeg: 30, cas: [48, 55, 62, 70, 79, 83], ias: [40, 50, 60, 70, 80, 85] },
  ],
  referenceMass: M.maxTakeoff,
  asiAliveKt: [18, 35],
};

// Autopilot gains (physics/autopilot.ts), per unit of normalised control input, tuned on this aircraft's control
// power and inertia.
export const C172S_AUTOPILOT: AutopilotGains = {
  // Dynamic pressure at which the surface gains are nominal (about 90 KTAS at sea level), Pa.
  qRef: 1300,
  pitchKp: 2.2, // yoke per rad of pitch error
  pitchKi: 0.6, // yoke per rad*s
  pitchKq: 0.9, // yoke per rad/s of pitch rate
  rollKp: 1.6, // aileron per rad of bank error
  rollKd: 0.35, // aileron per rad/s of roll rate
  rollKi: 0.15,
  headingK: 1.2, // rad of bank per rad of heading error
  altitudeK: 0.12, // (m/s) per m
  vsKp: 0.02, // rad of pitch per m/s
  vsKi: 0.008,
  speedKp: 0.03, // rad of pitch per m/s of airspeed error
  speedKi: 0.006,
  throttleKp: 0.12, // throttle per m/s
  throttleKi: 0.03,
  // Per unit ball deflection; the inclinometer is full scale at ~0.1 g lateral (6 deg), see airData.ts. Sized for
  // the rudder the slipstream asks for (a quarter of the travel in a full-power climb, ~0.06 at 100 KIAS), which
  // the ball loop must find within a few seconds of a power change.
  ballKp: 0.6,
  ballKi: 0.5,
  yawKr: 0.8, // rudder per rad/s of yaw rate beyond the coordinated turn rate
  rudderLimit: 0.6, // clamp of the ball loop's integrator, rudder
  trimRate: 0.08, // trim-wheel travel per second per unit of yoke held
  pitchLimit: 20 * DEG,
  // Yoke travel equivalent to one unit of trim wheel (nose-up float over nose-up yoke travel).
  trimEquivalence: (PITCH_TRIM.floatRatio * PITCH_TRIM.tabDown) / C172S_CONTROLS.elevator.maxUp,
  // Settings: airspeed 45 m/s, vertical speed 3.5 m/s, bank limit 25 deg.
  defaults: { airspeed: 45, verticalSpeed: 3.5, maxBank: 25 * DEG },
};
