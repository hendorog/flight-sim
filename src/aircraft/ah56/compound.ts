// Lockheed AH-56A Cheyenne: the compound (wing and pusher on the shared shaft) and the airframe aero it changes. Owner:
// AC (stages 3-4). Plan revision 2, section 7.3; docs/ah56-compound.md has the calibration of every ESTIMATE and the
// measured rows. Applied LAST by the assembly (rotorcraft.ts), so it may override airframe aero (drag area) that
// compounding changes.
//
// Tags: P primary (ASTA-72 = USAASTA 72-08, AMCS-73 = USAASTA 72-44; pages in docs/ah56-sources.md), D derived (arithmetic
// shown), S secondary, 3V photos / three-view, INF inference, ESTIMATE judged and calibrated (the row it is fitted to is
// named). AGENT choices are not owner decisions.
import { DEG, KT } from '../../core/math';
import type { PropellerDef } from '../../physics/propulsion/defs';
import type { ControlGyroDef } from '../../physics/rotorcraft/controlGyro';
import type { PusherDef } from '../../physics/rotorcraft/pusher';
import type { RotorSectionDef } from '../../physics/rotorcraft/section';
import type { WingPanelDef } from '../../physics/rotorcraft/wings';
import { AH56_BASE } from './base';
import * as D from './dimensions';
import { AH56_GYRO } from './gyro';
import { AH56_ROTOR_HIGH_SPEED } from './highSpeed';
import { AH56_PROP_BETA_DEG, AH56_PROP_INERTIA, AH56_PROP_RATIO, ah56PropLever } from './facts';
import type { AH56Patch } from './patch';

const IN = 0.0254;
const FT2 = 0.09290304;

// ------------------------------------------------------------------------------------------------------------ wing
/** Wing taper 0.50 (P ASTA-72 p 53); the MAC's spanwise station for a straight taper, (b/2)(1 + 2 lambda) / (3 (1 +
 *  lambda)) = 0.444 of the semi-span: BL 71.2 (D). */
const TAPER = 0.5;
export const WING_MAC_BL = D.WING.tipBl * (1 + 2 * TAPER) / (3 * (1 + TAPER));
/** Quarter-chord water line at the MAC station: the dihedral line through WL 67 at BL 35 (3V, the exterior's reading of
 *  the Fort Campbell and Rucker photos, docs/ah56-exterior.md), WL 70.2 (D). */
export const WING_MAC_WL = 67 + (WING_MAC_BL - 35) * Math.tan(D.WING.dihedralDeg * DEG);
/** Aspect ratio 3.66 (P); the finite-wing lift slope by Helmbold, 2 pi A / (2 + sqrt(A^2 + 4)) = 3.73 /rad (D; the
 *  XH-51A's measured wing-body slope was 3.47, P Lentine-68). */
const AR = D.WING.span ** 2 / D.WING.areaM2;
export const WING_LIFT_SLOPE = 2 * Math.PI * AR / (2 + Math.sqrt(AR * AR + 4));
/** Area-mean washout of a linear twist on a 0.5 taper: (1/3) / (3/4) = 0.444 of the tip twist (D). Twist -3 deg 06 min
 *  left, -3 deg 02 min right (P ASTA-72 p 53). */
const MEAN_TWIST = (1 / 3) / (3 / 4);
const TWIST_DEG = { left: -(3 + 6 / 60), right: -(3 + 2 / 60) };
/** Mean-chord incidence to the body x axis (the water line; the datum is unstated in the sources, plan 7.3): the root
 *  settings L 11 deg 52 min, R 12 deg 58 min (P) plus the mean washout: L 10.49, R 11.62 deg (D). */
export const WING_INCIDENCE_DEG = {
  left: D.WING.incidenceDeg.left + MEAN_TWIST * TWIST_DEG.left,
  right: D.WING.incidenceDeg.right + MEAN_TWIST * TWIST_DEG.right,
};
/** Zero-lift angle of the section with the trailing-edge extension that "defies aerodynamic description" (P ASTA-72 p 53),
 *  rad. ESTIMATE, fitted to the high-speed attitude (C8) and the lift share (C6). */
export const WING_ZERO_LIFT_DEG = -2;

