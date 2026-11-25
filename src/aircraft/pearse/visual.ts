// Richard Pearse Waitohi Monoplane: structured-cloneable airframe visual definition.
// Plain data only (imported by liveryWorker.ts via aircraft/visualLoader.ts).
//
// Matches the Richard Pearse Memorial & NZ Patent No. 21476 configuration:
//   - Flat rectangular off-white canvas wing with inset outer ailerons (2.68..3.56 m inside the 3.81 m half-span);
//   - All-moving rectangular elevator hinged directly to the rear edge of the centre wing (x = -1.50 m);
//   - Tall rectangular canvas sail standing upright in the centre of the wing (z = -0.92..-2.27 m);
//   - Custom open tubular-steel undercarriage, thin bicycle wheels, grid-ribbed wing underside, wing-front horizontal
//     twin engine + cylindrical tank and two-vane diamond-paddle airscrew added by `exteriorDetails.ts`.

import type {
  AirframeVisualDef,
  CockpitDef,
  GlazingDef,
  LampVisualDef,
  LiveryDef,
  PropVisualDef,
  SectionShape,
  TailVisualDef,
  WheelVisualDef,
  WingVisualDef,
} from '../types';
import { PEARSE_GEOMETRY } from './geometry';
import {
  PEARSE_FLAP_SLOT,
  PEARSE_PANEL_CENTRE_PX,
  PEARSE_PANEL_PX_PER_M,
  PEARSE_PANEL_PX_RECT,
  PEARSE_PANEL_WIDTH,
  PEARSE_PARKING_BRAKE,
} from './panelLayout';

const W = PEARSE_GEOMETRY.wing;
const H = PEARSE_GEOMETRY.hTail;
const V = PEARSE_GEOMETRY.vTail;
const G = PEARSE_GEOMETRY.gear;
const P = PEARSE_GEOMETRY.propellers[0];
const EYE = PEARSE_GEOMETRY.fuselage.pilotEye;

/** Flat thin stretched-canvas section over rectangular grid ribs. */
const GRID_CANVAS: SectionShape = { m: 0.02, p: 0.4, t: 0.032 };
const FLAT_SAIL: SectionShape = { m: 0, p: 0.4, t: 0.025 };

const WING: WingVisualDef = {
  mount: 'high',
  section: GRID_CANVAS,
  breaks: [
    { y: W.rootY, chord: W.rootChord, qcX: W.quarterChord.x },
    { y: W.span / 2, chord: W.tipChord, qcX: W.quarterChord.x },
  ],
  rootY: W.rootY,
  qcZ: W.quarterChord.z,
  dihedral: W.dihedral,
  rootIncidence: W.rootIncidence,
  tipIncidence: W.tipIncidence,
  bays: [
    { kind: 'fixed', from: W.rootY, to: W.flap.innerY },
    { kind: 'flap', from: W.flap.innerY, to: W.flap.outerY, chordFraction: W.flap.chordFraction },
    { kind: 'fixed', from: W.flap.outerY, to: W.aileron.innerY },
    // Inset rectangular ailerons WITHIN the outer wing bays, enclosed outboard by the fixed 3.56..3.81 m tip bay!
    { kind: 'aileron', from: W.aileron.innerY, to: W.aileron.outerY, chordFraction: W.aileron.chordFraction },
    { kind: 'fixed', from: W.aileron.outerY, to: W.span / 2 },
  ],
  flap: { maxDeflection: W.flap.maxDeflection, travelAft: 0, travelDown: 0 },
  // Crisp square-cornered rectangular wingtips matching the Memorial.
  tip: { round: 0.02, chordRound: 0.0 },
  // Omit the wide streamlined Cessna-style strut; exteriorDetails.ts builds the slim round tubes & guy wires.
  fuelCaps: [],
};

