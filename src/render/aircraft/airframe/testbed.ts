// Synthetic airframes that switch on the variant builders of render/aircraft before a real type has its data:
// tests/aircraft/variants.test.ts builds them, and dev/aircraft.html?type=syn-twin | syn-canopy shows them.
// They are NOT aircraft of the simulator (no registry entry, no flight model): each takes the planform, the
// tail, the wheels and the propeller discs of a real type's geometry file and adds a hand-sketched body.
//
// SYNTHETIC_TWIN (the PA-34 pattern): egg-shaped cabin body with a closed nose, low wing ending under its skin
// with a nacelle gap between two flap bays, root fillets, two nacelles with decal inlets and cowl flaps, two
// three-blade variable-pitch propellers turning opposite ways, stabilator with anti-servo tabs, rudder tab,
// dorsal fillet, three retracting oleo legs with doors and wells, the landing light on the nose leg, a
// six-lever quadrant, floor flap lever and gear selector.
// SYNTHETIC_CANOPY (the DA20 pattern): pod and boom, one canopy outline, composite skin, winglets, swept
// T-tail with ventral fin, leaf-spring main legs and a castering spring-tube nose leg, sticks, a centre
// console with levers, a flap switch, two occupants.
//
// Plain data, like every airframe definition.

import { DA20_GEOMETRY } from '../../../aircraft/da20/geometry';
import { PA34_GEOMETRY } from '../../../aircraft/pa34/geometry';
import { makeFinPlanform, makeRudderPlanform, makeWingPlanform, makeWingletPlanform, sectionPoint } from '../planformMath';
import type { AirframeVisualDef, CockpitDef, FRD, LampVisualDef, LiveryDef, LoftDef, NacelleVisualDef, PropVisualDef, TailVisualDef, WheelVisualDef, WingVisualDef } from './types';

const DEG = Math.PI / 180;
type Key = LoftDef['keys'][number];

/** The eight lamps where a low-wing type has them: tips, fin tip, rudder; `landing` and `taxi` as given. */
function lamps(wing: WingVisualDef, tail: TailVisualDef, landing: LampVisualDef, taxi: LampVisualDef): LampVisualDef[] {
  const tipY = wing.breaks[wing.breaks.length - 1].y - 0.04;
  // On a winglet the tip lamps sit at two thirds of its height.
  const tip = (xc: number, side: 1 | -1): FRD => {
    const p = wing.tip.winglet ? sectionPoint(makeWingletPlanform(wing), wing.tip.winglet.height * 0.66, xc, 0) : sectionPoint(makeWingPlanform(wing), tipY, xc, 0);
    return [p.x, p.y * side, p.z];
  };
  const finHeight = tail.v.base.z - tail.v.tip.z;
  const rudderFoot = sectionPoint(makeRudderPlanform(tail), 0.05, 1, 0);
  // The beacon stands on the fin tip, or on the tailplane over it.
  const top = sectionPoint(makeFinPlanform(tail), finHeight - 0.01, 0.35, 0);
  return [
    { id: 'navL', pos: tip(0.06, -1), radius: 0.03, glowOffset: [0.035, -0.035, 0] },
    { id: 'navR', pos: tip(0.06, 1), radius: 0.03, glowOffset: [0.035, 0.035, 0] },
    { id: 'navTail', pos: [rudderFoot.x - 0.015, 0, rudderFoot.z], radius: 0.022, glowOffset: [-0.03, 0, 0], parent: 'rudder' },
    { id: 'strobeL', pos: tip(0.2, -1), radius: 0.02, glowOffset: [0, -0.035, 0] },
    { id: 'strobeR', pos: tip(0.2, 1), radius: 0.02, glowOffset: [0, 0.035, 0] },
    { id: 'beacon', pos: [top.x, 0, top.z - (tail.tTail ? 0.09 : 0.035)], radius: 0.035, glowOffset: [0, 0, -0.045] },
    landing,
    taxi,
  ];
}

const PROP_PAINT: PropVisualDef['paint'] = { face: [0.45, 0.46, 0.47], back: [0.035, 0.035, 0.037], tip: [0.9, 0.9, 0.88], tipBand: 0.075 };

// =================================================================================================================
// Twin
// =================================================================================================================

const TG = PA34_GEOMETRY;
const TW = TG.wing;

