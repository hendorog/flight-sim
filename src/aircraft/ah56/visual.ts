// Lockheed AH-56A Cheyenne (AMCS ship 7, 66-8832; the ICS gyro X drawn with config=ics): the airframe visual. Plain
// data: the livery worker loads this file, so it imports no three.js and no renderer module.
//
// Every station comes from the geometry contract dimensions.ts (x = (298 - FS) 0.0254, z = (95 - WL) 0.0254, y = BL
// 0.0254; ground WL 18) and the frozen rear-cockpit contract panelLayout.ts. The loft, canopy outlines, sponsons, wing
// placement, fin and stabiliser planforms and paint are visual ESTIMATES traced from the Commons photographs listed in
// docs/ah56-exterior.md (Rucker 66-8832 side/front/rear, Fort Campbell 66-8831 left profile, Ames 66-8835 tunnel views,
// the XM51/XM52 armament drawings), scaled with the published stations. Tags: P primary (ASTA-72, AMCS-73, APE-I),
// S secondary (Jane's via Wikipedia), D derived (arithmetic shown), 3V read from photographs, ESTIMATE.
//
// The S0 physics stub flies the MD 500E rotor with four blades (base.ts): this visual builds to dimensions.ts, not to
// the stub. `rotorcraft` is the physics definition itself (consistency rule) and nothing below reads its geometry.
import type { AirframeVisualDef, FRD, RotorcraftVisualDef, WheelVisualDef } from '../../render/aircraft/airframe/types';
import { AH56_ROTORCRAFT } from './rotorcraft';
import { AH56_BLADE_CONING } from './coning';
import * as D from './dimensions';
import { AH56_PANEL_CANVAS, AH56_PANEL_FACE, AH56_PANEL_OUTLINE, AH56_SIDE_CONSOLES } from './panelLayout';

const IN = 0.0254;
const DEG = Math.PI / 180;
/** Fuselage station (in) to body x, m. */
export const fs = D.x;
/** Water line (in) to body z, m. */
export const wl = D.z;
/** Butt line (in, right +) to body y, m. */
export const bl = D.y;
/** Body x (m) back to the fuselage station, in. */
export const fsOf = (x: number): number => D.FS_REF - x / IN;
const point = (p: { x: number; y: number; z: number }): FRD => [p.x, p.y, p.z];

// ------------------------------------------------------------------------------------------------ fuselage loft
/**
 * Loft table in station units: [FS, top WL, bottom WL, widest WL, half width in, nTop, nBot]. 3V ESTIMATE from the
 * Rucker side and front photographs scaled on the hub (FS 300, WL 165.3 P) and the ground (WL 18): blunt rounded nose
 * from FS 30 (dimensions.ts NOSE_FS), the low front canopy (top about WL 125 over the gunner, eye WL 112), the step to
 * the raised rear canopy (top about WL 143 over the pilot, eye WL 130), the upper deck under the transmission (WL 150)
 * and the long tail cone whose centreline meets the prop and tail-rotor hub line WL 114.5 (P) at the gearbox, FS 668.
 * The belly passes WL 55 at FS 190 so the XM52 turret hangs to WL 39, 21 in above the ground (P ASTA-72 para 91).
 */
