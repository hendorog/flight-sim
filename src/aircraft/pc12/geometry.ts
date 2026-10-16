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
//   height h above level ground, aircraft at rest on its wheels:                              z = 1.30 - h
// ESTIMATE: the MAC quarter-chord at station 6.00 m. The MAC (1.585 m DERIVED: 25.81 / 16.28) is not located by
// any source obtained; the TCDS CG envelope at 4740 kg, 5.898-6.107 m, is 13 % MAC wide and is taken as about
// 18-31 % MAC, which puts the quarter-chord near 6.00 m. ESTIMATE: the nominal CG 1.30 m above the ground (low
// wing, cabin floor about 0.75 m up; the fuel is in the wing).
// Landmarks:
//   length     spinner tip station 0.55 (ESTIMATE, 3V) + 14.408 (TCDS) = tail end at station 14.958
//   wheelbase  nose 2.82 (W&B arm 110.8-111.9 in) to mains 6.30 (W&B 247.7-254.8 in with strut extension): 3.48 (3V)
//   track      4.53 (3V, 14 ft 10 in)
//   height     fin / T-tail top 4.26 above the ground (TCDS)

const S = (station: number): number => 6.0 - station;
const H = (height: number): number => 1.3 - height;
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
    nose: { x: S(3.2), y: 0, z: H(0.75) },
    leftMain: { x: S(6.25), y: -1.05, z: H(0.62) },
    rightMain: { x: S(6.25), y: 1.05, z: H(0.62) },
  },
  /** Retract hinge axes (unit vectors, body axes): mains swing inward about a fore-aft axis, nose aft about a lateral axis. ESTIMATE. */
  hinges: {
    nose: { axis: { x: 0, y: 1, z: 0 }, pivot: { x: S(2.75), y: 0, z: H(0.95) } },
    leftMain: { axis: { x: 1, y: 0, z: 0 }, pivot: { x: S(6.2), y: -1.95, z: H(0.85) } },
    rightMain: { axis: { x: -1, y: 0, z: 0 }, pivot: { x: S(6.2), y: 1.95, z: H(0.85) } },
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
  /** Root chord plane 0.70 m above the ground (3V ESTIMATE): 0.60 m below the reference point. */
  rootChordPlaneZ: H(0.7),
  quarterChordX: 0,
  flap: { innerY: 0.84, outerY: 5.05, detentsDeg: [0, 15, 30, 40] as const },
  aileron: { innerY: 5.15, outerY: 7.95 },
  winglet: { height: 0.45, rootY: 8.14 },
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
  finBase: { x: S(13.1), z: H(2.0) },
  finTip: { x: S(13.95), z: H(4.0) },
  tailEndX: S(14.958),
} as const;

/** Fuselage: width 1.69 m (3V), depth about 1.83 m (3V); cabin 1.52 wide, 1.45 high (47E-PROXY 1-8). */
export const PC12_FUSELAGE = {
  length: 14.408,
  noseX: S(0.55),
  tailX: S(14.958),
  maxWidth: 1.69,
  maxHeight: 1.83,
  bellyZ: H(0.5),
  roofZ: H(2.33),
} as const;

/**
 * Pilot's eye, LEFT seat (single-pilot PIC): seat arm 160.27 in = station 4.071 (W&B); eye ESTIMATE 0.07 m ahead of
 * it, 0.40 m left of the centreline, 2.03 m above the ground (about 0.30 m below the cockpit roof).
 */
export const PC12_EYE = { x: S(4.0), y: -0.4, z: H(2.03) } as const;

/** Reference point above the ground at rest on the wheels, m (geometry.restHeight). */
export const PC12_REST_HEIGHT = 1.3;
