// R44 Raven II, standard skids, doors on. POH 1-3 / MM 16-40 and the manufacturer's left-side photo
// establish the silhouette. Loft, window outlines and furniture are visual ESTIMATES; published geometry
// remains in dimensions.ts. See docs/r44-exterior.md for evidence and the outstanding renderer connection.
import type { AirframeVisualDef, FRD, RotorcraftVisualDef } from '../../render/aircraft/airframe/types';
import { R44_ROTORCRAFT } from './rotorcraft';
import { R44_MAIN_PAINT, R44_TAIL_PAINT } from './exteriorPaint';
import { CABIN_WIDTH, CABIN_HEIGHT, MAIN_HUB, MAIN_ROTOR_RADIUS, MAIN_ROTOR_CHORD, MAIN_ROTOR_TWIST_DEG, NOSE_X,
  PANEL_CANVAS, PANEL_FACE, PANEL_OUTLINE, PANEL_PEDESTAL, PANEL_ENCLOSURE_DEPTH, PILOT_EYE, SEAT_CENTRES,
  SKID_CONTACT_FRONT_X, SKID_CONTACT_REAR_X, SKID_FRONT_X, SKID_HALF_TRACK, SKID_REAR_X, SKID_Z, SKID_TUBE_RADIUS,
  TAIL_HUB, TAIL_ROTOR_RADIUS, TAIL_ROTOR_CHORD, TAIL_ROTOR_PRECONE_DEG,
  HORIZONTAL_STABILIZER as HS, UPPER_FIN_OUTLINE, LOWER_FIN_OUTLINE, TAIL_STINGER, TAIL_STINGER_RADIUS } from './dimensions';