export const LOFT: readonly (readonly [number, number, number, number, number, number, number])[] = [
  [30.0, 67.0, 57.0, 62.0, 1.5, 2.0, 2.0],
  [31.0, 72.5, 51.5, 62.0, 7.0, 2.0, 2.0],
  [33.0, 76.5, 48.5, 62.0, 10.5, 2.0, 2.0],
  [37.0, 80.5, 46.0, 62.5, 13.5, 2.1, 2.1],
  [44.0, 83.5, 44.5, 63.0, 15.2, 2.2, 2.2],
  [54.0, 86.5, 44.0, 64.0, 17.0, 2.3, 2.4],
  [64.0, 89.0, 44.5, 66.0, 17.9, 2.4, 2.6],
  [72.0, 95.0, 45.0, 68.0, 18.6, 2.4, 2.7],
  [84.0, 106.0, 45.5, 70.0, 19.1, 2.3, 2.8],
  [98.0, 116.0, 46.5, 72.0, 19.5, 2.2, 2.8],
  [114.0, 122.5, 47.5, 73.0, 19.8, 2.1, 2.8],
  [128.0, 125.0, 48.5, 74.0, 20.1, 2.1, 2.8],
  [133.0, 128.5, 48.8, 74.5, 20.2, 2.2, 2.8],
  [138.0, 137.0, 49.0, 75.0, 20.4, 2.3, 2.8],
  [143.0, 141.0, 49.5, 75.5, 20.4, 2.3, 2.8],
  [152.0, 142.0, 50.2, 76.5, 20.2, 2.3, 2.8],
  [170.0, 143.0, 52.0, 78.0, 20.2, 2.3, 2.8],
  [188.0, 143.5, 54.0, 79.0, 20.2, 2.3, 2.8],
  [205.0, 141.5, 55.5, 80.0, 20.2, 2.4, 2.8],
  [218.0, 138.0, 56.0, 81.0, 20.2, 2.5, 2.8],
  [240.0, 139.5, 56.5, 83.0, 20.3, 2.7, 2.8],
  [262.0, 146.0, 57.0, 84.5, 20.6, 2.8, 2.8],
  [290.0, 150.0, 57.5, 86.0, 20.8, 2.8, 2.8],
  [330.0, 150.0, 58.5, 88.0, 20.6, 2.8, 2.8],
  [370.0, 147.5, 61.0, 90.0, 19.9, 2.7, 2.7],
  [410.0, 143.0, 67.0, 95.0, 18.8, 2.6, 2.6],
  [445.0, 138.0, 76.0, 102.0, 17.5, 2.4, 2.4],
  [480.0, 133.5, 89.0, 110.0, 15.5, 2.2, 2.2],
  [520.0, 129.5, 99.0, 114.0, 13.5, 2.1, 2.1],
  [570.0, 125.5, 103.5, 114.5, 11.5, 2.0, 2.0],
  [620.0, 123.0, 106.0, 114.5, 9.5, 2.0, 2.0],
  [650.0, 121.5, 107.5, 114.5, 8.0, 2.0, 2.0],
  [668.0, 120.5, 108.5, 114.5, 7.0, 2.0, 2.0],
];
/** Loft end (the prop gearbox face, FS 668); the spinner closes the body to FS 686 (656 in from the nose, S). */
export const LOFT_END_FS = LOFT[LOFT.length - 1][0];
/** Spinner: from the gearbox face over the prop hub (FS 675.7 P) to its tip, so the fuselage measures 54 ft 8 in (S). */
export const SPINNER = { baseFs: LOFT_END_FS, tipFs: D.NOSE_FS + 656, radiusIn: 6.0 } as const;

// ------------------------------------------------------------------------------------------------ canopies
/** Side-projection (FS, WL) to body (x, z). */
const sw = (pts: readonly (readonly [number, number])[]): [number, number][] => pts.map(([s, w]) => [fs(s), wl(w)]);
/**
 * Front (gunner) canopy: windshield from the nose deck (FS 66, WL 89) back to its aft bow at FS 138, sill about WL 95;
 * the outline runs over the top (WL 200) so both halves and the roof are glass. Rear (pilot) canopy: its steep windshield
 * rises from the front canopy's aft bow (FS 129-131) so that the frozen panel face (FS 138.6-141.4, up to WL 125.8, 24.4 in
 * wide) stands inside the section behind it; back to FS 206, sill about WL 108. 3V (Rucker front/side, Fort Campbell). Butterfly halves hinged on
 * the centreline (P SoF "butterfly canopy (forward and/or aft)").
 */
