// Aerodynamic description of the Cessna 172S, built from the shared geometry in core/c172.ts.
//
// Everything here is geometry or section data; there are no stability derivatives and no correction
// factors on whole-aircraft totals. Sources for the numbers that are not in core/c172.ts:
//  - Separated-flow normal force of a finite surface: cd90 = 1.11 + 0.018 AR (Viterna & Corrigan 1982,
//    after Hoerner's flat-plate data).
//  - Production-surface drag: riveted painted aluminium sits between the NACA smooth and
//    standard-roughness data; attached-flow section drag is taken 35 % above the smooth value.
//  - Flap: single-slotted with Fowler travel of about 10 % chord at 30 deg (C172 flap track geometry).
//  - Parasite items: Hoerner, "Fluid-Dynamic Drag" ch. 13 (landing gear with fairings, struts) and a
//    typical cooling-drag allowance for a horizontally opposed engine with conventional baffles.

import { C172 } from '../../core/c172';
import { DEG, type Vec3 } from '../../core/math';
import { bodyAxisZ, type DragItem, type FuselageDefinition, type LiftingStrut } from './bodies';
import { viternaCd90, type AircraftAeroDefinition } from './definition';
import { NACA_0009, NACA_0012, NACA_2412 } from './sections';
import { buildFin, buildStrips, type FinPlanform, type Planform, type Strip } from './strips';

export type { AircraftAeroDefinition } from './definition';

/**
 * Lift effectiveness of the plain control surfaces relative to thin-aerofoil theory, read from DATCOM
 * fig. 6.1.1.1-39 for each surface's flap-chord ratio and section (c_l_alpha / c_l_alpha,theory ~0.88 for
 * the 12 % wing and fin sections, ~0.93 for the 9 % tailplane). The ailerons are Frise type: the balance nose
 * swings through an open slot in the lower skin, and the leakage through that gap costs much more than a
 * sealed hinge's: section tests of Frise ailerons (Rogallo & Lowry, NACA WR L-?/ARR 1943 series; Wenzinger,
 * NACA TR 605) give 0.030-0.040 per deg for 0.25-0.3c surfaces against thin-aerofoil theory's ~0.068, i.e.
 * ~0.5-0.6. That puts the whole-aircraft Cl_da at ~0.19 per rad (Roskam's C172: 0.18-0.23) and full-aileron
 * roll at pb/2V ~0.09.
 */
const VISCOUS = { aileron: 0.56, elevator: 0.88, rudder: 0.8, tab: 0.75 };
/**
 * Leakage through the unsealed elevator hinge gap (open, about 0.5-1 % of the local chord, on the C172):
 * air flows from the high- to the low-pressure side through the gap and relieves the pressure difference
 * across the hinge line. Wind-tunnel data on tail surfaces with plain control surfaces show 5-15 % less
 * lift-curve slope with the gap open than sealed (Hoerner & Borst, "Fluid-Dynamic Lift" sec. 5-10; DATCOM
 * 6.1.1.1). The fixed-surface lift slope and the control power drop together. The fin is left at its full
 * slope: without a gap correction its Cn_beta already matches the reference value for the C172 (Roskam
 * 0.065), so the data do not support one there (the rudder nests in the fin's rear spar channel).
 */
const HINGE_GAP_LEAKAGE = 0.9;
/** Frise aileron balance-nose drag (see FlapGeometry.friseNoseDrag). */
const FRISE_NOSE_DRAG = 0.08;
const PRODUCTION_SKIN = 1.35;

/**
 * The wing's planform (a fresh object on every call). Exported with the tailplane's and the fin's for the
 * synthetic definitions that vary one of them (tests/aero/testbed.ts).
 */
export function c172WingPlanform(): Planform {
  const w = C172.wing;
  const zAt = (y: number) => w.quarterChord.z - Math.max(y - w.rootY, 0) * Math.tan(w.dihedral);
  // The inboard panel is a constant-chord, untwisted box at the root incidence; the washout (root to tip
  // incidence) is built into the tapered outer panel only, where the ribs change anyway.
  const incAt = (y: number) =>
    y <= w.taperStartY ? w.rootIncidence : w.rootIncidence + ((w.tipIncidence - w.rootIncidence) * (y - w.taperStartY)) / (w.span / 2 - w.taperStartY);
  const qc = (y: number): Vec3 => ({ x: w.quarterChord.x, y, z: zAt(y) });
  const tip = w.span / 2;
  return {
    surface: 'wing',
    section: NACA_2412,
    mirror: true,
    stations: [
      { span: 0, qc: qc(0), chord: w.rootChord, incidence: incAt(0) },
      { span: w.rootY, qc: qc(w.rootY), chord: w.rootChord, incidence: incAt(w.rootY) },
      { span: w.taperStartY, qc: qc(w.taperStartY), chord: w.rootChord, incidence: incAt(w.taperStartY) },
      { span: tip, qc: qc(tip), chord: w.tipChord, incidence: incAt(tip) },
    ],
    // The centre section over the cabin roof (two lifting strips, no flap: see Strip.bodySection), then 10 strips
    // per side with edges on the flap and aileron ends.
    centre: 'body',
    edges: [w.rootY, 1.05, 1.57, 2.08, w.flap.outerY, 3.12, 3.64, 4.16, 4.68, w.aileron.outerY, tip],
    controls: [
      {
        source: 'flaps',
        gain: 1,
        geometry: { kind: 'slotted', chordFraction: w.flap.chordFraction, fowler: 0.1, fowlerDeflection: w.flap.maxDeflection },
        from: w.flap.innerY,
        to: w.flap.outerY,
      },
      {
        source: 'aileronRight',
        mirrorSource: 'aileronLeft',
        gain: 1,
        // Frise-type ailerons (the C172's have the offset hinge and protruding balance nose).
        geometry: { kind: 'plain', chordFraction: w.aileron.chordFraction, viscousEffectiveness: VISCOUS.aileron, friseNoseDrag: FRISE_NOSE_DRAG },
        from: w.aileron.innerY,
        to: w.aileron.outerY,
      },
    ],
    cd90: viternaCd90((w.span * w.span) / w.area),
    skinFactor: PRODUCTION_SKIN,
  };
}