const TAIL: TailVisualDef = {
  section: FLAT_SAIL,
  h: {
    span: H.span,
    rootChord: H.rootChord,
    tipChord: H.tipChord,
    quarterChord: { x: H.quarterChord.x, z: H.quarterChord.z },
    incidence: H.incidence,
    // Hinged directly along its leading edge (pivotFraction 0.03) at the rear edge of the centre wing!
    kind: 'stabilator',
    chordFraction: H.elevator.chordFraction,
    pivotFraction: 0.03,
    innerCutY: 0,
  },
  v: {
    base: { x: V.base.x, z: V.base.z },
    tip: { x: V.tip.x, z: V.tip.z },
    rootChord: V.rootChord,
    tipChord: V.rootChord,
    rudderChordFraction: V.rudder.chordFraction,
  },
  tTail: false,
};

// Minimal internal loft stub for bake worker compatibility (hidden in AircraftVisual).
type Key = readonly [number, number, number, number, number, number, number, number];
const FRONT_X = 0.75;
const END_X = -0.65;
const FIREWALL_X = 0.58;
const CABIN_REAR_X = -0.35;

const KEYS: readonly Key[] = [
  [FRONT_X, -0.88, -0.78, -0.83, 0.06, 2.0, 2.0, 0],
  [FIREWALL_X, -0.1, 0.48, 0.2, 0.18, 2.2, 2.2, 0],
  [0.1, -0.1, 0.52, 0.22, 0.22, 2.2, 2.4, 0],
  [CABIN_REAR_X, -0.1, 0.45, 0.18, 0.16, 2.2, 2.2, 0],
  [END_X, -0.88, -0.78, -0.83, 0.05, 2.0, 2.0, 0],
];

const FUSELAGE: AirframeVisualDef['fuselage'] = {
  keys: KEYS,
  frontX: FRONT_X,
  endX: END_X,
  nose: 'prop',
  inlets: [],
  antennas: [],
};

const GLAZING: GlazingDef = {
  cabinFrontX: 0.55,
  cabinRearX: CABIN_REAR_X,
  firewallX: FIREWALL_X,
  tRange: [0.18, 0.82],
  windows: [
    {
      pts: [
        [0.52, -0.08],
        [0.52, 0.22],
        [-0.3, 0.22],
        [-0.3, -0.08],
      ],
      r: 0.03,
      sides: 'both',
    },
  ],
  doors: [],
  liningRoofLimit: -1e9,
};

const GEAR: readonly [WheelVisualDef, WheelVisualDef, WheelVisualDef] = [
  {
    contact: [G.nose.x, G.nose.y, G.nose.z],
    radius: G.noseWheelRadius,
    width: 0.03,
    rimRadius: 0.258,
    leg: { kind: 'oleo', top: [G.nose.x, 0, 0.45], cylinderLen: 0.2, crownAt: 0.28, forkHalf: 0.03, scissors: false, steers: true },
  },
  {
    contact: [G.leftMain.x, G.leftMain.y, G.leftMain.z],
    radius: G.mainWheelRadius,
    width: 0.032,
    rimRadius: 0.336,
    leg: { kind: 'springTube', root: [-0.45, -0.95, 0.52], axleOffset: 0.03, r0: 0.012, r1: 0.01 },
  },
  {
    contact: [G.rightMain.x, G.rightMain.y, G.rightMain.z],
    radius: G.mainWheelRadius,
    width: 0.032,
    rimRadius: 0.336,
    leg: { kind: 'springTube', root: [-0.45, 0.95, 0.52], axleOffset: 0.03, r0: 0.012, r1: 0.01 },
  },
];

const INCH = 0.0254;
const PITCH_M = 65 * INCH;
const REF_PITCH = Math.atan(PITCH_M / (2 * Math.PI * 0.75 * (P.diameter / 2)));