export const FRONT_CANOPY = sw([[65.5, 89.5], [72, 89.5], [129, 97.5], [129, 200], [65.5, 200]]);
export const REAR_CANOPY = sw([[131, 125], [137, 108], [206, 109], [206, 200], [131, 200]]);
/** Canopy frame stations (FS), drawn as bows over the glass. 3V. */
export const CANOPY_BOWS = { front: [66.5, 80, 104, 129.5], rear: [131.5, 160, 184, 206] } as const;
/** Sill lines (FS, WL) of both canopies, as frames. 3V. */
export const FRONT_SILL = [[66, 89.5], [72, 89.5], [129.5, 97.5]] as const;
export const REAR_SILL = [[131.5, 124], [137, 108], [206, 109]] as const;

// ------------------------------------------------------------------------------------------------ sponsons, wing
/**
 * Sponsons (fuel, retracted mains, APU): bodies of revolution along x, centre BL 35, WL 70, radius 12.5 in, from FS 185
 * to FS 405. 3V ESTIMATE (Rucker front: the pod a third of the fuselage height; side: from under the rear canopy to
 * past the wing trailing edge); the main wheels (track 62 in D) retract into them (P). Profile: [FS, radius in].
 */
export const SPONSON = { bl: 35, wl: 70, profile: [[185, 0], [186, 3.7], [189, 6.9], [195, 9.6], [204, 11.5], [216, 12.3], [232, 12.5],
  [330, 12.5], [358, 11.9], [380, 9.4], [396, 5.6], [404, 1.9], [405, 0]] as readonly (readonly [number, number])[] } as const;

/**
 * Wing (P ASTA-72 p 53): 195 ft^2, span 26.7 ft (tip BL 160.2), root chord 9.74 ft at BL 0, tip 4.87 ft (D from S, b and
 * taper 0.50), MAC 7.6 ft with its quarter chord at FS 308.2, dihedral 5 deg, incidence L 11 deg 52 min / R 12 deg 58 min
 * (datum unstated: drawn to the waterline), twist about -3 deg, no control surfaces. The trailing edge is drawn UNSWEPT
 * (3V), so its station follows from the quarter-MAC (D): TE FS = 308.2 + 0.75 MAC = 376.4. Its quarter chord sits at
 * WL 67 at the sponson centre BL 35 (3V: the root on the lower half of the sponson); the panel is drawn from BL 21 (just
 * inside the body side, so the root below the sponson meets the fuselage) to the tip.
 */
const TAPER = 0.5;
const ROOT_CHORD_IN = 9.74 * 12;
const MAC_IN = (2 / 3) * ROOT_CHORD_IN * (1 + TAPER + TAPER ** 2) / (1 + TAPER);
export const WING_PLAN = {
  rootChordIn: ROOT_CHORD_IN, tipChordIn: ROOT_CHORD_IN * TAPER, tipBl: D.WING.tipBl, macIn: MAC_IN,
  teFs: 308.2 + 0.75 * MAC_IN, rootBl: 20, refBl: 35, rootQuarterWl: 67, dihedralDeg: D.WING.dihedralDeg,
  incidenceDeg: D.WING.incidenceDeg, twistDeg: D.WING.twistDeg, rootThickness: 0.12, tipThickness: 0.08,
} as const;
/** Chord (in) at butt line `b` (in, positive), linear taper from BL 0. */
export const wingChordIn = (b: number): number => WING_PLAN.rootChordIn + (WING_PLAN.tipChordIn - WING_PLAN.rootChordIn) * b / WING_PLAN.tipBl;
/** Quarter-chord WL at butt line `b`: the dihedral line through the exposed root. */
export const wingQuarterWl = (b: number): number => WING_PLAN.rootQuarterWl + (b - WING_PLAN.refBl) * Math.tan(WING_PLAN.dihedralDeg * DEG);
/** Leading-edge FS at butt line `b` (the trailing edge is unswept). */
export const wingLeFs = (b: number): number => WING_PLAN.teFs - wingChordIn(b);
/** Pylons (P ASTA-72 App J p 144): BL 70 inboard (one TOW launcher each: the default "TOW pair"), BL 117 outboard. */
export const PYLONS = D.PYLON_BL;

