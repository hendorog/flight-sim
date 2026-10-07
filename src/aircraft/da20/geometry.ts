// Diamond DA20-C1: the geometric facts physics and the 3D model must agree on. Transcribed from the DA20-C1
// engineering data sheet (work/aircraft-data/da20.md, kept outside the tree): "s.2.4" below is its section 2.4,
// "intro" its paragraph on axes, and the corrections of its "Verification notes" are applied (manufacturer tail
// and control-surface areas, wing incidence -2 degrees instead of +2). Source tags as in the sheet: [AFM] flight
// manual DA202-C1 Rev 29, [TCDS] EASA.IM.A.223, [AMM] maintenance manual rigging limits, [DV20] HOAC DV 20
// Katana manual (areas; taken as equal on the C1, +/-5 %), [3V] scaled from the AFM three-view (+/-5 %; its
// chords are drawn 7-10 % short), [CALC] arithmetic on sheet numbers, shown. A number the sheet does not give is
// marked ESTIMATE with its reasoning.
//
// COORDINATES. The sheet measures x AFT, either from the spinner tip ("x_nose") or from the handbook datum RD
// (the plane tangent to the wing leading edge at the root rib; "x_RD"), which it places 1.75 m aft of the spinner
// tip (+/-0.07, from the equipment-list arms [intro]); z UP from the fuselage reference line FRL (the
// longitudinal axis of the AFM side view, 0.05 m below the propeller hub); y from the centre line. Here every
// position is in body axes (FRD: x forward, y right, z DOWN, x parallel to FRL), metres, relative to the aircraft
// REFERENCE POINT, which is on the centre line at
//   x: the quarter-chord of the wing mean aerodynamic chord: LEMAC 0.025 m aft of RD (ESTIMATE of the sheet,
//      +/-0.015 [s.6]) plus a quarter of the 1.09 m MAC [AFM 1.5.2; s.2.2] = 0.2975 m aft of RD.
//   z: the nominal height of the centre of gravity: 0.07 m below FRL, 0.20 m above the wing root chord plane
//      (ESTIMATE of the sheet, no published value [s.6]).
// so that
//   x = 0.2975 - x_RD = 2.0475 - x_nose        y = y        z = -(z_FRL + 0.07)
//
// Checked against dimensions the conversion was not built from:
//   propeller   da20DatumX(-1.54) = 1.84 m ahead of the wing quarter-chord and 0.32 m above the wing chord plane:
//               the two figures of s.4. The propeller plane 0.19 m behind the spinner tip (s.5) gives 1.86 m.
//   wheelbase   the main axle, 0.62 m aft of RD, is the sheet's x_nose 2.37; the nose axle one wheelbase (1.678 m,
//               AFM three-view) ahead of it comes to x_nose 0.69, the sheet's own figure (s.3). Static nose-wheel
//               load at the training CG, 0.296 m aft of RD: 19 %, as in s.3.
//   tail arm    the tailplane below has its mean-chord quarter-chord at x = -4.67 (root -4.54, tip -4.83, mean
//               chord at y = 0.59): the 4.7 m of s.2.4 (side view 4.6, top view 4.8).
//   LEMAC       the leading edge of the planform below is 0.023 m aft of RD at the mean-chord station y = 2.37
//               (s.6: 0.025).
//   T junction  the fin tip leading edge (fin root at x_nose 5.80, 32 degrees, 0.90 m up) comes to x_nose 6.36;
//               the tailplane root leading edge (trailing edge at 7.24, chord 0.87) is at 6.37.
//   height      the tailplane chord plane, z = -1.06, stands 2.13 m above the ground at rest (z = +1.07); the
//               published overall height is 2.16 m (AFM Rev 29) to 2.19 m (TCDS) [s.2.1].
//   propeller   tip 0.31 m clear of the ground at rest: the three-view's 0.31 m; the sheet's working figure is
//               0.28 m and the AFM walk-round says "minimum approx. 25 cm" [s.2.1].
//
// WEAK DATA (the sheet says so; treat as starting values): wing chords (three-view x 1.10 to the published area),
// incidence and washout, the height of the tail (1.26 to 1.46 m above the wing) and of the fin (0.9 to 1.1 m),
// vertical CG and therefore rest height, pilot's eye point.