function wingStrips(): Strip[] {
  return buildStrips(c172WingPlanform());
}

export function c172TailplanePlanform(): Planform {
  const h = C172.hTail;
  const half = h.span / 2;
  return {
    surface: 'hTail',
    section: NACA_0009,
    mirror: true,
    stations: [
      { span: 0, qc: { x: h.quarterChord.x, y: 0, z: h.quarterChord.z }, chord: h.rootChord, incidence: h.incidence },
      { span: half, qc: { x: h.quarterChord.x, y: half, z: h.quarterChord.z }, chord: h.tipChord, incidence: h.incidence },
    ],
    // Centre strip across the tail cone, then 4 per side.
    edges: [0.2, 0.55, 0.9, 1.3, half],
    controls: [
      {
        source: 'elevator',
        gain: 1,
        geometry: { kind: 'plain', chordFraction: h.elevator.chordFraction, viscousEffectiveness: VISCOUS.elevator },
        from: 0.2,
        to: half,
      },
      // Trim tab on the right elevator only; ~0.1 m chord on a ~1 m section.
      {
        source: 'elevatorTrim',
        mirrorSource: null,
        gain: 1,
        geometry: { kind: 'plain', chordFraction: 0.1, viscousEffectiveness: VISCOUS.tab },
        from: 0.3,
        to: 0.9,
      },
    ],
    cd90: viternaCd90((h.span * h.span) / h.area),
    skinFactor: PRODUCTION_SKIN,
    liftSlopeFactor: HINGE_GAP_LEAKAGE,
  };
}

/** Fin: continued down to the tail-cone axis (see buildFin), one strip inside the tail cone and four above it. */
export function c172FinPlanform(): FinPlanform {
  const v = C172.vTail;
  return {
    section: NACA_0012,
    base: v.base,
    tip: v.tip,
    rootChord: v.rootChord,
    tipChord: v.tipChord,
    axisZ: bodyAxisZ(FUSELAGE, v.base.x),
    edges: [0.3, 0.6, 0.9],
    controls: [
      {
        source: 'rudder',
        gain: 1,
        geometry: { kind: 'plain', chordFraction: v.rudder.chordFraction, viscousEffectiveness: VISCOUS.rudder },
        // The rudder runs the full height, horn included: its end ramp lies beyond the tip strip.
        from: 0,
        to: v.height,
      },
    ],
    cd90: viternaCd90((v.height * v.height) / v.area),
    skinFactor: PRODUCTION_SKIN,
  };
}

function tailStrips(): Strip[] {
  return [...buildStrips(c172TailplanePlanform()), ...buildFin(c172FinPlanform())];
}

/**
 * Lateral added mass of the cabin's rounded-box section relative to its inscribed ellipse: corner radii of about
 * 0.15-0.2 of the width put it near 1.3 (sharp-cornered square 1.51).
 */
const CABIN_LATERAL_MASS = 1.3;