// ------------------------------------------------------------------------------------------------ tail
/**
 * Ventral fin (P ASTA-72 p 56): root WL 114.5, tip WL 37.6 (span 6.41 ft), root chord 4.84 ft, tip 2.84 ft (D from area
 * 24.6 ft^2 and taper 0.587), quarter-MAC FS 620.3 at WL 79.4. Its sweep is not published: the leading edge is drawn
 * swept 32 deg (3V, the Rucker side and Ames rear photographs) through the published quarter-MAC, which puts the tip
 * between FS 635 and FS 669, the tail wheel (dimensions.ts, about FS 640) in the forward third of the tip chord, and the
 * trailing edge clear ahead of the prop disc above its lowest tip (WL 54.5). Outline [FS, WL]: root LE, tip LE, tip TE,
 * root TE.
 */
const FIN_TAPER = 0.587;
const FIN_ROOT_IN = 4.84 * 12, FIN_TIP_IN = 2.84 * 12, FIN_SPAN_IN = 114.5 - 37.6;
const FIN_MAC_IN = (2 / 3) * FIN_ROOT_IN * (1 + FIN_TAPER + FIN_TAPER ** 2) / (1 + FIN_TAPER);
const FIN_MAC_FROM_ROOT = FIN_SPAN_IN / 3 * (1 + 2 * FIN_TAPER) / (1 + FIN_TAPER);
/** Tail-wheel station, in (dimensions.ts TAIL_WHEEL, about FS 640). */
export const TAIL_WHEEL_FS = fsOf(D.TAIL_WHEEL.x);
const FIN_TAN_LE = Math.tan(32 * DEG);
const FIN_ROOT_LE = 620.3 - FIN_MAC_IN / 4 - FIN_MAC_FROM_ROOT * FIN_TAN_LE;
export const VENTRAL_FIN = {
  outline: [[FIN_ROOT_LE, 114.5], [FIN_ROOT_LE + FIN_SPAN_IN * FIN_TAN_LE, 37.6],
    [FIN_ROOT_LE + FIN_SPAN_IN * FIN_TAN_LE + FIN_TIP_IN, 37.6], [FIN_ROOT_LE + FIN_ROOT_IN, 114.5]] as readonly (readonly [number, number])[],
  thickness: 0.18, leSweepDeg: Math.atan(FIN_TAN_LE) / DEG, macIn: FIN_MAC_IN,
} as const;

/**
 * Horizontal stabiliser (P ASTA-72 pp 54-55): total 31.83 ft^2, span 10.83 ft, incidence 2 deg, 0 dihedral. Right panel
 * NACA 0018 at the root to 0012 at the tip, BL 0 to 65.0, 15.58 ft^2, taper 0.568: root 44.0 in, tip 25.0 in (D). Left
 * "bobtailed" panel 16.25 ft^2, taper 0.583: root 45.5 in, tip 26.5 in (D), its trailing edge cut back in a notch round
 * the tail rotor (3V). Trailing edge unswept (3V) at FS 637.18 + 0.75 MAC_R (D, quarter-MAC P): FS 663.7. The surface
 * sits on the hub line WL 114.5.
 */
const STAB_MAC_R = (2 / 3) * 44.0 * (1 + 0.568 + 0.568 ** 2) / 1.568;
export const STABILISER = { teFs: 637.18 + 0.75 * STAB_MAC_R, wl: 114.5, incidenceDeg: D.HORIZONTAL_STABILIZER.incidenceDeg,
  right: { tipBl: 65.0, rootChordIn: 44.0, tipChordIn: 25.0 }, left: { tipBl: 65.0, rootChordIn: 45.5, tipChordIn: 26.5 },
  bob: { fromBl: 40, cutIn: 9 }, rootThickness: 0.18, tipThickness: 0.12 } as const;

// ------------------------------------------------------------------------------------------------ engine
/** T64 installation (3V): bell-mouth intakes each side of the transmission fairing just ahead of the mast, lip FS 292,
 *  BL +/-21, WL 147, lip diameter 19 in; the exhaust nozzle on the upper deck at FS 442, WL 144.5, 15 in, pointing aft
 *  and 15 deg up (Rucker rear: the red exhaust cover; Anefo in-flight). */
