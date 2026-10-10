import { roundedPanelOutline } from '../../core/roundedOutline';

// Schweizer 269C-1 / 300CB, standard two-seat right-PIC installation, compressed standard skids.
// Sole geometry contract for physics, exterior and panel. FRD metres, x=0 on the main mast;
// SKID_Z defines the vertical origin, not a measured CG. RFM = CSP-C1-1, reissued 16 Jan 2019.
// See docs/s269-sources.md for source conflicts, source URLs and measurements still needed.
const IN = 0.0254, FT = 0.3048;

/** Published RFM 1-8: three NACA 0015 blades, 26.83 ft disc, constant 6.75 in chord, −8°39′ twist. */
export const MAIN_ROTOR_BLADES = 3;
export const MAIN_ROTOR_RADIUS = 26.83 * FT / 2;
export const MAIN_ROTOR_CHORD = 6.75 * IN;
export const MAIN_ROTOR_TWIST_DEG = -(8 + 39 / 60);
/** CCW viewed from above: RFM 1-11 rightward antitorque thrust and 3-2 power-loss left yaw.
 * Direction inferred from these explicit force/yaw signs, not from a Robinson convention. */
export const MAIN_ROTOR_ROTATION = 1;
/** Published RFM 1-9: two modified NACA 0014 blades, 4.25 ft diameter, 4.81 in chord, −8° twist. */
export const TAIL_ROTOR_BLADES = 2;
export const TAIL_ROTOR_RADIUS = 4.25 * FT / 2;
export const TAIL_ROTOR_CHORD = 4.81 * IN;
export const TAIL_ROTOR_TWIST_DEG = -8;
/** ESTIMATE pending HMI rotation diagram: legacy opposite local-axis sense relative to main azimuth. */
export const TAIL_ROTOR_ROTATION = -1;
/** Published RFM 1-9/1-10 and Fig 1-1. Imperial values control over rounded/inconsistent metric cells. */
export const OVERALL_LENGTH = 30.83 * FT;
export const OVERALL_HEIGHT = 8.72 * FT;
export const CABIN_WIDTH = 4.25 * FT;
export const SKID_HALF_TRACK = 6.54 * FT / 2;
export const SKID_LENGTH = 8.25 * FT;
export const SKID_TO_STINGER_LENGTH = 22.19 * FT;
export const HUB_SEPARATION = 15.29 * FT;

/** ESTIMATES from Fig 1-1: origin convention, nose, cabin envelope and skid placement. */
export const SKID_Z = 0.90;
export const NOSE_X = 1.65;
export const CABIN_HEIGHT = 1.65;
export const SKID_FRONT_X = 1.85;
export const SKID_REAR_X = SKID_FRONT_X - SKID_LENGTH;
export const SKID_CONTACT_FRONT_X = 1.15;
export const SKID_CONTACT_REAR_X = -0.42;
export const SKID_TUBE_RADIUS = 0.028;
/** ESTIMATE hub hinge plane 0.06 m below the published top of the hub. */
export const MAIN_HUB = { x: 0, y: 0, z: SKID_Z - OVERALL_HEIGHT + 0.06 } as const;
/** Published longitudinal separation; LEFT side from Fig 1-1 plan view. Lateral offset ESTIMATE.
 * Height derived from RFM 1-10 minimum tail-tip clearance + radius; compressed-gear convention. */
export const TAIL_HUB = { x: -HUB_SEPARATION, y: -0.20, z: SKID_Z - (2.63 * FT + TAIL_ROTOR_RADIUS) } as const;
/** ESTIMATES only: no dimensioned 269C-1 hinge offsets obtained. Independent flap/lag pin axes,
 * not an elastomeric hingeless hub. Do not use these placeholders to claim control/lag calibration. */
export const FLAP_HINGE_OFFSET = 0.18;
export const LAG_HINGE_OFFSET = 0.22;

/** Published RFM 1-6/7-13: four nitrogen/hydraulic poppet oleos. Mounts/radii ESTIMATED from Fig 1-1.
 * FAA 4H12 rev 32 p14 gives 350 psi front / 725 psi aft; pressure is not a spring rate. */
export const SKID_DAMPERS = [SKID_CONTACT_FRONT_X, SKID_CONTACT_REAR_X].flatMap(x => [-1, 1].map(side => ({
  upper: { x: x - 0.08, y: side * 0.44, z: SKID_Z - 0.48 },
  lower: { x, y: side * SKID_HALF_TRACK, z: SKID_Z - SKID_TUBE_RADIUS },
  bodyRadius: 0.038, rodRadius: 0.020,
})));
/** RFM 1-9: one surface on the RIGHT, span to boom 2.50 ft, chord 12.7 in, 35° dihedral,
 * incidence 9.8°. ESTIMATE leading edge/location from Fig 1-1; span interpreted along the surface. */
