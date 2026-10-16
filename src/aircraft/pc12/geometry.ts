// Pilatus PC-12/47: the geometric facts the flight model, the 3D model, the panel and the sound must agree on. Plain
// data, written at the scaffold; owner afterwards: P1 (P2/P3/A1 read it and request changes in their PR text).
// P1 builds PC12_GEOMETRY (AircraftGeometry) from these objects when it wires the definition.
//
// Sources (docs/pc12-sources.md): TCDS = EASA TCDS A.089 Issue 11 sect. C (span 16.28 m, length 14.408 m, height
// 4.26 m, wing area 25.81 m^2, propeller 2.67 m / 4 blades / clockwise from behind, CG envelope and datum);
// 3V = measured on the POH three-view Fig 1-1 (47E-PROXY, same airframe; about +/-0.05 m); W&B = 47E-PROXY weight
// and balance arms (Fig 6-1A, 6-16, 6-17); ESTIMATE = judged, no source.
//
// AXES. Body FRD (x forward, y right, z DOWN), metres, about the REFERENCE POINT: on the centreline, at the
// quarter-chord of the wing MAC, at the height of the nominal CG.
//   station s (m aft of the datum, which is 3.000 m forward of the firewall, TCDS C.III.14):  x = 6.00 - s
//   height h above level ground, aircraft at rest on its wheels:                              z = 1.54 - h
// ESTIMATE: the MAC quarter-chord at station 6.00 m. The MAC (1.644 m DERIVED from the trapezoid below) is not
// located by any source obtained; the TCDS CG envelope at 4740 kg, 5.898-6.107 m, is 13 % MAC wide and is taken as
// about 19-31 % MAC, which puts the quarter-chord near 6.00 m. The nominal CG 1.54 m above the ground: DERIVED from
// the mass model of systems.ts at the maxGross loading (the empty aircraft about 1.62 m: the PT6 on the thrust line,
// the pressure cabin above a floor 1.18 m up; the fuel in the wing about 1.25 m; the occupants about 1.73 m), on the
// 3V heights P2 measured (belly 0.93, roof 2.73, wing root chord plane 1.05, floor 1.18 m: docs/pc12-exterior.md).
// The scaffold had 1.30 m, read from the fuselage-depth bracket of Fig 1-1 as if it stood on the ground.
// Landmarks:
//   length     spinner tip station 0.55 (ESTIMATE, 3V) + 14.408 (TCDS) = tail end at station 14.958
//   wheelbase  nose 2.82 (W&B arm 110.8-111.9 in) to mains 6.30 (W&B 247.7-254.8 in with strut extension): 3.48 (3V)
//   track      4.53 (3V, 14 ft 10 in)
//   height     fin / T-tail top 4.26 above the ground (TCDS)

import type { AircraftGeometry } from '../types';

const S = (station: number): number => 6.0 - station;
/** Height of the reference point (the nominal CG) above the ground at rest, m. */
const REF_H = 1.54;
const H = (height: number): number => REF_H - height;
const DEG = Math.PI / 180;

/** Height of the thrust line (propeller hub) in these axes, m (z down). */
export const PC12_THRUST_Z = H(1.635);

/**
 * Propeller: Hartzell HC-E4A-3D, 4 blades, 2.67 m (105 in), clockwise seen from behind (`rotation` +1), TCDS
 * C.III.6. Blade angles are quoted at the 42 in station = 0.80 R (`STATION`). Hub: ESTIMATE station 0.95 (3V,
 * PT6A-67 1.92 m long ahead of the firewall, reverse flow, gearbox forward); 1.635 m above the ground (ESTIMATE:
 * about 0.30 m of tip clearance at rest, 3V).
 */
export const PC12_PROP = {
  hub: { x: S(0.95), y: 0, z: PC12_THRUST_Z },
  diameter: 2.67,
  blades: 4,
  rotation: 1 as const,
  STATION: 42 / 52.5,
  spinnerTipX: S(0.55),
} as const;

/**
 * Landing gear: tricycle, hydraulic, trailing-link mains retracting inward, nose aft (47E-PROXY 7-4). Static
 * positions on the wheels (contact points at z = H(0)). Nose 17.5x6.25-6 (radius 0.222), mains 8.50-10 (radius
 * ESTIMATE 0.32) (TCDS C.III.19). Steering +/-12 deg by the pedals, castoring to +/-60 deg with differential
 * braking. Trailing link: the main wheel moves about 0.18 m aft as the strut compresses from 310 to 110 mm
 * (W&B arms, 47E-PROXY Fig 6-1A); `mainTrailShift` is that travel.
 * Stowed: mains inward into the wing root / fuselage junction, wheels about 25 mm proud; nose aft into the nose
 * bay, fully enclosed (ESTIMATE positions, 3V).
 */