export const INTAKE = { lipFs: 292, endFs: 338, bl: 21, wl: 147, lipRadiusIn: 9.5, ductRadiusIn: 8.5 } as const;
export const EXHAUST = { fs: 442, wl: 144.5, radiusIn: 7.5, upDeg: 15 } as const;
/** Transmission fairing round the mast and the engine cowl behind it: [FS, top WL, bottom WL, half width in]. 3V. */
export const TRANSMISSION_FAIRING: readonly (readonly [number, number, number, number])[] = [
  [246, 141.0, 139, 4], [252, 146.5, 139.5, 10], [262, 152.0, 142, 13], [278, 155.5, 145, 14], [312, 156.0, 146, 14],
  [330, 155.0, 146, 13.5], [360, 152.5, 145, 12.5], [400, 149.0, 141, 11], [430, 146.0, 137, 9.5], [446, 144.0, 135, 8]];

// ------------------------------------------------------------------------------------------------ gear
/** Tyres (ESTIMATE from the Rucker photographs: mains about 22 in; tail wheel 5.00x4 P, about 13.5 in). */
export const MAIN_TYRE = { radius: 11 * IN, width: 6.5 * IN, rim: 5 * IN } as const;
export const TAIL_TYRE = { radius: 6.75 * IN, width: 5 * IN, rim: 2.5 * IN } as const;
/** Main-gear trunnion inside the sponson (3V): the leg swings FORWARD and up into the sponson (P: "retract into the
 *  sponsons"). */
export const MAIN_PIVOT = { fs: 281, wl: 69 } as const;
/** Tail-wheel fork pivot inside the bulged lower end of the ventral fin; the wheel swings aft and up into it (P). */
export const TAIL_PIVOT = { fs: TAIL_WHEEL_FS - 3, wl: 44 } as const;

const contact = (x: number, y: number): FRD => [x, y, D.GROUND_Z];
/** Main and tail tyre contacts on the ground plane (dimensions.ts; AG's gear contract). */
export const GEAR_CONTACTS = {
  tail: contact(D.TAIL_WHEEL.x, 0), left: contact(D.MAIN_GEAR.x, -D.MAIN_GEAR.halfTrack), right: contact(D.MAIN_GEAR.x, D.MAIN_GEAR.halfTrack),
} as const;
/** Compatibility wheel table (tail wheel in the "nose" slot, then left, right: AircraftState.wheels order). The ground
 *  shadow reads the contacts and the dev page the retract flag; the wheels are drawn by exteriorGear.ts. */
const tyre = (k: 'tail' | 'left' | 'right'): WheelVisualDef => {
  const t = k === 'tail' ? TAIL_TYRE : MAIN_TYRE, p = k === 'tail' ? TAIL_PIVOT : MAIN_PIVOT;
  const side = k === 'left' ? -1 : k === 'right' ? 1 : 0;
  const pivot: FRD = [fs(p.fs), side * D.MAIN_GEAR.halfTrack, wl(p.wl)];
  return { contact: GEAR_CONTACTS[k], radius: t.radius, width: t.width, rimRadius: t.rim,
    leg: { kind: 'springTube', root: pivot, axleOffset: 0, r0: 0, r1: 0 } as unknown as WheelVisualDef['leg'],
    retract: { pivot, axis: [0, 1, 0], angle: k === 'tail' ? -Math.PI / 2 : Math.PI / 2, doors: [] } };
};

// ------------------------------------------------------------------------------------------------ crew
/** Rear (pilot) seat: pan WL 98.5 at FS 170 (P AMCS-73 App G p 41 aft-seat floor pickup), eye 31.5 in above it at
 *  dimensions.ts PILOT_EYE. Front (gunner, swivelling SGS): pan WL 80.5 at FS 130.5 (P), eye GUNNER_EYE. */
export const SEATS = {
  pilot: { frontFs: 160, backFs: 178, panWl: 99, width: 0.48 },
  gunner: { frontFs: 113, backFs: 130, panWl: 81, width: 0.46 },
} as const;
/** Cockpit floors (heel lines), WL and the station range. ESTIMATE. */
export const FLOORS = { rear: { wl: 92, fs0: 140, fs1: 180 }, front: { wl: 72, fs0: 70, fs1: 132 } } as const;

