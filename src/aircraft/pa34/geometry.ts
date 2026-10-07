// Piper PA-34-200 Seneca I (4200 lb airframes): the geometric facts physics and the 3D model must agree on.
// Transcribed from the type's data sheet (pa34.md); "s.N" below is its section N. Where its verification notes
// corrected an earlier row, the corrected value is the one used. EST marks a number the data sheet itself
// estimates or one estimated here; everything else is a dimensioned or labelled manufacturer's figure.
//
// COORDINATE CONVERSION (data sheet -> body axes FRD about the reference point, metres)
//
//   Data sheet (s.2, s.2.5): Piper fuselage stations FS in inches AFT of the datum (78.4 in ahead of the leading
//   edge of the constant-chord wing); key points in metres with x forward, y right, z UP from an origin at
//   FS 94.15 on the centre line, "on the wing root chord plane extended to the centreline".
//
//   x = (94.15 - FS) x 0.0254    FS 94.15 is the quarter-chord of the 63.0 in mean chord (leading edge FS 78.4,
//                                s.2.1), so the data sheet's origin is already at the reference point's x.
//   y = y                        right positive in both; BL and WS in inches x 0.0254.
//   z = 0.42 - z_up              the reference point is 0.42 m above the data sheet's origin (EST, below).
//
//   The data sheet's origin lies on the DIHEDRAL plane continued to the centre line, not on the chord plane at
//   the fuselage side: only then do its rows agree. Hub: 1.905 x tan 7 deg + 0.28 (thrust line above the local
//   chord plane, s.12) = 0.51, the table's value. Wing root: 0.616 x tan 7 deg = 0.076 above the origin, which
//   is 0.76 m above the ground, and s.2.1 puts the root quarter-chord 0.55 m below a centre line that s.12 puts
//   1.31 m above the ground (0.76). `wing.quarterChord.z` is the chord plane AT THE ROOT RIB (y = rootY, where
//   the dihedral is measured from), so it is 0.076 m above the data sheet's origin.
//
//   Static ground: 0.68 m below the data sheet's origin. Four rows agree within a centimetre: static axles at
//   -0.46 less the 0.2225 m tyre radius (0.68); stabilator 0.45 above the origin and 1.13 above the ground
//   (0.68); hub 0.51 above the origin with 0.23 m of propeller clearance under a 0.965 m blade (0.685); fin tip
//   at 2.33 against the overall height 3.02 (0.69).
//
//   Height of the reference point (the nominal vertical CG): 0.42 m above the data sheet's origin, 1.10 m above
//   the ground. EST: the data sheet gives no vertical CG. Mass build-up at the two-crew loading of s.6 (3550 lb),
//   heights above the origin: two power units 1000 lb at 0.48 (just under the thrust line); fuselage, cabin and
//   systems 1150 lb at 0.48 to 0.50; wing 440 lb at 0.36 (chord plane at mid panel); gear 180 lb at -0.25; tail
//   80 lb at 0.82; crew 340 lb at 0.45 and fuel 360 lb at 0.40 (s.2.5): 0.42 to 0.43 m, +/-0.08.
//
//   Checked against landmarks that the conversion did not use:
//     wheelbase   x(FS 24.58) - x(FS 108.58) = 1.767 + 0.367 = 2.134 m = 7.0 ft (s.3: 2.13 m)          scale
//     tail arm    stabilator leading edge FS 276.5 + a quarter of 0.871 m: x = -4.849 (s.2.2: 4.85 m)  origin
//     length      x(FS -27.5) - x(FS 316) = 3.090 + 5.635 = 8.725 m (s.2.4: 8.72 m)
//     height      fin tip 2.33 + 0.68 = 3.01 m above the ground (s.2.4: 3.02 m)

import { DEG } from '../../core/math';
import type { AircraftGeometry } from '../types';

const IN = 0.0254;
/** Fuselage station of the reference point: the quarter-chord of the mean chord (s.2.1). */
const REFERENCE_STATION = 94.15;
/** Reference point (nominal vertical CG) above the data sheet's origin, m. EST (mass build-up above). */
const CG_ABOVE_ORIGIN = 0.42;
/** Level ground under the standing aircraft, below the data sheet's origin, m (s.2.5, s.2.2, s.2.4). */
const GROUND_BELOW_ORIGIN = 0.68;

/** Piper fuselage station (inches aft of the datum) to body x. */
export const pa34StationX = (fs: number): number => (REFERENCE_STATION - fs) * IN;
/** Height above the data sheet's origin (its z, up) to body z. */
export const pa34HeightZ = (up: number): number => CG_ABOVE_ORIGIN - up;

