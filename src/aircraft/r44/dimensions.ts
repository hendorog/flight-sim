import { roundedPanelOutline } from '../../core/roundedOutline';

// R44 Raven II reference geometry: FRD metres, origin on the main-mast axis, level ground at z = SKID_Z.
// Physics, exterior and panel import this file; do not keep independent copies. Sources and drawing
// limitations: docs/r44-sources.md. POH = R44 II, sections 1 (26 Jan 2024) and 7 (5 Mar 2015 panel).
// Every un-dimensioned coordinate is an ESTIMATE; the vertical origin is a convention, not a measured CG.
const IN = 0.0254;

/** Published, POH 1-4: 33 ft diameter, chord 10.0 in inboard / 10.6 in outboard, −6° twist. */
export const MAIN_ROTOR_RADIUS = 198 * IN;
export const MAIN_ROTOR_CHORD = [10 * IN, 10.6 * IN] as const;
export const MAIN_ROTOR_TWIST_DEG = -6;
/** Published, POH 1-4: 58 in diameter, 5.1 in constant chord, no twist, 1° precone. */
export const TAIL_ROTOR_RADIUS = 29 * IN;
export const TAIL_ROTOR_CHORD = 5.1 * IN;
export const TAIL_ROTOR_PRECONE_DEG = 1;
/** Published, POH 1-3 and MM 16-40 three-view (standard skids, later aircraft). */
export const OVERALL_LENGTH = 459 * IN;
export const OVERALL_HEIGHT = 129 * IN;
export const SKID_HALF_TRACK = 86 * IN / 2;
export const CABIN_WIDTH = 50.5 * IN;
export const CABIN_HEIGHT = 72 * IN;
/** Published 353 in nose-to-tail envelope, INCLUDING the aft tail-rotor tip; not cabin-shell length. */
export const FUSELAGE_LENGTH = 353 * IN;

/** ESTIMATE datum convention: bottom of level skid tubes 1.10 m below model origin. */
export const SKID_Z = 1.10;
/** ESTIMATES traced from POH 1-3 / MM 16-40 side view, scaled by the 353 in envelope. */
export const SKID_FRONT_X = 1.65;
export const SKID_REAR_X = -1.05;
export const SKID_CONTACT_FRONT_X = 0.70;
export const SKID_CONTACT_REAR_X = -0.73;
export const SKID_TUBE_RADIUS = 0.030;
/** ESTIMATE: teeter centre 0.12 m below published top of rotor head; no measured mast rake. */
export const MAIN_HUB = { x: 0, y: 0, z: SKID_Z - OVERALL_HEIGHT + 0.12 } as const;
/** x derived from published rotor/envelope lengths. y/z ESTIMATES from POH 1-3; rotor is LEFT of boom. */
export const TAIL_HUB = {
  x: -(OVERALL_LENGTH - MAIN_ROTOR_RADIUS - TAIL_ROTOR_RADIUS),
  y: -0.22,
  z: SKID_Z - 2.00,
} as const;
/** Derived from published lengths with rotors fore/aft; envelope endpoint is not the fin trailing edge. */
export const NOSE_X = MAIN_ROTOR_RADIUS - (OVERALL_LENGTH - FUSELAGE_LENGTH);
export const TAIL_END_X = NOSE_X - FUSELAGE_LENGTH;

/** Span published: 66 in, MM 16-40 Fig 16-1 (Feb 2024, F004-2 empennage).
 * Chord/position ESTIMATES: Fig 16-1 side view (353 in envelope ≈796 px in the cached 1237 px
 * image) places the surface ≈19 px / 0.22 m below the tail hub. MM Fig 4-6, p4.22 (Feb 2024)
 * shows its short F955 brackets beneath the cone, not at the lower-fin tip. */
export const HORIZONTAL_STABILIZER = {
  span: 66 * IN, leftChord: 0.32, rightChord: 0.32,
  leadingX: TAIL_HUB.x + 1.20, z: TAIL_HUB.z + 0.22,
} as const;
/** ESTIMATED polygons, POH 1-3 / MM 16-40. Fin on the right of the left-side tail rotor. */
export const UPPER_FIN_OUTLINE = [
  { x: TAIL_HUB.x + 0.20, y: 0.075, z: TAIL_HUB.z },
  { x: TAIL_HUB.x - 0.15, y: 0.075, z: TAIL_HUB.z - 1.02 },
  { x: TAIL_HUB.x - 0.37, y: 0.075, z: TAIL_HUB.z - 1.02 },
  { x: TAIL_HUB.x - 0.24, y: 0.075, z: TAIL_HUB.z },
] as const;
export const LOWER_FIN_OUTLINE = [
  { x: TAIL_HUB.x + 0.20, y: 0.075, z: TAIL_HUB.z },
  { x: TAIL_HUB.x - 0.24, y: 0.075, z: TAIL_HUB.z },
  { x: TAIL_HUB.x - 0.45, y: 0.075, z: TAIL_HUB.z + 0.70 },
  { x: TAIL_HUB.x - 0.18, y: 0.075, z: TAIL_HUB.z + 0.70 },
] as const;
/** Short lower-fin stinger, ESTIMATE traced from MM Fig 16-1 (Feb 2024), POH 1-3.
 * The drawing distinguishes this tube (at the fin heel) from the long forward tail-rotor guard.
 * Root is inside the lower fin; the aft/down contact points retain the previous shared trace.
 * Physics imports this centreline directly, so its contact envelope follows the rendered tube. */