/**
 * Rotor wash on the wing against wake skew (ESTIMATE). Hover: the actuator disc's wake 2.40 m below the disc (hub WL 165.3,
 * wing WL 70.2) is 1 + z / sqrt(z^2 + R^2) = 1.29 times the disc's induced velocity (D); the wing is wholly inside the
 * disc (span 8.1 m against 15.6 m, P). High speed: the flat wake trails above the wing and the panel sits in the disc's
 * own induced field, about the mean induced velocity: at 150 KTAS with half the lift on the rotor, 1.1 m/s, which is 0.8
 * deg of downwash (plan 7.3, D). Between them the wake skews aft over the panel.
 */
export const WING_WASH: WingPanelDef['washBySkew'] = { x: [0, 60 * DEG, 90 * DEG], y: [1.29, 1.15, 1.0] };

/**
 * Stores: four XM159 pods on the BL 70 and BL 117 pylons (the TOW configuration) cost an equivalent flat plate of 2 ft^2 at
 * 110 KTAS rising to 6 ft^2 at 200 KTAS (P ASTA-72 Fig B), half per panel, at the pylons' mean station (BL 93.5, P) under
 * the wing (FS 310, WL 52, 3V ESTIMATE).
 */
export const STORES_FT2 = { x: [110, 200], y: [2, 6] } as const;
const storesPanel = (side: 1 | -1): NonNullable<WingPanelDef['stores']> => ({
  centre: { x: D.x(310), y: side * D.y(93.5), z: D.z(52) },
  dragAreaBySpeed: { x: STORES_FT2.x.map((kt) => kt * KT), y: STORES_FT2.y.map((ft2) => ft2 / 2 * FT2) },
});

/**
 * The wing's downwash at the horizontal stabiliser (ESTIMATE): the stabiliser (FS 637, P) sits 27 ft behind the wing's
 * quarter chord, about one span (26.7 ft, P), and 44 in above it, where the downwash of an AR 3.66 wing is close to its
 * far-field 2 C_L / (pi A): gradient 0.8 x 2 / (pi A) = 0.139 rad per unit C_L (D with the 0.8 vertical-offset and
 * distance factor an ESTIMATE). Fades in by about 30 kt (the hover wake falls clear of the tail).
 */
const TAIL_DOWNWASH = { centre: AH56_BASE.stabilizer.centre, area: AH56_BASE.stabilizer.area, liftSlope: AH56_BASE.stabilizer.liftSlope,
  gradient: 0.8 * 2 / (Math.PI * D.WING.span ** 2 / D.WING.areaM2), fadeSpeed: 15 };

const panel = (side: 1 | -1): WingPanelDef => ({
  side,
  centre: { x: D.WING.quarterMacX, y: side * WING_MAC_BL * IN, z: D.z(WING_MAC_WL) },
  // P: 195 ft^2 and 26.7 ft over both panels (the span includes the fuselage carry-through from BL 0).
  area: D.WING.areaM2 / 2, span: D.WING.span / 2,
  liftSlope: WING_LIFT_SLOPE,
  // ESTIMATES: attached maximum 1.2 (12 % root, 8 % tip, P; no flap); profile drag 0.009; Oswald e 0.85.
  maxCl: 1.2, cd0: 0.009, inducedK: 1 / (Math.PI * AR * 0.85),
  incidence: (side > 0 ? WING_INCIDENCE_DEG.right : WING_INCIDENCE_DEG.left) * DEG,
  zeroLiftAlpha: WING_ZERO_LIFT_DEG * DEG,
  dihedral: D.WING.dihedralDeg * DEG,
  washBySkew: WING_WASH,
  stores: storesPanel(side),
  tail: TAIL_DOWNWASH,
});
export const AH56_WINGS: readonly WingPanelDef[] = [panel(-1), panel(1)];

// ---------------------------------------------------------------------------------------------------------- pusher
/** Activity factor 142 per blade (P ASTA-72 p 51): AF = (1e5 / 16) integral (c / D) x^3 dx; a near-constant chord of c / D
 *  0.091 (c / R 0.182) gives it (D; the tabulated planform below gives 142 within 1 %, tests). */
const PROP_CHORD_OVER_R = [0.172, 0.180, 0.184, 0.186, 0.184, 0.178, 0.160, 0.110];
/** Helix twist of a P/D 1.3 blade (ESTIMATE: a high-speed design for J about 1.1 at 194 KTAS), relative to 0.7 R. */
const PROP_PD = 1.3;
const PROP_TWIST_X = [0.2, 0.3, 0.45, 0.6, 0.7, 0.8, 0.9, 1.0];
const helix = (x: number): number => Math.atan(PROP_PD / (Math.PI * x));