const TWIN_WING: WingVisualDef = {
  mount: 'low',
  section: { m: 0.02, p: 0.5, t: 0.15 },
  breaks: TW.breaks!,
  rootY: TW.rootY,
  qcZ: TW.quarterChord.z,
  dihedral: TW.dihedral,
  rootIncidence: TW.rootIncidence,
  tipIncidence: TW.tipIncidence,
  root: 'conform',
  // The flap is interrupted by the nacelle (a fixed bay); a fixed strip at the root and the tip panel.
  bays: [
    { kind: 'fixed', from: TW.rootY, to: 0.78 },
    { kind: 'flap', from: 0.78, to: 1.5, chordFraction: TW.flap.chordFraction },
    { kind: 'fixed', from: 1.5, to: 2.31 },
    { kind: 'flap', from: 2.31, to: TW.flap.outerY, chordFraction: TW.flap.chordFraction },
    { kind: 'aileron', from: TW.aileron.innerY, to: TW.aileron.outerY, chordFraction: TW.aileron.chordFraction },
    { kind: 'fixed', from: TW.aileron.outerY, to: TW.span / 2 },
  ],
  flap: { maxDeflection: TW.flap.maxDeflection, travelAft: 0.05, travelDown: 0.02 },
  tip: { round: 0.14, chordRound: 0.1 },
  fuelCaps: [{ y: 2.9, xc: 0.3, side: 'both' }],
  pitot: { side: -1, y: 3.4, xc: 0.2 },
};

const TWIN_TAIL: TailVisualDef = {
  section: { m: 0, p: 0.4, t: 0.1 },
  h: {
    span: TG.hTail.span,
    rootChord: TG.hTail.rootChord,
    tipChord: TG.hTail.tipChord,
    quarterChord: TG.hTail.quarterChord,
    incidence: TG.hTail.incidence,
    kind: 'stabilator',
    chordFraction: 1,
    pivotFraction: 0.27,
    innerCutY: 0,
    // Anti-servo tab across most of the span: it moves the same way as the stabilator, and further.
    tab: { y0: 0.2, y1: 1.7, xc: 0.82, sides: 'both', gearing: 1.5 },
  },
  v: {
    base: TG.vTail.base,
    tip: TG.vTail.tip,
    rootChord: TG.vTail.rootChord,
    tipChord: TG.vTail.tipChord,
    rudderChordFraction: TG.vTail.rudder.chordFraction,
    rudderTab: { h0: 0.2, h1: 0.7, xc: 0.9 },
  },
  tTail: false,
  dorsalFillet: { x0: -2.9, height: 0.45 },
};

const TWIN_KEYS: Key[] = [
  // Closed nose: the table ends in a point.
  [TG.fuselage.noseX, -0.05, 0.05, 0.0, 0.02, 2, 2, 0],
  [3.0, -0.14, 0.17, 0.0, 0.14, 2, 2, 0],
  [2.75, -0.24, 0.29, 0.0, 0.28, 2.1, 2.1, 0],
  [2.3, -0.33, 0.39, -0.02, 0.42, 2.2, 2.2, 0],
  [1.7, -0.4, 0.45, -0.05, 0.53, 2.3, 2.2, 0],
  [1.25, -0.44, 0.47, -0.1, 0.59, 2.4, 2.2, 0],
  [0.8, -0.62, 0.48, -0.15, 0.625, 2.5, 2.2, 0],
  [0.3, -0.76, 0.48, -0.2, 0.635, 2.6, 2.2, 0],
  // Egg-shaped cabin: widest high up, narrowing toward the belly, where the wing meets it.
  [-1.2, -0.78, 0.47, -0.2, 0.635, 2.6, 2.2, 0],
  [-2.2, -0.72, 0.42, -0.2, 0.58, 2.5, 2.2, 0],
  [-3.0, -0.6, 0.31, -0.19, 0.44, 2.3, 2.2, 0],
  [-3.9, -0.44, 0.18, -0.15, 0.28, 2.2, 2.2, 0],
  [-4.8, -0.33, 0.07, -0.12, 0.15, 2.1, 2.1, 0],
  [-5.4, -0.28, -0.02, -0.13, 0.06, 2, 2, 0],
];

const TWIN_HUB = TG.propellers![1].hub;

const twinProp = (side: 1 | -1): PropVisualDef => ({
  hub: [TWIN_HUB.x, side * TWIN_HUB.y, TWIN_HUB.z],
  diameter: TG.propellers![1].diameter,
  blades: 3,
  // Counter-rotating: the right one is the mirror image.
  rotation: side > 0 ? -1 : 1,
  referencePitch: 20 * DEG,
  variablePitch: true,
  chord: [
    [0.1, 0.07],
    [0.25, 0.11],
    [0.45, 0.14],
    [0.7, 0.135],
    [0.9, 0.1],
    [0.97, 0.07],
    [1.0, 0.03],
  ],
  spinner: { baseX: TWIN_HUB.x - 0.03, radius: 0.15, length: 0.34 },
  paint: PROP_PAINT,
});

/** Written for the right side; about its own axis through the propeller hub. */
const TWIN_NACELLE_LOFT: LoftDef = {
  keys: [
    [TWIN_HUB.x - 0.03, -0.15, 0.15, 0.0, 0.15, 2, 2, 0],
    [TWIN_HUB.x - 0.035, -0.2, 0.22, 0.0, 0.24, 2.4, 2.4, 0],
    [TWIN_HUB.x - 0.07, -0.24, 0.28, 0.01, 0.31, 2.6, 2.6, 0],
    [1.45, -0.27, 0.32, 0.02, 0.34, 2.8, 2.8, 0],
    [1.0, -0.29, 0.36, 0.03, 0.36, 2.8, 2.8, 0],
    [0.5, -0.28, 0.36, 0.03, 0.36, 2.6, 2.6, 0],
    [0.0, -0.22, 0.35, 0.05, 0.33, 2.4, 2.4, 0],
    [-0.6, -0.1, 0.3, 0.1, 0.22, 2.2, 2.2, 0],
    [-1.15, 0.05, 0.22, 0.14, 0.07, 2, 2, 0],
  ],
  frontX: TWIN_HUB.x - 0.03,
  endX: -1.15,
  offset: { y: TWIN_HUB.y, z: TWIN_HUB.z },
};

