// MBB Bo 105 CB-4: the airframe visual (plain data; the livery worker loads this file, so it imports no three.js and
// no renderer module). Package BX (plan revision 2, section 6.3).
//
// Shared reference geometry comes from dimensions.ts (BO's contract: datum, hub, rotors, fuselage lengths, skids,
// stabiliser, fin, eye) and the cockpit layout from the integrator-frozen panelLayout.ts. The loft, glazing and door
// outlines, deck fairing, furniture positions and paint here are visual ESTIMATES traced from the Wikimedia Commons
// photographs listed in docs/bo105-exterior.md (D-HILF left side and quarter views, D-HADO in flight, the Flying Bulls
// CB, the 0570b rotor head, the Christoph 7 / Policia / schoschie cockpits) against the P/3V numbers of dimensions.ts.
// Stations are metres aft of the datum and heights metres above the skid soles, as in dimensions.ts:
// x = (3.150 - sta), z = SKID_Z - h.
import type { AirframeVisualDef, FRD, RotorcraftVisualDef } from '../../render/aircraft/airframe/types';
import { BO105_ROTORCRAFT } from './rotorcraft';
import { BO105_BLADE_CONING } from './coning';
import * as D from './dimensions';
import { BO105_PANEL_CANVAS, BO105_PANEL_FACE, BO105_PANEL_OUTLINE } from './panelLayout';

const point = (p: { x: number; y: number; z: number }): FRD => [p.x, p.y, p.z];
/** Station (m aft of the datum) to body x, m. */
export const S = (sta: number): number => D.x(sta);
/** Height above the skid soles (m) to body z, m. */
export const H = (h: number): number => D.z(h);
/** (station, height) outline points to body (x, z). */
const sh = (pts: readonly (readonly [number, number])[]): [number, number][] => pts.map(([s, h]) => [S(s), H(h)]);

/** Nose and the rear end of the cabin pod (hull 4.30 m, P TCDS p8): the nose at dimensions.ts NOSE_X (STA 0.70). */
export const NOSE_STA = D.REF_STATION_M - D.NOSE_X;
export const POD_END_STA = NOSE_STA + D.HULL_LENGTH;
/** Aft end of the airframe (fuselage 8.56 m incl. the tail, P5 FM Fig 1-1): nothing but the rotors lies aft of it. */
export const TAIL_END_STA = D.REF_STATION_M - D.TAIL_END_X;

/**
 * Pod loft: [STA, top h, bottom h, widest-section h, half width, nTop, nBot] (m). The blunt round nose with the
 * windscreen rising steeply to a high flat roof, the flat belly 0.40 m above the soles (dimensions.ts BELLY_HEIGHT),
 * the widest section 1.58 m (P), near-vertical sides from the cheat line to the window tops (superellipse exponents
 * 3.2-3.4 over the cabin), and the bluff rear face of the aft clamshell doors closing within about 0.7 m at the hull's
 * 4.30 m (ext-munich-4 / -9, Flying Bulls CB).
 * The roof is 2.055 m outside (the lining 2.03 m) so the frozen overhead console (centre 1.98 m) and the power-lever
 * pivots (2.00 m) of panelLayout.ts hang inside it; dimensions.ts's CABIN_ROOF_HEIGHT 2.02 m (3V) is read as the
 * lining. 3V ESTIMATE (D-HILF, D-HADO, Flying Bulls CB).
 */
const LOFT: readonly (readonly [number, number, number, number, number, number, number])[] = [
  [0.700, 1.000, 0.940, 0.970, 0.020, 2.0, 2.0],
  [0.720, 1.200, 0.800, 0.990, 0.210, 2.0, 2.0],
  [0.770, 1.400, 0.680, 1.010, 0.370, 2.1, 2.1],
  [0.860, 1.600, 0.580, 1.040, 0.510, 2.2, 2.2],
  [0.990, 1.780, 0.500, 1.070, 0.615, 2.3, 2.3],
  [1.160, 1.920, 0.445, 1.100, 0.695, 2.6, 2.6],
  [1.380, 2.010, 0.410, 1.120, 0.748, 3.0, 3.0],
  [1.650, 2.050, 0.400, 1.140, 0.777, 3.3, 3.2],
  [2.000, 2.055, 0.400, 1.150, 0.790, 3.4, 3.2],
  [3.000, 2.055, 0.400, 1.150, 0.790, 3.4, 3.2],
  [3.800, 2.050, 0.410, 1.160, 0.785, 3.4, 3.2],
  [4.250, 2.030, 0.460, 1.180, 0.765, 3.3, 3.1],
  [4.600, 1.995, 0.530, 1.210, 0.740, 3.1, 3.0],
  [4.820, 1.930, 0.630, 1.240, 0.660, 2.9, 2.8],
  [4.950, 1.810, 0.790, 1.270, 0.500, 2.6, 2.5],
  [4.985, 1.680, 0.960, 1.290, 0.340, 2.3, 2.3],
  [5.000, 1.460, 1.150, 1.300, 0.100, 2.0, 2.0],
];

