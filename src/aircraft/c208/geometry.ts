// Cessna 208 Caravan 675 (PT6A-114A, 8000 lb): the geometric facts physics and the 3D model must agree on.
//
// Sources: the 208 POH section 1 and the three-view (span 52 ft 1 in, length 37 ft 7 in, height 14 ft 10 in,
// wing area 279.4 ft^2, propeller 106 in, wheelbase 11 ft 7.6 in, track 11 ft 8 in), Jane's (wing sections NACA
// 23017.424 at the root, 23012 at the tip; dihedral 3 degrees; Fowler flaps), the TCDS A37CE (control travels,
// MAC 69.4 in). Lengths scaled from the three-view are marked 3V (about +/-0.05 m); ESTIMATE marks a number that is
// derived or judged rather than published. No engineering data sheet exists for this type yet: every 3V and
// ESTIMATE figure is a first pick to be refined against one.
//
// All positions are in body axes (FRD: x forward, y right, z DOWN), metres, relative to the type's REFERENCE
// POINT: on the centreline, longitudinally at the quarter-chord of the wing mean aerodynamic chord, at the height
// of the nominal centre of gravity (C208_THRUST_Z below).
// Landmarks checked:
//   length      spinner tip x +4.00, rudder trailing edge x -7.46: 11.46 m (POH 37 ft 7 in = 11.46 m)
//   wheelbase   nose wheel x +3.08, main wheels x -0.47: 3.55 m (POH 11 ft 7.6 in = 3.55 m)
//   track       2 x 1.778 = 3.56 m (POH 11 ft 8 in)
//   height      fin tip 2.84 m above the thrust line, which sits 1.68 m above the ground: 4.52 m (POH 14 ft 10 in)
//   propeller   hub on the thrust line 1.68 m up, radius 1.346 m: 0.33 m of ground clearance (POH about 11 in, 3V)

import { DEG } from '../../core/math';
import type { AircraftGeometry } from '../types';

/**
 * Height of the thrust line in these axes, m (z down): the reference point is at the height of the nominal CG,
 * which the 1000 kg of fuel in the high wing lifts about 0.22 m above the thrust line at maximum weight (systems.ts).
 * Every height below is written as the thrust line plus its height measured from it.
 */
export const C208_THRUST_Z = 0.225;
const T = C208_THRUST_Z;

