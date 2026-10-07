// Diamond DA 42 NG: the geometric facts physics and the 3D model must agree on. Plain data, transcribed from
// the engineering data sheet of the type (da42.md; "s.N" below is its section N, "VN" its verification notes).
// AFM / TCDS = published; 3V = measured on the AFM three-view (+/-3 cm on a point); EST = an estimate.
//
// COORDINATES. Body axes FRD (x forward, y right, z DOWN), metres, about the REFERENCE POINT: on the centre
// line, at the quarter-chord of the wing MAC, at the nominal height of the CG.
//   x: the MAC leading edge is 2.14 m aft of the AFM datum (s.2.1) and the MAC is 1.271 m, so its quarter-chord
//      is at station 2.46 m (s.2.3 "tail arm", s.2.6).
//   z: the CG is about 0.20 m above the wing root chord plane (s.2.6, EST), which is 0.85 m above the ground
//      with the aircraft on its wheels (s.2.1): the reference point rests 1.05 m above the ground.
// Conversions, from the three forms the data sheet uses:
//   station s (m aft of the datum, s.2.1-2.5, s.3, s.6):        x = 2.46 - s
//   height h above the ground, on the wheels (s.2, s.12):       z = 1.05 - h
//   s.2.6 key points (x forward, y right, z UP, origin 2.29 m
//   aft of the datum on the root chord plane):                  x = x26 + 0.17,  y = y26,  z = 0.20 - z26
//   s.12 fuselage and nacelle stations (m aft of the nose tip, which is 0.55 m ahead of the datum):
//                                                               x = 3.01 - xNose
// Checked with landmarks that do not depend on one another:
//   tail arm: tailplane MAC quarter-chord at station 7.32 -> x = -4.86; s.2.6 gives -5.03 + 0.17 = -4.86; the
//     data sheet's tail arm is 4.86 m (s.2.3).
//   wheelbase: stations 0.91 and 2.65 (s.3) -> 1.55 and -0.19; s.2.6 gives 1.38 + 0.17 and -0.36 + 0.17, the
//     same; 1.74 m against the published 1.735 m (AFM 1.4).
//   overall length: nose tip at station -0.55 -> 3.01, rudder trailing edge at 8.01 -> -5.55: 8.56 m (AFM 1.4).
//   the planform below (wing.breaks), integrated: area-weighted quarter-chord at station 2.4603, i.e.
//     x = 0.000; MAC 1.287 m at y = 2.85 m (VN "arithmetic": 1.287 m, 2.85 m).
//   height: propeller hub 1.16 m above the ground -> z = -0.11; s.2.6 gives 0.20 - 0.31 = -0.11; tip
//     clearance 1.16 - 0.935 = 0.225 m (s.2.5: 0.22 m).
// The loaded CG is at stations 2.350-2.480 m (AFM 2.8, s.6): x = +0.11 to -0.02, at or just ahead of this point.

import { DEG } from '../../core/math';
import type { AircraftGeometry } from '../types';