/**
 * Glazing (side-projection (x, z) convex outlines; the window mask covers both sides). 3V ESTIMATES from the
 * photographs (D-HADO's near-profile puts the crew-door window at STA 1.34-1.71 and the sliding-door windows at
 * 1.85-2.25 and 2.39-2.59, scaled by the 4.30 m hull and checked on the mast at 3.15): the large windscreen over the
 * nose (its centre post is geometry), the roof glazing over the crew either side of the centre beam, the chin windows
 * below the horizontal nose bow, the crew-door windows (a large upper one and the lower "kick" window) and the two
 * sliding-door windows.
 */
/**
 * A-post (side projection, [STA, h]): the windscreen's aft frame and the crew door's front edge, from the nose bow up to
 * the roof, then the roof window's side frame aft. Straight from h 1.31 to the roof. The windscreen's aft edge and the
 * crew-door window's front edge run parallel to it only 4 mm either side, so the glazing and the lining are open up to
 * the post and the post itself is the painted tube over the seam (24 mm, exteriorDetails.ts): from the right seat at
 * eye height it and the lining's trim cover about 5 deg (the Policia CB and Flying Bulls photographs show a slim door
 * post between the curved windscreen and the door window). 3V ESTIMATE.
 */
export const A_POST: readonly (readonly [number, number])[] = [[1.16, 1.06], [1.235, 1.31], [1.395, 1.955], [1.93, 1.985]];
/** The A-post's station at height h (m above the soles) on its straight run, h 1.31-1.955. */
const aPostSta = (h: number): number => 1.235 + (h - 1.31) * (1.395 - 1.235) / (1.955 - 1.31);
export const WINDSCREEN = sh([[0.705, 1.045], [1.15, 1.07], [aPostSta(1.31) - 0.004, 1.31], [aPostSta(1.955) - 0.004, 1.955], [1.42, 2.30],
  [0.705, 2.30]]);
export const ROOF_GLASS = sh([[1.30, 1.965], [1.92, 1.995], [1.92, 2.30], [1.30, 2.30]]);
export const CHIN_GLASS = sh([[0.70, 1.00], [0.70, 0.80], [0.74, 0.715], [0.85, 0.635], [1.06, 0.60], [1.13, 0.62], [1.15, 1.03]]);
/** The horizontal nose bow between the windscreen and the chin windows (side projection; drawn as a frame). */
export const NOSE_BOW = sh([[0.718, 1.025], [1.16, 1.055]]);
export const CREW_WINDOW = sh([[1.27, 1.14], [1.72, 1.14], [1.72, 1.86], [aPostSta(1.90) + 0.004, 1.90], [aPostSta(1.40) + 0.004, 1.40]]);
export const CREW_LOWER_WINDOW = sh([[1.23, 0.75], [1.64, 0.75], [1.64, 1.01], [1.27, 1.01]]);
export const SLIDING_WINDOW = sh([[1.90, 1.22], [2.30, 1.22], [2.30, 1.85], [1.90, 1.86]]);
export const SLIDING_REAR_WINDOW = sh([[2.40, 1.30], [2.62, 1.30], [2.62, 1.84], [2.40, 1.84]]);
/** Doors (panel lines): the hinged crew door (hinges on its front edge at the windscreen frame), the sliding passenger
 *  door, the aft clamshell door outline seen from the side, and the nose compartment cover below the chin windows. */
