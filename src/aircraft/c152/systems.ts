// Cessna 152 (1978 model): mass and loadings, structural limits, the control system, the air-data calibration and
// the autopilot gains. Plain data.
//
// Figures from the type's engineering data sheet (aircraft-data/c152.md in the design work folder; "s.N" is its
// section N), which takes them from the 1978 POH, TCDS 3A19 and the service manual. Positions are reference-point
// body axes (geometry.ts): x = (33.5 - FS) x 0.0254 m, the reference point 0.62 m below the wing chord plane.
// What physics/controlSystem.ts reads is explained in aircraft/c172s/systems.ts; the 152 differs in its numbers.

import { DEG, KT, LB } from '../../core/math';
import type { AirDataDef, AutopilotGains, ControlSystemDef, LimitsDef, MassDef, PayloadDef } from '../types';
import { C152_GEOMETRY } from './geometry';
import { C152_POWERPLANT } from './powerplant';
import { C152_REFERENCE } from './reference';

/** Body x of a fuselage station (FS, inches aft of the firewall), m. */
const fs = (station: number) => (33.5 - station) * 0.0254;

/**
 * Empty mass: the POH sample aeroplane, 1136 lb at FS 29.93 (s.6: "flying-school aircraft typically 1130-1200 lb";
 * the bare standard empty weight is 1081 lb), with unusable fuel and full oil. Its height is that of the airframe
 * with the engine low in the nose: the CG of the sample loading at maximum weight is then the reference height.
 */
const EMPTY = 1136 * LB;
const EMPTY_CG = { x: fs(29.93), y: 0, z: 0.034 };
const USABLE_FUEL = C152_POWERPLANT.fuel.tanks.reduce((sum, t) => sum + t.capacity, 0);
const MAX_TAKEOFF = 1670 * LB;
/** Payload that brings a full-fuel aircraft to maximum take-off weight, kg (about 176: two adults and 22 kg of bags). */
const MAX_GROSS_PAYLOAD = MAX_TAKEOFF - EMPTY - USABLE_FUEL;
/** The two seats, FS 39 (adjustable FS 33-41), occupant CG 0.13 m below the reference point (s.2.5). */
const SEATS = { x: fs(39), y: 0, z: 0.13 };
/** Two occupants of 77 kg (the sheet's typical training loading, s.6). */
const CREW = 154;
/** Baggage area 1, FS 64 (s.6). */
const BAGGAGE = { x: fs(64), y: 0, z: 0.23 };

/** Payload made of the crew at `seat` and the rest of `payload` in the baggage area. */
function crewAndBags(payload: number, seat = SEATS): PayloadDef {
  const bags = payload - CREW;
  return {
    payload,
    payloadPosition: {
      x: (CREW * seat.x + bags * BAGGAGE.x) / payload,
      y: 0,
      z: (CREW * seat.z + bags * BAGGAGE.z) / payload,
    },
  };
}

export const C152_MASS: MassDef = {
  empty: EMPTY,
  maxTakeoff: MAX_TAKEOFF,
  maxLanding: MAX_TAKEOFF,
  // s.6, the sheet's pick at 1670 lb: Roskam radii of gyration of the strut-braced high-wing Cessna 182 (0.196 /
  // 0.300 / 0.316), +/-20 %; Ixz unknown and small. Taken about the CG of the maximum-weight sample loading.
  inertia: { about: 'cg', Ixx: 750, Iyy: 920, Izz: 1450, Ixz: 0 },
  inertiaLoading: crewAndBags(MAX_GROSS_PAYLOAD),
  emptyCg: EMPTY_CG,
  // Pilot eye point, left seat (s.2.5).
  seatY: Math.abs(C152_GEOMETRY.fuselage.pilotEye.y),
  loadings: {
    // Two 77 kg occupants and full fuel: 736 kg, CG FS 32.9 (s.6's typical training loading, near the forward limit).
    typical: { payload: CREW, payloadPosition: SEATS },
    // Maximum weight with the CG on the forward limit, FS 32.65 at 1670 lb (s.6): the seats run fully forward.
    forward: { payload: MAX_GROSS_PAYLOAD, payloadPosition: { x: -0.0907, y: 0, z: SEATS.z } },
    // Maximum weight with the CG on the aft limit, FS 36.4 (36.5, s.6), where POH fig 5-3 gives its aft-CG stall
    // speeds. A notional payload centroid (FS 53.3): with full fuel and this empty CG no legal cabin loading gets
    // there at 1670 lb (the crew at the back of the seat rails and 54 kg of baggage give FS 35.2).
    aft: { payload: MAX_GROSS_PAYLOAD, payloadPosition: { x: fs(53.3), y: 0, z: 0.19 } },
    // The POH sample loading (Fig 6-6): crew and bags, 1670 lb at FS 33.8.
    maxGross: crewAndBags(MAX_GROSS_PAYLOAD),
  },
};

export const C152_LIMITS: LimitsDef = {
  // Utility category at all weights (POH sect. 2): +4.4 / -1.76 g flaps up, +3.5 g flaps down; ultimate 1.5 x.
  loadFactorPositive: 4.4,
  loadFactorNegative: -1.76,
  ultimateFactor: 1.5,
  // The POH gives no negative figure with flap: the flaps-up one stands.
  loadFactorPositiveFlaps: 3.5,
  // Design dive speed from Vne <= 0.9 Vd, Vne taken as CAS (as the 172's), m/s.
  diveSpeedCas: (C152_REFERENCE.vne / 0.9) * KT,
  structureTime: 0.03,
  // Clean, then flaps 10, 20 and 30 degrees: 85 KIAS at any setting (POH Fig 2-1), taken as CAS.
  vfeCas: [Infinity, ...C152_REFERENCE.vfe.map((kias) => kias * KT)],
  flapOverspeed: { consequence: 'none', margin: 0, time: 0 },
  gearOverspeed: { consequence: 'none', margin: 0, time: 0 },
};