export const C208_GEOMETRY: AircraftGeometry = {
  // --- Wing (NACA 23017.424 at the root to NACA 23012 at the tip; high wing, one lift strut a side) ---
  wing: {
    mount: 'high',
    /** POH: 52 ft 1 in. */
    span: 15.88,
    /** POH: 279.4 ft^2. The planform below, run to span / 2, covers 26.0. */
    area: 25.96,
    /** 3V: constant chord from the centreline to WS 102 (the lift-strut rib), about 75 in. */
    rootChord: 1.9,
    /** 3V: about 44 in at the tip rib. */
    tipChord: 1.11,
    /** 3V: the lift-strut rib. */
    taperStartY: 2.6,
    /** TCDS: MAC 69.4 in (the planform's integral of c^2 gives 1.68). */
    meanChord: 1.76,
    /** The wing chord plane at the root, 1.0 m above the thrust line (3V). The quarter-chord line is straight (unswept). */
    quarterChord: { x: 0, z: T - 1.0 },
    /** Jane's: 3 degrees. */
    dihedral: 3 * DEG,
    /** ESTIMATE (Cessna practice, the 208's sections and washout): +2.6 degrees at the root, -0.6 at the tip. */
    rootIncidence: 2.6 * DEG,
    tipIncidence: -0.6 * DEG,
    /** Half the 1.62 m external cabin width at the wing (3V). */
    rootY: 0.81,
    /**
     * Single-slotted Fowler flaps from the cabin side to about 63 % of the semi-span (3V), 0.30 of the chord
     * stowed, 0 to 30 degrees (POH: UP, 10, 20, FULL).
     */
    flap: { innerY: 0.86, outerY: 5.0, chordFraction: 0.3, maxDeflection: 30 * DEG },
    /**
     * Ailerons outboard of the flaps to the tip rib (3V), 0.26 of the chord, 25 degrees up, 17 down (TCDS ESTIMATE).
     * The roll spoilers ahead of the flaps' outer ends are not modelled (the ailerons carry the roll power).
     */
    aileron: { innerY: 5.0, outerY: 7.75, chordFraction: 0.26, maxUp: 25 * DEG, maxDown: 17 * DEG },
    /** 3V, right side: lower end on the fuselage side at the main-gear frame, upper end on the front spar at WS 102. */
    strut: { fuselage: { x: -0.15, y: 0.86, z: T + 0.56 }, wing: { x: 0.18, y: 2.6, z: T - 0.93 } },
  },

  // --- Horizontal tail (fixed stabiliser and elevator on the tailcone) ---
  hTail: {
    mount: 'fuselage',
    allMoving: false,
    /** POH three-view: 20 ft 6 in. */
    span: 6.25,
    /** 3V: about 72 ft^2 gross. */
    area: 6.72,
    /** 3V. */
    rootChord: 1.3,
    tipChord: 0.85,
    /** 3V: root quarter-chord on the tailcone, 6.1 m aft of the wing's (the tail arm), 0.62 m above the thrust line. */
    quarterChord: { x: -6.1, z: T - 0.62 },
    /** 3V: the leading edge is swept, the hinge line straight. */
    tipQuarterChordX: -6.32,
    /** ESTIMATE: -2 degrees. */
    incidence: -2 * DEG,
    /** 3V: 0.40 of the chord aft of the hinge; TCDS ESTIMATE: 25 degrees up, 20 down. */
    elevator: { chordFraction: 0.4, maxUp: 25 * DEG, maxDown: 20 * DEG },
  },

  // --- Vertical tail (large swept fin and rudder with a dorsal fairing) ---
  vTail: {
    /** 3V: fin and rudder about 41 ft^2. */
    area: 3.8,
    /** 3V: from the tailcone top to the fin tip. */
    height: 2.2,
    rootChord: 2.25,
    tipChord: 1.2,
    /** 3V: quarter-chord of the fin at the tailcone top and at its tip; the rudder's trailing edge then ends at x -7.24 (root) and -7.45 (tip). */
    base: { x: -5.55, z: T - 0.64 },
    tip: { x: -6.55, z: T - 2.84 },
    /** 3V: 0.38 of the chord; TCDS ESTIMATE: 20 degrees each way (streamwise). */
    rudder: { chordFraction: 0.38, maxDeflection: 20 * DEG },
  },

  // --- Fuselage ---
  fuselage: {
    /** POH: 37 ft 7 in. */
    length: 11.46,
    /** Spinner tip. */
    noseX: 4.0,
    /** The rudder's trailing edge at the fin tip; the tailcone itself ends at -7.25 (3V). */
    tailX: -7.46,
    /** External cabin width (3V; the cabin is 64 in wide inside). */
    maxWidth: 1.75,
    /** Belly to cabin roof at mid-cabin (3V; the cabin is 54 in high inside). */
    maxHeight: 2.0,
    /** Pilot eye point, left seat: 3V, the seat FS ahead of the wing leading edge, about 0.8 m above the cabin floor. */
    pilotEye: { x: 1.35, y: -0.38, z: T - 0.62 },
  },

  // --- Landing gear: tyre contact points with struts fully extended ---
  // Static contact points (3V) 1.68 m below the thrust line at both: the Caravan stands about level. Fully extended they hang lower by
  // the static deflection of gear.ts's springs at maximum weight (nose about 0.06 m, mains about 0.06 m).
  gear: {
    nose: { x: 3.08, y: 0, z: T + 1.74 },
    leftMain: { x: -0.47, y: -1.778, z: T + 1.745 },
    rightMain: { x: -0.47, y: 1.778, z: T + 1.745 },
    /** 22 x 8.00-8 (POH). */
    noseWheelRadius: 0.28,
    /** 6.50-10 (POH). */
    mainWheelRadius: 0.31,
    /** POH: about 15 degrees with the pedals (castering to 56 with differential braking). */
    maxNoseSteer: 15 * DEG,
    retractable: false,
  },

  // --- Propeller (McCauley 3GFR34C703 three-blade 106 in (TCDS IM.A.226 sect. 6.2), constant speed, full feathering, reversible; clockwise from the cockpit) ---
  propellers: [{ hub: { x: 3.75, y: 0, z: T }, diameter: 106 * 0.0254, blades: 3, rotation: 1 }],

  // ESTIMATE, from the static contact points above: the thrust line 1.68 m above the ground.
  restHeight: T + 1.68,
  // The farthest point (the rudder's top trailing edge, about 7.6 m from the reference point) plus 0.3 m; span + 2 m.
  bounds: { radius: 8.3, fitSize: 17.9 },
};
