// Cabin interior seen from the pilot eye: instrument panel face (texture from the instruments module),
// glareshield, lower panel and pedestal, floor, four seats, door trim, the two yokes (fore-aft with
// elevator input, rotating with aileron input), rudder pedals, throttle (black) and mixture (red)
// push-pull knobs, flap lever, elevator trim wheel and the magnetic compass under the windscreen header.
//
// The layout is the cockpit of the airframe definition (CockpitDef: panel face, glareshield, seats, consoles,
// trim panels, column, pedals, engine controls, flap lever, trim wheel, compass, lamps) and the panel
// definition drawn on the face (PanelDef: gauge recesses, rocker switches, key, dimmers). The Cessna 172S
// layout (body axes, m) is tuned from the pilot eye in C172.fuselage.pilotEye so that, looking level with a
// 60-75 degree field of view, the glareshield lip sits ~11 degrees below the horizon and the cowling top ~6
// degrees below it: panel, glareshield and cowling fill the lower ~40 % of the view as in the real aircraft.
// Fittings only some types have (defroster outlets, the fuel selector's knobs, sun visors, cabin-air vents, the
// overhead console, door latches) are built where the definition's `fittings` put them, and not otherwise.
// Variants: centre sticks instead of yokes, quadrant levers instead of push-pull knobs, a flap switch or a
// floor lever, a gear selector; a canopy cockpit is seen from outside, so its small controls are never hidden.
// Throttle quadrants, pedestals and consoles (CockpitDef.quadrant), the knob library, the knurled trim wheels and the
// placards are built by quadrant.ts.

import { BallCompass } from './compass';
import type { CompassReading } from '../../instruments/dynamics/magneticCompass';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { C172S_PANEL } from '../../aircraft/c172s/panel';
import { C172S_VISUAL } from '../../aircraft/c172s/visual';
import { engineControl, type AircraftId, type AircraftState, type ControlInputs } from '../../core/types';
import { SCENE_UNITS_PER_LUX } from '../../core/context';
import type { CockpitDef } from './airframe/types';
import { cabinLamps, cockpitAdaptation } from './cabinLight';
import { addCabinTrim, projectTrimUv } from './cabinTrim';
import { sectionHalfWidth } from './fuselage';
import { FuselageShape, Ring } from './fuselageShape';
import { frd, MeshBatch } from './geometry';
import type { AircraftMaterials } from './materials';
import { PANEL_HEIGHT, PANEL_WIDTH } from '../../instruments/layout';
import type { PanelDef } from '../../instruments/panelDef';
import { PanelRecess, panelRecesses } from './panelMaterial';
import { columnBoot, StickColumn, YokeColumn, yokeMaterial, yokeStyle, type ControlColumn } from './yoke';
import type { PointTarget } from '../../training/types';
import { addQuadrant, buildPlunger, buildQuadrantLever, PlacardAtlas, trimWheelParts } from './quadrant';

/**
 * The flat instrument panel face of a cockpit definition: vertical, facing aft, centred on the aircraft
 * centreline. It shows `rect` of the panel canvas (px; default the whole canvas) at pxPerM, so its height
 * follows from its width.
 */
export interface PanelFace {
  x: number;
  zTop: number;
  width: number;
  height: number;
  pxPerM: number;
  rect: { x: number; y: number; w: number; h: number };
  /** The whole panel canvas, px. */
  canvas: { w: number; h: number };
}

export function panelFace(panel: CockpitDef['panel'], canvas: { w: number; h: number } = { w: PANEL_WIDTH, h: PANEL_HEIGHT }): PanelFace {
  const rect = panel.pxRect ?? { x: 0, y: 0, w: canvas.w, h: canvas.h };
  const pxPerM = rect.w / panel.width;
  return { x: panel.x, zTop: panel.zTop, width: panel.width, height: rect.h / pxPerM, pxPerM, rect, canvas };
}

/** Model-space position (cockpit group local: x right, y up, z aft, m) of a panel canvas pixel on the face, `dz` proud of it. */
function facePoint(face: PanelFace, px: number, py: number, dz = 0): THREE.Vector3 {
  const c = frd(face.x, 0, face.zTop + face.height / 2);
  return new THREE.Vector3(c.x + ((px - face.rect.x) / face.rect.w - 0.5) * face.width, c.y + (0.5 - (py - face.rect.y) / face.rect.h) * face.height, c.z + dz);
}

const C172S_FACE = panelFace(C172S_VISUAL.cockpit.panel, C172S_PANEL.size);
/** Instrument panel face of the Cessna 172S: 1.04 m x 0.40 m, vertical, facing aft, centred on the aircraft centreline. */
export const PANEL = { x: C172S_FACE.x, width: C172S_FACE.width, height: C172S_FACE.height, zTop: C172S_FACE.zTop } as const;
/** Cabin floor of the Cessna 172S (top of the carpet): ~1.2 m below the headliner, ~0.26 m below the front seat cushions. */
export const FLOOR_Z = C172S_VISUAL.cockpit.floor.z;
const PEDAL_SWING = 0.22;
/**
 * Flood intensity at full dimmer, candela: ~5 lx on the panel face 0.75 m away, falling with the square of
 * the dimmer (~1.5 lx at the usual 0.6). At night pilots keep it just bright enough to read switch labels
 * and placards without spoiling their dark adaptation; the displays themselves are 20-200 cd/m2.
 */
const FLOOD_CD = 5;
/**
 * Share of the flood's flux that enters the cabin's bounce, relative to a surface of the cabin's mean albedo
 * (cabinLight.CABIN_ALBEDO, ~0.25): the beam falls on the panel face and glareshield (~0.03) and partly on the
 * yokes, the pilots' knees and the switch row, ~0.05 overall (agent estimate).
 */
const FLOOD_FIRST_BOUNCE = 0.2;
/**
 * Backlighting dimmer below its usual day setting (agent choice, night-sky review round 2): from DIMMER_KNEE down
 * the backlight falls with the square of the knob, to 0 at 0, as a real lighting dimmer reaches far below its
 * linear range (a night panel is set to ~1 cd/m2 markings, not the 2 cd/m2 floor the linear curve had).
 * At and over the knee the curve is unchanged.
 */
const DIMMER_KNEE = 0.6;
function dimmerLow(level: number): number {
  return level >= DIMMER_KNEE ? 1 : (Math.max(level, 0) / DIMMER_KNEE) ** 2;
}
/**
 * The lit compass card's brightness for a panel dimmer setting, as a share of full: linear down to DIMMER_KNEE
 * (with the aeroplanes' floor of DIMMER_KNEE over it), the low-dimmer curve under it. `aeroplane` keeps the
 * aeroplanes' curve, flat at 1 over the knee; the helicopters keep their linear one there (unchanged by day)
 * and share the aeroplanes' under it (agent choice: their compass was ~3.6x the aeroplanes' at a night setting).
 */
export function compassLight(level: number, aeroplane = true): number {
  return (aeroplane || level < DIMMER_KNEE ? Math.max(level, DIMMER_KNEE) : level) * dimmerLow(level);
}
/**
 * Electrical power share of the panel lighting for a bus voltage on a `nominal` (14 or 28) V system: 0 below
 * 18/28 of nominal, full from 24/28 of it (18-24 V on a 28 V bus, 9-12 V on a 14 V one).
 */
export function panelPower(busVoltage: number, nominal = 28): number {
  const v = nominal === 28 ? busVoltage : (busVoltage * 28) / nominal;
  return Math.min(1, Math.max(0, (v - 18) / 6));
}
/** Dome light over the rear seats and its intensity, candela. */
const DOME_POS = { x: -0.55, y: 0, z: -0.605 };
const DOME_CD = 6;
/** Warm white of incandescent / 3000 K LED interior lamps (linear RGB, unit luminance). */
const LAMP_WHITE = new THREE.Color(1.0, 0.8, 0.6).multiplyScalar(1 / (0.2126 + 0.7152 * 0.8 + 0.0722 * 0.6));
/**
 * Red cockpit flood: the same lamp behind a red filter that passes its red and ~10 % / ~3 % of its green and blue
 * (linear RGB; ~0.33 of the white lamp's luminance). Agent estimate: a red flood at the same setting is dimmer, and
 * a red normalised to the white's luminance clipped the red channel of anything near the lamp (the PA38's
 * deviation card).
 */
const LAMP_RED = new THREE.Color(LAMP_WHITE.r, LAMP_WHITE.g * 0.1, LAMP_WHITE.b * 0.033);
/** The flood's cone half-angles when the definition gives none, degrees: outer edge and full-intensity core. */
const FLOOD_CONE: readonly [number, number] = [44, 24];
/** Glareshield top (model y) the flood mask uses when the definition gives none: the Cessna 172S's. */
const FLOOD_MASK_TOP = 0.29;

/**
 * RoundedBoxGeometry comes unindexed: 324 / 900 / 1764 vertices for 1 / 2 / 3 segments, each baked for the
 * cabin occlusion, so the cabin keeps to 1-2 segments (welding them costs more main-thread time than it saves).
 */
function roundedBox(w: number, h: number, d: number, segments: number, r: number): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, segments, r);
}

/** A floor flap lever's grip centre from its pivot, m. */
const FLOOR_LEVER_GRIP = 0.3;
/** How long a built hand primer takes over one stroke, s (out and back in). */
const PRIMER_STROKE_TIME = 0.8;

/** Box in body coordinates (centre FRD, size along FRD x, y, z). */
function box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, r = 0.008, segments = 2): THREE.BufferGeometry {
  const g = roundedBox(sy, sz, sx, segments, Math.min(r, sx / 2, sy / 2, sz / 2) * 0.99);
  const c = frd(cx, cy, cz);
  g.translate(c.x, c.y, c.z);
  return g;
}

