// Richard Pearse Waitohi Monoplane: strip-aerodynamic definition.
//
// Models the short-coupled flying-wing / parasol layout of NZ Patent 21476 & the Waitohi Memorial:
//   - Flat rectangular 7.62 m x 2.00 m grid-ribbed canvas wing with mild reflex pitching moment and inset outer
//     ailerons (2.68..3.56 m, inside the fixed wingtip panels);
//   - All-moving rectangular elevator hinged directly to the rear edge of the centre wing (x = -1.50 m);
//   - Tall rectangular canvas rudder sail standing upright in the centre of the wing (z = -0.92..-2.27 m);
//   - Open tubular-steel undercarriage frame, seated pilot and wire-spoked tricycle wheels beneath the wing.

import { DEG, type Vec3 } from '../../core/math';
import type { AirfoilSection } from '../../physics/aero/airfoil';
import type { DragItem, FuselageDefinition, LiftingStrut } from '../../physics/aero/bodies';
import { viternaCd90, type AircraftAeroDefinition } from '../../physics/aero/definition';
import { NACA_0009, NACA_0012 } from '../../physics/aero/sections';
import { buildFin, buildStrips, type FinPlanform, type Planform } from '../../physics/aero/strips';
import { PEARSE_GEOMETRY } from './geometry';

const G = PEARSE_GEOMETRY;

/**
 * Shallow-cambered / lightly reflexed stretched-canvas wing section over the flat rectangular bamboo/steel rib grid:
 * low zero-lift pitching moment (cm0 = -0.02) suited to the short-coupled rear-edge wing elevator.
 */
const PEARSE_CANVAS_SECTION: AirfoilSection = {
  name: 'Pearse Waitohi Grid-Ribbed Canvas',
  liftSlope: 0.098 / DEG,
  alpha0: -3.5 * DEG,
  cm0: -0.004,
  cdMin: 0.013,
  clCdMin: 0.42,
  dragBucket: 0.014,
  reRef: 1.8e6,
  stallPos: 15.8 * DEG,
  stallNeg: -10.5 * DEG,
  stallReSlope: 1.5 * DEG,
  s1: 3.2 * DEG,
  s2: 2.8 * DEG,
  reverseLiftSlope: 0.06 / DEG,
  reverseStall: 7 * DEG,
  momentK1: 0.035,
  momentK2: 0.018,
  breakSeparation: 0.5,
};

const CANVAS_ELEVATOR = { ...NACA_0009, cdMin: 0.0095 };
const CANVAS_SAIL = { ...NACA_0012, cdMin: 0.010 };

const VISCOUS = { flap: 0.72, aileron: 0.62, rudder: 0.85 };
const CANVAS_SKIN = 1.42;

export function pearseWingPlanform(): Planform {
  const w = G.wing;
  const tip = w.span / 2;
  const incAt = (y: number) =>
    y <= w.rootY ? w.rootIncidence : w.rootIncidence + ((w.tipIncidence - w.rootIncidence) * (y - w.rootY)) / (tip - w.rootY);
  const qc = (y: number): Vec3 => ({ x: w.quarterChord.x, y, z: w.quarterChord.z });
  return {
    surface: 'wing',
    section: PEARSE_CANVAS_SECTION,
    mirror: true,
    stations: [
      { span: 0, qc: qc(0), chord: w.rootChord, incidence: incAt(0) },
      { span: w.rootY, qc: qc(w.rootY), chord: w.rootChord, incidence: incAt(w.rootY) },
      { span: tip, qc: qc(tip), chord: w.tipChord, incidence: incAt(tip) },
    ],
    centre: 'body',
    edges: [w.rootY, w.flap.innerY, 0.8, w.flap.outerY, 1.95, w.aileron.innerY, 3.0, w.aileron.outerY, tip],
    controls: [
      {
        source: 'flaps',
        gain: 1,
        geometry: { kind: 'plain', chordFraction: w.flap.chordFraction, viscousEffectiveness: VISCOUS.flap },
        from: w.flap.innerY,
        to: w.flap.outerY,
      },
      {
        source: 'aileronRight',
        mirrorSource: 'aileronLeft',
        gain: 1,
        geometry: { kind: 'plain', chordFraction: w.aileron.chordFraction, viscousEffectiveness: VISCOUS.aileron },
        from: w.aileron.innerY,
        to: w.aileron.outerY,
      },
    ],
    cd90: viternaCd90((w.span * w.span) / w.area),
    skinFactor: CANVAS_SKIN,
  };
}

