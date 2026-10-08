// R22 Beta II, doors on. Reference: Robinson POH section 1, pp. 1-3/1-4 (22 Feb 2024 / 11 May 2020):
// https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r22_poh_1_f2700c9508.pdf
// Loft stations, cabin furniture, engine detail and fin outlines are visual ESTIMATES traced from the
// three-view. The later-aircraft drawing gives 107 in height / 345 in overall length; the shared geometry
// contract retains its earlier 105 in / 344 in envelope. No shared dimensions are changed here.
import type { AirframeVisualDef, FRD, RotorcraftVisualDef } from '../../render/aircraft/airframe/types';
import { R22_ROTORCRAFT } from './rotorcraft';
import { CABIN_WIDTH, MAIN_HUB, MAIN_ROTOR_RADIUS, NOSE_X, PANEL_CANVAS, PANEL_FACE, PILOT_EYE,
  SKID_CONTACT_FRONT_X, SKID_CONTACT_REAR_X, SKID_FRONT_X, SKID_HALF_TRACK, SKID_REAR_X, SKID_Z,
  TAIL_END_X, TAIL_HUB, TAIL_ROTOR_RADIUS } from './dimensions';

const point = (p: { x: number; y: number; z: number }): FRD => [p.x, p.y, p.z];
const W = CABIN_WIDTH / 2;
const TX = TAIL_HUB.x;
const TZ = TAIL_HUB.z;
const ROTORCRAFT: RotorcraftVisualDef = {
  main: { hub: point(MAIN_HUB), radius: MAIN_ROTOR_RADIUS, root: 0.42, chord: [0.18288, 0.19558], twist: -8 * Math.PI / 180 },
  tail: { hub: point(TAIL_HUB), radius: TAIL_ROTOR_RADIUS, root: 0.085, chord: 0.1016, precone: (1 + 11 / 60) * Math.PI / 180 },
  skids: { halfTrack: SKID_HALF_TRACK, z: SKID_Z, front: SKID_FRONT_X, rear: SKID_REAR_X,
    crossTubes: [SKID_CONTACT_FRONT_X, SKID_CONTACT_REAR_X] },
  boom: { front: [-0.86, 0, -0.48], rear: [TX, 0, TZ], radii: [0.15, 0.052] },
  mast: { bottom: [-0.04, 0, -0.81], top: [0, 0, MAIN_HUB.z + 0.22], bottomWidth: 0.38, topWidth: 0.23 },
  fins: [
    { name: 'upperFin', axis: 'y', thickness: 0.032, outline: [[TX + 0.13, 0.055, TZ], [TX - 0.07, 0.055, TZ - 0.47], [TAIL_END_X, 0.055, TZ - 0.47], [TAIL_END_X + 0.08, 0.055, TZ]] },
    { name: 'lowerFin', axis: 'y', thickness: 0.025, outline: [[TX + 0.12, 0.055, TZ], [TAIL_END_X + 0.08, 0.055, TZ], [TAIL_END_X + 0.05, 0.055, TZ + 0.55], [TX - 0.03, 0.055, TZ + 0.56]] },
    { name: 'horizontalStabiliser', axis: 'z', thickness: 0.026, outline: [[TX + 0.83, -0.49, TZ + 0.01], [TX + 0.61, -0.49, TZ + 0.01], [TX + 0.56, 0.49, TZ + 0.01], [TX + 0.83, 0.49, TZ + 0.01]] },
  ],
  guard: [[TX + 0.57, 0.03, TZ + 0.10], [TX + 0.45, 0.03, TZ + 0.39], [TX - 0.03, 0.03, TZ + 0.65], [TAIL_END_X - 0.02, 0.03, TZ + 0.70]],
  panel: { centre: point(PANEL_FACE.centre), width: PANEL_FACE.width, height: PANEL_FACE.height,
    tiltBackDeg: PANEL_FACE.tiltBackDeg, canvas: PANEL_CANVAS },
  collective: { pivots: [[0.58, -0.49, 0.25], [0.58, 0.04, 0.25]], length: 0.51 },
};