/** Cylinder along body x (fore-aft) centred at a body point. */
function rodX(cx: number, cy: number, cz: number, len: number, r: number, seg = 16): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  const c = frd(cx, cy, cz);
  g.translate(c.x, c.y, c.z);
  return g;
}

/** Cylinder along body y (across the cabin) centred at a body point. */
function rodY(cx: number, cy: number, cz: number, len: number, r: number, seg = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  const c = frd(cx, cy, cz);
  g.translate(c.x, c.y, c.z);
  return g;
}

/** Short cylinder along body z (vertical) centred at a body point. */
function rodZ(cx: number, cy: number, cz: number, len: number, r: number, seg = 24): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  const c = frd(cx, cy, cz);
  g.translate(c.x, c.y, c.z);
  return g;
}

/**
 * Extrude a profile drawn in the body x-z plane (points [x, z]) across the cabin from y0 to y1.
 * Used for the glareshield and the lower panel.
 */
function extrudeProfile(profile: readonly (readonly [number, number])[], y0: number, y1: number, bevel = 0.01): THREE.BufferGeometry {
  const shape = new THREE.Shape(profile.map(([x, z]) => new THREE.Vector2(-x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: y1 - y0 - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 3,
    curveSegments: 8,
  });
  // Shape (a, b) = (-x, -z) and extrusion e: model (X, Y, Z) = (y, -z, -x) = (e + y0 + bevel, b, a).
  const m = new THREE.Matrix4().set(0, 0, 1, y0 + bevel, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
  g.applyMatrix4(m);
  return flipWinding(g);
}

/**
 * Reverse the triangle winding of a non-indexed geometry. The profile-to-model mapping above swaps two axes
 * (a mirror), which turns the extrusion inside out: without this the far faces are the ones drawn.
 */
function flipWinding(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    const n = a.itemSize;
    const arr = a.array as Float32Array;
    for (let t = 0; t + 2 < a.count; t += 3) {
      for (let k = 0; k < n; k++) {
        const i1 = (t + 1) * n + k;
        const i2 = (t + 2) * n + k;
        const v = arr[i1];
        arr[i1] = arr[i2];
        arr[i2] = v;
      }
    }
  }
  return g;
}

/** Clearance kept between the glareshield and the inside of the fuselage skin, m. */
export const GLARESHIELD_SKIN_CLEARANCE = 0.008;

/**
 * The glareshield hood: the profile extruded across the cabin, then fitted to the cabin. The cabin narrows
 * toward the cowling and rounds over at the windscreen base, so each vertex's |y| is limited to the skin's
 * half width at its own (x, z) less GLARESHIELD_SKIN_CLEARANCE: the hood's ends follow the inside of the
 * skin instead of poking out through it at the windscreen's lower corners.
 * @param skin the outer skin shape (fuselageShape: inset 0)
 * @param hood the hood of the cockpit definition: its profile in the body x-z plane (panel-top lip, padded top,
 *             and forward under the windscreen) and its half width (default: the Cessna 172S)
 */
export function glareshieldGeometry(skin: FuselageShape, hood: CockpitDef['glareshield'] = C172S_VISUAL.cockpit.glareshield): THREE.BufferGeometry {
  const GLARESHIELD_HALF_WIDTH = hood.halfWidth;
  // Densify the long edges so the fitted ends can follow the skin's curvature between profile points.
  const dense: [number, number][] = [];
  const P = hood.profile;
  for (let i = 0; i < P.length; i++) {
    const [x0, z0] = P[i];
    const [x1, z1] = P[(i + 1) % P.length];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.03));
    for (let k = 0; k < n; k++) dense.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
  }
  // No bevel (it would fold over where the ends are pulled in), and ~7 cm steps across the cabin so the
  // per-vertex cabin occlusion can grade across the hood top.
  const shape = new THREE.Shape(dense.map(([x, z]) => new THREE.Vector2(-x, -z)));
  const W = 2 * GLARESHIELD_HALF_WIDTH;
  const g = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false, steps: 14, curveSegments: 1 });
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -GLARESHIELD_HALF_WIDTH, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  flipWinding(g);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const rings = new Map<number, Ring>();
  for (let i = 0; i < pos.count; i++) {
    // Model (X, Y, Z) = FRD (y, -z, -x).
    const x = -pos.getZ(i);
    const key = Math.round(x * 1e4);
    let ring = rings.get(key);
    if (!ring) rings.set(key, (ring = new Ring().set(skin.section(x))));
    // Below the roof line too (the bevel reaches ~1 cm above the profile at the hood's forward tip).
    const zTop = ring.z[(ring.z.length - 1) >> 1] + 1.5 * GLARESHIELD_SKIN_CLEARANCE;
    const z = Math.max(-pos.getY(i), zTop);
    pos.setY(i, -z);
    const limit = Math.max(0, sectionHalfWidth(skin, x, z, ring) - GLARESHIELD_SKIN_CLEARANCE);
    // Scale across rather than clamp: the ends land on the skin and the steps stay evenly spread.
    pos.setX(i, pos.getX(i) * Math.min(1, limit / GLARESHIELD_HALF_WIDTH));
  }
  g.computeVertexNormals();
  return g;
}

// ---- Control positions (exported for the Flight School's callouts and camera glance) -------------------------

/**
 * Model-space position (cockpit group local: x right, y up, z aft, m) of a panel pixel (instruments/layout.ts),
 * on the Cessna 172S panel face: the same mapping the panel mesh, the rockers and the magneto key use.
 */
export function panelPixelToModel(px: number, py: number): { x: number; y: number; z: number } {
  const v = facePoint(C172S_FACE, px, py);
  return { x: v.x, y: v.y, z: v.z };
}

/** The rocker switches a lesson can point at: PointTarget -> SwitchDef.id of the panel definition. */
const SWITCH_TARGETS: readonly (readonly [PointTarget, string])[] = [
  ['alternator', 'alternator'],
  ['avionics', 'avionics'],
  ['fuelPump', 'fuelPump'],
  ['beacon', 'beacon'],
  ['landingLight', 'landing'],
  ['taxiLight', 'taxi'],
  ['navLights', 'nav'],
  ['strobes', 'strobe'],
  ['pitotHeat', 'pitotHeat'],
];

/**
 * Every control and instrument the instructor can point at (training/types.ts PointTarget), model space.
 * Panel items come from the panel definition (switch row, key, dimmers, the instruments' highlight spots);
 * the levers, knobs and the trim wheel from where the cockpit definition has them (knobs at mid travel); what
 * has no 3D part from its `controlPoints`.
 */
export function cockpitControls(cockpit: CockpitDef, panel: PanelDef): Readonly<Record<PointTarget, { x: number; y: number; z: number }>> {
  const face = panelFace(cockpit.panel, panel.size);
  const out: Record<string, { x: number; y: number; z: number }> = {};
  const fromFrd = (x: number, y: number, z: number): { x: number; y: number; z: number } => {
    const v = frd(x, y, z);
    return { x: v.x, y: v.y, z: v.z };
  };
  const fromPx = (px: number, py: number): { x: number; y: number; z: number } => {
    const v = facePoint(face, px, py);
    return { x: v.x, y: v.y, z: v.z };
  };
  const row = panel.switchRow;
  /** Centre height of the rocker row, panel px. */
  const rowY = row.bounds.y + row.rockerTop + row.rockerH / 2;
  const master = row.switches.filter((s) => s.group === 'master');
  if (master.length === 2) out.master = fromPx(row.bounds.x + (master[0].x + master[1].x) / 2, rowY);
  for (const [target, id] of SWITCH_TARGETS) {
    const sw = row.switches.find((s) => s.id === id);
    if (sw) out[target] = fromPx(row.bounds.x + sw.x, rowY);
  }
  if (row.dimmers) out.panelLights = fromPx(row.bounds.x + row.dimmers.panel, row.bounds.y + row.dimmers.y);
  out.magnetos = fromPx(panel.ignition.at[0], panel.ignition.at[1]);
  for (const e of cockpit.engineControls) {
    // (A lever drawn fixed, such as the PC-12's manual override, is not the one the instructor means.)
    if (e.engine === 0 && e.fixed === undefined && (e.control === 'throttle' || e.control === 'mixture')) {
      // A quadrant library lever (quadrant.ts): its knob at mid travel; otherwise just aft of the pivot / shaft.
      if (e.knob && e.kind === 'lever') {
        const a = e.tilt ?? 0;
        const l = e.length ?? 0.11;
        out[e.control] = fromFrd(e.pos[0] - l * Math.sin(a), e.pos[1], e.pos[2] - l * Math.cos(a));
      } else out[e.control] = fromFrd(e.pos[0] - 0.04, e.pos[1], e.pos[2]);
    }
  }
  const flap = cockpit.flapControl.pos;
  // A floor lever: at its grip, forward of its pivot.
  out.flapLever = fromFrd(flap[0] + (cockpit.flapControl.kind === 'floorLever' ? FLOOR_LEVER_GRIP : -0.045), flap[1], flap[2]);
  if (cockpit.trimWheel) out.trimWheel = fromFrd(cockpit.trimWheel.pos[0], cockpit.trimWheel.pos[1], cockpit.trimWheel.pos[2]);
  for (const [id, p] of Object.entries(cockpit.controlPoints)) out[id] = fromFrd(p[0], p[1], p[2]);
  // The pilot's (left) seat.
  const column = cockpit.column;
  if (column.kind === 'yoke') out.yoke = fromFrd(column.x, -column.y, column.z);
  else out.yoke = fromFrd(column.pivot[0], column.ys[0], column.pivot[2] - column.height);
  out.rudderPedals = fromFrd(cockpit.pedals.x - 0.05, cockpit.pedals.ys[0], cockpit.floor.z - 0.18);
  out.toeBrakes = fromFrd(cockpit.pedals.x - 0.02, cockpit.pedals.ys[0], cockpit.floor.z - 0.24);
  // Instruments: the dial centres (ui/school/highlight.ts rings use the same pixels).
  for (const [id, spot] of Object.entries(panel.spots)) out[id] = fromPx(spot.x, spot.y);
  return out as Record<PointTarget, { x: number; y: number; z: number }>;
}