const twinNacelle = (side: 1 | -1): NacelleVisualDef => ({
  loft: TWIN_NACELLE_LOFT,
  side,
  // Two cooling inlets beside the spinner (clear of its 0.15 m backplate) and the induction scoop below it.
  inlets: [
    { y: -0.21, z: -0.08, w: 0.12, h: 0.09, r: 0.03 },
    { y: 0.21, z: -0.08, w: 0.12, h: 0.09, r: 0.03 },
    { y: 0, z: 0.21, w: 0.16, h: 0.06, r: 0.025 },
  ],
  exhaust: { pos: [0.95, TWIN_HUB.y - 0.12, TWIN_HUB.z + 0.33], radius: 0.028 },
  cowlFlaps: [
    {
      hinge: [0.6, TWIN_HUB.y, TWIN_HUB.z + 0.365],
      axis: [0, 1, 0],
      maxAngle: 0.45,
      pts: [
        [0.6, TWIN_HUB.y - 0.13, TWIN_HUB.z + 0.365],
        [0.6, TWIN_HUB.y + 0.13, TWIN_HUB.z + 0.365],
        [0.3, TWIN_HUB.y + 0.13, TWIN_HUB.z + 0.362],
        [0.3, TWIN_HUB.y - 0.13, TWIN_HUB.z + 0.362],
      ],
    },
  ],
});

const TWIN_WHEEL_RADIUS = TG.gear.mainWheelRadius;
/** Height of the belly and of the wing's lower skin where the wells are (the doors lie flush with them). */
const NOSE_WELL_Z = 0.455;
const MAIN_WELL_Z = 0.3;

const twinMain = (contact: { x: number; y: number; z: number }, side: 1 | -1): WheelVisualDef => {
  // Folds inboard into the wing about a fore-and-aft axis: the door hangs on the leg's outboard side.
  const y0 = contact.y - side * 0.95;
  const y1 = contact.y + side * 0.16;
  const rect = (z: number): FRD[] => [
    [contact.x + 0.26, y0, z],
    [contact.x + 0.26, y1, z],
    [contact.x - 0.26, y1, z],
    [contact.x - 0.26, y0, z],
  ];
  return {
    contact: [contact.x, contact.y, contact.z],
    radius: TWIN_WHEEL_RADIUS,
    width: 0.15,
    rimRadius: 0.076,
    leg: { kind: 'oleo', top: [contact.x, contact.y, 0.26], cylinderLen: 0.45, crownAt: 0.6, forkHalf: 0.095, scissors: true, steers: false },
    retract: {
      pivot: [contact.x, contact.y, 0.26],
      axis: [1, 0, 0],
      angle: side * 88 * DEG,
      doors: [{ hinge: [contact.x, y1, MAIN_WELL_Z], axis: [1, 0, 0], angle: -side * 80 * DEG, pts: [
        [contact.x + 0.22, y1, MAIN_WELL_Z],
        [contact.x + 0.22, contact.y - side * 0.2, MAIN_WELL_Z],
        [contact.x - 0.22, contact.y - side * 0.2, MAIN_WELL_Z],
        [contact.x - 0.22, y1, MAIN_WELL_Z],
      ] }],
      well: rect(MAIN_WELL_Z),
    },
  };
};

const TWIN_NOSE: WheelVisualDef = {
  contact: [TG.gear.nose.x, 0, TG.gear.nose.z],
  radius: TG.gear.noseWheelRadius,
  width: 0.14,
  rimRadius: 0.076,
  leg: { kind: 'oleo', top: [TG.gear.nose.x + 0.1, 0, 0.3], cylinderLen: 0.36, crownAt: 0.5, forkHalf: 0.085, scissors: true, steers: true },
  retract: {
    // Folds forward into the nose about the lateral axis; two doors, hinged along the belly either side (the
    // hinge line follows the belly up toward the nose).
    pivot: [TG.gear.nose.x + 0.1, 0, 0.3],
    axis: [0, 1, 0],
    angle: 100 * DEG,
    doors: ([-1, 1] as const).map((side) => ({
      hinge: [2.3, side * 0.15, NOSE_WELL_Z - 0.1] as FRD,
      axis: [1.1, 0, -0.2] as FRD,
      angle: -side * 85 * DEG,
      pts: [
        [2.85, side * 0.15, NOSE_WELL_Z - 0.2],
        [2.85, 0, NOSE_WELL_Z - 0.2],
        [1.75, 0, NOSE_WELL_Z],
        [1.75, side * 0.15, NOSE_WELL_Z],
      ] as FRD[],
    })),
    well: [
      [2.85, -0.15, NOSE_WELL_Z - 0.2],
      [2.85, 0.15, NOSE_WELL_Z - 0.2],
      [1.75, 0.15, NOSE_WELL_Z],
      [1.75, -0.15, NOSE_WELL_Z],
    ],
  },
};