export const TAIL_STINGER = [
  { x: TAIL_HUB.x - 0.24, y: 0.075, z: TAIL_HUB.z + 0.66 },
  { x: TAIL_HUB.x - 0.30, y: 0.075, z: TAIL_HUB.z + 0.74 },
  { x: TAIL_HUB.x - 0.40, y: 0.075, z: TAIL_HUB.z + 0.82 },
  { x: TAIL_HUB.x - 0.48, y: 0.075, z: TAIL_HUB.z + 0.87 },
  { x: TAIL_HUB.x - 0.56, y: 0.075, z: TAIL_HUB.z + 0.87 },
  { x: TAIL_HUB.x - 0.61, y: 0.075, z: TAIL_HUB.z + 0.85 },
] as const;
/** ESTIMATE tube radius, same source. */
export const TAIL_STINGER_RADIUS = 0.018;

/** Published horizontal occupant arms, POH 6-4 (datum 100 in ahead of mast). z ESTIMATE. */
export const SEAT_CENTRES = [
  { x: 50.5 * IN, y: -10.4 * IN, z: 0.10 },
  { x: 50.5 * IN, y: 12.2 * IN, z: 0.10 },
  { x: 20.5 * IN, y: -12.2 * IN, z: 0.10 },
  { x: 20.5 * IN, y: 12.2 * IN, z: 0.10 },
] as const;
/** Right front command seat (POH 2-5). Eye ESTIMATE from manufacturer cabin photo, not the occupant CG. */
export const PILOT_EYE = { x: 1.22, y: SEAT_CENTRES[1].y, z: SKID_Z - 1.58 } as const;

/** ESTIMATES from POH 7-21, IPC ch 95 and Robinson's eight-hole panel photo (URLs in docs/r44-sources.md).
 * Four 3-1/8 in instruments across the broad upper face, above a central pedestal. This is not the
 * R22 three-hole T-console. The photograph shows a central pod, NOT a 1.28 m cabin-width dashboard.
 * A continuous UV face preserves raycasting; separate shells and faceplates articulate the pod/pedestal.
 * Position/rake/depth remain photographic estimates. Optional pilot-side avionics console is omitted. */
export const PANEL_PX_PER_M = 2400;
export const PANEL_CANVAS = { w: 1152, h: 1872 } as const;
// Rounded four-column shell, with a raised warning-light brow and a separate central pedestal.
const PANEL_BROW = [
  [0, 132], [44, 56], [90, 40], [110, 0], [1042, 0], [1062, 40], [1108, 56],
  [1152, 132], [1152, 610], [1112, 706], [1020, 744], [840, 752],
] as const;
const PANEL_LEFT = [[312, 752], [132, 744], [40, 706], [0, 610]] as const;
export const PANEL_POD_OUTLINE = roundedPanelOutline([...PANEL_BROW, ...PANEL_LEFT], 70);
export const PANEL_PEDESTAL_OUTLINE = roundedPanelOutline([
  [312, 730], [840, 730], [840, 1812], [800, 1872], [352, 1872], [312, 1812],
], 20);
export const PANEL_OUTLINE = roundedPanelOutline([
  ...PANEL_BROW, [840, 1812], [800, 1872], [352, 1872], [312, 1812], ...PANEL_LEFT,
], 35);
export const PANEL_FACE = {
  centre: { x: 1.85, y: 0, z: SKID_Z - 1.00 },
  width: PANEL_CANVAS.w / PANEL_PX_PER_M,
  height: PANEL_CANVAS.h / PANEL_PX_PER_M,
  tiltBackDeg: 15,
} as const;
/** ESTIMATED support under the narrow pedestal; width is independent of the upper instrument panel. */
export const PANEL_PEDESTAL = { width: 0.22, depth: 0.24, forwardOffset: 0.14, footWidth: 0.26, footDepth: 0.30 } as const;
export const PANEL_ENCLOSURE_DEPTH = 0.15;