/** Blade angles of the map slices, deg: the flight range -12 .. +40.8 (P) in 3 deg steps (19 slices). */
const PROP_NODES_DEG = [-12, -9, -6, -3, 0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 40.8];

/**
 * Hamilton Standard 1311 GB 30/11FA 10A4-0 (P ASTA-72 pp 51-52, AMCS-73 pp 23-24): 3 blades, 10 ft, AF 142 per blade,
 * integrated design lift coefficient 0.411; blade angles quoted at the 42 in station (0.7 R). Polar inertia 13.98 slug-ft^2
 * (P). The thickness and the twist are ESTIMATES. The section (the existing propeller section model, airfoil.ts):
 * - design lift 0.411 (P);
 * - zero-lift angle -2.2 deg to the quoted blade angle: FITTED so the static thrust is zero at the -2.2 deg hover detent
 *   (P: "minimum power, level attitude"); the line the angle is quoted to (chord or face) is not stated, and -cl_i / (2 pi)
 *   = -3.75 deg to the chord of an a = 1.0 mean line put the zero at -3.8 deg;
 * - maximum lift 1.45 at low speed, losing 0.4 per unit Mach above 0.3: ESTIMATE for the thin (4-7 %) high-speed sections,
 *   FITTED so the blade does not stall short of the 40.8 deg stop at V_H (C4): at 190 KTAS and 1674 rpm the prop gives
 *   18.2 kN for 3,190 shp (efficiency 0.75; Hamilton Standard's charts give about 0.8 for a 3-blade AF 140 prop at that
 *   J 1.15, C_P 0.34) and 21.4 kN at the stop. The McCauley Clark-Y's 1.45 and 1.6 / Mach stalled it at 10 kN.
 * The pitch-control fields other than the stops and the slices are not read (the blade angle is the grip's, pusher.ts).
 */
export const AH56_PROPELLER: PropellerDef = {
  name: 'Hamilton Standard 1311 GB 30/11FA 10A4-0 (10 ft, three blades, reversing pusher)',
  diameter: 2 * D.PUSHER_RADIUS, blades: D.PUSHER_BLADES,
  hubRadius: 0.2 * D.PUSHER_RADIUS,
  stationX: [0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 0.97, 1.0],
  chordOverR: PROP_CHORD_OVER_R,
  thicknessX: [0.2, 0.3, 0.5, 0.7, 0.9, 1.0],
  thickness: [0.30, 0.20, 0.11, 0.07, 0.05, 0.04],
  twist: { kind: 'table', x: PROP_TWIST_X, angle: PROP_TWIST_X.map((x) => helix(x) - helix(0.7)) },
  referenceStation: 0.7,
  section: { alpha0: -2.2 * DEG, liftSlope: 2 * Math.PI * 0.9, clMaxLowSpeed: 1.45, clMaxMachLoss: 0.4, clMin: -0.8,
    cdMax: 1.6, clMinDrag: 0.4, dragDueToLift: 0.01, clIdeal: 0.411 },
  inertia: AH56_PROP_INERTIA,
  pitchControl: {
    kind: 'constantSpeed',
    fineStop: AH56_PROP_BETA_DEG.flightMin * DEG, coarseStop: AH56_PROP_BETA_DEG.max * DEG,
    rateToFine: 10 * DEG, rateToCoarse: 10 * DEG,
    governor: { minRpm: 1674, maxRpm: 1717, gain: 0.02, dampingTime: 0.2 },
    failsTo: 'fine',
    pitchNodes: PROP_NODES_DEG.map((deg) => deg * DEG),
  },
};

/**
 * The twist grip's blade-angle table, deg against grip position (ControlInputs.propLever 0..1). AMCS: about 130 deg of grip
 * for -12.0 .. +40.8 deg (P AMCS-73 p 23), nonlinear: 2:1 grip deg per blade deg from -10 to -5 and 3:1 from 35 to 40
 * (P ASTA-72 para 43). The three snap positions of the input profile (AG's linear `ah56PropLever`: hover detent -2.2, the
 * autorotation +8 and full reverse -12) are points of the table, so a snap lands exactly on its angle; between them the
 * grip runs at 2.94:1 (-12 .. -10, -5 .. -2.2), 2.46:1 (-2.2 .. +8), 2.35:1 (+8 .. +35) and 3:1 above 40 (D from the
 * 130 deg).
 */