const PROP: PropVisualDef = {
  hub: [P.hub.x, P.hub.y, P.hub.z],
  diameter: P.diameter,
  blades: P.blades,
  rotation: P.rotation,
  referencePitch: REF_PITCH,
  variablePitch: false,
  geometricPitch: PITCH_M,
  chord: [
    [0.14, 0.03],
    [0.45, 0.04],
    [0.65, 0.28],
    [0.82, 0.34],
    [0.96, 0.22],
    [1.0, 0.06],
  ],
  spinner: { baseX: 0.84, radius: 0.045, length: 0.18 },
  paint: { face: [0.14, 0.14, 0.15], back: [0.12, 0.12, 0.13], tip: [0.16, 0.16, 0.17], tipBand: 0.02 },
};

const TIP_Y = W.span / 2;
const LAMPS: readonly LampVisualDef[] = [
  { id: 'navL', pos: [0.1, -TIP_Y, W.quarterChord.z], radius: 0.012, glowOffset: [0.01, -0.02, 0] },
  { id: 'navR', pos: [0.1, TIP_Y, W.quarterChord.z], radius: 0.012, glowOffset: [0.01, 0.02, 0] },
  { id: 'navTail', pos: [-1.42, 0, -1.6], radius: 0.012, glowOffset: [-0.02, 0, 0], parent: 'rudder' },
  { id: 'strobeL', pos: [-0.1, -TIP_Y, W.quarterChord.z], radius: 0.01, glowOffset: [0, -0.02, 0] },
  { id: 'strobeR', pos: [-0.1, TIP_Y, W.quarterChord.z], radius: 0.01, glowOffset: [0, 0.02, 0] },
  { id: 'beacon', pos: [V.tip.x, 0, V.tip.z - 0.02], radius: 0.014, glowOffset: [0, 0, -0.02] },
  { id: 'landing', pos: [0.68, 0, 0.56], radius: 0.03, glowOffset: [0.03, 0, 0], aim: { downDeg: 5, outDeg: 0, halfAngleDeg: 14 } },
  { id: 'taxi', pos: [0.68, 0.07, 0.58], radius: 0.024, glowOffset: [0.03, 0, 0], aim: { downDeg: 9, outDeg: 0, halfAngleDeg: 20 } },
];

// Compact instrument board set low between the forward vertical frame tubes (0.384 m x 0.174 m).
const PANEL_X = 0.54;
const PANEL_ZTOP = 0.04;
const PANEL_SCALE = 0.6;
const PANEL_W = PEARSE_PANEL_WIDTH * PANEL_SCALE; // 0.384 m wide -> inconspicuous from outside, clear on Q!
const PX = PEARSE_PANEL_PX_RECT.w / PANEL_W;
const faceY = (px: number): number => (px - PEARSE_PANEL_CENTRE_PX) / PX;
const faceZ = (py: number): number => PANEL_ZTOP + (py - PEARSE_PANEL_PX_RECT.y) / PX;
const FLOOR_Z = 0.56;

