// Piper PA-38-112 Tomahawk II: the geometric facts physics and the 3D model must agree on. Transcribed from the
// PA-38 engineering data sheet (work/aircraft-data/pa38.md, kept outside the tree): "s.2.4" below is its section
// 2.4, and the corrections of its "Verification notes" are applied. Source tags as in the sheet: [POH] handbook
// VB-2126, [MM] maintenance manual 761-660 (dimensioned stations), [TCDS], [3V] scaled from the Piper three-view
// sketch (+/-5-10 %), [K] from knowledge, [CALC] arithmetic. A number the sheet does not dimension is marked
// ESTIMATE.
//
// COORDINATES. The sheet works in Piper's: fuselage station STA (inches AFT of a datum 66.25 in ahead of the wing
// leading edge), wing station WS / buttock line BL (inches from the centre line) and water line WL (inches UP;
// the thrust line is WL 40.00). Here every position is in body axes (FRD: x forward, y right, z DOWN), metres,
// relative to the aircraft REFERENCE POINT, which is on the centre line at
//   x: the quarter-chord of the wing mean aerodynamic chord. The wing is rectangular, so that is the leading
//      edge, STA 66.25, plus a quarter of the 44 in chord: STA 77.25 [POH 2.13; s.2.1, s.2.7].
//   z: the nominal height of the centre of gravity, taken as WL 36.5 (0.089 m below the thrust line, 0.39 m above
//      the root chord line). ESTIMATE: the sheet has no vertical CG. Build-up at the training loading of s.6:
//      wing 220 lb at WL 28, fuel 120 at WL 25, engine and accessories 288 at WL 39, propeller 30 at WL 40,
//      fuselage and equipment 486 at WL 38, tailplane 30 at WL 104, fin and rudder 25 at WL 78, main gear 60 at
//      WL 8, nose gear 30 at WL 14, crew 340 at WL 40: 1629 lb at WL 36.5, +/-3 in.
// so that
//   x = (77.25 - STA) * 0.0254        y = BL * 0.0254        z = (36.5 - WL) * 0.0254
//
// Checked against dimensions the conversion was not built from:
//   wheelbase   sta(33.0) - sta(90.0) = 1.124 + 0.324 = 1.448 m: the 4 ft 9 in of POH fig 1-1 (s.3).
//   tail arm    -sta(238.07 + 25.97 / 4) = 4.250 m from the wing to the tailplane quarter-chord (s.2.4).
//   propeller   sta(7.5) = 1.772 m ahead of the wing quarter-chord (s.2.8: 1.77 m).
//   tailplane   wl(40.0) - wl(103.9) = 1.623 m above the thrust line (s.2.4: 1.62 m).
// and, for the ground at rest (z = +1.05, REST_HEIGHT below):
//   height      the top of the tail, wl(105.75) = -1.759, stands 2.81 m above it: the POH's 9 ft 1 in (2.77 m,
//               on 5.00-5 tyres) plus the 0.042 m of the 6.00-6 tyres (s.2.6, s.2.9).
//   propeller   tip 0.225 m clear of it (s.2.6: 0.22 m with 6.00-6 tyres).

import { DEG } from '../../core/math';
import type { AircraftGeometry } from '../types';

/** Metres per inch. */
const IN = 0.0254;
/** Body x of a fuselage station, inches aft of the Piper datum. */
const sta = (station: number): number => (77.25 - station) * IN;
/** Body z of a water line, inches (thrust line 40.00). */
const wl = (waterLine: number): number => (36.5 - waterLine) * IN;
/** Body y of a wing station or buttock line on the right side, inches. */
const bl = (buttockLine: number): number => buttockLine * IN;

/** 34 ft 0 in [POH fig 1-1; s.2.1]. */
const SPAN = 10.36;
/**
 * Height of the reference point above the ground at rest. The thrust line stands 1.13-1.14 m above the ground
 * on 6.00-6 tyres (s.2.9: the POH's 43.25 in on 5.00-5 tyres confirmed by the MM water lines, plus 1.65 in of
 * tyre radius; +/-0.03 m) and the reference point is 0.089 m below it.
 */
const REST_HEIGHT = 1.05;