const TWIN_PANEL_X = 0.72;
const TWIN_PANEL_ZTOP = -0.4;
const TWIN_FLOOR_Z = 0.33;
const TWIN_SEAT_Y = 0.29;
/** The quadrant on the pedestal: lever pivots, across it throttles, propellers, mixtures (left engine first). */
const quadrant = (): CockpitDef['engineControls'][number][] => {
  const out: CockpitDef['engineControls'][number][] = [];
  (['throttle', 'propeller', 'mixture'] as const).forEach((control, k) => {
    for (const engine of [0, 1])
      out.push({
        kind: 'lever',
        control,
        engine,
        pos: [TWIN_PANEL_X - 0.2, (k * 2 + engine - 2.5) * 0.028, 0.02],
        travel: 60 * DEG,
        colour: control === 'throttle' ? 'black' : control === 'propeller' ? 'blue' : 'red',
        length: 0.1,
      });
  });
  return out;
};

const TWIN_COCKPIT: CockpitDef = {
  pilotEye: [TG.fuselage.pilotEye.x, TG.fuselage.pilotEye.y, TG.fuselage.pilotEye.z],
  defaultPitchDeg: -7,
  enclosure: 'cabin',
  panel: { x: TWIN_PANEL_X, zTop: TWIN_PANEL_ZTOP, width: 1.1 },
  floor: { z: TWIN_FLOOR_Z, x0: 1.2, x1: -2.0 },
  glareshield: {
    profile: [
      [TWIN_PANEL_X - 0.03, TWIN_PANEL_ZTOP - 0.0015],
      [TWIN_PANEL_X - 0.04, TWIN_PANEL_ZTOP - 0.01],
      [TWIN_PANEL_X - 0.035, TWIN_PANEL_ZTOP - 0.022],
      [TWIN_PANEL_X, TWIN_PANEL_ZTOP - 0.027],
      [1.0, TWIN_PANEL_ZTOP - 0.02],
      [1.2, TWIN_PANEL_ZTOP - 0.01],
      [1.2, TWIN_PANEL_ZTOP + 0.005],
      [TWIN_PANEL_X, TWIN_PANEL_ZTOP - 0.0015],
    ],
    halfWidth: 0.6,
  },
  seats: [
    { x: 0.42, y: -TWIN_SEAT_Y, kind: 'front', width: 0.46, depth: 0.45 },
    { x: 0.42, y: TWIN_SEAT_Y, kind: 'front', width: 0.46, depth: 0.45 },
    { x: -0.75, y: 0, kind: 'bench', width: 1.0, depth: 0.42 },
  ],
  consoles: [
    // Pedestal with the quadrant, and the tunnel between the front seats with the flap lever and the trim wheel.
    { min: [TWIN_PANEL_X - 0.3, -0.1, -0.03], max: [TWIN_PANEL_X + 0.02, 0.1, TWIN_FLOOR_Z], bevel: 0.015, material: 'panelPlastic' },
    { min: [-0.2, -0.07, TWIN_FLOOR_Z - 0.12], max: [TWIN_PANEL_X - 0.3, 0.07, TWIN_FLOOR_Z], bevel: 0.01, material: 'trimPlastic' },
  ],
  trimPanels: [
    { side: 0, x0: 0.7, x1: -0.3, z0: -0.25, z1: 0.25, relief: 0.01, material: 'trimPlastic', armrest: { xa: -0.2, xb: 0.5, zc: -0.05, hz: 0.04, height: 0.05, taper: 0.08 } },
    { side: 0, x0: -0.4, x1: -1.6, z0: -0.25, z1: 0.25, relief: 0.008, material: 'seatFabric' },
  ],
  occupants: [{ seat: 0 }],
  column: { kind: 'yoke', x: TWIN_PANEL_X - 0.2, y: TWIN_SEAT_Y, z: -0.1, travel: 0.07, rollDeg: 45 },
  pedals: { x: TWIN_PANEL_X + 0.16, ys: [-TWIN_SEAT_Y, TWIN_SEAT_Y] },
  engineControls: [
    ...quadrant(),
    // Cowl flap levers low on the pedestal.
    { kind: 'lever', control: 'cowlFlaps', engine: 0, pos: [TWIN_PANEL_X - 0.24, -0.05, 0.2], travel: 40 * DEG, colour: 'white', length: 0.06 },
    { kind: 'lever', control: 'cowlFlaps', engine: 1, pos: [TWIN_PANEL_X - 0.24, 0.05, 0.2], travel: 40 * DEG, colour: 'white', length: 0.06 },
  ],
  flapControl: { kind: 'floorLever', pos: [0.2, 0, TWIN_FLOOR_Z - 0.13], travel: 35 * DEG },
  gearLever: { pos: [TWIN_PANEL_X, -0.12, -0.05] },
  trimWheel: { pos: [0.05, 0, TWIN_FLOOR_Z - 0.1], axis: 'y' },
  lamps: { flood: { pos: [0.35, 0, -0.73], aim: [TWIN_PANEL_X, -0.1, -0.2] }, dome: { pos: [-0.5, 0, -0.74] } },
  box: { floor: TWIN_FLOOR_Z, roof: -0.75, side: 0.61, rear: -2.0, panelX: TWIN_PANEL_X, glareshieldZ: TWIN_PANEL_ZTOP - 0.02, sillZ: -0.43, windscreenX: 1.2, roofGlazed: false },
  glazingPanels: [
    { n: [0.6, 0, -0.8], area: 0.7 },
    { n: [0, -1, 0], area: 0.75 },
    { n: [0, 1, 0], area: 0.75 },
  ],
  interiorArea: 17,
  controlPoints: {},
};