import { DEG } from '../../core/math';
import type { AircraftGeometry } from '../types';

/** Body x of a point `aft` metres aft of the handbook datum RD (the sheet's x_RD). */
export const da20DatumX = (aft: number): number => 0.2975 - aft;
/** Body x of a point `aft` metres aft of the spinner tip (the sheet's x_nose); RD is 1.75 m aft of it [intro]. */
export const da20NoseX = (aft: number): number => da20DatumX(aft - 1.75);
/** Body z of a point `up` metres above the fuselage reference line FRL (the reference point is 0.07 m below it). */
export const da20FrlZ = (up: number): number => -0.07 - up;

/** 35 ft 8 in [TCDS, AFM Rev 25; s.2.1]. The Rev 29 three-view is dimensioned 10.89 m. */
const SPAN = 10.87;
/**
 * Half the fuselage width at the wing (AircraftGeometry.wing.rootY): 1.18-1.20 m across the wing-root stubs
 * [3V; s.2.6]. The root rib, (10.89 - 2 x 4.845 m panel) / 2 [AFM three-view, CALC; s.2.1], is at the same 0.6.
 */
const ROOT_Y = 0.6;
/** Where the raked, upturned tip begins [3V; s.2.2 planform table]. */
const TIP_START_Y = 5.02;
/** Leading-edge sweep: the sheet's pick between the AFM's "+1 degree nominal" and the C1's 0.5 degree [s.2.2]. */
const LE_SWEEP = 0.75 * DEG;
/** Wing chord plane at the root, m above FRL (it is 0.27 m below) [3V; s.2.2]. */
const WING_PLANE_UP = -0.27;
/** The upturned tip cants up "about 25 degrees" from the wing plane [3V; s.2.2]. */
const TIP_CANT = 25 * DEG;

/**
 * A station of the main panel. The leading edge is straight and touches RD at the root rib (that is how the
 * handbook defines its datum [AFM 1.11.5; s.6]); all the taper is on the trailing edge [s.2.2].
 */
const wingStation = (y: number, chord: number): { y: number; chord: number; qcX: number } => ({
  y,
  chord,
  qcX: da20DatumX((y - ROOT_Y) * Math.tan(LE_SWEEP) + 0.25 * chord),
});
/**
 * The recommended planform of s.2.2: the three-view's chords x 1.10, which matches the published area and MAC.
 * Centre line (extrapolated) 1.30 m; start of the raked tip 0.92 m. The root rib (y = 0.60, 1.25 m) lies on the
 * line between them. [3V scaled; s.2.2]
 */
const WING_CENTRE = wingStation(0, 1.3);
const WING_OUTER = wingStation(TIP_START_Y, 0.92);

/** Overall length, spinner tip to elevator trailing edge [AFM Rev 29 three-view; s.2.1, s.2.6]. TCDS: 7.17 m. */
const LENGTH = 7.24;

/** 8 ft 9 in [AFM 1.5.3; s.2.4]. */
const TAILPLANE_SPAN = 2.66;
/** Centre and tip chord: the three-view's 0.79 / 0.37 m x 1.09 to the published area [3V scaled to DV20; s.2.4]. */
const TAILPLANE_ROOT_CHORD = 0.87;
const TAILPLANE_TIP_CHORD = 0.41;
/**
 * Tailplane leading edge at the centre line, m aft of the spinner tip: the elevator trailing edge is the tail
 * end, x_nose 7.24 [s.12 tail].
 */
const TAILPLANE_ROOT_LE = LENGTH - TAILPLANE_ROOT_CHORD;
/** Tailplane leading-edge sweep, "16-18 degrees"; the hinge line is straight [3V; s.2.4]. */
const TAILPLANE_LE_SWEEP = 17 * DEG;
/**
 * Tailplane chord plane = the fin-tip junction: 1.26 m above the wing root chord plane, the sheet's pick, which
 * agrees with the published overall height. The three-view scales to 1.46 m: the weakest dimension of the sheet
 * [3V / CALC; s.2.4, s.2.6].
 */
