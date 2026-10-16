// MD 500E (Hughes 369E), standard skid gear, LH command, 2-blade tail rotor: the airframe visual (plain data;
// the livery worker loads this file, so it imports no three.js and no renderer module).
//
// Shared reference geometry comes from dimensions.ts (T2) and the panel face from panelLayout.ts (M3). The loft,
// glazing outlines, furniture positions and paint here are visual ESTIMATES traced from RFM Fig 1-1 (three-view)
// and the Commons photographs listed in docs/md500-exterior.md (G-SSCL left side, D-HHRM front/quarter, Kauai
// head-on, Radecki cockpit, FOX 52 three-view). Stations/waterlines in inches as in the RFM (Fig 6-3):
// x = (100 - STA) x 0.0254, z = SKID_Z - (WL + 15.2) x 0.0254.
import type { AirframeVisualDef, FRD, RotorcraftVisualDef } from '../../render/aircraft/airframe/types';
import { MD500_ROTORCRAFT } from './rotorcraft';
import { MD500_BLADE_CONING } from './coning';
import * as D from './dimensions';
import { MD500_CONSOLE, MD500_PANEL_CANVAS, MD500_PANEL_FACE, MD500_PANEL_OUTLINE } from './panelLayout';

const IN = 0.0254;
const point = (p: { x: number; y: number; z: number }): FRD => [p.x, p.y, p.z];
/** Station (in) to body x, m. */
export const sta = (s: number): number => (100 - s) * IN;
/** Waterline (in) to body z, m. */
export const wl = (w: number): number => D.SKID_Z - (w + D.GROUND_WL_BELOW) * IN;

/** RFM Fig 1-1 note 1: the cargo deck is 4.7 deg nose up on the ground with full fuel. */
export const GROUND_ATTITUDE_DEG = 4.7;
/**
 * Tail-rotor hub in LEVEL body axes. D (derived from P inputs): Fig 1-1's heights are measured in the 4.7 deg
 * nose-up ground attitude (the hub-fairing top, STA 100, WL 89.5, reads 8.72 ft, so heights pivot at the mast).
 * The lowest TR tip at 2.0 ft (ground attitude) puts the hub at 2.0 ft + R = 51.5 in above the ground; 184 in
 * aft of the mast the ground-attitude drop is 184 x sin 4.7 deg = 15.1 in, so the body waterline is
 * 51.5 - 15.2 + 15.1 = WL 51.4. Check: the fin top 8.4 ft (ground attitude, STA ~293) gives WL 101.4 by the
 * same rule, against the stabiliser top WL 102.17 of Fig 6-3 (0.8 in apart). dimensions.ts TAIL_HUB.z applies
 * the ground-attitude height to level axes (WL 36.3); the visual uses this level-axis value (handed to T2).
 */
export const TAIL_HUB_WL = 2.0 * 12 + D.TAIL_ROTOR_RADIUS / IN - D.GROUND_WL_BELOW
  + (284 - 100) * Math.sin(GROUND_ATTITUDE_DEG * Math.PI / 180);
export const TAIL_HUB_LEVEL = { x: D.TAIL_HUB.x, y: D.TAIL_HUB.y, z: wl(TAIL_HUB_WL) } as const;

/** Boom centreline: straight from the tailboom-root cant (STA 197.78, WL 55.34, Fig 6-3) to the TR hub height. */
const BOOM_SLOPE = (TAIL_HUB_WL - 55.34) / (284 - 197.78);
export const boomWl = (s: number): number => 55.34 + (s - 197.78) * BOOM_SLOPE;
/** Boom tube from inside the engine fairing (STA 150) to the TR gearbox frame base (STA 281.12). 3V ESTIMATE radii. */
export const BOOM = { front: [sta(150), 0, wl(boomWl(150))] as FRD, rear: [D.BOOM_END_X, 0, wl(boomWl(281.12))] as FRD,
  radii: [0.135, 0.068] as const };