const TWIN_LIVERY: LiveryDef = {
  registration: 'N34SYN',
  palette: { base: [238, 238, 232], band: [120, 24, 30], accent: [30, 30, 34] },
  stripe: {
    xs: [-5.5, -4.5, -3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5, 3.2],
    centre: [-0.16, -0.14, -0.1, -0.06, -0.03, -0.02, -0.02, -0.02, -0.02, -0.02],
    half: [0.02, 0.03, 0.04, 0.045, 0.05, 0.05, 0.05, 0.05, 0.045, 0.03],
    noseShearX: 2.6,
  },
  lettering: { x0: -3.6, x1: -2.3, z0: -0.5, z1: -0.3 },
  construction: 'metal',
  skinJoints: [1.25, -2.2, -3.6],
  floorRivets: { z: 0.2, x1: -2.0 },
  fin: { bandZ0: -0.9, bandX0: -4.6, slope: 0.7, cap: 0.12 },
  texture: { w: 2048, h: 1024 },
};

export const SYNTHETIC_TWIN: AirframeVisualDef = {
  id: 'syn-twin',
  fuselage: {
    keys: TWIN_KEYS,
    frontX: TG.fuselage.noseX,
    endX: -5.4,
    grid: { rows: 150, cols: 96 },
    nose: 'closed',
    inlets: [],
    antennas: [
      { kind: 'blade', pos: [-1.0, 0, -0.77], height: 0.22 },
      { kind: 'whip', pos: [-2.6, 0, -0.66], height: 0.6 },
      { kind: 'stub', pos: [-1.2, 0, 0.465], height: 0.08 },
    ],
  },
  glazing: {
    cabinFrontX: 1.25,
    cabinRearX: -2.0,
    firewallX: 1.25,
    tRange: [0.2, 0.8],
    windows: [
      { pts: [[0.85, -0.3], [0.42, -0.71], [-0.25, -0.71], [-0.25, -0.3]], r: 0.04, sides: 'both' },
      { pts: [[-0.36, -0.3], [-0.36, -0.71], [-1.0, -0.71], [-1.0, -0.3]], r: 0.04, sides: 'both' },
      { pts: [[-1.1, -0.3], [-1.1, -0.7], [-1.65, -0.66], [-1.65, -0.36]], r: 0.05, sides: 'both' },
    ],
    windscreen: { sillC: [1.2, -0.44], sillN: [0.63, 0.777], post: [[0.97, -0.28], [0.5, -0.74]], postY: 0.5, topX: 0.48 },
    doors: [{ pts: [[0.9, 0.2], [0.92, -0.26], [0.45, -0.73], [-0.3, -0.73], [-0.3, 0.2]], r: 0.06, sides: 'right', handle: { x: -0.2, z: -0.22 } }],
    liningRoofLimit: -1e9,
  },
  wing: TWIN_WING,
  tail: TWIN_TAIL,
  gear: [TWIN_NOSE, twinMain(TG.gear.leftMain, -1), twinMain(TG.gear.rightMain, 1)],
  props: [twinProp(-1), twinProp(1)],
  nacelles: [twinNacelle(-1), twinNacelle(1)],
  // Wing-root fillets: a slim body along each root, half sunk in the cabin body and in the wing.
  fairings: [
    {
      keys: [
        [0.95, -0.02, 0.02, 0, 0.02, 2, 2, 0],
        [0.6, -0.1, 0.1, 0, 0.12, 2, 2, 0],
        [-0.3, -0.13, 0.12, 0, 0.17, 2, 2, 0],
        [-1.2, -0.1, 0.08, 0, 0.13, 2, 2, 0],
        [-1.9, -0.02, 0.02, 0, 0.02, 2, 2, 0],
      ],
      frontX: 0.95,
      endX: -1.9,
      offset: { y: 0.5, z: 0.33 },
      grid: { rows: 24, cols: 16 },
      paint: 'base',
      mirror: true,
    },
  ],
  lamps: lamps(
    TWIN_WING,
    TWIN_TAIL,
    // Landing and taxi lights on the nose leg: they fold away with it.
    { id: 'landing', pos: [TG.gear.nose.x + 0.13, -0.06, 0.62], radius: 0.045, glowOffset: [0.02, 0, 0], parent: 'noseGear', aim: { downDeg: 3, outDeg: 0, halfAngleDeg: 9 } },
    { id: 'taxi', pos: [TG.gear.nose.x + 0.13, 0.06, 0.62], radius: 0.045, glowOffset: [0.02, 0, 0], parent: 'noseGear', aim: { downDeg: 7, outDeg: 0, halfAngleDeg: 24 } },
  ),
  cockpit: TWIN_COCKPIT,
  livery: TWIN_LIVERY,
  shadow: { halfX: 6.8, halfY: 6.6, fuselage: [-1.1, 3.0, 0.7], wingX: -0.2, wingY: 4.4, wingHeight: 0.9, restHeight: TG.restHeight },
};

