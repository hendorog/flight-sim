// Cessna 152 (1978 model, Lycoming O-235-L2C): the geometric facts physics and the 3D model must agree on.
// Transcribed from the type's engineering data sheet (aircraft-data/c152.md in the design work folder): "s.N"
// below is section N of that sheet, "3V" a length it scaled from the three-view drawings (about +/-0.04 m) and
// ESTIMATE a number that is derived or judged rather than published.
//
// All positions are in body axes (FRD: x forward, y right, z DOWN), metres, relative to the type's REFERENCE
// POINT: on the centreline, longitudinally at the quarter-chord of the wing mean aerodynamic chord, at the height
// of the nominal centre of gravity.
//
// Coordinate conversion from the data sheet. The sheet works in stations (FS: inches aft of the front face of the
// firewall, the TCDS datum; WS: inches outboard of the centreline) and in a body table (s.2.5: x forward, y right,
// z down, metres, origin at the wing root quarter-chord in the wing chord plane).
//   x = (33.5 - FS) x 0.0254 = x of s.2.5. The quarter-chord line of the wing is straight, so the quarter-chord of
//       the MAC is at the station of the root quarter-chord: LEMAC FS 18.7 + 59.1 in / 4 = FS 33.5 (s.2.1).
//   y = WS x 0.0254 = y of s.2.5.
//   z = z of s.2.5 - 0.62. The nominal CG is 0.62 m below the wing chord plane (s.2.5; the sheet calls its height a
//       guess, 0.10 m above the thrust line), so the chord plane is at z = -0.62 and the thrust line at z = +0.10.
// Checked on landmarks the sheet gives independently of its body table:
//   wheelbase   nose wheel FS -10.8 -> x +1.125, main wheels FS 47.1 -> x -0.345: 1.470 m; POH 58 in = 1.473 m (s.3)
//   tail arm    tailplane MAC quarter-chord FS 189.0 -> x -3.95: the 3.95 m arm of s.2.2; the planform below (root
//               quarter-chord -3.87, tip -4.03, taper 0.61) puts its MAC quarter-chord at -3.94
//   length      spinner tip FS -45 -> x +1.994, rudder trailing edge FS 239.8 -> x -5.240: 7.234 m; SM 7.235 m (s.2.4)
//   height      on the plane through the three static wheel contact points (z 1.26 nose, 1.17 mains): propeller
//               clearance 0.32 m (POH 0.305 m, s.2.4), wing lower surface 1.74 m above the ground (s.2.5)
// Every x inherits the +/-2 in (0.05 m) uncertainty of the wing leading-edge station (s.2.1), every z that of the
// drawings and of the CG height.

import { DEG } from '../../core/math';
import type { AircraftGeometry } from '../types';