const W = D.CABIN_WIDTH / 2;
const ROOF_Z = D.CABIN_ROOF_Z;

// Loft table in RFM units: [STA, top WL, bottom WL, max-width WL, half width in, nTop, nBot]. The pointed "E" nose
// meets at STA 15 about 40 % up the body (FOX 52 three-view, G-SSCL); widest 4.57 ft at the doors; roof 6.77 ft
// (WL 66.0) and belly 1.27 ft (WL 0) above the ground on standard gear (RFM Fig 1-1); the egg closes to the
// exhaust collector under the boom root, just aft of the aft bulkhead STA 174.
const LOFT: readonly (readonly [number, number, number, number, number, number, number])[] = [
  [15.0, 27.2, 25.8, 26.5, 0.6, 2, 2],
  [17.0, 31.5, 22.5, 26.6, 6.0, 2.0, 2.0],
  [20.0, 36.0, 18.6, 26.8, 10.6, 2.1, 2.1],
  [25.0, 42.5, 15.4, 27.2, 15.2, 2.2, 2.2],
  [32.0, 50.0, 11.4, 27.8, 19.8, 2.3, 2.3],
  [42.0, 58.2, 7.0, 28.4, 23.8, 2.4, 2.4],
  [55.0, 63.6, 3.2, 29.2, 26.6, 2.5, 2.6],
  [70.0, 65.6, 0.8, 29.8, 27.42, 2.6, 2.7],
  [85.0, 66.0, 0.0, 30.0, 27.42, 2.6, 2.7],
  [105.0, 65.6, 0.0, 30.0, 27.2, 2.6, 2.7],
  [125.0, 63.4, 2.4, 30.4, 25.6, 2.5, 2.5],
  [142.0, 58.6, 7.6, 30.0, 22.0, 2.4, 2.3],
  [157.0, 51.0, 13.2, 28.6, 16.4, 2.2, 2.2],
  [168.0, 42.6, 16.0, 26.6, 11.8, 2.1, 2.1],
  [175.0, 36.0, 16.0, 25.6, 9.2, 2.0, 2.0],
  [178.0, 34.0, 17.2, 25.6, 8.0, 2.0, 2.0],
];
export const POD_END_STA = LOFT[LOFT.length - 1][0];

/** Glazing and door outlines in (STA, WL), converted below. 3V ESTIMATES from the three-view and photographs. */
const sw = (pts: readonly (readonly [number, number])[]): [number, number][] => pts.map(([s, w]) => [sta(s), wl(w)]);
/** Front door: front edge raked forward at the sill, round top into the eyebrow line. */
export const FRONT_DOOR = sw([[45.6, 9], [44.0, 29.6], [49.6, 47.5], [54.4, 61.6], [62, 63.6], [81, 63.4], [83.5, 48], [83.5, 9]]);
export const REAR_DOOR = sw([[85, 9], [85, 62.6], [100, 63], [112, 61], [118, 50], [119, 12]]);
/** The one-piece windshields above the horizontal nose bow (convex side outline; the centre post is geometry). */
export const WINDSHIELD = sw([[16.4, 27.2], [44.2, 30.4], [54.6, 62.4], [54.6, 90], [16.4, 90]]);
/** The chin windows below the bow, down to the belly keel (the centre strip between them is paint, geometry). */
export const CHIN_GLASS = sw([[17.6, 24.2], [21, 19.6], [29, 13.4], [40, 9.2], [44.4, 10.2], [43.6, 27.4]]);
/** The horizontal bow between the windshields and the chin windows (side projection). */
export const NOSE_BOW = sw([[16.6, 25.8], [43.6, 28.9]]);
/** Roof glazing over the front seats (the "eyebrow" panels) back to the mast fairing. */
export const ROOF_GLASS = sw([[50, 62.6], [76, 63.6], [77, 90], [50, 90]]);
/** Door windows: the large rounded front-door window and the rear-door window (photographs). */
export const FRONT_WINDOW = sw([[47.2, 31], [52.4, 49], [57.4, 59.2], [70, 60.8], [79, 59.6], [80.5, 50], [80.5, 31], [76, 26.5], [51, 26.5]]);
export const REAR_WINDOW = sw([[89, 31], [89, 56], [93, 59.4], [104, 59.4], [110, 54], [112.5, 44], [112.5, 31], [109, 27.5], [92, 27.5]]);