/** Main-rotor blade paint: olive drab with a yellow tip square (Ames 66-8835, Fort Campbell). */
const MAIN_PAINT = { rootUpper: 0x40432f, rootLower: 0x34372a, capLength: 0.012,
  bands: [{ tipDistance: 0.012, upper: 0x8f9396, lower: 0x8f9396 }, { tipDistance: 0.32, upper: 0xd9b52a, lower: 0xd9b52a }] };
export const TAIL_PAINT = { rootUpper: 0x3a3d2c, rootLower: 0x3a3d2c, capLength: 0.006,
  bands: [{ tipDistance: 0.006, upper: 0x8f9396, lower: 0x8f9396 }, { tipDistance: 0.16, upper: 0xd9b52a, lower: 0xd9b52a }] };

const pilotEye = point(D.PILOT_EYE);
const panelTop = AH56_PANEL_FACE.centre.z - AH56_PANEL_FACE.height / 2 * Math.cos(AH56_PANEL_FACE.tiltBackDeg * DEG);

const rotorcraftVisual: RotorcraftVisualDef = {
  nominalVoltage: 28,
  interior: { frameColor: 0x2a2c27, seatColor: 0x3b3f33, seatBackColor: 0x45493b, perforatedPedals: false, collectiveFittings: false },
  engineDetail: { exposed: false, cylinderXs: [] },
  // Blades from dimensions.ts (P), hub at the flange point (P); root cut-out ESTIMATE.
  main: { hub: point(D.MAIN_HUB), radius: D.MAIN_ROTOR_RADIUS, root: D.MAIN_ROTOR_ROOT_CUTOUT,
    chord: [D.MAIN_ROTOR_CHORD, D.MAIN_ROTOR_CHORD], twist: D.MAIN_ROTOR_TWIST_DEG * DEG, coning: AH56_BLADE_CONING, paint: MAIN_PAINT },
  tail: { hub: point(D.TAIL_HUB), radius: D.TAIL_ROTOR_RADIUS, root: 0.20, chord: D.TAIL_ROTOR_CHORD, twist: 0, precone: 0, paint: TAIL_PAINT },
  // The generic boom, mast, fins, guard and skids are hidden by exterior.ts (the generic builder still needs the data).
  boom: { front: [fs(470), 0, wl(114.5)], rear: [fs(LOFT_END_FS), 0, wl(114.5)], radii: [0.2, 0.15] },
  mast: { bottom: [fs(300), 0, wl(150)], top: [fs(300), 0, wl(158)], bottomWidth: 0.4, topWidth: 0.3 },
  fins: [],
  guard: [[fs(636), 0, wl(40)], [fs(640), 0, wl(39)], [fs(644), 0, wl(40)]], guardRadius: 0.01,
  // Wheel-rest data in the skids slot (RotorcraftDefinition.skids carries it on a wheeled type; no skid is drawn).
  skids: { halfTrack: D.MAIN_GEAR.halfTrack, z: D.GROUND_Z, front: D.MAIN_GEAR.x, rear: D.TAIL_WHEEL.x, crossTubes: [] },
  panel: { centre: point(AH56_PANEL_FACE.centre), width: AH56_PANEL_FACE.width, height: AH56_PANEL_FACE.height,
    tiltBackDeg: AH56_PANEL_FACE.tiltBackDeg, canvas: AH56_PANEL_CANVAS, outline: AH56_PANEL_OUTLINE,
    pedestal: null, enclosureDepth: 0.16, poweredVolts: [18, 24] },
  // Pilot cyclic between the knees (rear seat); cockpitDetails.ts draws its grip.
  cyclic: { kind: 'individual', gripYs: [0, 0], barTiltDeg: 0,
    stem: [[0, 0, 0], [0.03, 0, -0.18], [0.0, 0, -0.42], [-0.05, 0, -0.56]] },
  // Pilot collective on the left: pivot aft beside the seat, rising forward (the prop twist grip and the engine
  // condition grip on its head, P ASTA-72 para 73a). ESTIMATE.
  collective: { pivots: [[fs(178), -0.30, wl(101)]], length: 0.56 },
  pedalZ: wl(96),
  registrationXs: [fs(470), fs(540)],
};