// =================================================================================================================
// Canopy single
// =================================================================================================================

const CG = DA20_GEOMETRY;
const CW = CG.wing;

const CANOPY_WING: WingVisualDef = {
  mount: 'low',
  section: { m: 0.03, p: 0.45, t: 0.15 },
  breaks: CW.breaks!,
  rootY: CW.rootY,
  qcZ: CW.quarterChord.z,
  dihedral: CW.dihedral,
  rootIncidence: CW.rootIncidence,
  tipIncidence: CW.tipIncidence,
  root: 'conform',
  bays: [
    { kind: 'fixed', from: CW.rootY, to: CW.flap.innerY },
    { kind: 'flap', from: CW.flap.innerY, to: CW.flap.outerY, chordFraction: CW.flap.chordFraction },
    { kind: 'aileron', from: CW.aileron.innerY, to: CW.aileron.outerY, chordFraction: CW.aileron.chordFraction },
    { kind: 'fixed', from: CW.aileron.outerY, to: CW.winglet!.rootY! },
  ],
  flap: { maxDeflection: CW.flap.maxDeflection, travelAft: 0.03, travelDown: 0.02 },
  tip: {
    round: 0.1,
    chordRound: 0.1,
    winglet: { height: CW.winglet!.height, cant: CW.winglet!.cant, rootChord: CW.winglet!.rootChord, tipChord: CW.winglet!.tipChord, sweep: CW.winglet!.sweep, section: { m: 0.01, p: 0.4, t: 0.1 } },
  },
  fuelCaps: [],
};

const CANOPY_TAIL: TailVisualDef = {
  section: { m: 0, p: 0.4, t: 0.1 },
  h: {
    span: CG.hTail.span,
    rootChord: CG.hTail.rootChord,
    tipChord: CG.hTail.tipChord,
    quarterChord: CG.hTail.quarterChord,
    tipQuarterChordX: CG.hTail.tipQuarterChordX,
    incidence: CG.hTail.incidence,
    kind: 'elevator',
    chordFraction: CG.hTail.elevator.chordFraction,
    innerCutY: 0,
  },
  v: {
    base: CG.vTail.base,
    tip: CG.vTail.tip,
    rootChord: CG.vTail.rootChord,
    tipChord: CG.vTail.tipChord,
    rudderChordFraction: CG.vTail.rudder.chordFraction,
  },
  tTail: true,
  ventralFin: { x0: -3.3, x1: -4.5, depth: 0.2 },
};

const CANOPY_HUB = CG.propellers![0].hub;
const CANOPY_FRONT_X = CANOPY_HUB.x - 0.03;

const CANOPY_KEYS: Key[] = [
  [CANOPY_FRONT_X, CANOPY_HUB.z - 0.16, CANOPY_HUB.z + 0.16, CANOPY_HUB.z, 0.16, 2, 2, 0],
  [CANOPY_FRONT_X - 0.006, -0.33, 0.12, -0.12, 0.24, 2.3, 2.3, 0],
  [1.72, -0.37, 0.2, -0.11, 0.31, 2.5, 2.5, 0],
  [1.5, -0.4, 0.27, -0.1, 0.37, 2.6, 2.5, 0],
  [1.0, -0.43, 0.33, -0.1, 0.45, 2.6, 2.4, 0],
  [0.6, -0.5, 0.36, -0.1, 0.5, 2.5, 2.4, 0],
  // The pod under the canopy, then the boom.
  [0.1, -0.76, 0.38, -0.12, 0.535, 2.2, 2.4, 0],
  [-0.5, -0.8, 0.38, -0.12, 0.535, 2.2, 2.4, 0],
  [-1.2, -0.7, 0.34, -0.14, 0.48, 2.2, 2.3, 0],
  [-1.9, -0.45, 0.22, -0.16, 0.3, 2.1, 2.2, 0],
  [-2.6, -0.33, 0.06, -0.16, 0.17, 2, 2, 0],
  [-3.6, -0.27, -0.02, -0.15, 0.12, 2, 2, 0],
  [-4.6, -0.24, -0.07, -0.155, 0.085, 2, 2, 0],
  [-5.0, -0.22, -0.1, -0.16, 0.06, 2, 2, 0],
];