const TAILPLANE_Z = da20FrlZ(WING_PLANE_UP + 1.26);

/** Fin leading edge where it leaves the tail boom, m aft of the spinner tip [3V; s.12 fuselage station 11, tail]. */
const FIN_ROOT_LE = 5.8;
/** Fin leading-edge sweep [3V; s.2.5]. */
const FIN_LE_SWEEP = 32 * DEG;
/** Fin + rudder chord at the boom and at the tip [3V, as drawn, not scaled up; s.2.5]. */
const FIN_ROOT_CHORD = 1.22;
const FIN_TIP_CHORD = 0.82;
/**
 * Exposed fin, boom top to tailplane: the value of s.2.5 that agrees with the published overall height (1.09 m
 * as drawn). It puts the fin base 0.09 m above FRL; the boom top is 0.10 m above FRL at station 11 [s.12].
 */
const FIN_EXPOSED = 0.9;

/**
 * Height of the reference point above the ground at rest: the vertical CG "1.07 m above the ground" (ESTIMATE of
 * the sheet [s.6]). The sheet's other heights give 1.05 m (wing root leading edge 0.85 m above the ground
 * [s.2.2]) and 1.04 m (propeller hub 1.16 m above the ground [s.2.1]).
 */
const REST_HEIGHT = 1.07;
/** Main axles, m aft of RD [3V fitted to the wheelbase and the wheel-fairing arms, +/-0.05; s.3]. */
const MAIN_AXLE_AFT = 0.62;
/** 5 ft 6 in [AFM three-view; s.3]. It puts the nose axle 1.058 m ahead of RD (s.3: "about -1.05 m", x_nose 0.69). */
const WHEELBASE = 1.678;
/** 6 ft 1 in [AFM Rev 29; s.3]. Rev 25: 1.90 m. */
const TRACK = 1.86;
/**
 * How far the tyre contact points drop when the weight comes off. ESTIMATE from the spring estimates of s.3:
 * main leaf 0.05 m at its static load (3.2 kN on 60-70 kN/m) plus 0.02 m of tyre; nose elastomer pack 0.05 m
 * (1.5 kN on 25-35 kN/m) plus 0.01 m of tyre.
 */
const MAIN_DROOP = 0.07;
const NOSE_DROOP = 0.06;