export const PA38_GEOMETRY: AircraftGeometry = {
  // --- Wing (NASA GA(W)-1 = LS(1)-0417 throughout, rectangular, low, no strut, no winglet) ---
  wing: {
    mount: 'low',
    span: SPAN,
    /** 124.7 sq ft [POH fig 1-1; s.2.1]. */
    area: 11.59,
    /** 3 ft 8 in, root = tip = mean chord [POH fig 1-1; s.2.1]. */
    meanChord: 1.118,
    rootChord: 1.118,
    tipChord: 1.118,
    /** Rectangular: the constant chord runs to the tip. */
    taperStartY: SPAN / 2,
    /**
     * At the root rib. x: the reference point by definition (no sweep). z: the root chord line is at about WL 21,
     * 0.48-0.50 m below the thrust line: ESTIMATE scaled from the MM side view, +/-0.05 m [s.2.1, s.2.8].
     */
    quarterChord: { x: 0, z: wl(21.0) },
    /** Printed on MM fig 1 (6-00-00) [s.2.1]. */
    dihedral: 5 * DEG,
    /**
     * Printed on MM fig 1: 2 deg at wing station 22.7 (root rib), 0 deg at wing station 194.38 (tip rib); the
     * washout is linear between the two, same section throughout [s.2.1].
     */
    rootIncidence: 2.0 * DEG,
    tipIncidence: 0.0 * DEG,
    /** Fuselage side at the wing root, WS 23.35 [MM fig 2; s.2.1, s.2.6]. */
    rootY: bl(23.35),
    /**
     * Plain flaps, WS 37.50 to WS 117.00 [MM fig 2; s.2.2]. Chord fraction: ESTIMATE 0.20 (0.18-0.22) scaled from
     * the plan view, hinge line common with the aileron. Full flap 34 deg (second notch; first notch 21 deg)
     * [POH 7.9, TCDS; s.2.2].
     */
    flap: { innerY: bl(37.5), outerY: bl(117.0), chordFraction: 0.2, maxDeflection: 34 * DEG },
    /**
     * Plain differential ailerons, WS 117.00 to WS 196.50 [MM fig 2; s.2.3]. Chord fraction: ESTIMATE 0.20
     * (0.18-0.22), as the flap. Travel 26 deg up, 14 deg down [TCDS, MM chart 2 of 27-00-00; s.2.3].
     */
    aileron: { innerY: bl(117.0), outerY: bl(196.5), chordFraction: 0.2, maxUp: 26 * DEG, maxDown: 14 * DEG },
  },

  // --- Horizontal tail (T-tail: fixed stabiliser on the fin top with a separate elevator; rectangular) ---
  hTail: {
    mount: 'tTail',
    allMoving: false,
    /** 10 ft 6 in [POH fig 1-1; s.2.4]; the tips are at BL 63.05 [MM fig 2]. */
    span: 3.2,
    /** Gross, from the dimensioned stations: 126.1 in x 25.97 in [CALC; s.2.4]. */
    area: 2.11,
    /** 2 ft 2 in, constant: STA 238.07 to STA 264.04 [POH fig 1-1, MM fig 2; s.2.4]. */
    rootChord: 0.66,
    tipChord: 0.66,
    /**
     * x: a quarter of the 25.97 in chord behind the leading edge, STA 238.07. z: the stabiliser chord plane,
     * WL 103.90 [MM fig 2; s.2.4].
     */
    quarterChord: { x: sta(238.07 + 25.97 / 4), z: wl(103.9) },
    /**
     * ESTIMATE: not found; the sheet gives 0 to -1 deg and picks -0.5 [s.2.4]. -1, the end of that range: the
     * trimmed elevator then sits where the spring trim's wheel reads "slightly aft of neutral" for the take-off
     * (POH 4.5; systems.ts PITCH_TRIM).
     */
    incidence: -1 * DEG,
    /**
     * Hinge line at STA 252.67: 11.37 in of the 25.97 in chord [MM fig 2; s.2.4]. Travel 32 deg up, 20 deg down
     * from the stabiliser chord line [MM chart 2 of 27-00-00]; the TCDS extracts say 34 deg up, the sheet picks
     * the manual's 32 [s.2.4, Verification notes].
     */
    elevator: { chordFraction: 0.44, maxUp: 32 * DEG, maxDown: 20 * DEG },
  },

  // --- Vertical tail (swept fin and rudder; scaled [3V] between the MM's dimensioned corner points, areas +/-15 %) ---
  vTail: {
    /** Fin + rudder: ESTIMATE, the sheet's pick of 15.0 sq ft between 1.35 and 1.42 m^2 [s.2.5]. */
    area: 1.39,
    /**
     * Rudder bottom (WL 44.90) to the stabiliser plane (WL 103.90) [MM fig 2; s.2.5, s.2.7]. The fin above the
     * tail cone top (WL 57.00), which is base to tip below, is 1.19 m of it.
     */
    height: (103.9 - 44.9) * IN,
    /**
     * Fin + rudder chord at the base and at the tip: 57.2 in at the tail cone top and 27.6 in at the stabiliser
     * plane, the trapezoid the sheet's verifier drew through the MM points [s.2.5]. ESTIMATE.
     */
    rootChord: 57.2 * IN,
    tipChord: 27.6 * IN,
    /**
     * Quarter-chord of fin + rudder at the tail cone top, WL 57.00 [MM fig 2]. The leading edge meets the tail
     * cone at about STA 205-206: ESTIMATE, scaled [s.2.5, s.2.7].
     */
    base: { x: sta(205.5 + 57.2 / 4), z: wl(57.0) },
    /**
     * Quarter-chord at the top: leading edge STA 243.40 at WL 103.90 [MM fig 2; s.2.5]. Same z as the tailplane,
     * 0.146 m behind its root quarter-chord (the tailplane sits forward on the fin top).
     */
    tip: { x: sta(243.4 + 27.6 / 4), z: wl(103.9) },
    /**
     * Chord fraction: ESTIMATE, the mean by area (about 0.28 of the local chord at the root, 0.65 at the tip)
     * [3V; s.2.5]. Travel 29 deg each way [TCDS, MM chart 2 of 27-00-00; s.2.5].
     */
    rudder: { chordFraction: 0.45, maxDeflection: 29 * DEG },
  },

  // --- Fuselage ---
  fuselage: {
    /** Overall, 23 ft 2 in [POH fig 1-1; s.2.6]. */
    length: 278 * IN,
    /**
     * Spinner tip: the overall length ahead of the tail tip, STA -4.4 [s.2.7 note to the tail tip; the sketch
     * scales to STA -3 +/- 1.5].
     */
    noseX: sta(273.59 - 278),
    /**
     * Aft-most point, the bullet fairing on the fin top: STA 273.59 [MM fig 2; s.2.7]. The tail cone itself ends
     * at the sternpost, STA 261.07.
     */
    tailX: sta(273.59),
    /** External, at the cabin: ESTIMATE [3V; s.2.6] (1.07 m inside at the shoulders; 1.19 m across the wing roots). */
    maxWidth: 1.12,
    /** Belly to canopy top at the crown: ESTIMATE [3V; s.2.6, s.12 station 7]. */
    maxHeight: 1.32,
    /**
     * Pilot eye point (left seat). ESTIMATE, not in the sheet; +/-0.05 m each way. x: STA 89, 3.5 in behind the
     * occupant arm of STA 85.5 (seat notch 4) [POH fig 6-14; s.6]. y: a quarter of the 1.07 m cabin [s.2.6].
     * z: WL 59, 0.22 m under the canopy crown (0.70 m above the thrust line) and 0.28 m above the window sill
     * (0.20 m above it) [3V; s.12].
     */
    pilotEye: { x: sta(89.0), y: -0.27, z: wl(59.0) },
  },

  // --- Landing gear: tyre contact points with struts fully extended (fixed tricycle, 6.00-6 on all three) ---
  // x: nose axle STA 33.0, main axles STA 90.0 [POH fig 6-3, MM fig 2; s.3]. y: track 10 ft 0 in [POH fig 1-1;
  // s.3]. z: ESTIMATE. The sheet gives the stance at rest only; the extended points are put below the resting
  // ground plane by the static deflection of strut and tyre, taken as on the C172S (nose oleo 0.06 m, main
  // leaf spring 0.08 m) until the springs are sized.
  gear: {
    nose: { x: sta(33.0), y: 0, z: REST_HEIGHT + 0.072 },
    leftMain: { x: sta(90.0), y: -1.524, z: REST_HEIGHT + 0.08 },
    rightMain: { x: sta(90.0), y: 1.524, z: REST_HEIGHT + 0.08 },
    /** 6.00-6 Type III, outside diameter about 0.445 m [K, medium confidence; s.3, s.12]. */
    noseWheelRadius: 0.2225,
    mainWheelRadius: 0.2225,
    /** Linked directly to the pedals, 30 deg each side [POH 7.7, MM chart 1 of 6-00-00; s.3]. */
    maxNoseSteer: 30 * DEG,
    retractable: false,
  },

  // --- Propeller (Sensenich 72CK-0-56, fixed pitch, clockwise seen from the cockpit [K, high confidence; s.4]) ---
  // Hub: propeller arm STA 7.5 [POH 6.9; s.2.7, s.2.8] on the thrust line WL 40.00 [MM fig 2]; no thrust-line
  // offset is known (s.2.8). Diameter 72 in, two blades [POH 1.5, 7.5; s.5].
  propellers: [{ hub: { x: sta(7.5), y: 0, z: wl(40.0) }, diameter: 72 * IN, blades: 2, rotation: 1 }],

  restHeight: REST_HEIGHT,
  // The farthest points are 5.3 m from the reference point (tail tip, tailplane tips; the wing tips 5.2 m).
  // Zoom-to-fit: span + 2 m, as the C172S.
  bounds: { radius: 5.6, fitSize: 12.4 },
};