/** s.2.1: 7 degrees, labelled on two Piper three-views. */
const DIHEDRAL = 7 * DEG;
/** s.2.1: fuselage side, WS 24.24. */
const ROOT_Y = 0.616;
/** s.2.1: the constant chord, 63.0 in (dimensioned). */
const CHORD = 1.6;
/** s.2.1: chord at the fuselage side with the leading-edge glove, 74 in (scaled from the drawing, +/-2 in). */
const GLOVE_CHORD = 1.88;
/** The glove lengthens the chord FORWARD of a straight trailing edge (FS 141.4), so its quarter-chord moves forward. */
const GLOVE_QC_X = 0.75 * (GLOVE_CHORD - CHORD);

// How far a tyre's contact point hangs below the static ground with the strut fully extended and the tyre
// round, m. Both EST from s.3.
/** Mains: 3.60 in of strut showing at rest, and the squat switch wants "more than 8 in" (taken as full extension): 4.4 in = 0.11 m, plus 0.02 m of tyre (a 6.00-6 at 50 psi under 5.8 kN). */
const MAIN_DROOP = 0.13;
/** Nose: 2.60 in showing at rest; full extension is not in the data sheet and is taken in the mains' ratio (5.8 in): 3.2 in = 0.08 m, plus 0.02 m of tyre. */
const NOSE_DROOP = 0.1;

/** s.2.4, s.2.5: propeller centre lines 12 ft 6 in apart (BL 75.0; the key-point table rounds it to 1.90). */
const HUB_Y = 1.905;
/** s.2.5: propeller plane near FS 28 (EST); hub 0.51 m above the origin (EST from the clearance, +/-0.08). */
const HUB_X = 1.68;
const HUB_Z = pa34HeightZ(0.51);

/** s.2.3: fin tip chord from FS 292.72 (labelled) to FS 316, the aft-most point of the aircraft. */
const FIN_TIP_LE_X = pa34StationX(292.72);
/** s.2.3: 1.6 m above the tail-cone top (+/-0.1); chords with the rudder; leading edge swept 45 degrees. All scaled, EST. */
const FIN_HEIGHT = 1.6;
const FIN_ROOT_CHORD = 1.85;
const FIN_TIP_CHORD = 0.59;
const FIN_LE_SWEEP = 45 * DEG;
/** s.2.5: fin tip 2.33 m above the origin (from the overall height). */
const FIN_TIP_UP = 2.33;