/** Fuselage cross-sections (x, width, height, centre z), spinner to tail cone. */
const FUSELAGE: FuselageDefinition = {
  stations: [
    { x: C172.fuselage.noseX, width: 0, height: 0, z: 0 },
    { x: 2.0, width: 0.35, height: 0.35, z: 0 },
    { x: 1.8, width: 0.85, height: 0.75, z: 0.05 },
    // The cabin is a rounded box: flat sides and roof, small corner radii (see FuselageStation.lateralMass).
    { x: 1.2, width: 0.98, height: 0.95, z: 0.02, lateralMass: CABIN_LATERAL_MASS },
    { x: 0.6, width: 1.06, height: 1.15, z: 0, lateralMass: CABIN_LATERAL_MASS },
    { x: 0.0, width: C172.fuselage.maxWidth, height: C172.fuselage.maxHeight, z: 0, lateralMass: CABIN_LATERAL_MASS },
    { x: -0.9, width: 1.02, height: 1.18, z: -0.02, lateralMass: CABIN_LATERAL_MASS },
    { x: -1.8, width: 0.85, height: 0.98, z: -0.08 },
    { x: -3.0, width: 0.6, height: 0.72, z: -0.12 },
    { x: -4.5, width: 0.36, height: 0.5, z: -0.15 },
    { x: C172.fuselage.tailX, width: 0.12, height: 0.25, z: -0.25 },
  ],
  // Cabin, cowling, flat-panel windshield and tail cone: C_D ~ 0.2 on the ~1 m^2 frontal area (Hoerner,
  // "Fluid-Dynamic Drag", ch. 14: 0.15-0.3 for light-aircraft cabin fuselages).
  axialDragArea: 0.2,
  // About 70 % of it is skin friction on the ~30 m^2 wetted area; referred to 100 KTAS at sea level.
  skinFrictionFraction: 0.7,
  referenceReynolds: (1.225 * 51.4 * (C172.fuselage.noseX - C172.fuselage.tailX)) / 1.79e-5,
  // eta ~ 0.65 for fineness ~ 7 times Cdc ~ 1.2 for a rounded-box section.
  crossflowDrag: 0.8,
  apparentMass: 0.9,
};

function dragItems(): DragItem[] {
  const g = C172.gear;
  const s = C172.wing.strut;
  const strutMid = (side: number): Vec3 => ({ x: 0.5 * (s.fuselage.x + s.wing.x), y: side * 0.5 * (s.fuselage.y + s.wing.y), z: 0.5 * (s.fuselage.z + s.wing.z) });
  const mainMid = (side: number): Vec3 => ({ x: g.leftMain.x, y: side * 0.7 * g.rightMain.y, z: 0.5 * (0.55 + g.rightMain.z) });
  return [
    // Spring-steel main legs with wheel fairings.
    { name: 'left main gear', position: mainMid(-1), area: { x: 0.035, y: 0.06, z: 0.03 } },
    { name: 'right main gear', position: mainMid(1), area: { x: 0.035, y: 0.06, z: 0.03 } },
    { name: 'nose gear', position: { x: g.nose.x, y: 0, z: 0.5 * (0.6 + g.nose.z) }, area: { x: 0.03, y: 0.04, z: 0.02 } },
    // Streamlined lift struts, ~2.2 m long.
    { name: 'left strut', position: strutMid(-1), area: { x: 0.012, y: 0.06, z: 0.2 } },
    { name: 'right strut', position: strutMid(1), area: { x: 0.012, y: 0.06, z: 0.2 } },
    // Momentum loss of the engine cooling air, at the cowl inlets (inside the slipstream): about 10 % of the
    // cruise drag for a baffled installation without cowl flaps.
    { name: 'cooling', position: { x: 1.55, y: 0, z: 0.1 }, area: { x: 0.05, y: 0, z: 0 } },
    // Leakage and protuberances (antennas, steps, fuel caps, vents, exhaust stacks, door, flap and aileron
    // gaps) plus the interference drag of the wing-body, strut-wing, strut-body and tail-body junctions:
    // together about 12 % of the zero-lift drag of a strut-braced, fixed-gear light aircraft (Raymer,
    // "Aircraft Design", sec. 12.5; Roskam Part VI ch. 4).
    { name: 'miscellaneous', position: { x: 0, y: 0, z: -0.3 }, area: { x: 0.068, y: 0.02, z: 0.02 } },
  ];
}

/**
 * The two lift struts: streamlined tubes of ~4.5 x 1.75 in (0.114 m chord, ~39 % thick) from the lower
 * fuselage to the wing. A section that thick has a lift slope well below 2 pi (~4.5 /rad, end-plated by the
 * fuselage and the wing) and stalls early (c_l,max ~0.6 at the strut's Reynolds number of ~5e5).
 */
function struts(): LiftingStrut[] {
  const s = C172.wing.strut;
  const side = (k: number): LiftingStrut => ({
    name: k < 0 ? 'left strut' : 'right strut',
    root: { x: s.fuselage.x, y: k * s.fuselage.y, z: s.fuselage.z },
    tip: { x: s.wing.x, y: k * s.wing.y, z: s.wing.z },
    chord: 0.114,
    liftSlope: 4.5,
    clMax: 0.6,
  });
  return [side(-1), side(1)];
}

export function createC172AeroDefinition(): AircraftAeroDefinition {
  const wing = wingStrips();
  // The stall-warning reed sits in the left wing leading edge just outboard of the strut attachment.
  const sensor = wing.findIndex((s) => s.side === -1 && s.span > C172.wing.flap.outerY && s.span < 3.2);
  return {
    referenceArea: C172.wing.area,
    referenceChord: C172.wing.meanChord,
    referenceSpan: C172.wing.span,
    wing,
    tail: tailStrips(),
    fuselage: FUSELAGE,
    dragItems: dragItems(),
    struts: struts(),
    propellers: [{ hub: { ...C172.prop.hub }, radius: C172.prop.diameter / 2 }],
    // The reed is rigged (its position relative to the leading-edge stagnation point) to sound 5-10 kt above
    // the stall.
    stallWarning: { strip: sensor, margin: 7.8 * DEG },
  };
}