// The door's front edge is the A-post's straight run extended down to the lower window (one edge: the outline stays
// convex, and no mid-edge vertex for the rounded intersection to pull in).
export const CREW_DOOR = sh([[1.14, 0.66], [1.78, 0.66], [1.78, 1.95], [aPostSta(1.965), 1.965], [aPostSta(1.00), 1.00]]);
export const SLIDING_DOOR = sh([[1.82, 0.64], [2.80, 0.64], [2.80, 1.95], [1.82, 1.95]]);
export const CLAMSHELL = sh([[4.33, 0.70], [5.10, 0.70], [5.10, 1.74], [4.33, 1.74]]);
export const NOSE_COMPARTMENT = sh([[0.98, 0.535], [1.42, 0.45], [1.44, 0.52], [1.42, 0.56], [1.00, 0.58]]);
/** Station where the clamshell doors begin (their seams and hinges are geometry: they face aft). */
export const CLAMSHELL_STA = 4.33;
/** Sliding-door travel: its rails run aft over the fixed panel to here. */
export const SLIDING_RAIL_END_STA = 3.78;

/**
 * Upper deck fairing (transmission and the two engines side by side behind it, P5 FM 7-16): [STA, top h, bottom h,
 * half width] (m), closed by a flat floor inside the pod (it overhangs the boom root at its tail). It starts about 0.45 m ahead of the mast (D-HADO, D-HILF),
 * its top 0.35 m above the roof, the mast standing 0.5 m clear of it to the hub (height to the head 3.00 m, P). 3V ESTIMATE.
 */
export const DECK_FAIRING: readonly (readonly [number, number, number, number])[] = [
  [2.690, 2.050, 1.86, 0.22], [2.750, 2.230, 1.86, 0.40], [2.850, 2.340, 1.86, 0.48], [3.000, 2.390, 1.86, 0.51],
  [3.800, 2.405, 1.86, 0.52], [4.300, 2.395, 1.84, 0.52], [4.700, 2.340, 1.70, 0.44], [5.050, 2.220, 1.66, 0.33],
  [5.300, 2.100, 1.74, 0.22], [5.500, 2.025, 1.80, 0.15]];
/** Boom-root fairing under the deck's tail, blending the pod's rear end into the boom (closed). [STA, top, bottom, hw]. */
export const BOOM_ROOT_FAIRING: readonly (readonly [number, number, number, number])[] = [
  [4.70, 2.10, 1.40, 0.46], [4.90, 2.08, 1.48, 0.38], [5.10, 2.06, 1.60, 0.29], [5.30, 2.04, 1.66, 0.225],
  [5.55, 2.015, 1.70, 0.19]];

/** Tail boom: a tapered tube from inside the deck fairing to the fin, centre heights and radii 3V ESTIMATE; it passes the
 *  stabiliser quarter chord (dimensions.ts, STA 7.55, 1.62 m) 6 cm below its centreline. */
export const BOOM = { front: [S(5.10), 0, H(1.86)] as FRD, rear: [S(8.95), 0, H(1.58)] as FRD, radii: [0.22, 0.10] as const };
/** Boom centre height (m above the soles) and radius at a station. */
export const boomHeight = (sta: number): number => 1.86 + (1.58 - 1.86) * (sta - 5.10) / (8.95 - 5.10);
export const boomRadius = (sta: number): number => 0.22 + (0.10 - 0.22) * (sta - 5.10) / (8.95 - 5.10);

/** Swept fin: dimensions.ts FIN_OUTLINE (3V) with its trailing edge clipped at the 8.56 m fuselage end (the outline
 *  reaches STA 9.35, 9 cm past it; the P length wins). [station, height] -> FRD, root leading edge first. */
export const FIN: FRD[] = D.FIN_OUTLINE.map(([s, h]) => [S(Math.min(s, TAIL_END_STA)), 0, H(h)]);
/** Stabiliser (span 2.0, chord 0.4, incidence 0: P AR-280) with endplates (P TCDS; size dimensions.ts ESTIMATE). */
const HS = D.HORIZONTAL_STABILIZER;
export const STAB = { leadingX: HS.quarterChord.x + HS.chord / 4, z: HS.quarterChord.z, span: HS.span, chord: HS.chord } as const;
export const STABILISER: FRD[] = [[STAB.leadingX, -HS.span / 2, STAB.z], [STAB.leadingX - HS.chord, -HS.span / 2, STAB.z],
  [STAB.leadingX - HS.chord, HS.span / 2, STAB.z], [STAB.leadingX, HS.span / 2, STAB.z]];