export const PA34_GEOMETRY: AircraftGeometry = {
  // --- Wing (NACA 65(2)-415, low, constant chord with a leading-edge glove between fuselage and nacelle) ---
  wing: {
    mount: 'low',
    // s.2.1: 38.88 ft.
    span: 11.85,
    // s.2.1: 208.7 ft^2, the handbook's gross area (the glove counted).
    area: 19.39,
    // s.2.1: the constant-chord value, EST (the glove raises it by about 1 %).
    meanChord: CHORD,
    // The planform is `breaks`; these three repeat its ends as the contract requires.
    rootChord: GLOVE_CHORD,
    tipChord: CHORD,
    taperStartY: 0,
    // s.2.1: glove from the fuselage side to the inboard face of the nacelle (BL 54, scaled), then constant chord
    // to the tip (span / 2; the squared tip carries a small cap outboard of WS 231.56). Inside the fuselage the
    // fuselage-side chord is carried to the centre line: the outline then encloses 19.52 m^2 against the
    // published 19.39.
    breaks: [
      { y: 0, chord: GLOVE_CHORD, qcX: GLOVE_QC_X },
      { y: ROOT_Y, chord: GLOVE_CHORD, qcX: GLOVE_QC_X },
      { y: 1.37, chord: CHORD, qcX: 0 },
      { y: 5.925, chord: CHORD, qcX: 0 },
    ],
    // x: the quarter-chord line of the constant-chord wing (FS 94.15), not the glove's local quarter-chord, which
    // is in `breaks`. z: chord plane at the root rib, 0.616 x tan 7 deg above the data sheet's origin (see above).
    quarterChord: { x: 0, z: pa34HeightZ(ROOT_Y * Math.tan(DIHEDRAL)) },
    dihedral: DIHEDRAL,
    // s.2.1: +2 degrees and no washout. Both are family values (PA-32, constant-chord Cherokee wing), medium confidence.
    rootIncidence: 2 * DEG,
    tipIncidence: 2 * DEG,
    rootY: ROOT_Y,
    // s.2.1: single-slotted, WS 24.24 to WS 144.08 in one piece behind the nacelle; chord 20-21 % (EST);
    // detents 0 / 10 / 25 / 40 degrees.
    flap: { innerY: ROOT_Y, outerY: 3.66, chordFraction: 0.205, maxDeflection: 40 * DEG },
    // s.2.1: Frise, WS 144.08 to WS 208.33 (the outer 0.63 m of the wing has no surface); chord 17-18 % (EST);
    // 30 up / 15 down relative to the wing chord.
    aileron: { innerY: 3.66, outerY: 5.292, chordFraction: 0.175, maxUp: 30 * DEG, maxDown: 15 * DEG },
  },

  // --- Horizontal tail: stabilator with an anti-servo tab, low on the tail cone (NACA 0012 assumed) ---
  hTail: {
    mount: 'fuselage',
    allMoving: true,
    // s.2.2: 162.7 in (tip at BL 81.35).
    span: 4.13,
    // s.2.2: 38.7 ft^2 with the tab (span x chord).
    area: 3.6,
    // s.2.2: 34.28 in, constant.
    rootChord: 0.871,
    tipChord: 0.871,
    // s.2.2, s.2.5: quarter-chord near FS 285 (+/-2 in), chord plane 0.45 m above the origin (+/-0.10). Both scaled, EST.
    quarterChord: { x: -4.85, z: pa34HeightZ(0.45) },
    // s.2.2: neutral is parallel to the fuselage reference; the incidence in flight is set by the trim.
    incidence: 0,
    // s.2.2: 12.5 degrees trailing edge up, 7.5 down.
    elevator: { chordFraction: 1, maxUp: 12.5 * DEG, maxDown: 7.5 * DEG },
  },

  // --- Vertical tail: swept fin and rudder. Only the tip station and the rudder travel are manufacturer's figures ---
  vTail: {
    // s.2.3: fin and rudder without the root fillet, EST +/-15 %.
    area: 1.95,
    height: FIN_HEIGHT,
    rootChord: FIN_ROOT_CHORD,
    tipChord: FIN_TIP_CHORD,
    // Quarter-chord at the tail-cone top and at the tip (mean quarter-chord then at FS 269; s.2.3: "near FS 270").
    base: { x: FIN_TIP_LE_X + FIN_HEIGHT * Math.tan(FIN_LE_SWEEP) - 0.25 * FIN_ROOT_CHORD, z: pa34HeightZ(FIN_TIP_UP - FIN_HEIGHT) },
    tip: { x: FIN_TIP_LE_X - 0.25 * FIN_TIP_CHORD, z: pa34HeightZ(FIN_TIP_UP) },
    // s.2.3: chord about 38 % (EST); 35 degrees each way.
    rudder: { chordFraction: 0.38, maxDeflection: 35 * DEG },
  },

  // --- Fuselage ---
  fuselage: {
    // s.2.4: 343.47 in overall.
    length: 8.72,
    // s.2.4: nose tip FS -27.5; aft-most point FS 316, the rudder trailing edge at the fin tip (the tail cone
    // itself ends near FS 311, s.12).
    noseX: pa34StationX(-27.5),
    tailX: pa34StationX(316),
    // s.2.4: both EST.
    maxWidth: 1.27,
    maxHeight: 1.25,
    // Pilot eye point (left seat). EST: the data sheet has the seat only (s.2.5: arm FS 85.5 = x 0.22, y 0.28).
    // The eye is taken 0.08 m behind the seat arm, as on the C172S, and 0.95 m above the origin: 0.30 m under
    // the outside of the cabin roof (1.93 m above the ground, s.12).
    pilotEye: { x: 0.14, y: -0.28, z: pa34HeightZ(0.95) },
  },

  // --- Landing gear: tyre contact points with struts fully extended, gear down ---
  gear: {
    // s.2.5: axles at FS 24.58 and FS 108.58 (wheelbase 7.0 ft), track 132.87 in.
    nose: { x: pa34StationX(24.58), y: 0, z: pa34HeightZ(-GROUND_BELOW_ORIGIN - NOSE_DROOP) },
    leftMain: { x: pa34StationX(108.58), y: -1.687, z: pa34HeightZ(-GROUND_BELOW_ORIGIN - MAIN_DROOP) },
    rightMain: { x: pa34StationX(108.58), y: 1.687, z: pa34HeightZ(-GROUND_BELOW_ORIGIN - MAIN_DROOP) },
    // s.3: 6.00-6 on all three, 0.445 m diameter.
    noseWheelRadius: 0.2225,
    mainWheelRadius: 0.2225,
    // s.3: 21 degrees each side to s/n 34-7350353 (the handbook's "42-degree arc", and its 19.5 ft turning radius
    // at the nose wheel is wheelbase / sin 21 deg); 27 degrees on 1974 aircraft.
    maxNoseSteer: 21 * DEG,
    retractable: true,
  },

  // --- Propellers (Hartzell, 76 in, two blades): left clockwise, right counter-clockwise seen from the cockpit (s.1, s.5) ---
  propellers: [
    { hub: { x: HUB_X, y: -HUB_Y, z: HUB_Z }, diameter: 1.93, blades: 2, rotation: 1 },
    { hub: { x: HUB_X, y: HUB_Y, z: HUB_Z }, diameter: 1.93, blades: 2, rotation: -1 },
  ],

  // Reference point above the ground at rest: CG_ABOVE_ORIGIN + GROUND_BELOW_ORIGIN.
  restHeight: 1.1,
  // The wing tip's trailing corner is 6.05 m from the reference point and the fin tip 5.95 m; the margin and
  // the fit (span + 2) are the C172S's.
  bounds: { radius: 6.5, fitSize: 13.85 },
};