export const R22_VISUAL: AirframeVisualDef = {
  id: 'r22', rotorcraft: R22_ROTORCRAFT, rotorcraftVisual: ROTORCRAFT,
  fuselage: {
    nose: 'closed', frontX: NOSE_X, endX: -0.87, inlets: [], antennas: [], grid: { rows: 112, cols: 88 },
    keys: [
      [NOSE_X, 0.22, 0.28, 0.25, 0.015, 2, 2, 0],
      [1.66, -0.01, 0.36, 0.21, 0.20, 2, 2, 0],
      [1.55, -0.29, 0.43, 0.15, 0.37, 2, 2.2, 0],
      [1.35, -0.53, 0.49, 0.11, 0.47, 2.2, 2.5, 0],
      [1.08, -0.73, 0.51, 0.06, 0.53, 2.5, 3, 0],
      [0.75, -0.84, 0.52, 0.01, W, 3.3, 3.5, 0],
      [0.35, -0.85, 0.52, 0.00, W, 3.5, 3.5, 0],
      [0.03, -0.84, 0.51, -0.02, 0.54, 3.5, 3, 0],
      [-0.12, -0.80, 0.46, -0.06, 0.51, 3, 2.5, 0],
      [-0.28, -0.76, -0.11, -0.39, 0.48, 3, 2, 0],
      [-0.60, -0.69, -0.25, -0.46, 0.39, 2.5, 2, 0],
      [-0.87, -0.63, -0.33, -0.48, 0.16, 2, 2, 0],
    ],
  },
  glazing: {
    cabinFrontX: NOSE_X - 0.005, cabinRearX: -0.10, firewallX: -0.10, tRange: [0.07, 0.93], liningRoofLimit: -1e9,
    // The forward bubble continues into the chin; the slim centre post is geometry, not a painted band.
    windscreen: { sillC: [1.7, 0.23], sillN: [0, 1], post: [[1.05, 0.18], [0.65, -0.80]], postY: 0.22, topX: 0.68 },
    windows: [{ pts: [[0.96, 0.13], [0.59, -0.76], [0.10, -0.75], [-0.035, -0.58], [0.05, -0.10]], r: 0.045, sides: 'both' }],
    doors: [{ pts: [[1.01, 0.20], [0.63, -0.79], [0.06, -0.78], [-0.06, -0.56], [0.02, 0.38]], r: 0.04, sides: 'both', handle: { x: 0.12, z: -0.08 } }],
  },
  // Fixed-wing-only fields satisfy the common presentation/bake interface. No wing, wheel or prop mesh
  // is built in the rotorcraft branch; fin dimensions also supply the shared paint material's UV scale.
  wing: { mount: 'low', section: { m: 0, p: 0.4, t: 0.12 }, breaks: [{ y: 0, chord: 0.1, qcX: 0 }, { y: 0.1, chord: 0.1, qcX: 0 }],
    rootY: 0, qcZ: 0, dihedral: 0, rootIncidence: 0, tipIncidence: 0, bays: [], flap: { maxDeflection: 0, travelAft: 0, travelDown: 0 }, tip: { round: 0, chordRound: 0 }, fuelCaps: [] },
  tail: { section: { m: 0, p: 0.4, t: 0.09 }, h: { span: 0.98, rootChord: 0.27, tipChord: 0.22, quarterChord: { x: TX + 0.75, z: TZ }, incidence: 0, kind: 'elevator', chordFraction: 0, innerCutY: 0 },
    v: { base: { x: TX, z: TZ }, tip: { x: TX - 0.1, z: TZ - 0.47 }, rootChord: 0.25, tipChord: 0.16, rudderChordFraction: 0 }, tTail: false },
  gear: [0, -1, 1].map(s => ({ contact: [s === 0 ? SKID_CONTACT_FRONT_X : SKID_CONTACT_REAR_X, s * SKID_HALF_TRACK, SKID_Z], radius: 0, width: 0, rimRadius: 0,
    leg: { kind: 'springTube', root: [0, 0, 0], axleOffset: 0, r0: 0, r1: 0 } })) as unknown as AirframeVisualDef['gear'],
  props: [], nacelles: [],
  lamps: [
    { id: 'navL', pos: [-0.03, -W, 0.17], radius: 0.022, glowOffset: [0.01, -0.025, 0] },
    { id: 'navR', pos: [-0.03, W, 0.17], radius: 0.022, glowOffset: [0.01, 0.025, 0] },
    { id: 'navTail', pos: [TAIL_END_X, 0.07, TZ - 0.43], radius: 0.018, glowOffset: [-0.025, 0, 0] },
    { id: 'strobeL', pos: [TX + 1.15, 0, TZ - 0.07], radius: 0.024, glowOffset: [0, 0, -0.03] },
    { id: 'beacon', pos: [-0.32, 0, -0.79], radius: 0.023, glowOffset: [0, 0, -0.03] },
    { id: 'landing', pos: [1.64, -0.065, 0.245], radius: 0.038, glowOffset: [0.03, 0, 0], aim: { downDeg: 8, outDeg: 0, halfAngleDeg: 12 } },
    { id: 'taxi', pos: [1.64, 0.065, 0.245], radius: 0.038, glowOffset: [0.03, 0, 0], aim: { downDeg: 14, outDeg: 0, halfAngleDeg: 22 } },
  ],
  cockpit: {
    pilotEye: point(PILOT_EYE), defaultPitchDeg: -31, defaultFovDeg: 74, enclosure: 'canopy',
    panel: { x: PANEL_FACE.centre.x, zTop: PANEL_FACE.centre.z - PANEL_FACE.height / 2, width: PANEL_FACE.width },
    floor: { z: 0.43, x0: 1.55, x1: -0.06 }, glareshield: { profile: [], halfWidth: PANEL_FACE.width / 2 },
    seats: [-0.27, 0.27].map(y => ({ x: 1.10, y, z: 0.22, kind: 'front', width: 0.43, depth: 0.47, reclineDeg: 10, back: { height: 0.56, headrest: false } })),
    occupants: [{ seat: 1 }], consoles: [], trimPanels: [],
    column: { kind: 'stick', pivot: [0.94, 0, 0.40], height: 0.48, pitchDeg: 12, rollDeg: 12, ys: [0] },
    pedals: { x: 1.36, ys: [-0.38, -0.16, 0.16, 0.38] }, engineControls: [],
    flapControl: { kind: 'panelSwitch', pos: [0, 0, 0], travel: 0 },
    lamps: { flood: { pos: [0.90, 0, -0.30], aim: point(PANEL_FACE.centre) } },
    box: { floor: 0.43, roof: -0.85, side: W, rear: -0.10, panelX: PANEL_FACE.centre.x, glareshieldZ: -0.29, sillZ: 0.20, windscreenX: 1.55, roofGlazed: true },
    glazingPanels: [{ n: [1, 0, 0], area: 1.0 }, { n: [0, 1, 0], area: 0.55 }, { n: [0, -1, 0], area: 0.55 }], interiorArea: 4, controlPoints: {},
  },
  livery: {
    registration: 'N22FS', palette: { base: [239, 239, 233], band: [151, 24, 34], accent: [47, 49, 54] }, accentBelow: true,
    stripe: { xs: [-0.87, -0.30, 0.2, 0.9, 1.5, 1.7], centre: [-0.48, -0.17, 0.17, 0.25, 0.29, 0.25], half: [0.035, 0.05, 0.045, 0.035, 0.02, 0.01], noseShearX: 1.72 },
    lettering: { x0: -10, x1: -9, z0: 0, z1: 0.1 }, construction: 'metal', skinJoints: [-0.60, -0.23],
    fin: { bandZ0: TZ - 0.3, bandX0: TX, slope: 0.2, cap: 0.08 }, texture: { w: 2048, h: 1024 },
  },
  shadow: { halfX: 4.9, halfY: 4.2, fuselage: [0.40, 1.0, 0.52], wingX: 0, wingY: 2.2, wingHeight: -MAIN_HUB.z + SKID_Z, restHeight: SKID_Z, skids: { halfTrack: SKID_HALF_TRACK, front: SKID_FRONT_X, rear: SKID_REAR_X } },
};
export default R22_VISUAL;