export const PC12_GEAR = {
  nose: { x: S(2.82), y: 0, z: H(0) },
  leftMain: { x: S(6.3), y: -4.53 / 2, z: H(0) },
  rightMain: { x: S(6.3), y: 4.53 / 2, z: H(0) },
  noseWheelRadius: 0.222,
  mainWheelRadius: 0.32,
  maxNoseSteer: 12 * DEG,
  castorLimit: 60 * DEG,
  mainTrailShift: 0.18,
  track: 4.53,
  wheelbase: 3.48,
  stowed: {
    nose: { x: S(3.62), y: 0, z: H(1.29) },
    leftMain: { x: S(6.3), y: -1.51, z: H(1.08) },
    rightMain: { x: S(6.3), y: 1.51, z: H(1.08) },
  },
  /**
   * Retract hinge axes (unit vectors, body axes), pivots and swing angles, 3V as P2 drew them: the mains inward about
   * a fore-aft axis through the wheel's span, 90 deg; the nose aft about a lateral axis, -96 deg.
   */
  hinges: {
    nose: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: S(2.74), y: 0, z: H(1.12) }, angle: -96 * DEG },
    leftMain: { axis: { x: 1, y: 0, z: 0 }, pivot: { x: S(5.92), y: -4.53 / 2, z: H(1.08) }, angle: 90 * DEG },
    rightMain: { axis: { x: 1, y: 0, z: 0 }, pivot: { x: S(5.92), y: 4.53 / 2, z: H(1.08) }, angle: -90 * DEG },
  },
} as const;

/**
 * Wing: low, straight-tapered, NASA LS(1)-0417 MOD root / LS(1)-0313 tip (SECONDARY, UIUC), span 16.28 (TCDS),
 * area 25.81 (TCDS), aspect ratio 10.27 (DERIVED), dihedral about 5 deg (3V ESTIMATE +/-1.5), small upturned winglets
 * (PHOTO). Root chord 2.10, tip chord 1.08 (3V ESTIMATE; the trapezoid then has 25.9 m^2 to the centreline).
 * Fowler flaps 0/15/30/40 deg, electric (47E-PROXY 7-3), from the fuselage side to about 62 % semi-span (3V ESTIMATE).
 */
export const PC12_WING = {
  span: 16.28,
  area: 25.81,
  meanChord: 25.81 / 16.28,
  rootChord: 2.1,
  tipChord: 1.08,
  rootY: 0.84,
  dihedral: 5 * DEG,
  /** Root chord plane 1.05 m above the ground (3V front view 1.03-1.10 m, P2's measurement). */
  rootChordPlaneZ: H(1.05),
  quarterChordX: 0,
  flap: { innerY: 0.84, outerY: 5.05, detentsDeg: [0, 15, 30, 40] as const },
  aileron: { innerY: 5.15, outerY: 7.8 },
  /** The flat wing ends at 7.88 m; the 0.45 m winglet, canted 62 deg up, reaches the TCDS half span (3V / PHOTO, P2). */
  winglet: { height: 0.45, rootY: 7.88, cant: 62 * DEG },
} as const;

/**
 * Tail: T-tail with a trimmable horizontal stabiliser (no trim tab) and a bullet fairing at the fin junction,
 * dorsal fin, ventral fin and a pair of ventral strakes (PHOTO). Tailplane span 5.20 (3V, 17 ft 1 in); tailplane
 * chord plane 4.05 m above the ground (3V ESTIMATE; fin tip / fairing top 4.26, TCDS). Tailplane quarter-chord at
 * station 13.85 (3V ESTIMATE): tail arm about 7.85 m.
 */