const GRIP_DEG = 130;
const g = (deg: number): number => deg / GRIP_DEG;
const leverDetent = ah56PropLever(AH56_PROP_BETA_DEG.hoverDetent), leverAuto = ah56PropLever(AH56_PROP_BETA_DEG.autorotation);
/** Grip degrees spent below the detent other than the 10 deg of the 2:1 stretch: (-12 .. -10) and (-5 .. -2.2) share it. */
const lowRatio = (leverDetent * GRIP_DEG - 10) / (2 + 2.8);
export const PROP_GRIP_TABLE = {
  lever: [0, g(2 * lowRatio), g(2 * lowRatio + 10), leverDetent, leverAuto, g(GRIP_DEG - 0.8 * 3 - 15), g(GRIP_DEG - 0.8 * 3), 1],
  betaDeg: [AH56_PROP_BETA_DEG.flightMin, -10, -5, AH56_PROP_BETA_DEG.hoverDetent, AH56_PROP_BETA_DEG.autorotation, 35, 40,
    AH56_PROP_BETA_DEG.max],
} as const;

/**
 * Trim schedule of the prop's blade angle against true airspeed (pusherTrimLever), FITTED at 18,300 lb, SL ISA, AMCS, stores
 * on (the trims of docs/ah56-compound.md):
 * - 100 KTAS and above: the angle that puts the trimmed collective on the SoF value, 13 deg indicated (AMCS-73 SoF, P) =
 *   2.25 deg at 0.75 R (C7; ICS 5-7 deg indicated, P APE-I SoF, is 1.25-3.25 deg);
 * - the hover: the -2.2 deg detent (P);
 * - 20-80 KTAS: the angle that holds the fuselage about 2 deg nose up (ASTA-72 para 32: 2-3 deg nose up at low speed,
 *   "varied as desired through use of propeller pitch", P), the collective as required.
 * Above 200 KTAS the stop (40.8 deg) is reached on the AMCS with the stores.
 */
export const PROP_TRIM_SCHEDULE = {
  kt: [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 190, 200, 210],
  betaDeg: [-2.2, 5, 7.5, 13, 17, 23.6, 24.8, 27.4, 30.7, 34.8, 37.1, 39.9, 40.8],
} as const;
/** The ICS's schedule (246 rpm): the same targets, 6 deg indicated (2.25 deg at 0.75 R, the middle of the P 5-7 deg) from 100
 *  KTAS; the low-speed part is the AMCS's (the attitude differs by under 0.5 deg). FITTED. pusherTrimLever reads it when the
 *  flight model passes the configuration (contract request: flightModel.ts reset). */
export const PROP_TRIM_SCHEDULE_ICS = {
  kt: [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 190, 200, 210],
  betaDeg: [-2.2, 5, 7.5, 13, 17, 22.5, 23.9, 26.4, 29.75, 33.7, 36.1, 38.7, 40.8],
} as const;
const table = (t: { kt: readonly number[]; betaDeg: readonly number[] }) => ({ x: t.kt.map((kt) => kt * KT), y: t.betaDeg.map((deg) => deg * DEG) });

export const AH56_PUSHER: PusherDef = {
  propeller: AH56_PROPELLER,
  // P ASTA-72 p 51: FS 675.7, WL 114.5, BL 0, shaft incidence 0.
  hub: D.PUSHER_HUB,
  ratio: AH56_PROP_RATIO, inertia: AH56_PROP_INERTIA,
  // P: counter-clockwise viewed from behind.
  rotation: -1,
  beta: {
    lever: PROP_GRIP_TABLE.lever, angle: PROP_GRIP_TABLE.betaDeg.map((deg) => deg * DEG),
    flightMin: AH56_PROP_BETA_DEG.flightMin * DEG, hoverDetent: AH56_PROP_BETA_DEG.hoverDetent * DEG,
    autorotation: AH56_PROP_BETA_DEG.autorotation * DEG, reverse: AH56_PROP_BETA_DEG.flightMin * DEG,
    // ESTIMATE: the blade-angle servo follows the grip at 10 deg/s.
    rate: 10 * DEG,
    // P (ASTA-72 para 43): above 33 deg the blades creep down with the friction full on; ESTIMATE 0.1 deg/s.
    creep: { above: 33 * DEG, rate: 0.1 * DEG },
  },
  deltaBeta: {
    // ESTIMATE sensor: the engine carrying less than half the prop's torque latches it.
    torqueDropFraction: 0.5,
    // P: to +18 deg from forward; -8.5 deg from reverse (AMCS; the ICS's -7 is not separated).
    forwardTarget: AH56_PROP_BETA_DEG.deltaBetaForward * DEG, reverseTarget: AH56_PROP_BETA_DEG.deltaBetaReverse.amcs * DEG,
    // ESTIMATE: 15 deg/s (C13: 25 -> 18 deg within 1.5 s, P).
    rate: 15 * DEG,
  },
  // ESTIMATE: the tail rotor's wake factor (base.ts / rotorcraft.ts, 0.35 of the mean inflow, faded with speed).
  wake: 0.35,
  trimSchedule: table(PROP_TRIM_SCHEDULE),
  trimScheduleByConfig: { ics: table(PROP_TRIM_SCHEDULE_ICS) },
};