/** Endplates: dimensions.ts height and chord, half above and half below the stabiliser (photographs). ESTIMATE */
export const ENDPLATE = { chord: HS.endplates.chord, height: HS.endplates.height, above: 0.5 } as const;
/** Tail skid: a bent tube from the fin's lower edge, down and aft under the fin, about 0.4 m below it (photographs);
 *  placed on the fin outline so it follows any change of dimensions.ts FIN_OUTLINE. ESTIMATE */
const finEdge = (t: number): FRD => [FIN[0][0] + (FIN[3][0] - FIN[0][0]) * t, 0, FIN[0][2] + (FIN[3][2] - FIN[0][2]) * t];
const skidStart = finEdge(0.55), skidEndX = Math.max(skidStart[0] - 0.45, S(TAIL_END_STA) + 0.06);
export const TAIL_SKID: FRD[] = [skidStart, [skidStart[0] - 0.08, 0, skidStart[2] + 0.17], [skidStart[0] - 0.22, 0, skidStart[2] + 0.33],
  [skidEndX + 0.08, 0, skidStart[2] + 0.40], [skidEndX, 0, skidStart[2] + 0.38]];

/** Seats. The pilot sits RIGHT (P TCDS p11), co-pilot left; the rear bench for three against the cabin's aft bulkhead.
 *  Cushion front, depth and height are placed round dimensions.ts PILOT_EYE (3V): the eye 0.78 m above the cushion
 *  and about 0.25 m ahead of the seat back at eye height. ESTIMATE */
export const SEAT = { frontX: S(1.34), depth: 0.44, z: H(0.92), width: 0.44, reclineDeg: 8 } as const;
export const BENCH = { frontX: S(2.30), depth: 0.44, z: H(0.95), width: 1.30, reclineDeg: 10 } as const;
/** Rear cabin bulkhead behind the bench (the cargo compartment lies aft of it, under the engines, reached through the
 *  clamshell doors). ESTIMATE */
export const CABIN_REAR_STA = 2.80;
export const FLOOR_Z = H(D.FLOOR_HEIGHT);
export const PILOT_SEAT_Y = D.PILOT_SEAT_Y;
/** Pilot collective: on the pilot's LEFT, between the right seat and the centre console; pivot aft beside the cushion. */
export const COLLECTIVE = { pivot: [S(2.06), PILOT_SEAT_Y - 0.245, H(0.84)] as FRD, length: 0.52 } as const;
/** Pilot cyclic: the curved tube rising from the floor ahead of the seat (photographs: the "goose-neck" stick). */
export const CYCLIC = { pivot: [S(1.30), PILOT_SEAT_Y, FLOOR_Z] as FRD, height: 0.62, pitchDeg: 10, rollDeg: 8 } as const;
/** Pedals, the pilot's pair. */
export const PEDALS = { x: S(0.98), ys: [PILOT_SEAT_Y - 0.10, PILOT_SEAT_Y + 0.10], z: H(0.80) } as const;

/** Skids: track and length from dimensions.ts; the two cross tubes (they bend to absorb the landing, P TM 00-7). 3V
 *  stations of the cross tubes; tube radii ESTIMATE (about 3 in). */
export const SKID_TUBE_RADIUS = 0.038;
export const CROSS_TUBE_STA = [2.12, 3.98] as const;
export const CROSS_TUBE_RADIUS = 0.040;

/** Main-rotor blade paint (generic: light grey upper, darker lower, yellow-orange tip band, metal tip cap). */
const MAIN_PAINT = { rootUpper: 0xa7abad, rootLower: 0x5f6467, capLength: 0.03,
  bands: [{ tipDistance: 0.03, upper: 0xb4b8ba, lower: 0xb4b8ba }, { tipDistance: 0.28, upper: 0xe0a12c, lower: 0xe0a12c }] };
/** Tail-rotor paint: grey with red, white, red tip bands (a common finish). */
const TAIL_PAINT = { rootUpper: 0x9da2a4, rootLower: 0x9da2a4, capLength: 0.006,
  bands: [{ tipDistance: 0.06, upper: 0xb62f31, lower: 0xb62f31 }, { tipDistance: 0.12, upper: 0xecece4, lower: 0xecece4 },
    { tipDistance: 0.20, upper: 0xb62f31, lower: 0xb62f31 }] };

const FACE = BO105_PANEL_FACE;