/** All-moving rectangular elevator hinged directly to the rear edge of the centre wing. */
export function pearseTailplanePlanform(): Planform {
  const h = G.hTail;
  const half = h.span / 2;
  return {
    surface: 'hTail',
    section: CANVAS_ELEVATOR,
    mirror: true,
    stations: [
      { span: 0, qc: { x: h.quarterChord.x, y: 0, z: h.quarterChord.z }, chord: h.rootChord, incidence: h.incidence },
      { span: half, qc: { x: h.quarterChord.x, y: half, z: h.quarterChord.z }, chord: h.tipChord, incidence: h.incidence },
    ],
    edges: [0.25, 0.65, half],
    controls: [
      { source: 'elevator', gain: 1, geometry: { kind: 'allMoving', chordFraction: 1 }, from: 0, to: half },
    ],
    cd90: viternaCd90((h.span * h.span) / h.area),
    skinFactor: CANVAS_SKIN,
    liftSlopeFactor: 0.92,
  };
}

/** Tall rectangular canvas sail standing upright in the centre of the wing. */
export function pearseFinPlanform(): FinPlanform {
  const v = G.vTail;
  return {
    section: CANVAS_SAIL,
    base: v.base,
    tip: v.tip,
    rootChord: v.rootChord,
    tipChord: v.tipChord,
    // Anchored at the wing chord plane (0.04 m below base.z so strip edges strictly ascend without extending below the wing).
    axisZ: v.base.z + 0.04,
    edges: [0.45, 0.9],
    controls: [
      {
        source: 'rudder',
        gain: 1,
        geometry: { kind: 'plain', chordFraction: v.rudder.chordFraction, viscousEffectiveness: VISCOUS.rudder },
        from: 0.04,
        to: 0.04 + v.height,
      },
    ],
    cd90: viternaCd90((v.height * v.height) / v.area),
    skinFactor: CANVAS_SKIN,
  };
}

/** Minimal slender-body representation of the open pilot/seat/engine cluster (no enclosed fuselage or tail boom). */
const FUSELAGE: FuselageDefinition = {
  stations: [
    { x: G.fuselage.noseX, width: 0, height: 0, z: -0.4 },
    { x: 0.65, width: 0.34, height: 0.32, z: -0.75 },
    { x: 0.15, width: 0.44, height: 0.85, z: -0.05 },
    { x: -0.45, width: 0.22, height: 0.4, z: -0.1 },
    { x: -0.95, width: 0.06, height: 0.08, z: -0.6 },
  ],
  axialDragArea: 0.32,
  skinFrictionFraction: 0.15,
  referenceReynolds: (1.225 * 22 * 2.0) / 1.79e-5,
  crossflowDrag: 0.6,
  apparentMass: 0.35,
};

function dragItems(): DragItem[] {
  const g = G.gear;
  const s = G.wing.strut!;
  const strutMid = (side: number): Vec3 => ({
    x: 0.5 * (s.fuselage.x + s.wing.x),
    y: side * 0.5 * (s.fuselage.y + s.wing.y),
    z: 0.5 * (s.fuselage.z + s.wing.z),
  });
  return [
    { name: 'left main wheel', position: { x: g.leftMain.x, y: -1.0, z: 0.65 }, area: { x: 0.04, y: 0.06, z: 0.025 } },
    { name: 'right main wheel', position: { x: g.rightMain.x, y: 1.0, z: 0.65 }, area: { x: 0.04, y: 0.06, z: 0.025 } },
    { name: 'nose wheel', position: { x: g.nose.x, y: 0, z: 0.68 }, area: { x: 0.032, y: 0.045, z: 0.02 } },
    { name: 'left frame & rigging', position: strutMid(-1), area: { x: 0.075, y: 0.05, z: 0.07 } },
    { name: 'right frame & rigging', position: strutMid(1), area: { x: 0.075, y: 0.05, z: 0.07 } },
    { name: 'wing-top engine & tank', position: { x: 0.45, y: 0, z: -0.88 }, area: { x: 0.075, y: 0.04, z: 0.04 } },
  ];
}

function struts(): LiftingStrut[] {
  const s = G.wing.strut!;
  const side = (k: number): LiftingStrut => ({
    name: k < 0 ? 'left brace' : 'right brace',
    root: { x: s.fuselage.x, y: k * s.fuselage.y, z: s.fuselage.z },
    tip: { x: s.wing.x, y: k * s.wing.y, z: s.wing.z },
    chord: 0.04,
    liftSlope: 0.8,
    clMax: 0.3,
  });
  return [side(-1), side(1)];
}

export function createPearseAeroDefinition(): AircraftAeroDefinition {
  const wing = buildStrips(pearseWingPlanform());
  const sensor = wing.findIndex((s) => s.side === -1 && s.span > 1.35 && s.span < 2.5);
  const prop = G.propellers[0];
  return {
    referenceArea: G.wing.area,
    referenceChord: G.wing.meanChord,
    referenceSpan: G.wing.span,
    wing,
    tail: [...buildStrips(pearseTailplanePlanform()), ...buildFin(pearseFinPlanform())],
    fuselage: FUSELAGE,
    dragItems: dragItems(),
    struts: struts(),
    propellers: [{ hub: { ...prop.hub }, radius: prop.diameter / 2 }],
    stallWarning: { strip: sensor, margin: 5 * DEG },
    wake: { maxLoss: 0.06 },
  };
}