const CANOPY_PANEL_X = 0.55;
const CANOPY_PANEL_ZTOP = -0.42;
const CANOPY_FLOOR_Z = 0.3;
const CANOPY_SEAT_Y = 0.25;

const CANOPY_COCKPIT: CockpitDef = {
  pilotEye: [CG.fuselage.pilotEye.x, CG.fuselage.pilotEye.y, CG.fuselage.pilotEye.z],
  defaultPitchDeg: -9,
  enclosure: 'canopy',
  // A low panel: the upper 624 px of the canvas at 0.9 m.
  panel: { x: CANOPY_PANEL_X, zTop: CANOPY_PANEL_ZTOP, width: 0.9, pxRect: { x: 0, y: 0, w: 2080, h: 624 } },
  floor: { z: CANOPY_FLOOR_Z, x0: 0.95, x1: -1.1 },
  glareshield: {
    profile: [
      [CANOPY_PANEL_X - 0.03, CANOPY_PANEL_ZTOP - 0.0015],
      [CANOPY_PANEL_X - 0.04, CANOPY_PANEL_ZTOP - 0.01],
      [CANOPY_PANEL_X - 0.03, CANOPY_PANEL_ZTOP - 0.022],
      [CANOPY_PANEL_X + 0.05, CANOPY_PANEL_ZTOP - 0.027],
      [0.9, CANOPY_PANEL_ZTOP - 0.015],
      [0.9, CANOPY_PANEL_ZTOP - 0.003],
      [CANOPY_PANEL_X, CANOPY_PANEL_ZTOP - 0.0015],
    ],
    halfWidth: 0.45,
  },
  // Fixed, reclined seats low in the tub.
  seats: [
    { x: 0.05, y: -CANOPY_SEAT_Y, kind: 'front', width: 0.42, depth: 0.45, reclineDeg: 24, z: 0.1 },
    { x: 0.05, y: CANOPY_SEAT_Y, kind: 'front', width: 0.42, depth: 0.45, reclineDeg: 24, z: 0.1 },
  ],
  consoles: [{ min: [-0.5, -0.045, 0.02], max: [CANOPY_PANEL_X, 0.045, CANOPY_FLOOR_Z], bevel: 0.012, material: 'panelPlastic' }],
  trimPanels: [],
  occupants: [{ seat: 0 }, { seat: 1 }],
  column: { kind: 'stick', pivot: [0.2, 0, 0.2], height: 0.36, pitchDeg: 14, rollDeg: 14, ys: [-CANOPY_SEAT_Y, CANOPY_SEAT_Y] },
  pedals: { x: CANOPY_PANEL_X + 0.2, ys: [-CANOPY_SEAT_Y, CANOPY_SEAT_Y] },
  engineControls: [
    { kind: 'lever', control: 'throttle', engine: 0, pos: [0.2, -0.02, 0.02], travel: 55 * DEG, colour: 'black', length: 0.09 },
    { kind: 'lever', control: 'mixture', engine: 0, pos: [0.2, 0.02, 0.02], travel: 55 * DEG, colour: 'red', length: 0.09 },
    { kind: 'knob', control: 'alternateAir', engine: 0, pos: [CANOPY_PANEL_X, 0.3, -0.2], travel: 0.04, colour: 'white' },
  ],
  flapControl: { kind: 'panelSwitch', pos: [CANOPY_PANEL_X, 0.2, -0.2], travel: 40 * DEG },
  lamps: { flood: { pos: [CANOPY_PANEL_X - 0.02, 0, CANOPY_PANEL_ZTOP - 0.005], aim: [CANOPY_PANEL_X, 0, -0.25] } },
  box: { floor: CANOPY_FLOOR_Z, roof: -0.78, side: 0.5, rear: -1.1, panelX: CANOPY_PANEL_X, glareshieldZ: CANOPY_PANEL_ZTOP - 0.02, sillZ: -0.4, windscreenX: 0.95, roofGlazed: true },
  glazingPanels: [
    { n: [0, 0, -1], area: 1.1 },
    { n: [0.6, 0, -0.8], area: 0.6 },
    { n: [0, -1, 0], area: 0.55 },
    { n: [0, 1, 0], area: 0.55 },
  ],
  interiorArea: 7,
  controlPoints: {},
};