export const HORIZONTAL_STABILIZER = {
  span: 2.5 * FT, chord: 12.7 * IN, dihedralDeg: 35, incidenceDeg: 9.8,
  leadingX: TAIL_HUB.x + 0.28, z: TAIL_HUB.z,
} as const;
const HS = HORIZONTAL_STABILIZER;
export const HORIZONTAL_STABILIZER_OUTLINE = [
  { x: HS.leadingX, y: 0, z: HS.z }, { x: HS.leadingX - HS.chord, y: 0, z: HS.z },
  { x: HS.leadingX - HS.chord, y: HS.span * Math.cos(HS.dihedralDeg * Math.PI / 180), z: HS.z - HS.span * Math.sin(HS.dihedralDeg * Math.PI / 180) },
  { x: HS.leadingX, y: HS.span * Math.cos(HS.dihedralDeg * Math.PI / 180), z: HS.z - HS.span * Math.sin(HS.dihedralDeg * Math.PI / 180) },
] as const;
/** RFM 1-9: triangular vertical fin above boom, span 1.25 ft, root chord 23.6 in, tip chord zero.
 * ESTIMATED sweep and attachment; RFM metric root chord says 60 mm, a factor-ten typo (599.44 mm). */
export const VERTICAL_FIN_OUTLINE = [
  { x: TAIL_HUB.x + 0.30, y: 0, z: TAIL_HUB.z },
  { x: TAIL_HUB.x - 0.12, y: 0, z: TAIL_HUB.z - 1.25 * FT },
  { x: TAIL_HUB.x + 0.30 - 23.6 * IN, y: 0, z: TAIL_HUB.z },
] as const;
/** Published rounded fin area, RFM 1-9. Aerodynamic centre ESTIMATED at the triangle centroid. */
export const VERTICAL_FIN_AREA = 1 * FT ** 2;
export const VERTICAL_FIN_CENTRE = {
  x: VERTICAL_FIN_OUTLINE.reduce((sum, p) => sum + p.x, 0) / 3,
  y: 0, z: VERTICAL_FIN_OUTLINE.reduce((sum, p) => sum + p.z, 0) / 3,
} as const;
/** ESTIMATED tail-skid shape from Fig 1-1; aft envelope uses the published skid-to-tail-skid length. */
export const TAIL_END_X = SKID_FRONT_X - SKID_TO_STINGER_LENGTH;
export const TAIL_STINGER = [
  { x: TAIL_HUB.x + 0.52, y: 0, z: TAIL_HUB.z + 0.06 },
  { x: TAIL_HUB.x + 0.16, y: 0, z: SKID_Z - 0.30 },
  { x: TAIL_END_X, y: 0, z: SKID_Z - 0.11 },
] as const;
/** ESTIMATE tube radius from Fig 1-1. */
export const TAIL_STINGER_RADIUS = 0.015;
/** ESTIMATE nose-to-tail-skid envelope; not the RFM 24 ft stopped-blade dimension. */
export const FUSELAGE_LENGTH = NOSE_X - TAIL_END_X;

/** Published seat arms, RFM 6-9/6-10 and FAA 4H12 p13; vertical positions ESTIMATED. */
export const SEAT_CENTRES = [-13.8, 12.8].map(y => ({ x: (100 - 83.2) * IN, y: y * IN, z: 0.05 }));
/** Standard RIGHT PIC, RFM 1-5 / FAA 4H12 p13. Left PIC requires supplement CSP-C1-1G. */
export const PILOT_SEAT = 1;
/** ESTIMATE seated eye and posture from Fig 1-1, not a surveyed eye or the occupant mass centre. */
export const PILOT_EYE = { x: 0.57, y: SEAT_CENTRES[PILOT_SEAT].y, z: SKID_Z - 1.52 } as const;

/** ESTIMATED central instrument console, RFM Fig 4-2A (carburetted CB). No surveyed cockpit.
 * Broad rectangular console; canvas/px-per-m are a simulator design choice.
 * Unlike the Robinson pod, the chosen flat face is 0.48 × 0.60 m. Rake/depth remain estimates. */
export const PANEL_PX_PER_M = 2400;
export const PANEL_CANVAS = { w: 1152, h: 1440 } as const;
export const PANEL_OUTLINE = roundedPanelOutline([
  [0, 0], [1152, 0], [1152, 1440], [0, 1440],
], 28);
export const PANEL_FACE = { centre: { x: 1.12, y: 0, z: SKID_Z - 0.98 },
  width: PANEL_CANVAS.w / PANEL_PX_PER_M, height: PANEL_CANVAS.h / PANEL_PX_PER_M, tiltBackDeg: 12 } as const;
export const PANEL_PEDESTAL = { width: 0.20, depth: 0.22, forwardOffset: 0.14, footWidth: 0.24, footDepth: 0.28 } as const;
/** ESTIMATE console depth, same source. */
export const PANEL_ENCLOSURE_DEPTH = 0.14;