// ------------------------------------------------------------------------------------------------- collective gauge
/**
 * The collective the reports quote is the blade pitch at the CENTRE OF ROTATION: ASTA-72's rotor table (p 48, P) gives
 * "Geometric twist, theta_1, from center of rotation to rotor station 302.4: -5 deg" and "Collective pitch range, theta_0:
 * 0 deg 30 min to 18 deg 30 min", the theta(r) = theta_0 + theta_1 r / R notation. The model's collective is the pitch at
 * 0.75 R (definition.ts), so the gauge reads it plus -0.75 x twist = +3.75 deg (D) on top of the AMCS's +7 deg rigging
 * offset ("13 deg AMCS = 6 deg ICS", D): AMCS 13 deg indicated (the SoF cruise setting) is 2.25 deg at 0.75 R, ICS 5 deg is
 * 1.25 deg. Without it the SoF collective puts about 6 deg at 0.75 R on a mu 0.5 rotor and the rotor, not the wing,
 * carries the aircraft at 190 KTAS (docs/ah56-compound.md "Collective reference").
 */
export const COLLECTIVE_CENTRE_OFFSET = -0.75 * AH56_BASE.main.twist;
const gyro = AH56_GYRO!;
export const AH56_COMPOUND_GYRO: ControlGyroDef = { ...gyro, configs: {
  amcs: { ...gyro.configs.amcs, collectiveIndicatedOffset: gyro.configs.amcs.collectiveIndicatedOffset + COLLECTIVE_CENTRE_OFFSET },
  ics: { ...gyro.configs.ics, collectiveIndicatedOffset: gyro.configs.ics.collectiveIndicatedOffset + COLLECTIVE_CENTRE_OFFSET },
} };

// ------------------------------------------------------------------------------------------------- rotor Mach drag
/**
 * PROVISIONAL main-rotor section (plan 7.3, drag budget): the base polar (lift slope 5.73, Cl max 1.3, Cd 0.0085 + 0.01
 * Cl^2, Cm0 -0.012; base.ts) through section.ts with a drag rise past the drag-divergence Mach number, so V_H (C4) is fitted
 * with the advancing tip's compressibility and stage 5 need not re-fit it. M_dd 0.78 ESTIMATE (plan 7.4: the (4.6)3012 root
 * and (0.6)3006 tip mods); rise 3 (M - M_dd)^2: ESTIMATE, Korn's 20 (M - M_crit)^4 with M_crit = M_dd - 0.1 at the 194 KTAS
 * advancing tip, M 0.886 (D). Used only while highSpeed.ts (AH) declares no section of its own; AH's section replaces it.
 */
export const PROVISIONAL_SECTION: RotorSectionDef = { liftSlope: AH56_BASE.main.liftSlope, maxCl: AH56_BASE.main.maxCl,
  cd0: AH56_BASE.main.profileCd, cd2: AH56_BASE.main.inducedDrag, cm0: AH56_BASE.main.cm0 ?? 0,
  machDragRise: { divergence: 0.78, rise: 3 } };

/** Fuselage, turrets, hub and gyro equivalent flat plate along x, m^2: FITTED to V_H (C4) with the stores (above) and the
 *  provisional Mach drag rise; plan 7.3's budget expects about 2.2 m^2 in all at 194 KTAS. */
export const FUSELAGE_DRAG_X = 0.8;

export const AH56_COMPOUND: AH56Patch = {
  main: { section: AH56_ROTOR_HIGH_SPEED.section ?? PROVISIONAL_SECTION },
  dragArea: { ...AH56_BASE.dragArea, x: FUSELAGE_DRAG_X },
  wings: AH56_WINGS,
  pusher: AH56_PUSHER,
  controlGyro: AH56_COMPOUND_GYRO,
};