/**
 * The Cessna 172S positions. The fuel selector and the parking brake handle, which have no 3D part, are where
 * they are in a C172S: the selector on the floor at the foot of the pedestal, the brake handle under the left of
 * the panel.
 */
export const COCKPIT_CONTROLS: Readonly<Record<PointTarget, { x: number; y: number; z: number }>> = cockpitControls(C172S_VISUAL.cockpit, C172S_PANEL);

/**
 * Round instruments set into the panel, in panel-mesh space: (x, y) centre, glass aperture radius, and how far
 * the dial sits behind the panel face (m). Which gauges are round, how large and how deep is the panel
 * definition's (gaugeRecess: the 3-1/8" instruments are mounted from behind with the dial ~14 mm back, the
 * 2-1/4" ones ~10 mm).
 */
function panelGauges(face: PanelFace, panel: PanelDef): THREE.Vector4[] {
  return panelRecesses(panel, (px, py) => facePoint(face, px, py), face.pxPerM);
}


export class Cockpit {
  readonly group = new THREE.Group();
  readonly panelMesh: THREE.Mesh;
  /** Cabin-only materials created here (the cabin occlusion patch applies to them). */
  get ownMaterials(): THREE.MeshStandardMaterial[] {
    const own = [this.panelMat];
    if (this.hasWindows) own.push(this.windowMat);
    if (this.compass) own.push(...this.compass.materials);
    own.push(this.visorMat, this.rockerMat, this.yokeMat);
    if (this.knobBlue) own.push(this.knobBlue);
    if (this.placards.material.map) own.push(this.placards.material);
    return own;
  }
  private readonly panelMat: THREE.MeshStandardMaterial;
  /** The panel canvas on quads off the face (CockpitDef.panel.windows): lit, and self-lit like the dial markings. */
  private readonly windowMat = new THREE.MeshStandardMaterial({ name: 'panelWindow', color: 0x2c2e32, roughness: 0.55, metalness: 0 });
  private hasWindows = false;
  /** Vertex-coloured plastic of the yokes and sticks (yoke.ts). */
  private readonly yokeMat = yokeMaterial();
  /** Smoked, tinted polycarbonate of the sun visors. */
  private readonly visorMat = new THREE.MeshStandardMaterial({ name: 'sunVisor', color: new THREE.Color().setRGB(0.035, 0.028, 0.02), roughness: 0.18 });
  /** The quadrant's and trim indicators' placards, printed once into one atlas (quadrant.ts). */
  private readonly placards = new PlacardAtlas();
  /** The cockpit of the airframe definition, its panel face and the rocker switches of the panel definition. */
  private readonly def: CockpitDef;
  private readonly face: PanelFace;
  private readonly switches: { x: number; red: boolean; on(c: ControlInputs): boolean }[];
  /** Centre height of the rocker row, panel px. */
  private readonly rockerRowY: number;
  private readonly columns: ControlColumn[] = [];
  private readonly pedals: { obj: THREE.Group; sign: 1 | -1 }[] = [];
  /** Engine controls: push-pull knobs sliding aft as they are pulled, quadrant levers swinging about their pivots. */
  private readonly knobs: { group: THREE.Group; def: CockpitDef['engineControls'][number] }[] = [];
  /** Levers drawn at a fixed position (`fixed`): never animated, but small controls like the others. */
  private readonly fixedLevers: THREE.Group[] = [];
  private readonly flapLever = new THREE.Group();
  /** The built hand primer's plunger, its rest position (three z) and the stroke it is showing. */
  private readonly primer: { group: THREE.Group; z0: number; strokes: number; strokeAt: number } | null = null;
  private readonly gearLever: THREE.Group | null = null;
  private readonly trimWheel: THREE.Group | null = null;
  /** The trim indicator's sliding pointer (an indicator with a take-off band) and the slot it slides along. */
  private readonly trimPointer: { group: THREE.Group; centre: THREE.Vector3; along: THREE.Vector3; travel: number } | null = null;
  private readonly fuelHandle: THREE.Group | null = null;
  private readonly brakeHandle: THREE.Group | null = null;
  private readonly compass?: BallCompass;
  /** Blue propeller-lever knobs (made when the definition has one). */
  private knobBlue: THREE.MeshStandardMaterial | null = null;
  private hasPanelTexture = false;
  private readonly rockers: THREE.InstancedMesh;
  private rockerBase: THREE.Vector3[] = [];
  private readonly rockerState: Int8Array;
  private readonly rockerMat = new THREE.MeshStandardMaterial({ name: 'rocker', roughness: 0.45 });
  private readonly rockerM = new THREE.Matrix4();
  private readonly rockerPivot = new THREE.Matrix4();
  private readonly rockerRow = new THREE.Vector3();
  private readonly magnetoKey = new THREE.Group();
  /** True once the instruments module's own self-illumination map is in use (exact backlight mask). */
  private dedicatedEmissive = false;
  /**
   * Gain on the dial markings of the dedicated emissive map relative to the displays: the markings follow dimmerLow
   * below DIMMER_KNEE while the displays, radios and annunciators keep the linear 20-200 cd/m2 with its floor
   * (agent choice, night-sky final gate). 1 at and over the knee.
   */
  private readonly panelDial = { value: 1 };
  /** The panel flood: intensity at full dimmer (cd) and colour (unit luminance). */
  private readonly floodCd: number;
  private readonly floodLamp: THREE.Color;