export const C152_GEOMETRY: AircraftGeometry = {
  // --- Wing (NACA 2412 to the strut station, blending to NACA 0012 at the tip; high wing, strut braced) ---
  wing: {
    /** s.2.1 (configuration). */
    mount: 'high',
    /** s.2.1: 400 in, the POH span with strobe lights (the sheet's pick; 10.11 m structural). */
    span: 10.16,
    /** s.2.1: 159.5 ft^2 with conical tips (the sheet's pick). The trapezoid below, run to span / 2, covers 15.06. */
    area: 14.82,
    /** s.2.1: 64 in, constant from the centreline to the lift-strut rib. */
    rootChord: 1.626,
    /** s.2.1: 44.5 in at the tip rib. */
    tipChord: 1.13,
    /** s.2.1: WS 84.00, the lift-strut rib. */
    taperStartY: 2.134,
    /** s.2.1: MAC 59.1 in. ESTIMATE of the sheet (integral of c^2; Cessna publishes none). */
    meanChord: 1.5,
    /**
     * s.2.5: the wing root quarter-chord is the sheet's origin (FS 33.5, +/-2 in); z converted. The quarter-chord
     * line is taken as straight (s.2.1 "essentially unswept"; the 3V tip figure is 0.02 m aft).
     */
    quarterChord: { x: 0, z: -0.62 },
    /** s.2.1: 1 degree (the sheet's pick; 1 deg 45 min is the 172). */
    dihedral: 1 * DEG,
    /** s.2.1: +1 degree at the root. */
    rootIncidence: 1 * DEG,
    /** s.2.1: 0 degrees at the tip; the 1 degree of washout lies wholly outboard of the strut rib (WS 84). */
    tipIncidence: 0 * DEG,
    /** s.2.4: half the 1.02 m cabin width (ESTIMATE of the sheet). The wing root rib is at 0.562 (WS 22.12). */
    rootY: 0.51,
    /**
     * s.2.1: single-slotted, root rib (WS 22.12) to the strut rib (WS 84); 0.33 of the chord (the corrected
     * figure of the sheet's verification notes, +/-0.02); 0 to 30 degrees.
     */
    flap: { innerY: 0.562, outerY: 2.134, chordFraction: 0.33, maxDeflection: 30 * DEG },
    /**
     * s.2.1: Frise, WS 84 to about WS 190 (3V); chord about 0.22 of the local chord with the Frise nose
     * (ESTIMATE of the sheet from the 1.66 m^2 aileron area); 20 degrees up, 15 down.
     */
    aileron: { innerY: 2.134, outerY: 4.83, chordFraction: 0.22, maxUp: 20 * DEG, maxDown: 15 * DEG },
    /**
     * s.2.5 (3V ESTIMATE), z converted, right side: lower end at the base of the forward door post (FS 21.6,
     * 1.06 m below the wing plane), upper end on the front spar at WS 84 (FS 28, lower surface).
     */
    strut: { fuselage: { x: 0.3, y: 0.5, z: 0.44 }, wing: { x: 0.14, y: 2.134, z: -0.54 } },
  },

  // --- Horizontal tail (fixed stabiliser and elevator on the tailcone; thin symmetric section, about NACA 0009) ---
  hTail: {
    /** s.2.2: conventional low position, not a T-tail. */
    mount: 'fuselage',
    /** s.2.2: fixed stabiliser with an elevator, not a stabilator. */
    allMoving: false,
    /** s.2.2: 120 in. */
    span: 3.048,
    /** s.2.2: gross area, centreline to tip. ESTIMATE of the sheet from 3V (+/-5 %; Jane's 2.65). */
    area: 2.7,
    /** s.2.2: 43.3 in at the centreline (3V). */
    rootChord: 1.1,
    /** s.2.2: 26.5 in (3V). */
    tipChord: 0.67,
    /**
     * x: s.2.2 stations, root leading edge FS 175 + 43.3 in / 4 = FS 185.8 (derived). z: s.2.5, 0.57 m below the
     * wing chord plane, converted. The MAC quarter-chord (the 3.95 m tail arm) is at x = -3.95.
     */
    quarterChord: { x: -3.87, z: -0.05 },
    /** s.2.2 stations: tip leading edge FS 185.7 + 26.5 in / 4 = FS 192.3 (derived); the leading edge is swept. */
    tipQuarterChordX: -4.03,
    /** s.2.2: -3 degrees (leading edge down), no twist. */
    incidence: -3 * DEG,
    /**
     * s.2.2: chord aft of the hinge 0.42 at the root to 0.44 at the tip (3V), here their area-weighted mean
     * (the straight hinge line is at x = -4.24, FS 200.37); 25 degrees up, 18 down.
     */
    elevator: { chordFraction: 0.43, maxUp: 25 * DEG, maxDown: 18 * DEG },
  },

  // --- Vertical tail (swept fin and rudder with a dorsal fairing) ---
  vTail: {
    /** s.2.3: fin + rudder, the sheet's pick of 1.31-1.35 (+/-7 %; its verification notes widened the Jane's 1.31). */
    area: 1.33,
    /** s.2.3: 56 in from the tailcone top to the fin tip (3V). */
    height: 1.42,
    /** s.2.3: 47.4 in at the tailcone top (3V). */
    rootChord: 1.2,
    /** s.2.3: 20.3 in (3V). */
    tipChord: 0.52,
    /** s.2.5: quarter-chord of the fin at the tailcone top (3V), z converted. */
    base: { x: -3.88, z: -0.11 },
    /** s.2.5: quarter-chord of the fin at its tip (3V), z converted. */
    tip: { x: -4.86, z: -1.535 },
    /**
     * s.2.3: chord aft of the hinge 0.40 at the root to about 0.45 near the tip (3V), here their area-weighted
     * mean; travel 20 deg 30 min each way measured parallel to the waterline (23 degrees perpendicular to the
     * swept hinge line).
     */
    rudder: { chordFraction: 0.42, maxDeflection: 20.5 * DEG },
  },

  // --- Fuselage ---
  fuselage: {
    /** s.2.4: overall, spinner tip to rudder trailing edge (the sheet's pick; SM 7.235, POH three-view 7.34). */
    length: 7.24,
    /** s.2.5: spinner tip, FS -45. */
    noseX: 1.99,
    /** s.2.5: aft-most point, the rudder top trailing edge (FS 239.8). The tailcone itself ends at -4.76 (FS 221). */
    tailX: -5.24,
    /** s.2.4: external, at door-sill level. ESTIMATE of the sheet. */
    maxWidth: 1.02,
    /** s.2.4: belly to roof at mid-cabin (3V). */
    maxHeight: 1.35,
    /**
     * Pilot eye point, left seat. x, y: s.2.5 (ESTIMATE of the sheet). z: -0.40, not the sheet's 3V -0.26 (0.36 m
     * below the wing plane), which its own cabin figures contradict (request D-D-c152-cockpit-01): the windshield's
     * lower edge about 0.45 m above the thrust line (s.12, z -0.35), the 41 in cabin height (POH Fig 6-5) with a
     * seated eye 0.70-0.80 m above the cushion. -0.40 is 0.19 m above the windshield sill and 0.19 m under the
     * headliner.
     */
    pilotEye: { x: -0.09, y: -0.24, z: -0.4 },
  },

  // --- Landing gear: tyre contact points with struts fully extended ---
  // The sheet gives the STATIC contact points (s.2.5: nose FS -10.8, z 1.88 -> 1.26 here; mains FS 47.1, z 1.79 ->
  // 1.17 here, 3V). Fully extended they hang lower by the static deflection of the springs of gear.ts at the
  // maximum-weight sample loading (nose 1.71 kN, each main 2.87 kN, engine stopped):
  //   nose   0.063 m = oleo 0.049 (s.3: 0.10 m stroke, 0.04-0.05 m of chrome showing at rest) + tyre 0.014
  //   mains  0.078 m = tubular spring leg 0.056 (s.3: about 50 kN/m) + tyre 0.023, along the leg's tilted axis
  // The two tyre figures are not in the sheet (21 and 30 psi tyres of about 125 kN/m). The legs are taken to
  // deflect straight up in y, so y is the published track both extended and at rest. At rest the aircraft then
  // sits 3.4 degrees nose-up (POH three-view: 3 deg 25 min, s.2.4), a little more with the engine idling (the
  // slipstream on the tail with the take-off trim set unloads the nose wheel).
  gear: {
    /** s.2.5 x (the 1.473 m wheelbase of s.3); z = 1.26 static + 0.063. */
    nose: { x: 1.125, y: 0, z: 1.325 },
    /** s.2.5 x; s.3 track 2.318 m (91.28 in); z = 1.17 static + 0.078. */
    leftMain: { x: -0.345, y: -1.159, z: 1.25 },
    rightMain: { x: -0.345, y: 1.159, z: 1.25 },
    /** s.3: 5.00-5 tyre, outside diameter about 0.36 m. */
    noseWheelRadius: 0.18,
    /** s.3: 6.00-6 tyre, outside diameter about 0.445 m. */
    mainWheelRadius: 0.2225,
    /** s.3: +/-8.5 degrees from the pedals alone (free castoring to 30 degrees with differential braking). */
    maxNoseSteer: 8.5 * DEG,
    /** s.3: fixed tricycle. */
    retractable: false,
  },

  // --- Propeller (McCauley 1A103/TCM6958, fixed pitch, clockwise seen from the cockpit) ---
  propellers: [
    {
      /** s.2.5: propeller plane FS -36.5 on the thrust line (0.72 m below the wing chord plane, 3V), z converted. */
      hub: { x: 1.78, y: 0, z: 0.1 },
      /** s.5: 69 in. */
      diameter: 1.753,
      /** s.5. */
      blades: 2,
      /** s.4: clockwise seen from the cockpit. */
      rotation: 1,
    },
  ],

  // ESTIMATE, derived: the reference point above the plane through the three static contact points of s.2.5 (z 1.26
  // at the nose wheel, 1.17 at the mains: 3.5 degrees nose-up, s.2.4 reads 3.4 off the POH three-view).
  restHeight: 1.19,
  // ESTIMATE, by the rule of the C172S: the farthest point (rudder top trailing edge, 5.45 m from the reference
  // point) plus 0.3 m; span + 2 m.
  bounds: { radius: 5.8, fitSize: 12.2 },
};