export const DA42_GEOMETRY: AircraftGeometry = {
  // --- Wing (s.2.1, s.2.2: Wortmann FX 63-137/20 - W4, low wing, centre wing between the nacelles + outer wings) ---
  wing: {
    mount: 'low',
    span: 13.42, // s.2.1 (AFM 1.4); 13.55 over the tip lights
    area: 16.29, // s.2.1 (AFM 1.4)
    meanChord: 1.271, // s.2.1 (AFM 1.4)
    // `breaks` is the planform: these two repeat its ends.
    rootChord: 1.86, // s.2.1 planform table, centre line (extrapolated), 3V
    tipChord: 0.91, // s.2.1 planform table, tip rib, 3V
    taperStartY: 0, // by the rule of `breaks`
    // s.2.1 planform table (3V): the centre wing tapers and sweeps FORWARD toward the root, the outer wing is a
    // straight taper on an unswept quarter-chord line, and the two sets of lines step by 0.11 m of chord
    // under the nacelle. The other rows of the table (fuselage side, inboard side of the nacelle, wing joint,
    // flap / aileron boundary) lie on these lines to 1 cm. Integrated: 15.85 m^2 (16.2 m^2 with the winglets)
    // against the published 16.29 m^2 (VN).
    breaks: [
      { y: 0, chord: 1.86, qcX: 0.17 }, // quarter-chord at station 2.29 (s.2.6 origin; leading edge 1.83)
      { y: 1.67, chord: 1.39, qcX: -0.0075 }, // nacelle centre line, centre-wing lines: LE 2.12 + 1.39 / 4 = 2.4675
      { y: 1.67, chord: 1.28, qcX: -0.045 }, // nacelle centre line, outer-wing lines: quarter-chord at 2.505 (s.2.1)
      { y: 6.43, chord: 0.91, qcX: -0.045 }, // tip rib, where the winglet blend starts: same line
    ],
    // Root = centre line. The chord plane there is 0.85 m above the ground (s.2.1, 3V), 0.20 m below the
    // reference point; the 5 degrees of dihedral run from there (s.2.6: the MAC at y = 2.85 is 0.25 m up).
    quarterChord: { x: 0.17, z: 0.2 },
    dihedral: 5 * DEG, // s.2.1 (AFM 1.4)
    // s.2.1, EST of low confidence (+/-1.5 degrees, not published): to be tuned so that the 75 % cruise is
    // flown with the fuselage near level.
    rootIncidence: 1 * DEG,
    tipIncidence: 0,
    rootY: 0.61, // s.2.1 planform table, fuselage side, 3V
    flap: {
      // Envelope of the two pieces a side (s.2.2); the chord fraction is the outer piece's (three quarters of
      // the flapped area).
      innerY: 0.61,
      outerY: 4.78,
      chordFraction: 0.23,
      maxDeflection: 42 * DEG, // s.2.2 (TCDS C.III.16): UP 0, APP 20, LDG 42 degrees
      // s.2.2, 3V and EST: centre wing between fuselage and nacelle (chord about 0.40 m), outer wing from
      // the nacelle to the aileron (about 0.27 m). 2 x (0.74 x 0.40 + 2.91 x 0.27) = 2.16 m^2 against the
      // published 2.18 m^2.
      segments: [
        { innerY: 0.61, outerY: 1.35, chordFraction: 0.25 },
        { innerY: 1.87, outerY: 4.78, chordFraction: 0.23 },
      ],
    },
    // s.2.2: stations 3V; chord EST 21 % from the published area (0.33 m^2 a side over 1.62 m), the line on
    // the three-view would give 27 %; travel TCDS C.III.16.
    aileron: { innerY: 4.78, outerY: 6.4, chordFraction: 0.21, maxUp: 25 * DEG, maxDown: 15 * DEG },
    // s.2.1 and s.12: 0.78 m above the tip chord (its top is 2.205 m above the ground, an AFM dimension); the
    // rest 3V: cant 85-90 degrees from the horizontal after a curved blend, leading edge swept 30-35 degrees,
    // chord 0.45 m after the blend and 0.16 m at the top. It starts at the tip rib, inside the published span.
    winglet: { height: 0.78, cant: 87.5 * DEG, rootChord: 0.45, tipChord: 0.16, sweep: 32.5 * DEG, rootY: 6.43 },
  },

  // --- Horizontal tail (s.2.3: fixed tailplane on the fin tip, one-piece elevator with trim tab; about 12 % thick) ---
  hTail: {
    mount: 'tTail',
    allMoving: false,
    span: 3.49, // s.2.3, 3V, over the tip fairings ("about 3.3 m" is also quoted: weak-data item 4)
    area: 2.35, // s.2.3 (AFM 1.4)
    rootChord: 0.99, // s.2.3, 3V: leading edge at station 6.96, elevator trailing edge at 7.96
    // The straight taper of the main panel (0.47 m at y = 1.48, s.2.3) carried on to the tip at y = 1.745:
    // 0.99 - 0.52 x 1.745 / 1.48. The real tip is a triangular cap outboard of y = 1.48. This trapezoid has
    // 2.39 m^2 against the published 2.35 m^2 (the outline with the caps: 2.28 m^2, VN).
    tipChord: 0.377,
    // Root: leading edge 6.96 + 0.99 / 4 = station 7.2075. Chord plane 1.60 m above the wing root chord plane,
    // 2.45 m above the ground (s.2.3, s.2.6, 3V): this is the fin-tip junction.
    quarterChord: { x: -4.7475, z: -1.4 },
    // Leading edge swept 14.5 degrees (s.2.3, 3V): at y = 1.745 it is at station 7.411, the quarter-chord at
    // 7.5055. The quarter-chord then passes station 7.32 at y = 0.65, the data sheet's mean (tail arm 4.86 m).
    tipQuarterChordX: -5.0455,
    incidence: -1.1 * DEG, // s.2.3 (AFM 1.4), to the longitudinal axis
    // s.2.3: about 31 % by area (3V; hinge line unswept at station 7.65); travel TCDS C.III.16. The variable
    // elevator stop (13 degrees up with both levers above 20 %) is not part of the geometry.
    elevator: { chordFraction: 0.31, maxUp: 15.5 * DEG, maxDown: 13 * DEG },
  },

  // --- Vertical tail (s.2.4: swept fin on the tail boom, full-height rudder with trim tab; about 12 % thick) ---
  vTail: {
    // s.2.4 (AFM 1.4), fin + rudder as published. The panel that stands clear above the boom (the numbers
    // below) has only about 1.2 m^2; the effective area is nearer 1.4-1.8 m^2 if the model's yaw stability
    // comes out too strong (VN "still uncertain" 3).
    area: 2.43,
    height: 1.05, // s.2.4, 3V: top of the tail boom (1.40 m above the ground) to the tailplane chord plane (2.45 m)
    rootChord: 1.33, // s.2.4, 3V, at the top of the tail boom
    tipChord: 0.92, // s.2.4, 3V, at the top
    // Quarter-chord of the fin at the top of the boom and at the tailplane (s.2.4, 3V; EST): the rudder
    // trailing edge is the aft-most point of the aircraft at its top (station 8.01, s.2.6) and is swept 12
    // degrees, so the quarter-chord is at station 8.01 - 0.75 x 0.92 = 7.32 at the top and at
    // 8.01 - 1.05 x tan(12 deg) - 0.75 x 1.33 = 6.79 at the base. That gives the leading edge 31 degrees and the
    // hinge line 16 degrees (s.2.4: about 30 and 17). The panel's mean quarter-chord is then at station 7.04,
    // 0.06 m ahead of the data sheet's 7.10 (s.2.6; fin arm 4.58 m against 4.64 m).
    // The tip is the fin's own: the tailplane root quarter-chord point is 0.11 m ahead of it (the tailplane
    // root with its bullet fairing overhangs the fin leading edge, s.12).
    base: { x: -4.33, z: -0.35 },
    tip: { x: -4.86, z: -1.4 },
    // s.2.4: about 40 % of the local chord (3V); 27 degrees LEFT, 29 degrees RIGHT (TCDS C.III.16).
    rudder: { chordFraction: 0.4, maxDeflection: 27 * DEG, maxRight: 29 * DEG },
  },

  // --- Fuselage (s.2.5, s.12: pod and boom; no engine in the nose) ---
  fuselage: {
    length: 8.56, // s.2.5 (AFM 1.4)
    /** Nose tip (0.55 m ahead of the datum, s.2.5, 3V) and rudder trailing edge (s.2.6). */
    noseX: 3.01,
    tailX: -5.55,
    maxWidth: 1.2, // s.2.5 and s.12, 3V, at 3.4-3.8 m aft of the nose
    maxHeight: 1.29, // s.2.5, 3V: belly 0.70 m to roof 1.99 m above the ground
    // Left seat. EST, not in the data sheet: under the highest point of the canopy (3.10 m aft of the nose,
    // s.12), 0.25 m aft of the front-seat arm of 2.30 m (reclined seats); 1.70 m above the ground, 0.26 m
    // below the top of the canopy (1.96 m, s.12); seat centre line y = 0.28 (s.2.6, EST).
    pilotEye: { x: -0.09, y: -0.28, z: -0.65 },
  },

  // --- Landing gear (s.3: retractable tricycle, mains fold inboard into the centre wing, nose leg forward) ---
  gear: {
    // x: main wheels at station 2.65 (s.3, 3V); nose wheel the published wheelbase of 1.735 m (AFM 1.4)
    // ahead of them, at station 0.915 (s.3: 0.91, 3V). y: published track 2.95 m (AFM 1.4).
    // z: the tyres touch the ground 1.05 m below the reference point at rest; with the struts fully extended
    // they hang lower by the static stroke, EST 0.03 m (nose) and 0.05 m (main, at the wheel): the strokes
    // are not published (s.3: about 0.18 and 0.15 m, with at least 15 cm and 4 cm of bare piston parked).
    nose: { x: 1.545, y: 0, z: 1.08 },
    leftMain: { x: -0.19, y: -1.475, z: 1.1 },
    rightMain: { x: -0.19, y: 1.475, z: 1.1 },
    noseWheelRadius: 0.18, // s.2.6 and s.12, 3V: 5.00-5 tyre, about 0.36 m
    mainWheelRadius: 0.195, // s.2.6 and s.12, 3V: 15x6.0-6 tyre, about 0.39 m
    maxNoseSteer: 30 * DEG, // s.3 (AFM 7.5): 30 degrees by the pedals (52 with one wheel braked)
    retractable: true,
  },

  // --- Propellers (s.5: MT MTV-6-R-C-F / CF187-129; left, then right) ---
  // Hub in the disc plane: station 1.14, 1.67 m either side, 1.16 m above the ground = 0.31 m above the wing
  // root chord plane (s.2.6 and s.12, 3V). Diameter and blades AFM 2.4 (s.5). BOTH turn clockwise seen from
  // behind (TCDS C.III.7.5, s.4): the left engine is the critical one.
  propellers: [
    { hub: { x: 1.32, y: -1.67, z: -0.11 }, diameter: 1.87, blades: 3, rotation: 1 },
    { hub: { x: 1.32, y: 1.67, z: -0.11 }, diameter: 1.87, blades: 3, rotation: 1 },
  ],

  // Wing root chord plane 0.85 m above the ground on the wheels (s.2.1, 3V) + the CG 0.20 m above it (s.2.6, EST).
  restHeight: 1.05,
  // The farthest point is the tip light on the winglet (y = 6.775, 2.2 m above the ground): 6.9 m. Span + 2.
  bounds: { radius: 7.4, fitSize: 15.4 },
};