  /**
   * @param floor cabin floor geometry fitted to the lining (see fuselage.cabinFloorGeometry)
   * @param shapes the outer skin and the cabin lining (fuselage.createFuselageShapes); interior parts near
   *               the skin are fitted inside it, the trim panels to the lining
   * @param def the cockpit of the airframe definition (default: the Cessna 172S)
   * @param panelDef the instrument panel drawn on the face: its round gauges are recessed, its rocker
   *               switches, key and dimmer knobs stand on it (default: the Cessna 172S panel)
   */
  constructor(
    mat: AircraftMaterials,
    floor: THREE.BufferGeometry,
    shapes: { outer: FuselageShape; lining: FuselageShape } = { outer: new FuselageShape(0), lining: new FuselageShape(0.015, -0.63) },
    def: CockpitDef = C172S_VISUAL.cockpit,
    panelDef: PanelDef = C172S_PANEL,
    aircraft: AircraftId = 'c172s',
    /** Nominal bus voltage, V (AirframeVisualDef.nominalVoltage). */
    private readonly nominalVoltage = 28,
  ) {
    const skin = shapes.outer;
    const flood = def.lamps.flood;
    this.floodCd = flood.cd ?? FLOOD_CD;
    this.floodLamp = flood.colour === 'red' ? LAMP_RED : LAMP_WHITE;
    this.group.name = 'cockpit';
    this.def = def;
    const PANEL = (this.face = panelFace(def.panel, panelDef.size));
    const PANEL_ZB = PANEL.zTop + PANEL.height;
    const FLOOR_Z = def.floor.z;
    const column = def.column;
    const fittings = def.fittings ?? {};
    const PEDAL_X = def.pedals.x;
    const FLOOD_POS = def.lamps.flood.pos;
    const DOME_POS = def.lamps.dome?.pos;
    const row = panelDef.switchRow;
    this.switches = row.switches.map((s) => ({ x: row.bounds.x + s.x, red: s.red ?? false, on: s.on }));
    this.rockerRowY = row.bounds.y + row.rockerTop + row.rockerH / 2;
    this.rockerState = new Int8Array(this.switches.length);
    const PANEL_GAUGES = panelGauges(PANEL, panelDef);
    // A shift across the face, m, becomes one of the texture coordinate over the whole canvas.
    const recess = new PanelRecess(PANEL_GAUGES, { w: PANEL.canvas.w / PANEL.pxPerM, h: PANEL.canvas.h / PANEL.pxPerM });
    Cockpit.initLamps(def, PANEL);
    const fixed = new MeshBatch();

    // --- Panel face ---
    this.panelMat = new THREE.MeshStandardMaterial({ name: 'instrumentPanel', color: 0x2c2e32, roughness: 0.7, metalness: 0 });
    // Only the markings, pointers and displays are backlit: the emissive map is masked by texel brightness,
    // so the grey faceplate and black dials stay dark at night (a few percent stand in for the glareshield
    // flood light spilling on the faceplate).
    // With a dedicated emissive map from the instruments module (setPanelEmissiveTexture) the map is used
    // as is: it is already black where nothing glows.
    this.panelMat.onBeforeCompile = (shader) => {
      recess.patch(shader);
      // The dedicated map carries the dial faces at 0.1 x their near-black paint (~0.002 linear); at night
      // exposure that still reads as grey faces. Real faces are black paint behind the lit markings, so
      // texels below a small floor do not glow (markings are ~0.09, displays up to 1). Without it the colour
      // map is masked by brightness (a few percent stand in for light spilling on the faceplate).
      // With the dedicated map the dial markings (at PANEL_DIAL_LIGHT, 0.1 of the displays) take the low-dimmer
      // curve (panelDial, dimmerLow) and the displays and annunciators (~1) keep their own floor.
      const mask = this.dedicatedEmissive
        ? 'smoothstep( 0.006, 0.03, emissivePeak ) * mix( panelDial, 1.0, smoothstep( 0.12, 0.25, emissivePeak ) )'
        : '( 0.03 + 0.97 * smoothstep( 0.12, 0.45, emissivePeak ) )';
      if (this.dedicatedEmissive) {
        shader.uniforms.panelDial = this.panelDial;
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float panelDial;');
      }
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, panelUv );
	float emissivePeak = max( emissiveColor.r, max( emissiveColor.g, emissiveColor.b ) );
	totalEmissiveRadiance *= emissiveColor.rgb * ${mask} * ( 1.0 - panelWall );
#endif
`,
      );
    };
    // The shader text depends on the number of recesses and on the face (the program cache does not see it).
    const faceKey = `${PANEL_GAUGES.length}|${PANEL.width}x${PANEL.height}@${PANEL.pxPerM}`;
    this.panelMat.customProgramCacheKey = () => `${this.dedicatedEmissive ? 'panelEmissiveMap' : 'panelBacklightMask'}|${faceKey}`;
    // Tessellated so the per-vertex cabin occlusion (cabinLight.ts) can grade across the face.
    const plane = new THREE.PlaneGeometry(PANEL.width, PANEL.height, 26, 10);
    // PlaneGeometry faces +Z (model aft) with u to +X (pilot's right) and v to +Y (up): exactly the contract.
    // A face that shows only part of the canvas maps its texture coordinates onto that part.
    if (def.panel.pxRect) {
      const uv = plane.getAttribute('uv') as THREE.BufferAttribute;
      const { rect, canvas } = PANEL;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (rect.x + uv.getX(i) * rect.w) / canvas.w, 1 - (rect.y + (1 - uv.getY(i)) * rect.h) / canvas.h);
    }
    const pc = frd(PANEL.x, 0, PANEL.zTop + PANEL.height / 2);
    plane.translate(pc.x, pc.y, pc.z);
    this.panelMesh = new THREE.Mesh(plane, this.panelMat);
    this.panelMesh.name = 'instrumentPanel';
    this.panelMesh.receiveShadow = true;
    // The recess parallax needs the eye in the panel's own space for the camera actually rendering.
    recess.bind(this.panelMesh);
    this.group.add(this.panelMesh);
    // Parts of the canvas off the face, on quads of their own (the Tomahawk's fuel gauges on the quadrant's tilted housing).
    for (const w of def.panel.windows ?? []) {
      const g = new THREE.PlaneGeometry(w.w, w.h);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      const { canvas } = PANEL;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (w.px.x + uv.getX(i) * w.px.w) / canvas.w, 1 - (w.px.y + (1 - uv.getY(i)) * w.px.h) / canvas.h);
      const n = new THREE.Vector3(w.normal[1], -w.normal[2], -w.normal[0]).normalize();
      const up = new THREE.Vector3(w.up[1], -w.up[2], -w.up[0]).projectOnPlane(n).normalize();
      const right = new THREE.Vector3().crossVectors(up, n);
      g.applyMatrix4(new THREE.Matrix4().makeBasis(right, up, n).setPosition(frd(w.centre[0], w.centre[1], w.centre[2])));
      fixed.add(this.windowMat, g);
      this.hasWindows = true;
    }
    // Panel backing box (so the panel has thickness at its edges) and bezel lip under the glareshield.
    fixed.add(mat.panelPlastic, box(PANEL.x + 0.03, 0, PANEL.zTop + PANEL.height / 2, 0.055, PANEL.width - 0.004, PANEL.height - 0.004, 0.004));

    // --- Glareshield: padded hood from the panel top forward to the windscreen base ---
    fixed.add(mat.glareshield, glareshieldGeometry(skin, def.glareshield));

    // Defroster outlets on the glareshield top just aft of the windscreen.
    // (The Cessna 172S: hood top at x 0.88 is z -0.247; the cabin there is ~0.36 m half wide at that height.)
    for (const d of fittings.defrosters ?? []) fixed.add(mat.black, box(d[0], d[1], d[2], 0.022, 0.2, 0.004, 0.0015));

    // --- Interior furniture: the lower (knee) panel, the centre pedestal, the fuel selector's plate ---
    for (const c of def.consoles) {
      if (c.profile) fixed.add(mat[c.material], extrudeProfile(c.profile, c.min[1], c.max[1], c.bevel));
      else fixed.add(mat[c.material], box((c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2, (c.min[2] + c.max[2]) / 2, c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2], c.bevel));
    }
    // The throttle quadrant / pedestal / console of the shared builder: housings, slotted covers, fittings, placards.
    if (def.quadrant) addQuadrant(fixed, mat, def, this.placards);

    // --- Floor, seats, door trim ---
    fixed.add(mat.carpet, floor);
    for (const seat of def.seats) {
      const recline = seat.reclineDeg === undefined ? 0.21 : (seat.reclineDeg * Math.PI) / 180;
      this.addSeat(fixed, mat, seat.x, seat.y, seat.width, seat.depth, seat.kind !== 'bench', recline, seat.z ?? FLOOR_Z - 0.265, seat.kind === 'shell', seat.back);
    }
    // Fuel selector (LEFT / BOTH / RIGHT, set to BOTH) and the red fuel shut-off valve knob on the floor
    // between the front seats (on the plate among the consoles).
    const selector = fittings.fuelSelector;
    if (selector) {
      fixed.add(mat.knobWhite, rodZ(selector.x, selector.y, FLOOR_Z - 0.013, 0.004, 0.045, 28));
      fixed.add(mat.knobBlack, box(selector.x, selector.y, FLOOR_Z - 0.03, 0.11, 0.022, 0.03, 0.008));
      if (selector.shutoffX !== undefined) fixed.add(mat.knobRed, rodZ(selector.shutoffX, selector.y, FLOOR_Z - 0.02, 0.03, 0.014, 16));
    }
    // Door panels, kick panels, carpeted sidewalls and toe boards, rear and baggage-bay trim.
    addCabinTrim(fixed, mat, shapes.lining, FLOOR_Z, def.trimPanels, fittings);

    // --- Overhead: tinted sun visors folded up under the headliner, the wing-root fresh-air vents in the
    // upper cabin corners, and the dome light ---
    const visors = fittings.visors;
    for (const y of visors?.ys ?? []) {
      fixed.add(this.visorMat, box(visors!.x, y, visors!.z, 0.25, 0.33, 0.007, 0.006));
      // Hinge rod and its two clips at the header.
      fixed.add(mat.darkMetal, rodY(visors!.x + 0.13, y, visors!.z - 0.005, 0.34, 0.005));
      for (const s of [-1, 1]) fixed.add(mat.trimPlastic, box(visors!.x + 0.13, y + s * 0.16, visors!.z - 0.008, 0.025, 0.02, 0.012, 0.004));
    }
    for (const vent of fittings.vents ?? []) {
      const side = vent[1] < 0 ? -1 : 1;
      // Round bezel on the sloping upper corner, with a pull-out nozzle pointing down and inboard.
      const b = new MeshBatch();
      b.add(mat.trimPlastic, new THREE.CylinderGeometry(0.03, 0.034, 0.01, 28));
      b.add(mat.knobBlack, new THREE.CylinderGeometry(0.015, 0.017, 0.035, 20).translate(0, -0.018, 0));
      b.add(mat.knobBlack, new THREE.TorusGeometry(0.0155, 0.003, 8, 20).rotateX(Math.PI / 2).translate(0, -0.036, 0));
      const g = b.build('vent');
      // Axis: from the corner toward the cabin (down and inboard).
      const axis = frd(0, -side * 0.55, 0.83).normalize();
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), axis);
      frd(vent[0], vent[1], vent[2], g.position);
      g.updateMatrix();
      for (const child of [...g.children]) {
        const m = child as THREE.Mesh;
        m.geometry.applyMatrix4(g.matrix);
        fixed.add(m.material as THREE.Material, m.geometry);
      }
    }
    const overhead = fittings.overhead;
    if (overhead) {
      if (DOME_POS) {
        fixed.add(mat.trimPlastic, rodZ(DOME_POS[0], 0, overhead.z, 0.012, 0.05));
        fixed.add(mat.knobWhite, rodZ(DOME_POS[0], 0, overhead.z + 0.012, 0.004, 0.036));
      }
      // Overhead console with the panel flood light between the front seats.
      fixed.add(mat.trimPlastic, box(FLOOD_POS[0] - 0.06, 0, overhead.z + 0.005, 0.2, 0.09, 0.022, 0.008));
      fixed.add(mat.knobWhite, box(FLOOD_POS[0], 0, FLOOD_POS[2] + 0.001, 0.025, 0.04, 0.004, 0.0015));
    }

    if (def.compass) {
      this.compass = new BallCompass(def.compass.pos, aircraft, def.compass.mount);
      this.group.add(this.compass.group);
    }

    // --- Yokes or sticks ---
    if (column.kind === 'yoke') {
      for (const y of [-column.y, column.y]) this.columns.push(new YokeColumn(mat, this.yokeMat, column, y));
      this.group.add(...this.columns.map((c) => c.group));
      // Shaft boots where the columns enter the panel.
      for (const y of [-column.y, column.y]) fixed.add(mat.black, columnBoot(yokeStyle(column), PANEL.x, y, column.z));
    } else {
      for (const y of column.ys) this.columns.push(new StickColumn(mat, this.yokeMat, column, y));
      this.group.add(...this.columns.map((c) => c.group));
    }

    // --- Rudder pedals (hinged at the floor, swinging fore-aft) ---
    // 14 cm forward of the panel face: their toe-brake tops (z ~0.34) show below the lower panel edge from
    // the pilot's eye, as in the aircraft (a line from the eye to a pedal top passes ~4 cm under the panel).
    for (const yc of def.pedals.ys) {
      // Rudder bar tube across each pilot's pair, on the floor pivots.
      fixed.add(mat.darkMetal, rodY(PEDAL_X, yc, FLOOR_Z - 0.012, 0.3, 0.011));
      for (const side of [-1, 1] as const) {
        const pivot = new THREE.Group();
        frd(PEDAL_X, yc + side * 0.095, FLOOR_Z - 0.012, pivot.position);
        const pb = new MeshBatch();
        const arm = new THREE.BoxGeometry(0.018, 0.2, 0.02);
        arm.translate(0, 0.1, 0);
        pb.add(mat.darkMetal, arm);
        // Rudder pedal pad and, hinged above it, the toe-brake pad with its ribbed rubber tread.
        const plate = roundedBox(0.075, 0.075, 0.014, 2, 0.006);
        plate.rotateX(-0.35);
        plate.translate(0, 0.135, 0.012);
        pb.add(mat.black, plate);
        const toe = roundedBox(0.075, 0.06, 0.016, 2, 0.006);
        toe.rotateX(-0.5);
        toe.translate(0, 0.2, 0.03);
        pb.add(mat.black, toe);
        for (let k = 0; k < 4; k++) {
          const rib = new THREE.BoxGeometry(0.068, 0.005, 0.004);
          rib.rotateX(-0.5);
          rib.translate(0, 0.182 + k * 0.012, 0.04 + k * 0.0065);
          pb.add(mat.knobBlack, rib);
        }
        // Brake master cylinder from the toe brake forward to the firewall.
        const cyl = new THREE.CylinderGeometry(0.011, 0.011, 0.15, 12);
        cyl.rotateX(Math.PI / 2 - 0.35);
        cyl.translate(0, 0.19, -0.075);
        pb.add(mat.darkMetal, cyl);
        pivot.add(...pb.build('pedal').children);
        this.pedals.push({ obj: pivot, sign: side });
        this.group.add(pivot);
      }
    }

    // --- Switch row: rocker switches, magneto key, dimmer knobs (over their painted positions) ---
    this.rockers = this.buildRockers();
    this.group.add(this.rockers);
    const px = (x: number, y: number, dz = 0): THREE.Vector3 => facePoint(PANEL, x, y, dz);
    // Magneto/starter switch: chrome escutcheon and a key that turns with the selected position.
    const mag = px(panelDef.ignition.at[0], panelDef.ignition.at[1]);
    fixed.add(mat.chrome, new THREE.CylinderGeometry(0.016, 0.017, 0.004, 28).rotateX(Math.PI / 2).translate(mag.x, mag.y, mag.z + 0.002));
    fixed.add(mat.knobBlack, new THREE.CylinderGeometry(0.011, 0.012, 0.01, 24).rotateX(Math.PI / 2).translate(mag.x, mag.y, mag.z + 0.009));
    const key = new MeshBatch();
    key.add(mat.knobBlack, roundedBox(0.009, 0.03, 0.012, 2, 0.003).translate(0, 0, 0.018));
    this.magnetoKey.add(...key.build('magnetoKey').children);
    this.magnetoKey.position.copy(mag);
    this.group.add(this.magnetoKey);
    // Panel and radio light dimmers: small knurled knobs.
    for (const x of row.dimmers ? [row.dimmers.panel, row.dimmers.radio] : []) {
      const k = px(row.bounds.x + x, row.bounds.y + row.dimmers!.y);
      fixed.add(mat.knobBlack, new THREE.CylinderGeometry(0.0085, 0.009, 0.012, 20).rotateX(Math.PI / 2).translate(k.x, k.y, k.z + 0.006));
    }

    // --- Engine and flap controls on the lower panel ---
    const blue = (): THREE.MeshStandardMaterial => (this.knobBlue ??= new THREE.MeshStandardMaterial({ name: 'knobBlue', color: new THREE.Color().setRGB(0.03, 0.09, 0.4), roughness: 0.45 }));
    for (const e of def.engineControls) {
      const knobMat = e.colour === 'black' ? mat.knobBlack : e.colour === 'red' ? mat.knobRed : e.colour === 'white' ? mat.knobWhite : e.colour === 'grey' ? mat.trimPlastic : blue();
      const g = new THREE.Group();
      // A knob or lever of the quadrant builder's library (its slots and marks are the quadrant's); else the generic one.
      if (e.knob) {
        if (e.kind === 'knob') buildPlunger(g, fixed, mat, knobMat, e);
        else buildQuadrantLever(g, mat, knobMat, e);
        if (!def.quadrant && e.kind === 'lever') addLeverMarks(fixed, mat, e, def.consoles);
      }
      // The mixture knob is ribbed (told by touch from the smooth throttle).
      else if (e.kind === 'knob') this.buildKnob(g, knobMat, mat, e.pos, e.control === 'mixture');
      else {
        this.buildLever(g, knobMat, mat, e.pos, e.length ?? 0.11, e.fixed !== undefined ? 'fixed' : e.control);
        addLeverMarks(fixed, mat, e, def.consoles);
      }
      // A lever drawn fixed (not modelled) stands where it is put and is never animated.
      if (e.kind === 'lever' && e.fixed !== undefined) {
        g.rotation.x = e.travel * (1 - e.fixed - 0.5);
        this.group.add(g);
        this.fixedLevers.push(g);
      } else this.knobs.push({ group: g, def: e });
    }
    for (const k of this.knobs) this.group.add(k.group);
    const FLAP = def.flapControl.pos;
    const lever = new MeshBatch();
    if (def.flapControl.kind === 'panelLever') {
      // Flap lever: slot plate plus lever with an airfoil-shaped knob.
      fixed.add(mat.black, box(FLAP[0] - 0.004, FLAP[1], FLAP[2] + 0.055, 0.006, 0.03, 0.13, 0.003));
      lever.add(mat.darkMetal, box(-0.02, 0, 0, 0.04, 0.008, 0.008, 0.002));
      lever.add(mat.knobWhite, box(-0.045, 0, 0, 0.02, 0.05, 0.022, 0.008));
    } else if (def.flapControl.kind === 'panelSwitch') {
      // Flap switch: a flap-shaped paddle on a small escutcheon, tilting with the selected position.
      fixed.add(mat.black, box(FLAP[0] - 0.003, FLAP[1], FLAP[2], 0.004, 0.04, 0.06, 0.002));
      lever.add(mat.darkMetal, box(-0.012, 0, 0, 0.024, 0.006, 0.006, 0.002));
      lever.add(mat.knobWhite, box(-0.03, 0, 0, 0.016, 0.034, 0.012, 0.004));
    } else {
      // Hand lever between the seats, lying forward from its pivot with a grip and release button at its end.
      lever.add(mat.darkMetal, box(0.17, 0, -0.03, 0.34, 0.022, 0.014, 0.005));
      lever.add(mat.black, rodX(FLOOR_LEVER_GRIP, 0, -0.03, 0.12, 0.017, 14));
      lever.add(mat.knobWhite, rodX(0.366, 0, -0.03, 0.012, 0.008, 10));
    }
    this.flapLever.add(...lever.build('flapLever').children);
    frd(FLAP[0], FLAP[1], FLAP[2], this.flapLever.position);
    this.group.add(this.flapLever);
    if (def.primer) {
      // The hand primer: a chrome hex bushing nut over its painted knob, and the plunger sliding aft out of it, a chrome
      // shaft and a fluted metal knob with an index bar across its face that turns with the lock.
      const p = frd(def.primer.pos[0], def.primer.pos[1], def.primer.pos[2]);
      fixed.add(mat.chrome, new THREE.CylinderGeometry(0.0105, 0.011, 0.006, 6).rotateX(Math.PI / 2).translate(p.x, p.y, p.z + 0.003));
      const g = new THREE.Group();
      const b = new MeshBatch();
      b.add(mat.chrome, new THREE.CylinderGeometry(0.003, 0.003, 0.08, 10).rotateX(Math.PI / 2).translate(0, 0, -0.03));
      b.add(mat.aluminium, new THREE.CylinderGeometry(0.0105, 0.0115, 0.016, 20).rotateX(Math.PI / 2).translate(0, 0, 0.014));
      b.add(mat.chrome, new THREE.CylinderGeometry(0.0085, 0.0085, 0.002, 20).rotateX(Math.PI / 2).translate(0, 0, 0.0225));
      b.add(mat.black, new THREE.BoxGeometry(0.014, 0.0025, 0.0016).translate(0, 0, 0.0238));
      g.add(...b.build('primer').children);
      g.position.copy(p);
      this.group.add(g);
      this.primer = { group: g, z0: p.z, strokes: NaN, strokeAt: -Infinity };
    }
    if (def.gearLever) {
      // Gear selector: a short lever standing out of the face with a wheel-shaped knob.
      const g = (this.gearLever = new THREE.Group());
      const b = new MeshBatch();
      b.add(mat.darkMetal, box(-0.022, 0, 0, 0.044, 0.006, 0.006, 0.002));
      b.add(mat.knobWhite, rodY(-0.05, 0, 0, 0.014, 0.017, 20));
      g.add(...b.build('gearLever').children);
      frd(def.gearLever.pos[0], def.gearLever.pos[1], def.gearLever.pos[2], g.position);
      this.group.add(g);
    }
    const fuel = def.fuelSelectorHandle;
    if (fuel) {
      // Fuel selector on the quadrant face: a white tick at each position round a black boss, and a bright
      // pointer handle (its tip white) that turns to the selected one.
      // On a face leaning back by `tilt`, the whole selector is turned back about the lateral axis.
      const [fx, fy, fz] = fuel.pos;
      const tilt = fuel.tilt ?? 0;
      for (const deg of Object.values(fuel.angles)) {
        const a = (deg * Math.PI) / 180;
        const tick = box(-0.001, 0, -(fuel.tickR ?? 0.048), 0.003, 0.004, 0.012, 0.001);
        tick.rotateZ(-a);
        tick.rotateX(-tilt);
        tick.translate(fy, -fz, -fx);
        fixed.add(mat.knobWhite, tick);
      }
      const b = new MeshBatch();
      b.add(mat.knobBlack, rodX(-0.006, 0, 0, 0.012, 0.022, 24));
      if (fuel.colour === 'red') {
        // A red pointer, broad at the boss and tapering to its tip, with a short tail.
        const outline = [[-0.006, -0.018], [0.006, -0.018], [0.011, 0], [0.0035, 0.046], [-0.0035, 0.046], [-0.011, 0]].map(([x, y]) => new THREE.Vector2(x, y));
        const pointer = new THREE.ExtrudeGeometry(new THREE.Shape(outline), { depth: 0.007, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2 });
        pointer.deleteAttribute('uv');
        b.add(mat.knobRed, pointer.translate(0, 0, 0.0135));
        b.add(mat.knobWhite, box(-0.0225, 0, -0.038, 0.002, 0.005, 0.008, 0.0008));
      } else {
        b.add(mat.chrome, box(-0.018, 0, -0.012, 0.014, 0.016, 0.06, 0.005));
        b.add(mat.knobWhite, box(-0.025, 0, -0.038, 0.002, 0.008, 0.01, 0.001));
      }
      const g = (this.fuelHandle = new THREE.Group());
      g.add(...b.build('fuelSelector').children);
      if (tilt) {
        const mount = new THREE.Group();
        mount.rotation.x = -tilt;
        mount.add(g);
        frd(fx, fy, fz, mount.position);
        this.group.add(mount);
      } else {
        frd(fx, fy, fz, g.position);
        this.group.add(g);
      }
    }
    const brake = def.parkingBrakeHandle;
    if (brake) {
      // Parking brake: a T-handle on a shaft out of the face, pulled aft when set.
      const b = new MeshBatch();
      b.add(mat.darkMetal, rodX(-0.02, 0, 0, 0.04, 0.004, 10));
      b.add(mat.knobBlack, rodY(-0.042, 0, 0, 0.06, 0.008, 14));
      const g = (this.brakeHandle = new THREE.Group());
      g.add(...b.build('parkingBrake').children);
      frd(brake.pos[0], brake.pos[1], brake.pos[2], g.position);
      this.group.add(g);
    }
    if (def.trimWheel) {
      // Knurled trim wheel (quadrant.ts) in its moulding, protruding through the pedestal's face or beside it.
      const { wheel, pointer } = trimWheelParts(mat, def.trimWheel, fixed, this.placards);
      const trim = (this.trimWheel = new THREE.Group());
      const meshes = wheel.build('trimWheel').children as THREE.Mesh[];
      // A wheel turning about the body x axis: the same wheel a quarter turn round the vertical.
      if (def.trimWheel.axis === 'x') for (const m of meshes) m.geometry.rotateY(Math.PI / 2);
      trim.add(...meshes);
      const TRIM = def.trimWheel.pos;
      frd(TRIM[0], TRIM[1], TRIM[2], trim.position);
      this.group.add(trim);
      if (pointer) {
        const group = new THREE.Group();
        group.add(...pointer.batch.build('trimPointer').children);
        group.position.copy(pointer.centre);
        this.group.add(group);
        this.trimPointer = { group, centre: pointer.centre, along: pointer.along, travel: pointer.travel };
      }
    }

    this.placards.build(fixed);
    const built = fixed.build('cabinFixed', { cast: false, receive: true });
    // Leather, carpet and plastic grain at the same scale on every part.
    const textured = new Set<THREE.Material>([mat.seatFabric, mat.carpet, mat.trimPlastic, mat.panelPlastic]);
    for (const m of built.children as THREE.Mesh[]) if (textured.has(m.material as THREE.Material)) projectTrimUv(m.geometry);
    this.group.add(built);
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.receiveShadow = true;
    });
  }

  /**
   * A seat with its cushion front edge at body x and centred at y: leather facings with pleated inserts
   * (rolls with stitched grooves between them) on the cushion and the back, side bolsters, and on the front
   * seats the headrest and the unworn harness. The rear bench (front = false) is two places wide.
   * @param recline of the seat back from upright, rad
   * @param cushionTop height of the cushion's top (FRD z)
   * @param back a lower back (fewer rolls, the harness from below its top) and a front seat without its headrest
   */
  private addSeat(batch: MeshBatch, mat: AircraftMaterials, x: number, y: number, width: number, depth: number, front: boolean, recline = 0.21, cushionTop = 0.3, shell = false,
                  back?: { height?: number; headrest?: boolean }): void {
    const FLOOR_Z = this.def.floor.z;
    batch.add(mat.seatFabric, box(x - depth / 2, y, cushionTop + 0.05, depth, width, 0.1, 0.04));
    // Rolled front edge of the cushion (thigh support).
    batch.add(mat.seatFabric, rodY(x - 0.035, y, cushionTop + 0.01, width - 0.04, 0.035, 16));
    // Pleated cushion insert: fore-aft rolls, four per place.
    const places = front ? [0] : [-width / 4, width / 4];
    const rollW = 0.074;
    for (const pc of places)
      for (let k = 0; k < 4; k++) {
        const oy = pc + (k - 1.5) * (rollW + 0.006);
        batch.add(mat.seatFabric, box(x - depth / 2 - 0.02, y + oy, cushionTop - 0.008, depth - 0.12, rollW, 0.026, 0.012, 1));
      }
    // Seat back, reclined ~12 degrees: a centre panel with its pleated insert between raised side bolsters,
    // and on the front seats the integral headrest. Built upright about the seat pivot (seat-back frame:
    // x across, y up the back, -z forward), then reclined together.
    const parts: THREE.BufferGeometry[] = [];
    // A seat shell's back runs on up into its head section.
    const backH = back?.height ?? (shell ? 0.78 : front ? 0.6 : 0.56);
    // A back of its own height carries the pleated rolls that fit under its top.
    const rolls = back?.height === undefined ? 6 : Math.max(1, Math.min(6, Math.floor((backH - 0.114) / 0.086) + 1));
    const panel = roundedBox(width - 0.1, backH, 0.08, 2, 0.03);
    panel.translate(0, backH / 2, 0);
    parts.push(panel);
    for (const pc of places)
      for (let k = 0; k < rolls; k++) {
        const roll = roundedBox(front ? width - 0.18 : width / 2 - 0.12, 0.078, 0.026, 1, 0.012);
        roll.translate(pc, 0.075 + k * (0.078 + 0.008), -0.04);
        parts.push(roll);
      }
    for (const s of [-1, 1]) {
      const bolster = roundedBox(0.075, backH - 0.04, 0.13, 2, 0.035);
      bolster.rotateY(-s * 0.18);
      bolster.translate(s * (width / 2 - 0.04), backH / 2, -0.02);
      parts.push(bolster);
    }
    if (!front) {
      // Centre divider between the two rear places.
      const div = roundedBox(0.06, backH - 0.06, 0.1, 2, 0.03);
      div.translate(0, backH / 2, -0.015);
      parts.push(div);
    }
    const straps: THREE.BufferGeometry[] = [];
    if (front) {
      if (!shell && back?.headrest !== false) {
        const head = roundedBox(0.26, 0.17, 0.09, 2, 0.04);
        head.translate(0, 0.7, -0.005);
        parts.push(head);
        // Headrest posts.
        for (const s of [-1, 1]) parts.push(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 8).translate(s * 0.08, 0.6, 0));
      }
      // Unworn shoulder harness lying diagonally over the seat back, from the outboard upper corner down to
      // the inboard side of the cushion junction.
      const out = Math.sign(y);
      const a = new THREE.Vector3(out * (width / 2 - 0.1), back?.height === undefined ? 0.56 : Math.min(0.56, backH - 0.04), -0.07);
      const c = new THREE.Vector3(-out * 0.1, 0.04, -0.07);
      const d = new THREE.Vector3().subVectors(c, a);
      const strap = new THREE.BoxGeometry(0.045, d.length(), 0.004);
      strap.translate(0, d.length() / 2, 0);
      strap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
      strap.translate(a.x, a.y, a.z);
      straps.push(strap);
    }
    const base = frd(x - depth - 0.02, y, cushionTop);
    for (const [g, m] of [...parts.map((g) => [g, mat.seatFabric] as const), ...straps.map((g) => [g, mat.carpet] as const)]) {
      // Recline: the top of the back goes aft (+Z in model space).
      g.rotateX(recline);
      g.translate(base.x, base.y, base.z);
      batch.add(m, g);
    }
    if (front) {
      // Lap belt lying across the cushion with its buckle on the inboard side.
      batch.add(mat.carpet, box(x - depth * 0.6, y, cushionTop - 0.024, 0.045, width - 0.06, 0.006, 0.002));
      batch.add(mat.chrome, box(x - depth * 0.6, y - Math.sign(y) * 0.1, cushionTop - 0.028, 0.05, 0.04, 0.01, 0.003));
    }
    // Seat frame from the cushion pan down to its floor rails, and the rails (a shell sits on the tub itself).
    if (shell) return;
    const pan = cushionTop + 0.1;
    for (const s of [-1, 1]) {
      const yy = y + s * Math.min(0.1, width * 0.18);
      batch.add(mat.darkMetal, box(x - depth / 2, yy, (pan + FLOOR_Z) / 2, depth * 0.85, 0.03, FLOOR_Z - pan, 0.008));
      if (front) batch.add(mat.aluminium, box(x - depth / 2, yy, FLOOR_Z - 0.006, depth + 0.3, 0.025, 0.012, 0.003));
    }
  }

  /** The rocker switches of the panel definition as one instanced mesh (one draw), each tilted by its switch state. */
  private buildRockers(): THREE.InstancedMesh {
    const ROCKERS = this.switches;
    const face = this.face;
    // Rocker 12 x 21 mm, standing ~6 mm proud of the face, slightly rounded; the painted rocker is underneath.
    const g = roundedBox(0.0115, 0.0205, 0.012, 2, 0.0025);
    const c = frd(face.x, 0, face.zTop + face.height / 2);
    const rowY = facePoint(face, 0, this.rockerRowY).y;
    const rowX = facePoint(face, (ROCKERS[0].x + ROCKERS[ROCKERS.length - 1].x) / 2, 0).x;
    // The geometry sits at the row centre so the cabin occlusion bake (per base vertex) samples the right spot.
    g.translate(rowX, rowY, c.z);
    this.rockerRow.set(rowX, rowY, c.z);
    const m = new THREE.InstancedMesh(g, this.rockerMat, ROCKERS.length);
    m.name = 'rockers';
    const red = new THREE.Color().setRGB(0.42, 0.03, 0.03);
    const white = new THREE.Color().setRGB(0.62, 0.62, 0.6);
    ROCKERS.forEach((r, i) => m.setColorAt(i, r.red ? red : white));
    this.rockerBase = ROCKERS.map((r) => new THREE.Vector3(facePoint(face, r.x, 0).x - rowX, 0, 0));
    this.rockerState.fill(-1);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    return m;
  }

  private poseRockers(controls: ControlInputs): void {
    let changed = false;
    this.switches.forEach((r, i) => {
      const on = r.on(controls) ? 1 : 0;
      if (on === this.rockerState[i]) return;
      this.rockerState[i] = on;
      changed = true;
      // ON: the upper half pressed in. The rocker pivots on the panel face; the base geometry sits at the row
      // centre P0, so M = T(P0 + offset) * R * T(-P0).
      const tilt = (on ? -1 : 1) * 0.2;
      const p0 = this.rockerRow;
      this.rockerM.makeTranslation(-p0.x, -p0.y, -p0.z);
      this.rockerPivot.makeRotationX(tilt);
      this.rockerM.premultiply(this.rockerPivot);
      this.rockerPivot.makeTranslation(p0.x + this.rockerBase[i].x, p0.y, p0.z);
      this.rockers.setMatrixAt(i, this.rockerM.premultiply(this.rockerPivot));
    });
    if (changed) this.rockers.instanceMatrix.needsUpdate = true;
  }

  /** Push-pull knob on a shaft coming out of the panel at `pos`; the group slides aft as the control is pulled. */
  private buildKnob(g: THREE.Group, knobMat: THREE.Material, mat: AircraftMaterials, pos: readonly [number, number, number], ribbed: boolean): void {
    frd(pos[0], pos[1], pos[2], g.position);
    const b = new MeshBatch();
    const shaft = new THREE.CylinderGeometry(0.0045, 0.0045, 0.12, 10);
    shaft.rotateX(Math.PI / 2);
    b.add(mat.chrome, shaft);
    const knob = new THREE.CylinderGeometry(0.02, 0.022, 0.028, ribbed ? 20 : 28);
    knob.rotateX(Math.PI / 2);
    knob.translate(0, 0, 0.074);
    b.add(knobMat, knob);
    g.add(...b.build('knob').children);
  }

  /**
   * Quadrant lever pivoted at `pos`, standing up out of its quadrant; the group swings fore and aft about the
   * lateral axis. The throttle has a round knob, the propeller lever a notched one, the mixture a ribbed one (told
   * apart by touch).
   */
  private buildLever(g: THREE.Group, knobMat: THREE.Material, mat: AircraftMaterials, pos: readonly [number, number, number], length: number, control: string): void {
    frd(pos[0], pos[1], pos[2], g.position);
    const b = new MeshBatch();
    b.add(mat.darkMetal, new THREE.BoxGeometry(0.005, length, 0.012).translate(0, length / 2, 0));
    // A fixed (unmodelled) lever has a small flat T-grip.
    const knob =
      control === 'throttle'
        ? new THREE.SphereGeometry(0.017, 14, 10)
        : control === 'propeller'
          ? new THREE.CylinderGeometry(0.017, 0.017, 0.022, 8).rotateZ(Math.PI / 2)
          : control === 'fixed'
            ? roundedBox(0.03, 0.012, 0.016, 1, 0.004)
            : roundedBox(0.022, 0.03, 0.026, 1, 0.005);
    b.add(knobMat, knob.translate(0, length, 0));
    g.add(...b.build('lever').children);
  }

  /** Filter the cockpit's instrument textures (the compass card and placard) at `n`x anisotropy. */
  setTextureAnisotropy(n: number): void {
    this.compass?.setAnisotropy(n);
    this.placards.setAnisotropy(n);
  }

  /** Apply the instrument texture: u to the pilot's right, v up. It is lit and also self-illuminated. */
  setPanelTexture(texture: THREE.Texture): void {
    this.windowMat.map = texture;
    this.windowMat.color.setRGB(1, 1, 1);
    this.windowMat.needsUpdate = true;
    this.panelMat.map = texture;
    if (!this.dedicatedEmissive) this.panelMat.emissiveMap = texture;
    this.panelMat.color.setRGB(1, 1, 1);
    this.panelMat.emissive.setRGB(1, 1, 1);
    this.panelMat.needsUpdate = true;
    this.hasPanelTexture = true;
  }

  /**
   * Use the instruments module's self-illumination map (InstrumentPanel.emissiveTexture: displays and lamps
   * at full value, dial markings at PANEL_DIAL_LIGHT, faceplate black) instead of masking the colour map by
   * texel brightness. Displays then reach ~20-200 cd/m2 and markings ~2-20 cd/m2 with the dimmer.
   */
  setPanelEmissiveTexture(texture: THREE.Texture): void {
    // The windows glow only with the dedicated map (it is black where nothing is lit).
    this.windowMat.emissiveMap = texture;
    this.windowMat.emissive.setRGB(1, 1, 1);
    this.windowMat.needsUpdate = true;
    this.panelMat.emissiveMap = texture;
    this.panelMat.emissive.setRGB(1, 1, 1);
    this.dedicatedEmissive = true;
    this.panelMat.needsUpdate = true;
  }

  /**
   * @param panelEmissiveScale multiplier on the backlight radiance (see AircraftVisual options)
   */
  update(state: AircraftState, controls: ControlInputs, panelEmissiveScale: number, compass?: CompassReading): void {
    for (const column of this.columns) column.pose(controls.elevator, controls.aileron);
    for (let i = 0; i < this.pedals.length; i++) {
      const p = this.pedals[i];
      // Right pedal forward for positive rudder: rotation about +X with the arm's top moving to -Z.
      p.obj.rotation.x = -p.sign * PEDAL_SWING * controls.rudder;
    }
    for (const k of this.knobs) {
      const value = Number(engineControl(controls, k.def.engine, k.def.control));
      // Pushed in (a lever: forward) = full throttle / full rich / high rpm; carburettor heat and alternate air
      // are pulled (back) for on.
      const pulled = k.def.control === 'carbHeat' || k.def.control === 'alternateAir' ? value : 1 - value;
      if (k.def.kind === 'knob') k.group.position.z = -k.def.pos[0] + k.def.travel * pulled - 0.055;
      else {
        // A power lever with a beta / reverse range swings on aft of its idle gate as ControlInputs.reverse rises.
        const aft = k.def.reverseTravel ? k.def.reverseTravel * clamp01(Number(engineControl(controls, k.def.engine, 'reverse') ?? 0)) : 0;
        k.group.rotation.x = k.def.travel * (pulled + aft - 0.5);
      }
    }
    const flap = this.def.flapControl;
    if (flap.kind === 'panelLever') this.flapLever.position.y = -(flap.pos[2] + flap.travel * controls.flaps);
    else if (flap.kind === 'panelSwitch') this.flapLever.rotation.x = flap.travel * (controls.flaps - 0.5);
    else this.flapLever.rotation.x = flap.travel * controls.flaps;
    const pr = this.primer;
    if (pr) {
      // Out and back in over a stroke's time; a little out and turned while unlocked.
      const strokes = controls.primerStrokes ?? 0;
      if (strokes > pr.strokes) pr.strokeAt = state.time;
      pr.strokes = strokes;
      const t = (state.time - pr.strokeAt) / PRIMER_STROKE_TIME;
      const stroke = t >= 0 && t < 1 ? 1 - Math.abs(2 * t - 1) : 0;
      const locked = controls.primerLocked ?? true;
      pr.group.position.z = pr.z0 + Math.max(stroke * this.def.primer!.travel, locked ? 0 : 0.008);
      pr.group.rotation.z = locked ? 0 : Math.PI / 2;
    }
    if (this.gearLever) this.gearLever.rotation.x = controls.gearLever === 'up' ? -0.35 : 0.35;
    if (this.trimWheel) this.trimWheel.rotation[this.def.trimWheel!.axis === 'x' ? 'z' : 'x'] = 3 * controls.elevatorTrim;
    const tp = this.trimPointer;
    if (tp) tp.group.position.copy(tp.centre).addScaledVector(tp.along, tp.travel * controls.elevatorTrim);
    // Clockwise as the pilot sees it (looking along -z) is a negative rotation about three's z.
    if (this.fuelHandle) this.fuelHandle.rotation.z = (-(this.def.fuelSelectorHandle!.angles[controls.fuelSelector] ?? 0) * Math.PI) / 180;
    if (this.brakeHandle) this.brakeHandle.position.z = -this.def.parkingBrakeHandle!.pos[0] + (controls.parkingBrake ? this.def.parkingBrakeHandle!.travel : 0);
    const bus = state.electrical.busVoltage;
    if (compass) this.compass?.update(compass, compassLight(controls.lights.panel) * ((bus * 28) / this.nominalVoltage > 10 ? 1 : 0) * 1.2 * panelEmissiveScale);
    this.poseRockers(controls);
    // Key: OFF, R, L, BOTH 30 degrees apart clockwise, START a further 30 (spring-loaded).
    this.magnetoKey.rotation.z = -((controls.starter ? 4 : controls.magnetos) - 2) * (Math.PI / 6);

    const power = panelPower(bus, this.nominalVoltage);
    const level = controls.lights.panel;
    // Backlight luminance of the white markings: ~2 cd/m2 at the dimmer's minimum up to ~20 cd/m2 at full
    // (core/context.ts: an instrument backlight is ~5-20 cd/m2), in scene units.
    // With the dedicated map the displays are at full value and the markings at 0.1 of it, so the scale is
    // 10x: markings 2-20 cd/m2, displays 20-200 cd/m2.
    // Below DIMMER_KNEE the markings take dimmerLow (to 0 at 0, ~1 cd/m2 at a night setting). With the dedicated map
    // that applies to the markings only (panelDial): the radio / GPS displays and the annunciators are powered on
    // their own and keep 20 + 180 x level, so a warning lamp never goes dark with the panel dimmer.
    const markings = (2 + 18 * Math.max(level, DIMMER_KNEE)) * dimmerLow(level);
    this.panelDial.value = level >= DIMMER_KNEE ? 1 : markings / (2 + 18 * Math.max(level, 0));
    const nits = this.dedicatedEmissive ? 20 + 180 * Math.max(level, 0) : markings;
    this.panelMat.emissiveIntensity = this.hasPanelTexture || this.dedicatedEmissive ? power * nits * SCENE_UNITS_PER_LUX * panelEmissiveScale : 0;
    // The windows carry dial markings only: the panel's radiance at the markings' level.
    this.windowMat.emissiveIntensity = this.dedicatedEmissive ? this.panelMat.emissiveIntensity * this.panelDial.value : 0;

    // Interior lamps (cabinLight.cabinLamps): the flood on the PANEL dimmer, the dome on its own switch.
    const flood = power * level * level * this.floodCd * SCENE_UNITS_PER_LUX;
    cabinLamps.floodColor.value.copy(this.floodLamp).multiplyScalar(flood);
    const dome = (controls.lights as { dome?: boolean }).dome === true ? power * DOME_CD * SCENE_UNITS_PER_LUX : 0;
    cabinLamps.domeColor.value.copy(LAMP_WHITE).multiplyScalar(dome);
    cockpitAdaptation.floodExposure = FLOOD_CD / this.floodCd;
    cockpitAdaptation.panelGlow = 0;
  }

  /**
   * Shadow proxy layout (shadowProxy.ts): the yokes move and cast onto the panel and the pilots; the pedals,
   * throttle, mixture, flap lever and trim wheel sit under the panel or on it, where their shadows are lost.
   */
  shadowRig(): { moving: THREE.Object3D[]; none: THREE.Mesh[] } {
    const none: THREE.Mesh[] = [];
    for (const g of this.details())
      g.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) none.push(o as THREE.Mesh);
      });
    return { moving: this.columns.map((c) => c.group), none };
  }

  /** The small controls under and on the lower panel. */
  private details(): THREE.Group[] {
    const groups = [...this.knobs.map((k) => k.group), ...this.fixedLevers, this.flapLever];
    if (this.primer) groups.push(this.primer.group);
    if (this.trimWheel) groups.push(this.trimWheel);
    if (this.trimPointer) groups.push(this.trimPointer.group);
    groups.push(...this.pedals.map((p) => p.obj));
    if (this.gearLever) groups.push(this.gearLever);
    if (this.fuelHandle) groups.push(this.fuelHandle);
    if (this.brakeHandle) groups.push(this.brakeHandle);
    return groups;
  }

  /**
   * Show the small controls under and on the lower panel (pedals, throttle, mixture, flap lever, trim wheel)
   * only when the camera is in the cockpit: from outside they are hidden by the panel and the doors, and
   * they are 17 draw calls.
   */
  setDetailVisible(visible: boolean): void {
    for (const g of this.details()) g.visible = visible;
  }

  /** Show or hide the yokes / sticks (with their shadow proxies, which hang under them). */
  setColumnsVisible(visible: boolean): void {
    for (const c of this.columns) c.group.visible = visible;
  }

  /** Luminous flux of the interior lamps now, lumens x SCENE_UNITS_PER_LUX (linear RGB). */
  lampFlux(out: THREE.Color): THREE.Color {
    // A spot of ~45 degrees half-angle subtends ~1.9 sr; a downward Lambertian emitter PI sr.
    return out.copy(cabinLamps.floodColor.value).multiplyScalar(1.9).add(this.tmpColor.copy(cabinLamps.domeColor.value).multiplyScalar(Math.PI));
  }

  /**
   * The lamps' flux as the cabin bounce (cabinLight.updateCabinBounce) should take it: the flood lands on the dark
   * panel and glareshield first, so only FLOOD_FIRST_BOUNCE of its flux counts against the cabin's (much lighter)
   * mean albedo, and the lining is not lit as if it were in the beam. A flood brighter than the Cessna 172S's only
   * because it sits further from its panel (CockpitDef.lamps.flood.cd) puts the same light on the panel, so its
   * flux counts as the 172S's would (agent choice: the DA20's lamp behind the seats lit the whole canopy grey).
   */
  lampBounceFlux(out: THREE.Color): THREE.Color {
    return out.copy(cabinLamps.floodColor.value).multiplyScalar(1.9 * FLOOD_FIRST_BOUNCE * (FLOOD_CD / this.floodCd)).add(this.tmpColor.copy(cabinLamps.domeColor.value).multiplyScalar(Math.PI));
  }
  private readonly tmpColor = new THREE.Color();

  /** Static lamp geometry in model space (called once). */
  private static initLamps(def: CockpitDef, face: PanelFace): void {
    const FLOOD_POS = def.lamps.flood.pos;
    const FLOOD_AIM = def.lamps.flood.aim;
    frd(FLOOD_POS[0], FLOOD_POS[1], FLOOD_POS[2] + 0.006, cabinLamps.floodPos.value);
    const aim = frd(FLOOD_AIM[0], FLOOD_AIM[1], FLOOD_AIM[2]);
    cabinLamps.floodAxis.value.copy(aim).sub(cabinLamps.floodPos.value).normalize();
    // Mask: aft of the panel face (model z > -PANEL.x) or above the glareshield top (model y > maskTop).
    cabinLamps.floodMask.value.set(-face.x, def.lamps.flood.maskTop ?? FLOOD_MASK_TOP);
    const [outer, inner] = def.lamps.flood.cone ?? FLOOD_CONE;
    cabinLamps.floodCone.value.set(Math.cos((outer * Math.PI) / 180), Math.cos((inner * Math.PI) / 180));
    const DOME_POS = def.lamps.dome?.pos;
    if (DOME_POS) frd(DOME_POS[0], DOME_POS[1], DOME_POS[2] + 0.006, cabinLamps.domePos.value);
  }

  dispose(): void {
    this.compass?.dispose();
    this.panelMat.dispose();
    this.windowMat.dispose();
    this.visorMat.dispose();
    this.yokeMat.dispose();
    this.rockerMat.dispose();
    this.knobBlue?.dispose();
    this.placards.dispose();
  }
}

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);

/**
 * The top (FRD z) of the box console the lever's pivot sits under (the pedestal it stands out of), or undefined when
 * the pivot is not under one: the nearest box top above the pivot whose plan contains it.
 */
export function leverSurfaceZ(consoles: CockpitDef['consoles'], pos: readonly [number, number, number]): number | undefined {
  let top: number | undefined;
  for (const c of consoles) {
    if (c.profile) continue;
    const inside = pos[0] >= c.min[0] && pos[0] <= c.max[0] && pos[1] >= c.min[1] && pos[1] <= c.max[1];
    if (inside && c.min[2] < pos[2] && (top === undefined || c.min[2] > top)) top = c.min[2];
  }
  return top;
}

/**
 * The quadrant's marks beside a lever's slot (fixed parts): a white notch at each detent (lever fraction), and for a
 * lever with a beta / reverse range the idle gate (a red stop across the slot at lever 0) and a red arc beyond it.
 * A lever at value v stands at rotation travel x (1 - v - 0.5) about the lateral axis through its pivot (see update).
 * When the pivot sits under a console's top (a pedestal), each mark lies flat on that top where the lever at that
 * angle comes out through it, just proud of the surface; otherwise on an arc 35 mm from the pivot.
 */
function addLeverMarks(fixed: MeshBatch, mat: AircraftMaterials, e: CockpitDef['engineControls'][number], consoles: CockpitDef['consoles']): void {
  if (e.kind !== 'lever' || (!e.detents?.length && !e.reverseTravel)) return;
  const p = frd(e.pos[0], e.pos[1], e.pos[2]);
  const top = leverSurfaceZ(consoles, e.pos);
  /** Height of the console top above the pivot, m (model +y up = -FRD z). */
  const h = top === undefined ? 0 : e.pos[2] - top;
  /** The mark at lever angle a (rad, + = aft), on the slot's right side (lateral offset y). */
  const mark = (a: number, w: number, m: THREE.Material, y = 0.011): void => {
    const g = new THREE.BoxGeometry(w, 0.003, 0.004);
    // Lever frame: the lever stands up +y; a rotation about +x by a moves its top toward +z (aft in three's frame).
    if (top === undefined) g.translate(0, 0.035, 0).rotateX(a);
    else g.translate(0, h + 0.0015, h * Math.tan(a));
    g.translate(p.x + y, p.y, p.z);
    fixed.add(m, g);
  };
  const angle = (v: number): number => e.travel * (1 - v - 0.5);
  for (const d of e.detents ?? []) mark(angle(d), 0.016, mat.knobWhite);
  if (e.reverseTravel) {
    // The gate at idle (lever 0) across the slot, and the beta / reverse range beyond it in red.
    mark(angle(0), 0.034, mat.knobRed, 0);
    const n = 4;
    for (let i = 1; i <= n; i++) mark(angle(0) + (e.travel * e.reverseTravel * i) / n, 0.01, mat.knobRed);
  }
}