export const PC12_TAIL = {
  mount: 'tTail' as const,
  hSpan: 5.2,
  hQuarterChord: { x: S(13.85), z: H(4.05) },
  hRootChord: 1.25,
  hTipChord: 0.75,
  finTipHeight: 4.26,
  /** Fin quarter-chord at its base inside the tailcone (leading edge station 11.80, chord 1.95, 2.05 m up) and at its tip under the tailplane (leading edge 13.35, chord 1.20): 3V, P2. */
  finBase: { x: S(11.8 + 0.25 * 1.95), z: H(2.05) },
  finTip: { x: S(13.35 + 0.25 * 1.2), z: H(4.05) },
  finRootChord: 1.95,
  finTipChord: 1.2,
  /** Tailplane tip quarter-chord: the leading edge swept about 12 deg (3V top view, P2). */
  hTipQuarterChordX: S(13.85) - 0.42,
  tailEndX: S(14.958),
} as const;

/** Fuselage: width 1.69 m (3V), belly 0.93 m and roof 2.73 m up (3V, P2); cabin 1.52 wide, 1.45 high inside (47E-PROXY 1-8). */
export const PC12_FUSELAGE = {
  length: 14.408,
  noseX: S(0.55),
  tailX: S(14.958),
  maxWidth: 1.69,
  maxHeight: 2.73 - 0.93,
  bellyZ: H(0.93),
  roofZ: H(2.73),
} as const;

/**
 * Pilot's eye, LEFT seat (single-pilot PIC): station 4.20, 0.13 m aft of the W&B pilot arm (160.27 in = 4.071 m, the
 * occupant's CG), 0.40 m left of the centreline, 2.33 m above the ground (1.15 m above the floor; 3V, P2).
 */
export const PC12_EYE = { x: S(4.2), y: -0.4, z: H(2.33) } as const;

/** Reference point above the ground at rest on the wheels, m (geometry.restHeight). */
export const PC12_REST_HEIGHT = REF_H;

// ------------------------------------------------------------------------------------------------ the definition's
// AircraftGeometry, built from the shared facts above (P1). Every number not in the objects above is written here
// with its tag.

/** Mean aerodynamic chord of the straight-tapered wing, m: 2/3 cr (1 + l + l^2) / (1 + l), l = 1.08 / 2.10. DERIVED. */
export const PC12_MAC = (() => {
  const l = PC12_WING.tipChord / PC12_WING.rootChord;
  return ((2 / 3) * PC12_WING.rootChord * (1 + l + l * l)) / (1 + l);
})();

/**
 * Wing incidence at the root and the tip, rad. ESTIMATE (2.5 deg of washout); CALIBRATED on the attitudes: the
 * fuselage about level in the fast cruise and a few degrees nose-down on a flaps-40 approach.
 */
const ROOT_INCIDENCE = 0.5 * DEG;
const TIP_INCIDENCE = -2.0 * DEG;
/** Winglet: 0.45 m along itself, canted 62 deg up, chord 0.95 -> 0.45 m, leading edge swept 32 deg (3V / PHOTO, as P2 drew it). */
const WINGLET = { height: PC12_WING.winglet.height, cant: PC12_WING.winglet.cant, rootChord: 0.95, tipChord: 0.45, sweep: 32 * DEG, rootY: PC12_WING.winglet.rootY };

/**
 * Static compression of the legs at the design loading (gear.ts), m: the fully extended contact points hang this much
 * below the static ones of PC12_GEAR (nose oleo + tyre, main oleo + tyre). The main legs are trailing links: the
 * wheel moves up and AFT as the leg compresses, along an axis tilted aft by PC12_MAIN_LEG_TILT (mainTrailShift 0.18 m
 * over the 0.20 m of travel), so the extended main wheels also sit forward of the static ones by sag x tan(tilt).
 */
export const PC12_GEAR_STATIC_SAG = { nose: 0.075, main: 0.1 } as const;
export const PC12_MAIN_LEG_TILT = Math.atan2(PC12_GEAR.mainTrailShift, 0.2);
const MAIN_FORWARD = PC12_GEAR_STATIC_SAG.main * Math.tan(PC12_MAIN_LEG_TILT);