const point = (p: { x: number; y: number; z: number }): FRD => [p.x, p.y, p.z];
const ROOF_Z = SKID_Z - CABIN_HEIGHT;
const W = CABIN_WIDTH / 2, TX = TAIL_HUB.x, TZ = TAIL_HUB.z;
const ROTORCRAFT: RotorcraftVisualDef = {
  nominalVoltage: 28,
  main: { hub: point(MAIN_HUB), radius: MAIN_ROTOR_RADIUS, root: 0.55, chord: MAIN_ROTOR_CHORD, twist: MAIN_ROTOR_TWIST_DEG * Math.PI / 180,
    paint: R44_MAIN_PAINT,
    coning: { referenceThrust: 11000, angleDeg: 2.5, maxDeg: 5, droopDeg: -2 } },
  tail: { hub: point(TAIL_HUB), radius: TAIL_ROTOR_RADIUS, root: 0.11, chord: TAIL_ROTOR_CHORD,
    precone: TAIL_ROTOR_PRECONE_DEG * Math.PI / 180, paint: R44_TAIL_PAINT },
  skids: { halfTrack: SKID_HALF_TRACK, z: SKID_Z, front: SKID_FRONT_X, rear: SKID_REAR_X,
    crossTubes: [SKID_CONTACT_FRONT_X, SKID_CONTACT_REAR_X], tubeRadius: SKID_TUBE_RADIUS,
    bellyHalfWidth: 0.51, bellyZ: 0.61, crossCentreZ: 0.59 },
  boom: { front: [-0.35, 0, -0.38], rear: [TX, 0, TZ], radii: [0.205, 0.065] },
  mast: { bottom: [-0.05, 0, ROOF_Z + 0.01], top: [0, 0, MAIN_HUB.z + 0.32], bottomWidth: 0.67, topWidth: 0.35 },
  fins: [
    { name: 'upperFin', axis: 'y', thickness: 0.040, outline: UPPER_FIN_OUTLINE.map(point) },
    { name: 'lowerFin', axis: 'y', thickness: 0.040, outline: LOWER_FIN_OUTLINE.map(point) },
    { name: 'horizontalStabiliser', axis: 'z', thickness: 0.035, outline: [[HS.leadingX, -HS.span / 2, HS.z],
      [HS.leadingX - HS.leftChord, -HS.span / 2, HS.z], [HS.leadingX - HS.rightChord, HS.span / 2, HS.z], [HS.leadingX, HS.span / 2, HS.z]] },
  ],
  guard: TAIL_STINGER.map(point), guardRadius: TAIL_STINGER_RADIUS,
  panel: { centre: point(PANEL_FACE.centre), width: PANEL_FACE.width, height: PANEL_FACE.height,
    tiltBackDeg: PANEL_FACE.tiltBackDeg, canvas: PANEL_CANVAS, outline: PANEL_OUTLINE,
    pedestal: PANEL_PEDESTAL, enclosureDepth: PANEL_ENCLOSURE_DEPTH, poweredVolts: [18, 24] },
  cyclic: { gripYs: [-0.35, 0.35], barTiltDeg: -9,
    stem: [[0, 0, 0], [0.02, 0, -0.18], [-0.08, 0, -0.45], [-0.08, 0, -0.56]] },
  pedalZ: 0.43,
  collective: { pivots: [[1.02, -0.54, 0.28], [1.02, 0.04, 0.28]], length: 0.55 },
  engineDetail: { exposed: false, cylinderXs: [] }, registrationXs: [-2.0, -3.6],
};
const ANTENNA_X = -1.72;
const boomTop = (x: number): number => {
  const b = ROTORCRAFT.boom, t = (x - b.front[0]) / (b.rear[0] - b.front[0]);
  return b.front[2] + t * (b.rear[2] - b.front[2]) - (b.radii[0] + t * (b.radii[1] - b.radii[0]));
};
export const R44_VISUAL: AirframeVisualDef = {
  id: 'r44', rotorcraft: R44_ROTORCRAFT, rotorcraftVisual: ROTORCRAFT,
  fuselage: { nose: 'closed', frontX: NOSE_X, endX: -1.72, inlets: [],
    exhaust: { pos: [-1.39, -0.18, 0.43], radius: 0.038 },
    antennas: [
      // ESTIMATES: MM Fig. 16-5 and manufacturer left-side photo, blade antenna on forward tailcone.
      { kind: 'blade', pos: [ANTENNA_X, 0, boomTop(ANTENNA_X)], height: 0.40 },
    ], grid: { rows: 144, cols: 96 },
    keys: [
      [NOSE_X, 0.19, 0.30, 0.25, 0.012, 2, 2, 0],
      [2.28, -0.02, 0.43, 0.23, 0.25, 2, 2, 0],
      [2.12, -0.29, 0.55, 0.17, 0.43, 2, 2.2, 0],
      [1.86, -0.54, 0.63, 0.08, 0.56, 2.2, 2.6, 0],
      [1.48, -0.70, 0.66, 0.02, 0.625, 2.6, 3, 0],
      [1.10, ROOF_Z, 0.67, 0.00, W, 3.1, 3.6, 0],
      [0.55, ROOF_Z, 0.67, -0.01, W, 3.4, 3.6, 0],
      [0.06, -0.70, 0.66, -0.02, 0.62, 3.2, 3.2, 0],
      [-0.30, -0.64, 0.64, -0.04, 0.58, 2.8, 2.8, 0],
      [-0.80, -0.55, 0.59, -0.06, 0.53, 2.6, 2.7, 0],
      [-1.28, -0.47, 0.48, -0.03, 0.455, 2.5, 2.5, 0],
      [-1.49, -0.44, 0.29, -0.05, 0.38, 2.3, 2.4, 0],
      [-1.72, -0.44, -0.30, -0.37, 0.25, 2, 2, 0],
    ] },
  glazing: { cabinFrontX: NOSE_X - 0.005, cabinRearX: -0.14, firewallX: -0.14,
    tRange: [0.07, 0.93], liningRoofLimit: -1e9,
    headliner: { x0: 1.15, x1: -0.10, z0: -0.52, z1: -0.66, pitch: 0.38 },
    windscreen: { sillC: [NOSE_X, 0.23], sillN: [0, 1], post: [[1.73, 0.20], [1.19, -0.69]], postY: 0.27, topX: 1.19 },
    windows: [
      { pts: [[1.58, 0.10], [1.08, -0.63], [0.64, -0.63], [0.88, 0.04]], r: 0.045, sides: 'both' },
      { pts: [[0.77, 0.03], [0.52, -0.63], [0.10, -0.60], [0.07, -0.05]], r: 0.045, sides: 'both' },
    ],
    doors: [
      { pts: [[1.67, 0.30], [1.14, -0.69], [0.56, -0.68], [0.83, 0.28], [1.50, 0.43]], r: 0.05, sides: 'both', handle: { x: 0.94, z: 0.16 } },
      { pts: [[0.80, 0.34], [0.51, -0.68], [0.04, -0.65], [-0.02, 0.23], [0.60, 0.44]], r: 0.045, sides: 'both', handle: { x: 0.14, z: 0.14 } },
    ] },
  // Unused fixed-wing carriers retained for the common bake interface.
  wing: { mount: 'low', section: { m: 0, p: 0.4, t: 0.12 }, breaks: [{ y: 0, chord: 0.1, qcX: 0 }, { y: 0.1, chord: 0.1, qcX: 0 }],
    rootY: 0, qcZ: 0, dihedral: 0, rootIncidence: 0, tipIncidence: 0, bays: [], flap: { maxDeflection: 0, travelAft: 0, travelDown: 0 }, tip: { round: 0, chordRound: 0 }, fuelCaps: [] },
  tail: { section: { m: 0, p: 0.4, t: 0.09 }, h: { span: HS.span, rootChord: HS.rightChord, tipChord: HS.leftChord,
    quarterChord: { x: HS.leadingX - HS.rightChord / 4, z: HS.z }, incidence: 0, kind: 'elevator', chordFraction: 0, innerCutY: 0 },
    v: { base: { x: UPPER_FIN_OUTLINE[0].x, z: UPPER_FIN_OUTLINE[0].z },
      tip: { x: UPPER_FIN_OUTLINE[1].x, z: UPPER_FIN_OUTLINE[1].z },
      rootChord: UPPER_FIN_OUTLINE[0].x - UPPER_FIN_OUTLINE[3].x,
      tipChord: UPPER_FIN_OUTLINE[1].x - UPPER_FIN_OUTLINE[2].x, rudderChordFraction: 0 }, tTail: false },
  gear: [0, -1, 1].map(s => ({ contact: [s === 0 ? SKID_CONTACT_FRONT_X : SKID_CONTACT_REAR_X, s * SKID_HALF_TRACK, SKID_Z], radius: 0, width: 0, rimRadius: 0,
    leg: { kind: 'springTube', root: [0, 0, 0], axleOffset: 0, r0: 0, r1: 0 } })) as unknown as AirframeVisualDef['gear'],
  props: [], nacelles: [],
  lamps: [
    // MM 26-00 / Fig. 4-7: cabin chin positions, red tailcone anti-collision light, aft white mount.
    // The shared light switch map still calls the red circuit 'beacon'; see the integration notes.
    { id: 'navL', pos: [1.47, -0.605, 0.24], radius: 0.025, glowOffset: [0.01, -0.025, 0] },
    { id: 'navR', pos: [1.47, 0.605, 0.24], radius: 0.025, glowOffset: [0.01, 0.025, 0] },
    { id: 'navTail', pos: [TX - 0.36, 0.075, TZ + 0.02], radius: 0.022, glowOffset: [-0.025, 0, 0] },
    { id: 'beacon', pos: [TX + 1.58, 0, boomTop(TX + 1.58) - 0.044], radius: 0.032, glowOffset: [0, 0, -0.03] },
    { id: 'landing', pos: [2.27, -0.07, 0.32], radius: 0.043, glowOffset: [0.03, 0, 0], aim: { downDeg: 8, outDeg: 0, halfAngleDeg: 12 } },
    { id: 'taxi', circuit: 'landing', pos: [2.27, 0.07, 0.32], radius: 0.043, glowOffset: [0.03, 0, 0], aim: { downDeg: 14, outDeg: 0, halfAngleDeg: 22 } },
  ],
  cockpit: { pilotEye: point(PILOT_EYE), defaultPitchDeg: -24, defaultFovDeg: 82, enclosure: 'canopy',
    panel: { x: PANEL_FACE.centre.x, zTop: PANEL_FACE.centre.z - PANEL_FACE.height / 2, width: PANEL_FACE.width },
    floor: { z: 0.52, x0: 2.10, x1: -0.12 }, glareshield: { profile: [], halfWidth: PANEL_FACE.width / 2 },
    seats: SEAT_CENTRES.map(p => ({ x: p.x + 0.26, y: p.y, z: 0.28, kind: 'front', width: 0.47, depth: 0.50,
      reclineDeg: 10, back: { height: 0.62, headrest: false } })),
    occupants: [{ seat: 1 }], consoles: [], trimPanels: [],
    column: { kind: 'stick', pivot: [1.52, 0, 0.51], height: 0.56, pitchDeg: 12, rollDeg: 12, ys: [0] },
    pedals: { x: 1.97, ys: [-0.39, -0.17, 0.20, 0.42] }, engineControls: [],
    flapControl: { kind: 'panelSwitch', pos: [0, 0, 0], travel: 0 },
    lamps: { flood: { pos: [1.5, 0, -0.20], aim: point(PANEL_FACE.centre) } },
    box: { floor: 0.52, roof: ROOF_Z, side: W, rear: -0.14, panelX: PANEL_FACE.centre.x, glareshieldZ: -0.28,
      sillZ: 0.23, windscreenX: 2.10, roofGlazed: false },
    glazingPanels: [{ n: [1, 0, 0], area: 1.4 }, { n: [0, 1, 0], area: 1.1 }, { n: [0, -1, 0], area: 1.1 }], interiorArea: 6, controlPoints: {} },
  livery: { registration: 'N44FS', palette: { base: [239, 239, 233], band: [151, 24, 34], accent: [47, 49, 54] }, accentBelow: true,
    stripe: { xs: [-1.72, -0.8, 0.2, 1.2, 2.0, NOSE_X], centre: [-0.25, -0.12, 0.20, 0.32, 0.32, 0.27],
      half: [0.04, 0.06, 0.05, 0.04, 0.025, 0.01], noseShearX: NOSE_X + 0.02 },
    lettering: { x0: -10, x1: -9, z0: 0, z1: 0.1 }, construction: 'metal', skinJoints: [-1.28, -0.80, -0.25],
    fin: { bandZ0: TZ - 0.5, bandX0: TX, slope: 0.2, cap: 0.08 }, texture: { w: 4096, h: 2048 } },
  shadow: { halfX: 6.9, halfY: 5.4, fuselage: [0.50, 1.9, W], wingX: 0, wingY: 3, wingHeight: -MAIN_HUB.z + SKID_Z,
    restHeight: SKID_Z, skids: { halfTrack: SKID_HALF_TRACK, front: SKID_FRONT_X, rear: SKID_REAR_X } },
};
export default R44_VISUAL;