/** Main-rotor blade paint (generic: grey upper, dark lower, orange-red tip band as on D-HHRM). */
const MAIN_PAINT = { rootUpper: 0x8e9497, rootLower: 0x2b2f32, capLength: 0.03,
  bands: [{ tipDistance: 0.03, upper: 0xa9adaf, lower: 0xa9adaf }, { tipDistance: 0.30, upper: 0xd65f2f, lower: 0xd65f2f }] };
/** Tail-rotor paint: white root, red and white tip bands (photographs; a common 500E finish). */
const TAIL_PAINT = { rootUpper: 0xe9e9e4, rootLower: 0xe9e9e4, capLength: 0.006,
  bands: [{ tipDistance: 0.06, upper: 0xb62f31, lower: 0xb62f31 }, { tipDistance: 0.12, upper: 0xecece4, lower: 0xecece4 },
    { tipDistance: 0.20, upper: 0xb62f31, lower: 0xb62f31 }] };

/** Pilot seat (LEFT): seat back on the cargo-compartment bulkhead STA 78.5 (Fig 6-3), cushion top 0.27 m above the floor. */
export const SEAT = { frontX: sta(60.5), depth: sta(60.5) - sta(78.5) - 0.005, z: 0.235, width: 0.46, reclineDeg: 6 } as const;
/** Upper fin traced back to the boom: the shared outline's root (WL 60) stops above the tube (3V), so the leading
 * and trailing edges are extended along their own lines down to the boom centreline. */
const extendFinRoot = (o: readonly { x: number; z: number }[], rootZ: number): FRD[] => {
  const ext = (a: { x: number; z: number }, b: { x: number; z: number }): FRD =>
    [a.x + (b.x - a.x) * (rootZ - a.z) / (b.z - a.z), 0, rootZ];
  return [ext(o[0], o[1]), point({ ...o[1], y: 0 }), point({ ...o[2], y: 0 }), ext(o[3], o[2])];
};
export const UPPER_FIN: FRD[] = extendFinRoot(D.UPPER_FIN_OUTLINE, wl(boomWl(276)));
export const LOWER_FIN: FRD[] = D.LOWER_FIN_OUTLINE.map(point);
const HS = D.HORIZONTAL_STABILIZER;
export const STABILISER: FRD[] = [[HS.leadingX, -HS.span / 2, HS.z], [HS.leadingX - HS.chord, -HS.span / 2, HS.z],
  [HS.leadingX - HS.chord, HS.span / 2, HS.z], [HS.leadingX, HS.span / 2, HS.z]];
/** Endplates: HS.endplates height, chord 1.2 x the stab chord (photographs), centred on the stab. */
export const ENDPLATE = { chord: HS.chord * 1.2, height: HS.endplates.height, toeDeg: HS.endplates.toeDeg } as const;
/** Tail-skid bumper under the lower fin (Fig 6-3: tail-skid bottom WL 25.46). */
export const TAIL_SKID: FRD[] = [[sta(279), 0, wl(31)], [sta(283), 0, wl(25.9)], [sta(291), 0, wl(25.6)], [sta(295.5), 0, wl(28.6)]];

/** Gear struts (3V): top on the lower pod sides at STA 78.5 / 124, splayed out to the skid tubes. */
export const STRUT_TOP = { y: 0.52, z: wl(11) } as const;