export const AH56_VISUAL: AirframeVisualDef = {
  id: 'ah56', rotorcraft: AH56_ROTORCRAFT, rotorcraftVisual,
  fuselage: { nose: 'closed', frontX: D.NOSE_X, endX: fs(LOFT_END_FS), inlets: [], antennas: [], grid: { rows: 220, cols: 104 },
    keys: LOFT.map(([s, top, bot, mid, hw, nTop, nBot]) => [fs(s), wl(top), wl(bot), wl(mid), hw * IN, nTop, nBot, 0] as const) },
  glazing: { cabinFrontX: fs(64), cabinRearX: fs(210), firewallX: fs(210),
    tRange: [0.035, 0.965], liningRoofLimit: -1e9,
    windows: [
      { pts: FRONT_CANOPY, r: 0.03, sides: 'both' },
      { pts: REAR_CANOPY, r: 0.03, sides: 'both' },
    ],
    doors: [] },
  // Fixed-wing carriers: unused compatibility data (the R44 / MD 500E pattern); the wing is drawn by exteriorDetails.ts.
  wing: { mount: 'low', section: { m: 0, p: 0.4, t: 0.12 }, breaks: [{ y: 0, chord: 0.1, qcX: 0 }, { y: 0.1, chord: 0.1, qcX: 0 }],
    rootY: 0, qcZ: 0, dihedral: 0, rootIncidence: 0, tipIncidence: 0, bays: [], flap: { maxDeflection: 0, travelAft: 0, travelDown: 0 },
    tip: { round: 0, chordRound: 0 }, fuelCaps: [] },
  tail: { section: { m: 0, p: 0.4, t: 0.09 }, h: { span: D.HORIZONTAL_STABILIZER.span, rootChord: 44 * IN, tipChord: 25 * IN,
    quarterChord: { x: D.HORIZONTAL_STABILIZER.quarterMacX, z: wl(114.5) }, incidence: 0, kind: 'elevator', chordFraction: 0, innerCutY: 0 },
    v: { base: { x: fs(VENTRAL_FIN.outline[0][0]), z: wl(114.5) }, tip: { x: fs(VENTRAL_FIN.outline[1][0]), z: wl(37.6) },
      rootChord: FIN_ROOT_IN * IN, tipChord: FIN_TIP_IN * IN, rudderChordFraction: 0 }, tTail: false },
  gear: [tyre('tail'), tyre('left'), tyre('right')],
  props: [], nacelles: [],
  lamps: [
    // Position lights at the wing tips, white tail light on the prop gearbox fairing, red anti-collision beacon on
    // the engine deck, landing light under the nose. ESTIMATES.
    { id: 'navL', pos: [fs(322), -bl(160.4), wl(81.5)], radius: 0.022, glowOffset: [0, -0.02, 0] },
    { id: 'navR', pos: [fs(322), bl(160.4), wl(81.5)], radius: 0.022, glowOffset: [0, 0.02, 0] },
    { id: 'navTail', pos: [fs(663), 0, wl(121)], radius: 0.018, glowOffset: [0, 0, -0.02] },
    { id: 'beacon', pos: [fs(372), 0, wl(152.5)], radius: 0.035, glowOffset: [0, 0, -0.03] },
    { id: 'landing', pos: [fs(60), 0, wl(44.3)], radius: 0.05, glowOffset: [0, 0, 0.03], aim: { downDeg: 12, outDeg: 0, halfAngleDeg: 13 } },
  ],
  cockpit: {
    pilotEye, defaultPitchDeg: -10, defaultFovDeg: 80, enclosure: 'canopy',
    panel: { x: AH56_PANEL_FACE.centre.x, zTop: panelTop, width: AH56_PANEL_FACE.width },
    floor: { z: wl(FLOORS.rear.wl), x0: fs(FLOORS.rear.fs0), x1: fs(FLOORS.rear.fs1) },
    glareshield: { profile: [], halfWidth: AH56_PANEL_FACE.width / 2 },
    // Seat 0: the pilot (rear); seat 1: the copilot/gunner (front).
    seats: [
      { x: fs(SEATS.pilot.frontFs), y: 0, z: wl(SEATS.pilot.panWl), kind: 'front', width: SEATS.pilot.width,
        depth: (SEATS.pilot.backFs - SEATS.pilot.frontFs) * IN, reclineDeg: 12, back: { height: 0.66, headrest: false } },
      { x: fs(SEATS.gunner.frontFs), y: 0, z: wl(SEATS.gunner.panWl), kind: 'front', width: SEATS.gunner.width,
        depth: (SEATS.gunner.backFs - SEATS.gunner.frontFs) * IN, reclineDeg: 8, back: { height: 0.64, headrest: false } },
    ],
    // The pilot's figure; the gunner's (whose feet rest on the lower front floor) is built by cockpitDetails.ts.
    occupants: [{ seat: 0 }], consoles: [], trimPanels: [],
    column: { kind: 'stick', pivot: [fs(156), 0, wl(FLOORS.rear.wl)], height: 0.56, pitchDeg: 10, rollDeg: 8, ys: [0] },
    pedals: { x: fs(142), ys: [-0.13, 0.13] },
    engineControls: [], flapControl: { kind: 'panelSwitch', pos: [0, 0, 0], travel: 0 },
    lamps: { flood: { pos: [fs(162), 0, wl(141)], aim: point(AH56_PANEL_FACE.centre), colour: 'red' } },
    box: { floor: wl(FLOORS.rear.wl), roof: wl(143), side: 21.5 * IN, rear: fs(SEATS.pilot.backFs), panelX: AH56_PANEL_FACE.centre.x,
      glareshieldZ: panelTop, sillZ: wl(108), windscreenX: fs(140), roofGlazed: true },
    glazingPanels: [{ n: [1, 0, 0], area: 0.5 }, { n: [0, 1, 0], area: 1.1 }, { n: [0, -1, 0], area: 1.1 }, { n: [0, 0, -1], area: 1.0 }],
    interiorArea: 4.5,
    controlPoints: { gearHandle: [AH56_SIDE_CONSOLES.left.centre.x, AH56_SIDE_CONSOLES.left.centre.y, AH56_SIDE_CONSOLES.left.centre.z] },
  },
  // Olive drab (FS 34087-like, weathered as the museum airframes). The fuselage-side registration box is parked aft of
  // the loft (no texel samples it) and the stripe has zero width: the US Army markings (ARMY, the national star, the
  // yellow prop-danger band, "U.S. ARMY" and the serial in the Army's tail-number form "68832" for 66-8832 on the
  // ventral fin) are decals built by exteriorDetails.ts.
  livery: { registration: '66-8832', palette: { base: [104, 104, 70], band: [24, 24, 22], accent: [104, 104, 70] },
    accentBelow: false, construction: 'metal', skinJoints: [fs(66), fs(140), fs(210), fs(255), fs(345), fs(445), fs(520), fs(600)],
    stripe: { xs: [fs(LOFT_END_FS), fs(30)], centre: [wl(90), wl(90)], half: [0, 0], noseShearX: fs(LOFT_END_FS) - 2 },
    lettering: { x0: fs(LOFT_END_FS) - 1.2, x1: fs(LOFT_END_FS) - 0.8, z0: wl(120), z1: wl(112) },
    fin: { bandZ0: wl(200), bandX0: fs(700), slope: 0, cap: 0 }, texture: { w: 4096, h: 2048 } },
  shadow: { halfX: 9.4, halfY: 4.6, fuselage: [fs(330), 7.6, 0.6], wingX: fs(330), wingY: 4.0,
    wingHeight: D.GROUND_Z - wl(76), restHeight: D.GROUND_Z },
};

export default AH56_VISUAL;