const rotorcraftVisual: RotorcraftVisualDef = {
  nominalVoltage: 28,
  interior: { frameColor: 0x26292c, seatColor: 0x56606d, seatBackColor: 0x606a78, perforatedPedals: false, collectiveFittings: false },
  engineDetail: { exposed: false, cylinderXs: [] },
  main: { hub: point(D.MAIN_HUB), radius: D.MAIN_ROTOR_RADIUS, root: D.MAIN_ROTOR_ROOT_CUTOUT,
    chord: [D.MAIN_ROTOR_CHORD, D.MAIN_ROTOR_CHORD], twist: D.MAIN_ROTOR_TWIST_DEG * Math.PI / 180,
    coning: BO105_BLADE_CONING, paint: MAIN_PAINT },
  tail: { hub: point(D.TAIL_HUB), radius: D.TAIL_ROTOR_RADIUS, root: 0.14, chord: D.TAIL_ROTOR_CHORD,
    twist: D.TAIL_ROTOR_TWIST_DEG * Math.PI / 180, precone: 0, paint: TAIL_PAINT },
  boom: { front: BOOM.front, rear: BOOM.rear, radii: BOOM.radii },
  mast: { bottom: [0, 0, H(2.40)], top: [0, 0, H(2.80)], bottomWidth: 0.30, topWidth: 0.16 },
  fins: [
    { name: 'fin', axis: 'y', thickness: 0.07, outline: FIN },
    { name: 'horizontalStabiliser', axis: 'z', thickness: 0.04, outline: STABILISER },
  ],
  guard: TAIL_SKID, guardRadius: 0.016,
  skids: { halfTrack: D.SKID_HALF_TRACK, z: D.SKID_Z, front: D.SKID_FRONT_X, rear: D.SKID_REAR_X,
    crossTubes: CROSS_TUBE_STA.map(S), tubeRadius: SKID_TUBE_RADIUS, bellyHalfWidth: 0.42, bellyZ: H(D.BELLY_HEIGHT), crossCentreZ: H(0.37) },
  // The narrow instrument pedestal (panelLayout.ts, frozen): cockpitDetails builds its box, hood and centre console.
  panel: { centre: point(FACE.centre), width: FACE.width, height: FACE.height, tiltBackDeg: FACE.tiltBackDeg,
    canvas: BO105_PANEL_CANVAS, outline: BO105_PANEL_OUTLINE, pedestal: null, enclosureDepth: 0.20, poweredVolts: [18, 24] },
  // One pilot cyclic (RIGHT); cockpitDetails replaces the generic stick with the Bo 105's curved stick.
  cyclic: { kind: 'individual', gripYs: [PILOT_SEAT_Y, PILOT_SEAT_Y], barTiltDeg: 0,
    stem: [[0, 0, 0], [0.16, 0, -0.06], [0.16, 0, -0.30], [0.02, 0, -0.50], [-0.04, 0, -0.60]] },
  // Pilot collective on the pilot's left (between the seats), pivot aft; dual controls not fitted (AGENT choice).
  collective: { pivots: [COLLECTIVE.pivot], length: COLLECTIVE.length },
  pedalZ: PEDALS.z,
  registrationXs: [S(5.6), S(7.2)],
};