export const DA20_GEOMETRY: AircraftGeometry = {
  wing: {
    mount: 'low',
    span: SPAN,
    /** 125 sq ft [AFM 1.5.2, TCDS; s.2.2]. */
    area: 11.6,
    /** Mean aerodynamic chord, 3 ft 6.9 in [AFM 1.5.2; s.2.2]. */
    meanChord: 1.09,
    // One straight-tapered panel from the centre line to the start of the raked tip (no taper break), then the
    // tip as `winglet`: the first and last chord of `breaks`.
    rootChord: WING_CENTRE.chord,
    tipChord: WING_OUTER.chord,
    taperStartY: 0,
    // Area of this planform with the tip: 2 x (5.02 x (1.30 + 0.92) / 2 + 0.415 x (0.92 + 0.30) / 2) = 11.65 m^2.
    breaks: [WING_CENTRE, WING_OUTER],
    /** The centre-line station; z is the chord plane at the root rib, from which the dihedral is measured. */
    quarterChord: { x: WING_CENTRE.qcX, z: da20FrlZ(WING_PLANE_UP) },
    /** "+4 degrees nominal"; the AMM rigging check (tip rise 290-330 mm) agrees [AFM 1.5.2, AMM; s.2.2]. */
    dihedral: 4 * DEG,
    /**
     * Relative to FRL. NOT published. ESTIMATE of the sheet from the lift curve of the FX 63-137 and the trim of
     * the tailplane: root -2 degrees (range -4 to 0), tip 2 degrees lower. The +2 degrees of the sheet's first
     * draft is withdrawn [s.2.2; verification note 4].
     */
    rootIncidence: -2 * DEG,
    tipIncidence: -4 * DEG,
    rootY: ROOT_Y,
    /**
     * Slotted, 0 / 15 / 45 degrees [AFM 7.3.3, TCDS; s.2.3]. Span stations [3V; s.2.3]. Chord fraction 0.22 (the
     * three-view measures 0.215-0.22); the manufacturer's 1.24 m^2 for both flaps agrees [DV20, 3V; s.2.3;
     * verification note 3].
     */
    flap: { innerY: 0.85, outerY: 3.27, chordFraction: 0.22, maxDeflection: 45 * DEG },
    /**
     * Plain, push-rod operated. Span stations and chord fraction [3V; s.2.3; verification note 3]; 15.5 degrees
     * up, 13.5 degrees down, +/-1 [TCDS B.III.16, AMM; s.2.3].
     */
    aileron: { innerY: 3.27, outerY: 4.96, chordFraction: 0.2, maxUp: 15.5 * DEG, maxDown: 13.5 * DEG },
    /**
     * The integral upturned tip, a blended curve taken as one straight piece: over the last 0.415 m of the half
     * span the leading edge rakes back 55-60 degrees (`sweep`: of the leading edge, in plan) while the tip cants
     * up about 25 degrees; the chord falls from 0.92 m to about 0.30 m [3V; s.2.2 and its planform table].
     * `height` is its length along itself, so that it ends at the published half span; it then rises 0.19 m
     * (the sheet measures about 0.18 m).
     */
    winglet: {
      height: (SPAN / 2 - TIP_START_Y) / Math.cos(TIP_CANT),
      cant: TIP_CANT,
      rootChord: WING_OUTER.chord,
      tipChord: 0.3,
      sweep: 57.5 * DEG,
      rootY: TIP_START_Y,
    },
  },
  hTail: {
    /** T-tail: fixed stabiliser and a one-piece elevator without a tab [AFM 7.2.3; s.2.4]. */
    mount: 'tTail',
    allMoving: false,
    span: TAILPLANE_SPAN,
    /** Stabiliser + elevator, 18.21 sq ft [DV20; s.2.4; verification note 1]. The three-view scales to 1.55 m^2. */
    area: 1.69,
    rootChord: TAILPLANE_ROOT_CHORD,
    tipChord: TAILPLANE_TIP_CHORD,
    quarterChord: { x: da20NoseX(TAILPLANE_ROOT_LE + 0.25 * TAILPLANE_ROOT_CHORD), z: TAILPLANE_Z },
    // With the leading edge swept 17 degrees the trailing edge comes 0.05 m forward at the tip: the straight
    // hinge line and the elevator chord of 0.20 m at the centre, 0.14 m at the tips, of s.2.4 [CALC].
    tipQuarterChordX: da20NoseX(
      TAILPLANE_ROOT_LE + (TAILPLANE_SPAN / 2) * Math.tan(TAILPLANE_LE_SWEEP) + 0.25 * TAILPLANE_TIP_CHORD,
    ),
    /** -4 degrees +/-0.25 to the longitudinal axis [AFM 1.5.3; s.2.4]. */
    incidence: -4 * DEG,
    /**
     * Elevator 0.44 m^2 of the 1.69 m^2 [DV20, CALC; s.2.4; verification note 1]; 25 degrees up, 15 degrees
     * down, +/-1 [TCDS B.III.16, AMM; s.2.4].
     */
    elevator: { chordFraction: 0.26, maxUp: 25 * DEG, maxDown: 15 * DEG },
  },
  vTail: {
    /**
     * Fin + rudder, 12.21 sq ft [DV20; s.2.5; verification note 2]. The trapezoid of the chords below over 0.90 m
     * is 0.92 m^2: the published figure is matched by the fin counted down to the boom centre line with the
     * three-view's chord shortfall made good, or by the fin as drawn (1.09 m tall).
     */
    area: 1.13,
    /**
     * "About 1.0 m +/-0.1" [3V; s.2.5]: here the 0.90 m exposed between `base` and `tip` plus the 0.11 m from the
     * boom top down to the boom axis [s.12 fuselage stations 11 and 12].
     */
    height: 1,
    rootChord: FIN_ROOT_CHORD,
    tipChord: FIN_TIP_CHORD,
    /** Quarter-chord of the fin where it leaves the boom, and at the tailplane junction. */
    base: { x: da20NoseX(FIN_ROOT_LE + 0.25 * FIN_ROOT_CHORD), z: TAILPLANE_Z + FIN_EXPOSED },
    tip: { x: da20NoseX(FIN_ROOT_LE + FIN_EXPOSED * Math.tan(FIN_LE_SWEEP) + 0.25 * FIN_TIP_CHORD), z: TAILPLANE_Z },
    /**
     * Rudder 0.43 m^2 of the 1.13 m^2 (the three-view suggests 0.42 of the chord) [DV20, 3V; s.2.5]; 27 degrees
     * each way, +/-1 [TCDS B.III.16, AMM; s.2.5].
     */
    rudder: { chordFraction: 0.38, maxDeflection: 27 * DEG },
  },
  fuselage: {
    length: LENGTH,
    /** Spinner tip, and the elevator trailing edge (the tail boom itself ends at x_nose 6.55 [s.12 station 12]). */
    noseX: da20NoseX(0),
    tailX: da20NoseX(LENGTH),
    /** At the cabin; 1.18-1.20 m across the wing-root stubs [3V; s.2.6]. */
    maxWidth: 1.07,
    /** Belly to canopy top at x_nose 2.15 [3V; s.2.6]. */
    maxHeight: 1.19,
    /**
     * Left seat. ESTIMATE, the sheet has no eye point. x: 0.31 m behind the occupants' arm (0.143 m aft of RD
     * [AFM fig 6.5; s.6]) for a reclined seat, just behind the canopy apex at x_nose 2.15 (range 2.15 to 2.30).
     * y: a quarter of the 1.07 m cabin width. z: 0.48 m above FRL, 0.21 m under the canopy apex (0.69 m) and
     * 0.3 m above the sill (0.17-0.20 m) [s.12 fuselage station 6, canopy].
     */
    pilotEye: { x: da20NoseX(2.2), y: -0.27, z: da20FrlZ(0.48) },
  },
  gear: {
    // Tyre contact points, legs unloaded: under the axles, the mains half the track out, below the ground line
    // at rest by the droop.
    nose: { x: da20DatumX(MAIN_AXLE_AFT - WHEELBASE), y: 0, z: REST_HEIGHT + NOSE_DROOP },
    leftMain: { x: da20DatumX(MAIN_AXLE_AFT), y: -TRACK / 2, z: REST_HEIGHT + MAIN_DROOP },
    rightMain: { x: da20DatumX(MAIN_AXLE_AFT), y: TRACK / 2, z: REST_HEIGHT + MAIN_DROOP },
    /**
     * 5.00-4 nose tyre, about 0.33 m outside diameter; 5.00-5 mains, about 0.36 m [AFM 1.5.4 for the sizes; the
     * diameters are the sheet's, from memory of tyre catalogues, medium confidence; s.3].
     */
    noseWheelRadius: 0.165,
    mainWheelRadius: 0.18,
    /** Free-castering nosewheel, not linked to the pedals: the swivel stops, +/-60 degrees [AFM 7.5; s.3]. */
    maxNoseSteer: 60 * DEG,
    /** Fixed tricycle [AFM 7.5; s.3]. */
    retractable: false,
  },
  propellers: [
    {
      /** Propeller plane: arm -1.54 m [AFM 6.5 equipment list, item 61-003; s.4]; 0.05 m above FRL [3V; s.4]. */
      hub: { x: da20DatumX(-1.54), y: 0, z: da20FrlZ(0.05) },
      /** Sensenich W69EK7-63, 69.0 in, two blades, fixed pitch [AFM 2.4.3, TCDS; s.5]. */
      diameter: 1.752,
      blades: 2,
      /** Clockwise seen from the cockpit [TCDS B.III.7.5; s.4]. */
      rotation: 1,
    },
  ],
  restHeight: REST_HEIGHT,
  // ESTIMATE [CALC]: the wing tip is the farthest point, 5.44 m from the reference point (the tail 5.30 m), plus
  // the margin the C172S has; the published span + 2 m.
  bounds: { radius: 5.9, fitSize: 12.9 },
};