const rotorcraftVisual: RotorcraftVisualDef = {
  nominalVoltage: 28,
  interior: { frameColor: 0x2b2e31, seatColor: 0x2c3540, seatBackColor: 0x3a4450, perforatedPedals: false, collectiveFittings: false },
  engineDetail: { exposed: false, cylinderXs: [] },
  main: { hub: point(D.MAIN_HUB), radius: D.MAIN_ROTOR_RADIUS, root: D.MAIN_BLADE_ROOT,
    chord: [D.MAIN_ROTOR_CHORD, D.MAIN_ROTOR_CHORD], twist: D.MAIN_ROTOR_TWIST_DEG * Math.PI / 180,
    coning: MD500_BLADE_CONING, paint: MAIN_PAINT },
  tail: { hub: point(TAIL_HUB_LEVEL), radius: D.TAIL_ROTOR_RADIUS, root: 0.10, chord: D.TAIL_ROTOR_CHORD,
    twist: D.TAIL_ROTOR_TWIST_DEG * Math.PI / 180, precone: 0, paint: TAIL_PAINT },
  boom: { front: BOOM.front, rear: BOOM.rear, radii: BOOM.radii },
  mast: { bottom: [0, 0, ROOF_Z], top: [0, 0, wl(77)], bottomWidth: 0.55, topWidth: 0.30 },
  fins: [
    { name: 'upperFin', axis: 'y', thickness: 0.045, outline: UPPER_FIN },
    { name: 'lowerFin', axis: 'y', thickness: 0.040, outline: LOWER_FIN },
    { name: 'horizontalStabiliser', axis: 'z', thickness: 0.036, outline: STABILISER },
  ],
  guard: TAIL_SKID, guardRadius: 0.014,
  skids: { halfTrack: D.SKID_HALF_TRACK, z: D.SKID_Z, front: D.SKID_FRONT_X, rear: D.SKID_REAR_X,
    crossTubes: [D.SKID_CONTACT_FRONT_X, D.SKID_CONTACT_REAR_X], tubeRadius: D.SKID_TUBE_RADIUS,
    bellyHalfWidth: STRUT_TOP.y, bellyZ: STRUT_TOP.z, crossCentreZ: STRUT_TOP.z },
  panel: { centre: point(MD500_PANEL_FACE.centre), width: MD500_PANEL_FACE.width, height: MD500_PANEL_FACE.height,
    tiltBackDeg: MD500_PANEL_FACE.tiltBackDeg, canvas: MD500_PANEL_CANVAS, outline: MD500_PANEL_OUTLINE,
    // The instrument pod sits on the slant console (MD spec: 16.3 x 10.1 in), which narrows to the floor.
    pedestal: { width: MD500_CONSOLE.width * 0.72, depth: 0.30, forwardOffset: 0.10, footWidth: MD500_CONSOLE.width * 0.8, footDepth: 0.34 },
    enclosureDepth: 0.17, poweredVolts: [18, 24] },
  // One pilot cyclic (LEFT); cockpitDetails replaces the generic sticks with the curved 500 stick.
  cyclic: { kind: 'individual', gripYs: [D.SEAT_CENTRES[0].y, D.SEAT_CENTRES[1].y], barTiltDeg: 0,
    stem: [[0, 0, 0], [0.10, 0, -0.08], [0.04, 0, -0.36], [-0.06, 0, -0.52]] },
  // Pilot collective on the left of the left seat, pivot aft beside the seat (3V); dual controls not fitted.
  collective: { pivots: [[sta(76), D.SEAT_CENTRES[0].y - 0.27, 0.36]], length: 0.52 },
  pedalZ: 0.47,
  registrationXs: [sta(118), sta(160)],
};