export const BO105_VISUAL: AirframeVisualDef = {
  id: 'bo105', rotorcraft: BO105_ROTORCRAFT, rotorcraftVisual,
  fuselage: { nose: 'closed', frontX: D.NOSE_X, endX: S(5.0), inlets: [], antennas: [],
    // The two engine exhausts on top of the deck, pointing up and aft (P5 FM 7-16; photographs).
    exhaust: { pos: [S(4.42), 0.30, H(2.36)], dir: [-0.16, 0.02, -0.07], radius: 0.085, mirror: true, oval: [0.07, 0.095] },
    grid: { rows: 180, cols: 112 },
    keys: LOFT.map(([s, top, bot, mid, hw, nTop, nBot]) => [S(s), H(top), H(bot), H(mid), hw, nTop, nBot, 0] as const) },
  glazing: { cabinFrontX: D.NOSE_X - 0.003, cabinRearX: S(CABIN_REAR_STA), firewallX: S(CABIN_REAR_STA),
    tRange: [0.035, 0.965], liningRoofLimit: -1e9,
    windows: [
      // r 0.02 on the windscreen and crew-door window: at r 0.05 the rounded intersection of their nearly collinear
      // aft / front edges pulled each edge about 1.5 cm in and widened the post to 6 cm at eye height.
      { pts: WINDSCREEN, r: 0.02, sides: 'both' },
      { pts: ROOF_GLASS, r: 0.05, sides: 'both' },
      { pts: CHIN_GLASS, r: 0.04, sides: 'both' },
      { pts: CREW_WINDOW, r: 0.02, sides: 'both' },
      { pts: CREW_LOWER_WINDOW, r: 0.04, sides: 'both' },
      { pts: SLIDING_WINDOW, r: 0.05, sides: 'both' },
      { pts: SLIDING_REAR_WINDOW, r: 0.04, sides: 'both' },
    ],
    doors: [
      { pts: CREW_DOOR, r: 0.04, sides: 'both', handle: { x: S(1.70), z: H(1.08) } },
      { pts: SLIDING_DOOR, r: 0.03, sides: 'both', handle: { x: S(1.92), z: H(1.08) } },
      { pts: CLAMSHELL, r: 0.04, sides: 'both' },
      { pts: NOSE_COMPARTMENT, r: 0.02, sides: 'both' },
    ] },
  // Fixed-wing carriers: unused compatibility data for the common bake interface (the R44 / MD 500E pattern).
  wing: { mount: 'low', section: { m: 0, p: 0.4, t: 0.12 }, breaks: [{ y: 0, chord: 0.1, qcX: 0 }, { y: 0.1, chord: 0.1, qcX: 0 }],
    rootY: 0, qcZ: 0, dihedral: 0, rootIncidence: 0, tipIncidence: 0, bays: [], flap: { maxDeflection: 0, travelAft: 0, travelDown: 0 },
    tip: { round: 0, chordRound: 0 }, fuelCaps: [] },
  tail: { section: { m: 0, p: 0.4, t: 0.10 }, h: { span: HS.span, rootChord: HS.chord, tipChord: HS.chord,
    quarterChord: { x: HS.quarterChord.x, z: HS.quarterChord.z }, incidence: 0, kind: 'elevator', chordFraction: 0, innerCutY: 0 },
    v: { base: { x: FIN[0][0], z: FIN[0][2] }, tip: { x: FIN[1][0], z: FIN[1][2] },
      rootChord: FIN[0][0] - FIN[3][0], tipChord: FIN[1][0] - FIN[2][0], rudderChordFraction: 0 }, tTail: false },
  gear: [0, -1, 1].map(s => ({ contact: [s === 0 ? D.SKID_FRONT_X : D.SKID_REAR_X, s * D.SKID_HALF_TRACK, D.SKID_Z],
    radius: 0, width: 0, rimRadius: 0, leg: { kind: 'springTube', root: [0, 0, 0], axleOffset: 0, r0: 0, r1: 0 } })) as unknown as AirframeVisualDef['gear'],
  props: [], nacelles: [],
  lamps: [
    // Position lights on the outboard faces of the stabiliser endplates, the white tail light on the fin trailing edge,
    // the red anti-collision beacon on the deck aft of the exhausts, the landing light under the nose. ESTIMATES.
    { id: 'navL', pos: [STAB.leadingX - HS.chord / 2, -HS.span / 2 - 0.035, STAB.z], radius: 0.02, glowOffset: [0, -0.02, 0] },
    { id: 'navR', pos: [STAB.leadingX - HS.chord / 2, HS.span / 2 + 0.035, STAB.z], radius: 0.02, glowOffset: [0, 0.02, 0] },
    { id: 'navTail', pos: [FIN[2][0] + (FIN[3][0] - FIN[2][0]) * 0.3 + 0.01, 0, FIN[2][2] + (FIN[3][2] - FIN[2][2]) * 0.3], radius: 0.016, glowOffset: [-0.02, 0, 0] },
    { id: 'beacon', pos: [S(4.78), 0, H(2.34)], radius: 0.035, glowOffset: [0, 0, -0.03] },
    { id: 'landing', pos: [S(1.30), 0, H(0.43)], radius: 0.05, glowOffset: [0, 0, 0.03], aim: { downDeg: 12, outDeg: 0, halfAngleDeg: 13 } },
  ],
  cockpit: {
    // Default view 30 degrees down (was 14): the tall centre console in full, down to its switch row, with the horizon
    // still ~20 % down the frame.
    pilotEye: point(D.PILOT_EYE), defaultPitchDeg: -30, defaultFovDeg: 80,
    // Instrument focus (Q): the console's flight instruments, the horizon still near the top of the frame; dials 96-133 px
    // across on a 991 px high view, the far ones smallest (scripts/cockpit-focus.mjs).
    focus: { yawDeg: 34, pitchDeg: -23, fovDeg: 50 }, enclosure: 'canopy',
    panel: { x: FACE.centre.x, zTop: FACE.centre.z - FACE.height / 2, width: FACE.width },
    floor: { z: FLOOR_Z, x0: S(0.98), x1: S(CABIN_REAR_STA) }, glareshield: { profile: [], halfWidth: FACE.width / 2 },
    seats: [
      ...[PILOT_SEAT_Y, -PILOT_SEAT_Y].map(y => ({ x: SEAT.frontX, y, z: SEAT.z, kind: 'front' as const, width: SEAT.width,
        depth: SEAT.depth, reclineDeg: SEAT.reclineDeg, back: { height: 0.60, headrest: false } })),
      { x: BENCH.frontX, y: 0, z: BENCH.z, kind: 'bench' as const, width: BENCH.width, depth: BENCH.depth, reclineDeg: BENCH.reclineDeg,
        back: { height: 0.58, headrest: false } },
    ],
    occupants: [{ seat: 0 }], consoles: [], trimPanels: [],
    column: { kind: 'stick', pivot: CYCLIC.pivot, height: CYCLIC.height, pitchDeg: CYCLIC.pitchDeg, rollDeg: CYCLIC.rollDeg, ys: [PILOT_SEAT_Y] },
    pedals: { x: PEDALS.x, ys: PEDALS.ys },
    engineControls: [], flapControl: { kind: 'panelSwitch', pos: [0, 0, 0], travel: 0 },
    // Standby compass on the windscreen centre post (research-bo105 section 13). ESTIMATE position.
    compass: { pos: [S(1.30), 0, H(1.93)] },
    lamps: { flood: { pos: [S(1.85), 0, H(1.95)], aim: point(FACE.centre) } },
    box: { floor: FLOOR_Z, roof: H(2.03), side: 0.76, rear: S(CABIN_REAR_STA), panelX: FACE.centre.x,
      glareshieldZ: FACE.centre.z - FACE.height / 2, sillZ: H(0.66), windscreenX: D.NOSE_X, roofGlazed: true },
    glazingPanels: [{ n: [1, 0, 0], area: 1.7 }, { n: [0, 1, 0], area: 1.0 }, { n: [0, -1, 0], area: 1.0 },
      { n: [0, 0, -1], area: 0.55 }, { n: [0.5, 0, 0.87], area: 0.35 }],
    interiorArea: 7.5, controlPoints: {},
  },
  livery: { registration: 'D-HBOX', palette: { base: [240, 241, 238], band: [24, 42, 92], accent: [24, 42, 92] },
    accentBelow: true, construction: 'metal', skinJoints: [S(1.16), S(1.80), S(2.82), S(CLAMSHELL_STA)],
    doorSeam: { halfWidth: 0.004, darken: 0.55 },
    // A generic dark blue cheat line from the nose bow, under the door windows, to the clamshell doors (not an
    // operator's scheme).
    stripe: { xs: [S(5.00), S(4.70), S(3.60), S(2.40), S(1.50), S(0.80), S(0.71)],
      centre: [H(1.15), H(1.09), H(1.075), H(1.075), H(1.075), H(1.05), H(1.035)],
      half: [0.01, 0.030, 0.033, 0.033, 0.030, 0.022, 0.010], noseShearX: D.NOSE_X },
    lettering: { x0: S(4.15), x1: S(3.30), z0: H(1.66), z1: H(1.40) },
    fin: { bandZ0: H(2.10), bandX0: S(9.0), slope: 0, cap: 0.08 }, texture: { w: 4096, h: 2048 } },
  shadow: { halfX: 5.8, halfY: 5.0, fuselage: [S(2.85), 2.2, D.HULL_WIDTH / 2], wingX: 0, wingY: 3.4,
    wingHeight: D.HUB_HEIGHT, restHeight: D.SKID_Z,
    skids: { halfTrack: D.SKID_HALF_TRACK, front: D.SKID_FRONT_X, rear: D.SKID_REAR_X } },
};

export default BO105_VISUAL;