const COCKPIT: CockpitDef = {
  pilotEye: [EYE.x, EYE.y, EYE.z],
  defaultPitchDeg: -5,
  focus: { yawDeg: 0, pitchDeg: -28, fovDeg: 36 },
  enclosure: 'canopy',
  panel: { x: PANEL_X, zTop: PANEL_ZTOP, width: PANEL_W, pxRect: PEARSE_PANEL_PX_RECT },
  floor: { z: FLOOR_Z, x0: 0.62, x1: -0.25 },
  glareshield: {
    profile: [
      [PANEL_X - 0.008, PANEL_ZTOP],
      [PANEL_X, PANEL_ZTOP - 0.006],
      [PANEL_X + 0.025, PANEL_ZTOP - 0.005],
      [PANEL_X + 0.025, PANEL_ZTOP + 0.004],
      [PANEL_X, PANEL_ZTOP],
    ],
    halfWidth: PANEL_W / 2,
  },
  seats: [
    { x: 0.22, y: 0, kind: 'front', width: 0.36, depth: 0.34, z: FLOOR_Z - 0.28, reclineDeg: 6, back: { height: 0.32, headrest: false } },
  ],
  occupants: [{ seat: 0 }],
  consoles: [],
  trimPanels: [],
  column: { kind: 'stick', pivot: [0.32, 0, FLOOR_Z - 0.02], height: 0.42, pitchDeg: 16, rollDeg: 18, ys: [0] },
  pedals: { x: 0.58, ys: [0] },
  engineControls: [
    { kind: 'lever', control: 'throttle', engine: 0, pos: [0.28, 0.2, 0.26], travel: 0.6, colour: 'black', length: 0.1, knob: 'cylinderThrottle' },
    { kind: 'lever', control: 'mixture', engine: 0, pos: [0.18, 0.22, 0.26], travel: 0.55, colour: 'red', length: 0.09, knob: 'scallopedMixture' },
  ],
  flapControl: { kind: 'panelLever', pos: [PANEL_X, faceY(PEARSE_FLAP_SLOT.x), faceZ(PEARSE_FLAP_SLOT.y)], travel: 0.06 },
  trimWheel: { pos: [0.12, -0.2, 0.28], axis: 'y', radius: 0.045, width: 0.015 },
  compass: { pos: [PANEL_X - 0.015, 0, PANEL_ZTOP - 0.045], mount: 'glareshield' },
  lamps: {
    flood: { pos: [0.18, 0, -0.45], aim: [PANEL_X, 0, PANEL_ZTOP + 0.09], cd: 4.5, maskTop: 0.6 },
  },
  box: {
    floor: FLOOR_Z,
    roof: -0.88,
    side: 0.32,
    rear: -0.35,
    panelX: PANEL_X,
    glareshieldZ: PANEL_ZTOP - 0.006,
    sillZ: 0.25,
    windscreenX: 0.6,
    roofGlazed: true,
  },
  glazingPanels: [
    { n: [1, 0, 0], area: 0.8 },
    { n: [0, -1, 0], area: 1.2 },
    { n: [0, 1, 0], area: 1.2 },
    { n: [-1, 0, 0], area: 0.8 },
  ],
  interiorArea: 3.5,
  controlPoints: {
    fuelSelector: [0.15, 0, -0.95],
    parkingBrake: [PANEL_X - 0.01, faceY(PEARSE_PARKING_BRAKE[0]), faceZ(PEARSE_PARKING_BRAKE[1])],
  },
};

// Pure sun-bleached off-white taut canvas across the wing, rear-edge elevator and tall central sail!
const CANVAS_WHITE: readonly [number, number, number] = [246, 244, 238];

const LIVERY: LiveryDef = {
  registration: 'ZK-RWP',
  palette: { base: CANVAS_WHITE, band: CANVAS_WHITE, accent: CANVAS_WHITE },
  stripe: {
    xs: [END_X, -0.2, 0.1, 0.4, FRONT_X],
    centre: [0, 0, 0, 0, 0],
    half: [0.001, 0.001, 0.001, 0.001, 0.001],
    noseShearX: 0.7,
  },
  lettering: { x0: -0.5, x1: -0.3, z0: -0.86, z1: -0.8 },
  construction: 'composite',
  skinJoints: [],
  fin: { bandZ0: -99, bandX0: 0, slope: 0, cap: 0 },
  texture: { w: 2048, h: 1024 },
};

export const PEARSE_VISUAL: AirframeVisualDef = {
  id: 'pearse',
  nominalVoltage: 14,
  fuselage: FUSELAGE,
  glazing: GLAZING,
  wing: WING,
  tail: TAIL,
  gear: GEAR,
  props: [PROP],
  nacelles: [],
  lamps: LAMPS,
  cockpit: COCKPIT,
  livery: LIVERY,
  shadow: {
    halfX: 3.8,
    halfY: 4.4,
    fuselage: [0.1, 1.0, 0.22],
    wingX: -0.5,
    wingY: W.span / 2,
    wingHeight: PEARSE_GEOMETRY.restHeight - W.quarterChord.z,
    restHeight: PEARSE_GEOMETRY.restHeight,
  },
};

export default PEARSE_VISUAL;