export const MD500_VISUAL: AirframeVisualDef = {
  id: 'md500', rotorcraft: MD500_ROTORCRAFT, rotorcraftVisual,
  fuselage: { nose: 'closed', frontX: D.NOSE_X, endX: sta(POD_END_STA), inlets: [], antennas: [],
    exhaust: { pos: [sta(POD_END_STA) + 0.03, 0, wl(25.6)], dir: [-0.06, 0, 0], radius: 0.15 }, grid: { rows: 160, cols: 104 },
    keys: LOFT.map(([s, top, bot, mid, hw, nTop, nBot]) => [sta(s), wl(top), wl(bot), wl(mid), hw * IN, nTop, nBot, 0] as const) },
  glazing: { cabinFrontX: D.NOSE_X - 0.003, cabinRearX: sta(120), firewallX: sta(120),
    tRange: [0.035, 0.965], liningRoofLimit: -1e9,
    windows: [
      { pts: WINDSHIELD, r: 0.03, sides: 'both' },
      { pts: CHIN_GLASS, r: 0.025, sides: 'both' },
      { pts: ROOF_GLASS, r: 0.03, sides: 'both' },
      { pts: FRONT_WINDOW, r: 0.03, sides: 'both' },
      { pts: REAR_WINDOW, r: 0.03, sides: 'both' },
    ],
    doors: [
      { pts: FRONT_DOOR, r: 0.035, sides: 'both', handle: { x: sta(78), z: wl(28) } },
      { pts: REAR_DOOR, r: 0.035, sides: 'both', handle: { x: sta(115), z: wl(28) } },
    ] },
  // Fixed-wing carriers: unused compatibility data for the common bake interface (the R44 pattern).
  wing: { mount: 'low', section: { m: 0, p: 0.4, t: 0.12 }, breaks: [{ y: 0, chord: 0.1, qcX: 0 }, { y: 0.1, chord: 0.1, qcX: 0 }],
    rootY: 0, qcZ: 0, dihedral: 0, rootIncidence: 0, tipIncidence: 0, bays: [], flap: { maxDeflection: 0, travelAft: 0, travelDown: 0 },
    tip: { round: 0, chordRound: 0 }, fuelCaps: [] },
  tail: { section: { m: 0, p: 0.4, t: 0.09 }, h: { span: HS.span, rootChord: HS.chord, tipChord: HS.chord,
    quarterChord: { x: HS.leadingX - HS.chord / 4, z: HS.z }, incidence: 0, kind: 'elevator', chordFraction: 0, innerCutY: 0 },
    v: { base: { x: UPPER_FIN[0][0], z: UPPER_FIN[0][2] }, tip: { x: UPPER_FIN[1][0], z: UPPER_FIN[1][2] },
      rootChord: UPPER_FIN[0][0] - UPPER_FIN[3][0], tipChord: UPPER_FIN[1][0] - UPPER_FIN[2][0], rudderChordFraction: 0 }, tTail: true },
  gear: [0, -1, 1].map(s => ({ contact: [s === 0 ? D.SKID_CONTACT_FRONT_X : D.SKID_CONTACT_REAR_X, s * D.SKID_HALF_TRACK, D.SKID_Z],
    radius: 0, width: 0, rimRadius: 0, leg: { kind: 'springTube', root: [0, 0, 0], axleOffset: 0, r0: 0, r1: 0 } })) as unknown as AirframeVisualDef['gear'],
  props: [], nacelles: [],
  lamps: [
    // Position lights on the stabiliser endplates, white tail light on the TR gearbox fairing, red anti-collision
    // beacon under the belly (Kauai photograph), landing light in the lower nose strip (D-HHRM front). ESTIMATES.
    { id: 'navL', pos: [HS.leadingX - HS.chord / 2, -HS.span / 2 - 0.02, HS.z], radius: 0.018, glowOffset: [0, -0.02, 0] },
    { id: 'navR', pos: [HS.leadingX - HS.chord / 2, HS.span / 2 + 0.02, HS.z], radius: 0.018, glowOffset: [0, 0.02, 0] },
    { id: 'navTail', pos: [sta(292), 0, wl(46)], radius: 0.016, glowOffset: [-0.02, 0, 0] },
    { id: 'beacon', pos: [sta(96), 0, D.BELLY_Z + 0.025], radius: 0.03, glowOffset: [0, 0, 0.03] },
    { id: 'landing', pos: [sta(23.5), 0, wl(17.5)], radius: 0.045, glowOffset: [0.03, 0, 0], aim: { downDeg: 10, outDeg: 0, halfAngleDeg: 13 } },
  ],
  cockpit: {
    pilotEye: point(D.PILOT_EYE), defaultPitchDeg: -18, defaultFovDeg: 82, enclosure: 'canopy',
    panel: { x: MD500_PANEL_FACE.centre.x, zTop: MD500_PANEL_FACE.centre.z - MD500_PANEL_FACE.height / 2, width: MD500_PANEL_FACE.width },
    floor: { z: D.FLOOR_Z, x0: sta(40), x1: sta(78.5) }, glareshield: { profile: [], halfWidth: MD500_PANEL_FACE.width / 2 },
    seats: D.SEAT_CENTRES.map(s => ({ x: SEAT.frontX, y: s.y, z: SEAT.z, kind: 'front', width: SEAT.width,
      depth: SEAT.depth, reclineDeg: SEAT.reclineDeg, back: { height: 0.62, headrest: false } })),
    occupants: [{ seat: D.PILOT_SEAT }], consoles: [], trimPanels: [],
    column: { kind: 'stick', pivot: [sta(52), 0, D.FLOOR_Z - 0.01], height: 0.55, pitchDeg: 11, rollDeg: 9, ys: [D.SEAT_CENTRES[0].y] },
    pedals: { x: sta(33), ys: D.SEAT_CENTRES.flatMap(s => [s.y - 0.10, s.y + 0.10]) },
    engineControls: [], flapControl: { kind: 'panelSwitch', pos: [0, 0, 0], travel: 0 },
    // Wet compass on the windshield centre bow above the panel (Radecki photograph). ESTIMATE.
    compass: { pos: [sta(50), 0, wl(55)] },
    lamps: { flood: { pos: [sta(64), 0, wl(62)], aim: point(MD500_PANEL_FACE.centre) } },
    box: { floor: D.FLOOR_Z, roof: ROOF_Z, side: W, rear: sta(78.5), panelX: MD500_PANEL_FACE.centre.x,
      glareshieldZ: MD500_PANEL_FACE.centre.z - MD500_PANEL_FACE.height / 2, sillZ: wl(8), windscreenX: D.NOSE_X, roofGlazed: true },
    glazingPanels: [{ n: [1, 0, 0], area: 1.5 }, { n: [0, 1, 0], area: 1.0 }, { n: [0, -1, 0], area: 1.0 }, { n: [0, 0, -1], area: 0.6 }],
    interiorArea: 6.0, controlPoints: {},
  },
  livery: { registration: 'N500EA', palette: { base: [238, 240, 237], band: [28, 50, 92], accent: [178, 38, 40] },
    accentBelow: false, construction: 'metal', skinJoints: [sta(84), sta(120), sta(150)],
    // A generic sweep from the chin, under the doors, rising to the exhaust (not a factory scheme).
    stripe: { xs: [sta(178), sta(150), sta(115), sta(80), sta(45), sta(15)], centre: [wl(31), wl(24), wl(17), wl(13), wl(14), wl(25)],
      half: [0.02, 0.045, 0.055, 0.055, 0.04, 0.012], noseShearX: D.NOSE_X },
    lettering: { x0: sta(160), x1: sta(128), z0: wl(50), z1: wl(42) },
    fin: { bandZ0: wl(80), bandX0: sta(284), slope: 0, cap: 0.08 }, texture: { w: 4096, h: 2048 } },
  shadow: { halfX: 5.6, halfY: 4.6, fuselage: [sta(95), 1.55, W], wingX: 0, wingY: 3.4,
    wingHeight: -D.MAIN_HUB.z + D.SKID_Z, restHeight: D.SKID_Z,
    skids: { halfTrack: D.SKID_HALF_TRACK, front: D.SKID_FRONT_X, rear: D.SKID_REAR_X } },
};

export default MD500_VISUAL;