/** Elevator trim tab on the right elevator: 20 degrees trailing edge down (nose-up trim), 10 up (TCDS, s.2.2). */
const PITCH_TRIM = { kind: 'tab', tabDown: 20 * DEG, tabUp: 10 * DEG, floatRatio: 1.0 } as const;
const FLAP_MAX = C152_GEOMETRY.wing.flap.maxDeflection;

// The control system (physics/controlSystem.ts; the model as aircraft/c172s/systems.ts describes it):
//  - Elevator: 0.43-chord, horn-balanced, unsealed: the 172's float, -Ch_alpha / Ch_delta about 0.45.
//  - Rigging. The ground-adjustable rudder tab (s.2.3) is bent so the ball is centred with the pedals neutral in
//    full-throttle level flight at sea level, the top of the cruise range, and the wings are rigged to fly
//    level hands-off there (the "heavy wing" adjustment); slower, the slipstream's swirl asks for right pedal.
//  - Trim tab: 20 degrees down, 10 up, the elevator floating about one for one with it; the wheel turns it at
//    20 deg/s.
//  - Flaps: a 28 V motor, about 9 s from 0 to 30 degrees (s.2.1, ESTIMATE), while the bus is above 20 V.
//  - Steering bungee: as the 172's.
export const C152_CONTROLS: ControlSystemDef = {
  elevator: {
    maxUp: C152_GEOMETRY.hTail.elevator.maxUp,
    maxDown: C152_GEOMETRY.hTail.elevator.maxDown,
    alphaFloat: 0.45,
    floatAlphaLimit: 14 * DEG,
    floatQHalf: 30,
  },
  aileron: { maxUp: C152_GEOMETRY.wing.aileron.maxUp, maxDown: C152_GEOMETRY.wing.aileron.maxDown, rigging: 0 },
  rudder: {
    maxDeflection: C152_GEOMETRY.vTail.rudder.maxDeflection,
    // The tab's rudder deflection (+ = trailing edge left): the ball centred at about 111 KTAS (above).
    tabOffset: -1.2 * DEG,
    alphaFloat: 0.5,
    floatLimit: 15 * DEG,
  },
  pitchTrim: PITCH_TRIM,
  trimRate: 20 * DEG,
  flaps: {
    maxDeflection: FLAP_MAX,
    // 0, 10, 20 and 30 degrees: the thirds of the lever travel (the stops of the pre-select lever, s.2.1),
    // written so that detents[i] / maxDeflection is exactly the lever value.
    detents: [0, (1 / 3) * FLAP_MAX, (2 / 3) * FLAP_MAX, FLAP_MAX],
    drive: { kind: 'electric', rate: (10 / 3) * DEG, minVolts: 20 },
  },
  stretchQ: { elevator: 50e3, aileron: 40e3, rudder: 30e3 },
  surfaceRate: 150 * DEG,
  steering: { kind: 'bungee', restraintQ: 600, refLoad: 1700 },
};

// Static-source position error: the POH airspeed calibration (Fig 5-1, normal static source; knots, flaps up, 10
// and 30 degrees), flown at maximum weight, and below its 50 KIAS points the POH stall-speed table (Fig 5-3,
// 1670 lb, forward and aft CG), as the C172S's rows end in its stall table: the error is a function of the angle
// of attack (physics/airData.ts), and near the stall the pilot reads the stall table's figures (clean 48 KCAS =
// 40 KIAS, the bottom of the green arc; flaps 30 43 KCAS = 35 KIAS, the bottom of the white arc). Fig 5-1's own
// 40 KIAS points (46 / 44 / 43 KCAS) are replaced: they lie at or beyond the stall's angle of attack.
export const C152_AIR_DATA: AirDataDef = {
  calibration: [
    { flapDeg: 0, cas: [46, 48, 53, 60, 69, 78, 88, 97, 107, 117, 127, 136], ias: [36, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140] },
    { flapDeg: 10, cas: [43, 46, 52, 61, 70, 80, 84], ias: [36, 40, 50, 60, 70, 80, 85] },
    { flapDeg: 30, cas: [41, 43, 51, 61, 71, 82, 87], ias: [31, 35, 50, 60, 70, 80, 85] },
  ],
  referenceMass: MAX_TAKEOFF,
  asiAliveKt: [18, 35],
};

// Autopilot gains (physics/autopilot.ts; the 152 has none of its own, these drive the scripted pilot and the hold
// keys). The 172's scaled by control power over inertia (contract 3.4): about 1.4 x the 172's elevator power per
// unit Iyy and 1.4 x its aileron power per unit Ixx, so the surface gains are about 0.7 x; then tuned on the
// flown checks.
export const C152_AUTOPILOT: AutopilotGains = {
  // About 85 KTAS at sea level, Pa.
  qRef: 1150,
  pitchKp: 1.6,
  pitchKi: 0.45,
  pitchKq: 0.65,
  rollKp: 1.15,
  rollKd: 0.25,
  rollKi: 0.1,
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
  rudderLimit: 0.6,
  trimRate: 0.08,
  pitchLimit: 20 * DEG,
  trimEquivalence: (PITCH_TRIM.floatRatio * PITCH_TRIM.tabDown) / C152_GEOMETRY.hTail.elevator.maxUp,
  // Settings: 80 KIAS, 500 ft/min, bank limit 25 deg.
  defaults: { airspeed: 41, verticalSpeed: 2.5, maxBank: 25 * DEG },
};