export const PC12_GEOMETRY: AircraftGeometry = {
  wing: {
    mount: 'low',
    span: PC12_WING.span,
    area: PC12_WING.area,
    meanChord: PC12_MAC,
    rootChord: PC12_WING.rootChord,
    tipChord: PC12_WING.tipChord,
    taperStartY: 0,
    // Unswept quarter-chord line (3V ESTIMATE), at the reference point's x; the root chord plane 0.70 m up.
    quarterChord: { x: PC12_WING.quarterChordX, z: PC12_WING.rootChordPlaneZ },
    dihedral: PC12_WING.dihedral,
    rootIncidence: ROOT_INCIDENCE,
    tipIncidence: TIP_INCIDENCE,
    rootY: PC12_WING.rootY,
    // Single-piece Fowler a side (47E-PROXY 7-3), about 0.30 of the chord stowed (3V ESTIMATE), 0 / 15 / 30 / 40 deg.
    flap: { innerY: PC12_WING.flap.innerY, outerY: PC12_WING.flap.outerY, chordFraction: 0.3, maxDeflection: 40 * DEG },
    // Ailerons with geared balance tabs (47E-PROXY 7-3): about 0.26 of the chord; travel ESTIMATE 20 up / 15 down.
    aileron: { innerY: PC12_WING.aileron.innerY, outerY: PC12_WING.aileron.outerY, chordFraction: 0.26, maxUp: 20 * DEG, maxDown: 15 * DEG },
    winglet: WINGLET,
  },
  hTail: {
    mount: 'tTail',
    // A trimmable stabiliser with a plain elevator (not a stabilator): the trim turns the stabiliser
    // (PitchTrimDef 'stabilizer', SurfaceState.elevatorTrim), the yoke the elevator.
    allMoving: false,
    span: PC12_TAIL.hSpan,
    area: (PC12_TAIL.hSpan * (PC12_TAIL.hRootChord + PC12_TAIL.hTipChord)) / 2,
    rootChord: PC12_TAIL.hRootChord,
    tipChord: PC12_TAIL.hTipChord,
    quarterChord: PC12_TAIL.hQuarterChord,
    tipQuarterChordX: PC12_TAIL.hTipQuarterChordX,
    // ESTIMATE: the stabiliser's rigging with the trim at zero; the trim adds -4 .. +2.5 deg (systems.ts). CALIBRATED so
    // that the trim's travel covers a flaps-40 approach at the forward limit and a Vmo descent at the aft limit.
    incidence: -0.7 * DEG,
    // ESTIMATE: 0.36 of the chord; 20 deg up, 15 down.
    elevator: { chordFraction: 0.36, maxUp: 20 * DEG, maxDown: 15 * DEG },
  },
  vTail: {
    // 3V (P2): the trapezoid of the swept fin and rudder, without the dorsal fin.
    area: ((PC12_TAIL.finBase.z - PC12_TAIL.finTip.z) * (PC12_TAIL.finRootChord + PC12_TAIL.finTipChord)) / 2,
    height: PC12_TAIL.finBase.z - PC12_TAIL.finTip.z,
    rootChord: PC12_TAIL.finRootChord,
    tipChord: PC12_TAIL.finTipChord,
    base: PC12_TAIL.finBase,
    tip: PC12_TAIL.finTip,
    // ESTIMATE: 0.34 of the chord, 25 deg each way.
    rudder: { chordFraction: 0.34, maxDeflection: 25 * DEG },
  },
  fuselage: {
    length: PC12_FUSELAGE.length,
    noseX: PC12_FUSELAGE.noseX,
    tailX: PC12_FUSELAGE.tailX,
    maxWidth: PC12_FUSELAGE.maxWidth,
    maxHeight: PC12_FUSELAGE.maxHeight,
    pilotEye: PC12_EYE,
  },
  gear: {
    nose: { ...PC12_GEAR.nose, z: PC12_GEAR.nose.z + PC12_GEAR_STATIC_SAG.nose },
    leftMain: { ...PC12_GEAR.leftMain, x: PC12_GEAR.leftMain.x + MAIN_FORWARD, z: PC12_GEAR.leftMain.z + PC12_GEAR_STATIC_SAG.main },
    rightMain: { ...PC12_GEAR.rightMain, x: PC12_GEAR.rightMain.x + MAIN_FORWARD, z: PC12_GEAR.rightMain.z + PC12_GEAR_STATIC_SAG.main },
    noseWheelRadius: PC12_GEAR.noseWheelRadius,
    mainWheelRadius: PC12_GEAR.mainWheelRadius,
    maxNoseSteer: PC12_GEAR.maxNoseSteer,
    retractable: true,
  },
  propellers: [{ hub: PC12_PROP.hub, diameter: PC12_PROP.diameter, blades: PC12_PROP.blades, rotation: PC12_PROP.rotation }],
  restHeight: PC12_REST_HEIGHT,
  // The farthest point (the tailplane tip, about 9.2 m from the reference point) plus 0.3 m; span + 2 m.
  bounds: { radius: 9.5, fitSize: PC12_WING.span + 2 },
};
