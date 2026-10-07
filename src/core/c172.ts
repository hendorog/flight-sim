// Cessna 172S Skyhawk SP: the geometric and mass facts that the flight model and the 3D model must agree on.
//
// All positions are in body axes (FRD: x forward, y right, z DOWN), metres, relative to the aircraft
// REFERENCE POINT: on the centreline, longitudinally at the quarter-chord of the wing mean aerodynamic chord
// (the nominal centre of gravity), 1.25 m above the ground when the aircraft rests on its wheels.
// AircraftState.position is this point. The 3D model's origin is this point (nose toward three.js -Z).

import { DEG, HP, LB } from './math';

export const C172 = {
  // --- Wing (NACA 2412, high wing, strut braced) ---
  wing: {
    span: 11.0,
    area: 16.17,
    /** Constant-chord inboard section out to `taperStartY`, then linear taper to the tip. */
    rootChord: 1.626,
    tipChord: 1.13,
    taperStartY: 2.54,
    meanChord: 1.494,
    /** Quarter-chord line position at the root (straight, unswept quarter-chord... leading edge is straight inboard). */
    quarterChord: { x: 0, z: -0.62 },
    dihedral: 1.73 * DEG,
    /** Incidence relative to the fuselage reference line. */
    rootIncidence: 1.5 * DEG,
    tipIncidence: -1.5 * DEG,
    /** Half-width of the fuselage/cabin where the wing panels begin. */
    rootY: 0.53,
    flap: { innerY: 0.64, outerY: 2.6, chordFraction: 0.3, maxDeflection: 30 * DEG },
    aileron: { innerY: 2.6, outerY: 5.2, chordFraction: 0.26, maxUp: 20 * DEG, maxDown: 15 * DEG },
    /** Lift strut attach points: fuselage (lower) and wing (upper), right side. */
    strut: { fuselage: { x: 0.1, y: 0.55, z: 0.55 }, wing: { x: -0.05, y: 2.45, z: -0.58 } },
  },

  // --- Horizontal tail (NACA 0009-ish) ---
  hTail: {
    span: 3.45,
    area: 3.35,
    rootChord: 1.15,
    tipChord: 0.76,
    quarterChord: { x: -4.6, z: -0.25 },
    incidence: -1.0 * DEG,
    elevator: { chordFraction: 0.42, maxUp: 28 * DEG, maxDown: 23 * DEG },
  },

  // --- Vertical tail ---
  vTail: {
    /** Fin + rudder. */
    area: 1.73,
    height: 1.55,
    rootChord: 1.42,
    tipChord: 0.72,
    /** Quarter-chord of the fin at its base and tip. */
    base: { x: -4.55, z: -0.3 },
    tip: { x: -5.3, z: -1.47 },
    rudder: { chordFraction: 0.4, maxDeflection: 16 * DEG },
  },

  // --- Fuselage ---
  fuselage: {
    length: 8.28,
    /** Spinner tip and tail cone end. */
    noseX: 2.25,
    tailX: -6.03,
    maxWidth: 1.06,
    maxHeight: 1.22,
    /** Pilot eye point (left seat). */
    pilotEye: { x: -0.18, y: -0.27, z: -0.42 },
  },

  // --- Landing gear: tyre contact points with struts fully extended ---
  gear: {
    nose: { x: 1.21, y: 0, z: 1.31 },
    leftMain: { x: -0.44, y: -1.275, z: 1.33 },
    rightMain: { x: -0.44, y: 1.275, z: 1.33 },
    noseWheelRadius: 0.19,
    mainWheelRadius: 0.22,
    maxNoseSteer: 10 * DEG,
  },

  // --- Propeller (McCauley 1A170E/JHA7660, fixed pitch, clockwise seen from the cockpit) ---
  prop: {
    hub: { x: 1.95, y: 0, z: 0 },
    diameter: 1.93,
    blades: 2,
    /** Geometric pitch, inches (the "60" in 7660). */
    pitchIn: 60,
  },

  // --- Engine (Lycoming IO-360-L2A) ---
  engine: {
    ratedPower: 180 * HP,
    ratedRpm: 2700,
    idleRpm: 600,
    displacementM3: 5.916e-3,
  },

  // --- Mass properties ---
  mass: {
    empty: 1663 * LB,
    maxTakeoff: 2550 * LB,
    /** Usable fuel, kg (53 US gal of 100LL), split evenly between two wing tanks. */
    usableFuel: 144,
    /** Tank centroid. */
    tank: { x: 0.0, y: 1.4, z: -0.62 },
    /** Default payload: pilot + passenger, kg, and its position. */
    crew: 160,
    crewPos: { x: -0.1, y: 0, z: -0.05 },
    /** Moments of inertia about the reference point at a typical loaded weight, kg*m^2. */
    Ixx: 1285,
    Iyy: 1825,
    Izz: 2667,
    Ixz: 0,
  },

  // --- Pilot's Operating Handbook reference performance (max gross, sea level ISA unless noted) ---
  poh: {
    stallCleanKcas: 53,
    stallFullFlapKcas: 48,
    vxKias: 62,
    vyKias: 74,
    bestGlideKias: 68,
    glideRatio: 9.0,
    vneKias: 163,
    vnoKias: 129,
    vfeKias: 85,
    maxSpeedSeaLevelKtas: 126,
    climbRateSeaLevelFpm: 730,
    cruise75pct8000ftKtas: 124,
    staticRpm: [2300, 2400] as [number, number],
    takeoffGroundRollM: 293,
    landingGroundRollM: 175,
    serviceCeilingFt: 14000,
  },
} as const;
