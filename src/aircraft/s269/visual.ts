// Schweizer 269C-1 / 300CB, doors on, single left tank, right PIC. CSP-C1-1 Fig 1-1 and
// AOPA Pilot Apr 1997 p64 / Andrew Borrows' 300CB photographs (docs/s269-exterior.md).
// Cabin stations and furniture are visual ESTIMATES; shared reference geometry stays in dimensions.ts.
import type { AirframeVisualDef, FRD, RotorcraftVisualDef } from '../../render/aircraft/airframe/types';
import { R22_VISUAL as base } from '../r22/visual';
import { S269_ROTORCRAFT } from './rotorcraft';
import * as D from './dimensions';
const point = (p: { x: number; y: number; z: number }): FRD => [p.x, p.y, p.z];
const W = D.CABIN_WIDTH / 2;
const CABIN_BOTTOM = 0.54; // ESTIMATE floor-pan lower envelope, Fig 1-1.
const CABIN_TOP = CABIN_BOTTOM - D.CABIN_HEIGHT;
// Tilted oval door/window outlines, sampled densely enough that the shared convex mask and the
// physical gasket follow the same smooth curve. All positions are photographic estimates.
const doorOval = (rx: number, rz: number): [number, number][] => Array.from({ length: 32 }, (_, i) => {
  const a = i / 32 * Math.PI * 2;
  return [0.60 + rx * Math.cos(a) + 0.22 * Math.sin(a), -0.35 + rz * Math.sin(a)];
});
const rotorcraftVisual: RotorcraftVisualDef = {
  nominalVoltage: 28,
  interior: { frameColor: 0x33383c, seatColor: 0xa4aaa7, seatBackColor: 0x727f88,
    perforatedPedals: false, collectiveFittings: false },
  engineDetail: { exposed: false, cylinderXs: [] }, // S269ExteriorVisual supplies the HO-360 installation.
  main: { hub: point(D.MAIN_HUB), radius: D.MAIN_ROTOR_RADIUS, root: 0.45,
    chord: [D.MAIN_ROTOR_CHORD, D.MAIN_ROTOR_CHORD], twist: D.MAIN_ROTOR_TWIST_DEG * Math.PI / 180,
    // Visual fallback ONLY until the articulated state adapter is supplied.
    coning: { referenceThrust: 7785, angleDeg: 2.5, maxDeg: 5, droopDeg: -2 },
    paint: { rootUpper: 0x929c9e, rootLower: 0x292d30, capLength: 0.015,
      bands: [{ tipDistance: 0.15, upper: 0xe4b842, lower: 0xe4b842 }] } },
  tail: { hub: point(D.TAIL_HUB), radius: D.TAIL_ROTOR_RADIUS, root: 0.09,
    chord: D.TAIL_ROTOR_CHORD, twist: D.TAIL_ROTOR_TWIST_DEG * Math.PI / 180, precone: 0,
    paint: { rootUpper: 0xb62f31, rootLower: 0xb62f31, capLength: 0.006,
      bands: [{ tipDistance: 0.08, upper: 0xb62f31, lower: 0xb62f31 },
        { tipDistance: 0.15, upper: 0xecece4, lower: 0xecece4 }] } },
  boom: { front: [-0.82, 0, -0.42], rear: [D.TAIL_HUB.x, 0, D.TAIL_HUB.z], radii: [0.078, 0.052] },
  mast: { bottom: [0, 0, -0.55], top: [0, 0, D.MAIN_HUB.z + 0.28], bottomWidth: 0.13, topWidth: 0.085 },
  fins: [
    { name: 'verticalFin', axis: 'y', thickness: 0.0254, outline: D.VERTICAL_FIN_OUTLINE.map(point) },
    { name: 'horizontalStabiliser', axis: 'z', thickness: 0.025, outline: D.HORIZONTAL_STABILIZER_OUTLINE.map(point) },
  ],
  guard: D.TAIL_STINGER.map(point), guardRadius: D.TAIL_STINGER_RADIUS,
  skids: { halfTrack: D.SKID_HALF_TRACK, z: D.SKID_Z, front: D.SKID_FRONT_X, rear: D.SKID_REAR_X,
    crossTubes: [D.SKID_CONTACT_FRONT_X, D.SKID_CONTACT_REAR_X], tubeRadius: D.SKID_TUBE_RADIUS,
    dampers: D.SKID_DAMPERS.map(d => ({ ...d, upper: point(d.upper), lower: point(d.lower) })) },
  panel: { centre: point(D.PANEL_FACE.centre), width: D.PANEL_FACE.width, height: D.PANEL_FACE.height,
    tiltBackDeg: D.PANEL_FACE.tiltBackDeg, canvas: D.PANEL_CANVAS, outline: D.PANEL_OUTLINE,
    pedestal: D.PANEL_PEDESTAL, enclosureDepth: D.PANEL_ENCLOSURE_DEPTH, poweredVolts: [18, 24] },
  cyclic: { kind: 'individual', gripYs: [D.SEAT_CENTRES[0].y, D.SEAT_CENTRES[1].y], barTiltDeg: 0,
    stem: [[0, 0, 0], [0.15, 0, -0.17], [0.17, 0, -0.37], [0.12, 0, -0.48]] },
  collective: { pivots: D.SEAT_CENTRES.map(s => [s.x - 0.16, s.y - 0.23, 0.23] as const), length: 0.51 },
  pedalZ: 0.36,
  registrationXs: [-2.80, -4.10],
};
export const S269_VISUAL: AirframeVisualDef = {
  // Fixed-wing fields are unused compatibility data for the common bake interface.
  ...base, id: 's269', rotorcraft: S269_ROTORCRAFT, rotorcraftVisual,
  fuselage: { nose: 'closed', frontX: D.NOSE_X, endX: -0.20, inlets: [], antennas: [], grid: { rows: 112, cols: 88 },
    keys: [
      [D.NOSE_X, -0.18, 0.17, 0.01, 0.013, 2, 2, 0],
      [1.61, -0.39, 0.32, -0.015, 0.24, 2, 2, 0],
      [1.48, -0.65, 0.46, -0.035, 0.43, 2, 2, 0],
      [1.24, -0.89, 0.52, -0.05, 0.565, 2.2, 2.2, 0],
      // The seat/floor pan has straight sides below the bubble (RFM 1-6); an oval underside
      // pinches through the outboard seat bases at the published lateral arms.
      [0.94, CABIN_TOP + 0.06, CABIN_BOTTOM, -0.12, 0.624, 2.6, 4.5, 0],
      [0.62, CABIN_TOP, 0.53, -0.22, W, 2.8, 4.5, 0],
      [0.33, CABIN_TOP + 0.02, 0.49, -0.24, W, 2.9, 4.5, 0],
      [0.06, CABIN_TOP + 0.10, 0.36, -0.29, 0.60, 2.6, 4.5, 0],
      [-0.14, CABIN_TOP + 0.25, 0.10, -0.35, 0.50, 2.3, 2, 0],
      [-0.20, CABIN_TOP + 0.34, -0.03, -0.37, 0.42, 2, 2, 0],
    ] },
  glazing: { cabinFrontX: D.NOSE_X - 0.005, cabinRearX: -0.19, firewallX: -0.19,
    tRange: [0.035, 0.965], liningRoofLimit: -1e9,
    windscreen: { sillC: [1.60, 0.20], sillN: [0, 1], post: [[1.30, 0.21], [0.68, -1.01]], postY: 0.20, topX: 0.54 },
    windows: [{ pts: doorOval(0.40, 0.55), r: 0.008, sides: 'both' }],
    doors: [{ pts: doorOval(0.48, 0.65), r: 0.008, sides: 'both', handle: { x: 0.36, z: 0.16 } }],
  },
  cockpit: {
    pilotEye: point(D.PILOT_EYE), defaultPitchDeg: -27, defaultFovDeg: 82, enclosure: 'canopy',
    panel: { x: D.PANEL_FACE.centre.x, zTop: D.PANEL_FACE.centre.z - D.PANEL_FACE.height / 2, width: D.PANEL_FACE.width },
    floor: { z: 0.385, x0: 1.46, x1: 0.0 }, glareshield: { profile: [], halfWidth: D.PANEL_FACE.width / 2 },
    seats: D.SEAT_CENTRES.map(s => ({ x: s.x + 0.31, y: s.y, z: 0.17, kind: 'front', width: 0.44,
      depth: 0.46, reclineDeg: 9, back: { height: 0.59, headrest: false } })),
    occupants: [{ seat: D.PILOT_SEAT }], consoles: [], trimPanels: [],
    column: { kind: 'stick', pivot: [0.85, 0, 0.40], height: 0.48, pitchDeg: 12, rollDeg: 12,
      ys: D.SEAT_CENTRES.map(s => s.y) },
    pedals: { x: 1.27, ys: D.SEAT_CENTRES.flatMap(s => [s.y - 0.105, s.y + 0.105]) },
    engineControls: [], flapControl: { kind: 'panelSwitch', pos: [0, 0, 0], travel: 0 },
    compass: { pos: [1.18, 0, -0.58] },
    lamps: { flood: { pos: [0.91, 0, -0.49], aim: point(D.PANEL_FACE.centre) } },
    box: { floor: 0.385, roof: CABIN_TOP, side: W, rear: -0.19, panelX: D.PANEL_FACE.centre.x,
      glareshieldZ: -0.38, sillZ: 0.20, windscreenX: 1.60, roofGlazed: true },
    glazingPanels: [{ n: [1, 0, 0], area: 1.25 }, { n: [0, 1, 0], area: 0.72 }, { n: [0, -1, 0], area: 0.72 }],
    interiorArea: 4.8, controlPoints: {},
  },
  lamps: [
    { id: 'navL', pos: [0.14, -W, 0.25], radius: 0.022, glowOffset: [0, -0.025, 0] },
    { id: 'navR', pos: [0.14, W, 0.25], radius: 0.022, glowOffset: [0, 0.025, 0] },
    { id: 'navTail', pos: [D.TAIL_HUB.x - 0.05, 0, D.TAIL_HUB.z + 0.07], radius: 0.018, glowOffset: [-0.025, 0, 0] },
    { id: 'beacon', pos: [-1.60, 0, -0.54], radius: 0.027, glowOffset: [0, 0, -0.03] },
    { id: 'landing', pos: [1.50, 0, 0.355], radius: 0.055, glowOffset: [0.03, 0, 0], aim: { downDeg: 10, outDeg: 0, halfAngleDeg: 14 } },
  ],
  livery: { registration: 'N269FS', palette: { base: [237, 239, 235], band: [38, 88, 106], accent: [190, 46, 44] },
    accentBelow: true, construction: 'metal', skinJoints: [],
    stripe: { xs: [-0.20, 0.0, 0.45, 0.95, 1.42, D.NOSE_X], centre: [0.03, 0.19, 0.35, 0.39, 0.36, 0.17],
      half: [0.015, 0.025, 0.035, 0.036, 0.025, 0.012], noseShearX: D.NOSE_X },
    lettering: { x0: -10, x1: -9, z0: 0, z1: 0.1 },
    fin: { bandZ0: D.TAIL_HUB.z - 0.20, bandX0: D.TAIL_HUB.x, slope: 0, cap: 0.08 }, texture: { w: 2048, h: 1024 } },
  shadow: { halfX: 5.2, halfY: 4.4, fuselage: [0.65, 1.05, W], wingX: 0, wingY: 2.2,
    wingHeight: -D.MAIN_HUB.z + D.SKID_Z, restHeight: D.SKID_Z,
    skids: { halfTrack: D.SKID_HALF_TRACK, front: D.SKID_FRONT_X, rear: D.SKID_REAR_X } },
};
export default S269_VISUAL;