export const SYNTHETIC_CANOPY: AirframeVisualDef = {
  id: 'syn-canopy',
  fuselage: {
    keys: CANOPY_KEYS,
    frontX: CANOPY_FRONT_X,
    endX: -5.0,
    grid: { rows: 140, cols: 88 },
    nose: 'prop',
    inlets: [
      { y: 0.2, z: CANOPY_HUB.z + 0.02, w: 0.12, h: 0.08, r: 0.03, exponent: 3, xMin: CANOPY_FRONT_X - 0.08, baffleX: CANOPY_FRONT_X - 0.15 },
      { y: -0.2, z: CANOPY_HUB.z + 0.02, w: 0.12, h: 0.08, r: 0.03, exponent: 3, xMin: CANOPY_FRONT_X - 0.08, baffleX: CANOPY_FRONT_X - 0.15 },
    ],
    exhaust: { pos: [1.2, 0.1, 0.3], radius: 0.025 },
    antennas: [{ kind: 'blade', pos: [-1.9, 0, -0.44], height: 0.2 }],
  },
  glazing: {
    cabinFrontX: 1.0,
    cabinRearX: -1.2,
    firewallX: 1.0,
    tRange: [0.2, 0.8],
    // The canopy: one outline from the sill to above the roof, between the front and the rear bow.
    windows: [{ pts: [[0.93, -0.36], [0.55, -1.2], [-1.12, -1.2], [-1.12, -0.3], [0.62, -0.3]], r: 0.06, sides: 'both' }],
    doors: [],
    liningRoofLimit: -1e9,
  },
  wing: CANOPY_WING,
  tail: CANOPY_TAIL,
  gear: [
    {
      contact: [CG.gear.nose.x, 0, CG.gear.nose.z],
      radius: CG.gear.noseWheelRadius,
      width: 0.11,
      rimRadius: 0.06,
      // Castering nose wheel on a spring tube from the firewall.
      leg: { kind: 'springTube', root: [1.0, 0, 0.3], axleOffset: 0, r0: 0.026, r1: 0.02 },
      fairing: { length: 0.7, halfWidth: 0.09, top: 0.19, bottom: 0.11 },
    },
    ...([-1, 1] as const).map((side): WheelVisualDef => {
      const contact = side < 0 ? CG.gear.leftMain : CG.gear.rightMain;
      return {
        contact: [contact.x, contact.y, contact.z],
        radius: CG.gear.mainWheelRadius,
        width: 0.13,
        rimRadius: 0.064,
        leg: { kind: 'leafSpring', root: [contact.x, side * 0.3, 0.33], width: 0.15, thickness: 0.028 },
        fairing: { length: 0.85, halfWidth: 0.1, top: 0.21, bottom: 0.12 },
      };
    }),
  ] as unknown as AirframeVisualDef['gear'],
  props: [
    {
      hub: [CANOPY_HUB.x, CANOPY_HUB.y, CANOPY_HUB.z],
      diameter: CG.propellers![0].diameter,
      blades: 2,
      rotation: 1,
      referencePitch: 17 * DEG,
      variablePitch: false,
      chord: [
        [0.1, 0.07],
        [0.3, 0.12],
        [0.6, 0.13],
        [0.9, 0.09],
        [1.0, 0.03],
      ],
      spinner: { baseX: CANOPY_FRONT_X, radius: 0.14, length: 0.24 },
      paint: PROP_PAINT,
    },
  ],
  nacelles: [],
  lamps: lamps(
    CANOPY_WING,
    CANOPY_TAIL,
    { id: 'landing', pos: [CANOPY_FRONT_X - 0.02, -0.1, 0.1], radius: 0.04, glowOffset: [0.02, 0, 0], aim: { downDeg: 3, outDeg: 0, halfAngleDeg: 9 } },
    { id: 'taxi', pos: [CANOPY_FRONT_X - 0.02, 0.1, 0.1], radius: 0.04, glowOffset: [0.02, 0, 0], aim: { downDeg: 7, outDeg: 0, halfAngleDeg: 24 } },
  ),
  cockpit: CANOPY_COCKPIT,
  livery: {
    registration: 'D-ESYN',
    palette: { base: [244, 244, 240], band: [20, 60, 120], accent: [200, 40, 30] },
    stripe: {
      xs: [-5.1, -4.0, -3.0, -2.0, -1.0, 0.0, 1.0, 1.9],
      centre: [-0.15, -0.14, -0.13, -0.1, 0.02, 0.05, 0.05, 0.04],
      half: [0.012, 0.015, 0.018, 0.025, 0.035, 0.035, 0.035, 0.03],
      noseShearX: 1.6,
    },
    lettering: { x0: -3.7, x1: -2.7, z0: -0.28, z1: -0.1 },
    construction: 'composite',
    skinJoints: [],
    fin: { bandZ0: -0.5, bandX0: -4.3, slope: 0.6, cap: 0.1 },
    texture: { w: 2048, h: 1024 },
  },
  shadow: { halfX: 6.0, halfY: 6.0, fuselage: [-1.2, 2.6, 0.55], wingX: -0.3, wingY: 4.0, wingHeight: 0.9, restHeight: CG.restHeight },
};

/** The synthetic airframes by id (dev/aircraft.html?type=). */
export const SYNTHETIC_AIRFRAMES: Readonly<Record<string, AirframeVisualDef>> = {
  [SYNTHETIC_TWIN.id]: SYNTHETIC_TWIN,
  [SYNTHETIC_CANOPY.id]: SYNTHETIC_CANOPY,
};
