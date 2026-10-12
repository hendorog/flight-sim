// Cessna 208 Caravan 675: the aerodynamic definition (a factory: strips carry section objects), built from the
// shared geometry (geometry.ts) the way the Cessna 152's is (aircraft/c152/aero.ts, where each modelling choice
// is explained): geometry and section data, no stability derivatives and no correction factors on whole-aircraft
// totals. Fuselage drag, drag items and the section copies below are first estimates, calibrated on the POH's
// stall speeds, climb and cruise (tests/conformance/targets/c208.ts).

import { DEG, type Vec3 } from '../../core/math';
import type { AirfoilSection } from '../../physics/aero/airfoil';
import { bodyAxisZ, type DragItem, type FuselageDefinition, type LiftingStrut } from '../../physics/aero/bodies';
import { viternaCd90, type AircraftAeroDefinition } from '../../physics/aero/definition';
import { NACA_0009, NACA_0012, NACA_2412 } from '../../physics/aero/sections';
import { buildFin, buildStrips, type FinPlanform, type Planform } from '../../physics/aero/strips';
import { C208_GEOMETRY, C208_THRUST_Z } from './geometry';

const G = C208_GEOMETRY;
/** Thrust line height (geometry.ts); the fuselage stations are written from it. */
const T = C208_THRUST_Z;

/** Lift effectiveness of the plain control surfaces relative to thin-aerofoil theory (c172Aero.ts VISCOUS). */
const VISCOUS = { aileron: 0.56, elevator: 0.88, rudder: 0.8, tab: 0.75 };
const HINGE_GAP_LEAKAGE = 0.9;
/** Riveted, painted aluminium (flush-riveted leading edges on the 208, otherwise as the 152's). */
const PRODUCTION_SKIN = 1.3;

/**
 * NACA 23017.424 at the root (Jane's). Abbott & von Doenhoff, NACA 23015/23018 at R = 6e6: a = 0.107/deg, alpha0
 * -1.2 deg, c_m about -0.008, cd,min about 0.0065 near cl 0.15; the five-digit sections stall more abruptly than the
 * four-digit ones (a narrower separation band). The break is set so the clean wing reaches the POH stall speed;
 * the record of the 2412 is the base for everything else (reverse flow, moment break).
 */
const WING_ROOT: AirfoilSection = {
  ...NACA_2412,
  name: 'NACA 23017 (C208 copy)',
  liftSlope: 0.105 / DEG,
  alpha0: -1.2 * DEG,
  cm0: -0.008,
  cdMin: 0.0066,
  clCdMin: 0.15,
  dragBucket: 0.007,
  reRef: 6e6,
  stallPos: 17.8 * DEG,
  stallNeg: -15.5 * DEG,
  s1: 1.6 * DEG,
  s2: 2.4 * DEG,
};
/** NACA 23012 at the tip: thinner, a later and sharper break. */
const WING_TIP: AirfoilSection = { ...WING_ROOT, name: 'NACA 23012 (C208 copy)', cdMin: 0.006, stallPos: 18.8 * DEG, s1: 1.4 * DEG };

/** The wing's planform (a fresh object on every call). */
export function c208WingPlanform(): Planform {
  const w = G.wing;
  const zAt = (y: number) => w.quarterChord.z - Math.max(y - w.rootY, 0) * Math.tan(w.dihedral);
  const tip = w.span / 2;
  // Constant-chord inboard panel at the root incidence; the washout runs through the tapered outer panel.
  const incAt = (y: number) =>
    y <= w.taperStartY ? w.rootIncidence : w.rootIncidence + ((w.tipIncidence - w.rootIncidence) * (y - w.taperStartY)) / (tip - w.taperStartY);
  const qc = (y: number): Vec3 => ({ x: w.quarterChord.x, y, z: zAt(y) });
  return {
    surface: 'wing',
    section: WING_ROOT,
    mirror: true,
    stations: [
      { span: 0, qc: qc(0), chord: w.rootChord, incidence: incAt(0), section: WING_ROOT },
      { span: w.rootY, qc: qc(w.rootY), chord: w.rootChord, incidence: incAt(w.rootY), section: WING_ROOT },
      { span: w.taperStartY, qc: qc(w.taperStartY), chord: w.rootChord, incidence: incAt(w.taperStartY), section: WING_ROOT },
      { span: tip, qc: qc(tip), chord: w.tipChord, incidence: incAt(tip), section: WING_TIP },
    ],
    centre: 'body',
    // 7 strips over the flap (cabin side to WS 197), 5 over the aileron, the tip.
    edges: [w.rootY, 1.4, 2.0, w.taperStartY, 3.2, 3.8, 4.4, w.flap.outerY, 5.55, 6.1, 6.65, 7.2, w.aileron.outerY, tip],
    controls: [
      {
        source: 'flaps',
        gain: 1,
        // Single-slotted Fowler flaps on tracks: a large chord extension (about 25 % of the local chord at FULL).
        geometry: { kind: 'slotted', chordFraction: w.flap.chordFraction, fowler: 0.25, fowlerDeflection: w.flap.maxDeflection },
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
    skinFactor: PRODUCTION_SKIN,
  };
}

/** Tailplane: fixed stabiliser and elevator on the tailcone, swept leading edge, straight hinge line, about NACA 0009. */
export function c208TailplanePlanform(): Planform {
  const h = G.hTail;
  const half = h.span / 2;
  const tipX = h.tipQuarterChordX ?? h.quarterChord.x;
  return {
    surface: 'hTail',
    section: NACA_0009,
    mirror: true,
    stations: [
      { span: 0, qc: { x: h.quarterChord.x, y: 0, z: h.quarterChord.z }, chord: h.rootChord, incidence: h.incidence },
      { span: half, qc: { x: tipX, y: half, z: h.quarterChord.z }, chord: h.tipChord, incidence: h.incidence },
    ],
    // Centre strip across the tailcone (about 0.55 m wide there), then 4 per side.
    edges: [0.28, 0.98, 1.68, 2.4, half],
    controls: [
      {
        source: 'elevator',
        gain: 1,
        geometry: { kind: 'plain', chordFraction: h.elevator.chordFraction, viscousEffectiveness: VISCOUS.elevator },
        from: 0.28,
        to: half,
      },
      // Trim tabs on both elevators' inboard trailing edges (about 0.12 m of chord).
      {
        source: 'elevatorTrim',
        gain: 1,
        geometry: { kind: 'plain', chordFraction: 0.1, viscousEffectiveness: VISCOUS.tab },
        from: 0.35,
        to: 1.6,
      },
    ],
    cd90: viternaCd90((h.span * h.span) / h.area),
    skinFactor: PRODUCTION_SKIN,
    liftSlopeFactor: HINGE_GAP_LEAKAGE,
  };
}

/** Fin: swept, continued down to the tailcone axis (see buildFin); the dorsal fin's stall-delaying effect as a thicker section. */
export function c208FinPlanform(): FinPlanform {
  const v = G.vTail;
  return {
    section: NACA_0012,
    base: v.base,
    tip: v.tip,
    rootChord: v.rootChord,
    tipChord: v.tipChord,
    axisZ: bodyAxisZ(FUSELAGE, v.base.x),
    edges: [0.5, 1.0, 1.55],
    controls: [
      {
        source: 'rudder',
        gain: 1,
        geometry: { kind: 'plain', chordFraction: v.rudder.chordFraction, viscousEffectiveness: VISCOUS.rudder },
        from: 0,
        to: v.height,
      },
      // The cockpit rudder trim acts through the rudder it holds (C208_CONTROLS.rudder.trim), as on the PA-34.
    ],
    cd90: viternaCd90((v.height * v.height) / v.area),
    skinFactor: PRODUCTION_SKIN,
  };
}

/** Lateral added mass of the slab-sided cabin relative to its inscribed ellipse (c172Aero.ts CABIN_LATERAL_MASS). */
const CABIN_LATERAL_MASS = 1.3;
/** Tailcone end, under the rudder (3V). */
const TAILCONE_X = -7.25;

/** Fuselage cross-sections (x, width, height, centre z), spinner to tailcone end (3V; the thrust line is z = 0). */
const FUSELAGE: FuselageDefinition = {
  stations: [
    { x: G.fuselage.noseX, width: 0, height: 0, z: T },
    // Spinner base at the propeller plane.
    { x: 3.72, width: 0.52, height: 0.52, z: T },
    // Cowling over the PT6's reduction gearbox and the chin inlet below it.
    { x: 3.2, width: 0.82, height: 0.98, z: T + 0.06 },
    // The cowling widens over the engine to the firewall.
    { x: 2.35, width: 1.15, height: 1.32, z: T - 0.02 },
    // Windshield base; the cabin is a slab-sided box from here (FuselageStation.lateralMass).
    { x: 1.75, width: 1.55, height: 1.8, z: T - 0.12, lateralMass: CABIN_LATERAL_MASS },
    { x: 0.8, width: G.fuselage.maxWidth, height: G.fuselage.maxHeight, z: T - 0.18, lateralMass: CABIN_LATERAL_MASS },
    { x: -1.2, width: G.fuselage.maxWidth, height: G.fuselage.maxHeight, z: T - 0.18, lateralMass: CABIN_LATERAL_MASS },
    // The aft cabin: the floor sweeps up toward the tailcone.
    { x: -2.6, width: 1.6, height: 1.72, z: T - 0.28, lateralMass: CABIN_LATERAL_MASS },
    { x: -3.8, width: 1.12, height: 1.22, z: T - 0.42 },
    { x: -5.0, width: 0.72, height: 0.84, z: T - 0.52 },
    // Tailplane leading edge, elevator hinge.
    { x: -5.85, width: 0.45, height: 0.56, z: T - 0.58 },
    { x: -6.6, width: 0.22, height: 0.32, z: T - 0.62 },
    { x: TAILCONE_X, width: 0.05, height: 0.08, z: T - 0.64 },
  ],
  // The deep cabin, the long, well-faired cowling with its chin inlet and the windshield: C_D about 0.13 on the
  // ~3.1 m^2 frontal area (Hoerner ch. 14: 0.1-0.2 for cabin fuselages; the 208's is long and clean).
  axialDragArea: 0.4,
  skinFrictionFraction: 0.7,
  // Referred to 150 KTAS at sea level.
  referenceReynolds: (1.225 * 77 * (G.fuselage.noseX - TAILCONE_X)) / 1.79e-5,
  crossflowDrag: 0.8,
  apparentMass: 0.9,
};

function dragItems(): DragItem[] {
  const g = G.gear;
  const s = G.wing.strut!;
  const strutMid = (side: number): Vec3 => ({ x: 0.5 * (s.fuselage.x + s.wing.x), y: side * 0.5 * (s.fuselage.y + s.wing.y), z: 0.5 * (s.fuselage.z + s.wing.z) });
  const mainMid = (side: number): Vec3 => ({ x: g.leftMain.x, y: side * 0.6 * g.rightMain.y, z: 0.5 * (T + 0.85 + g.rightMain.z) });
  return [
    // Tubular spring-steel main legs and 6.50-10 wheels with brakes, without fairings.
    { name: 'left main gear', position: mainMid(-1), area: { x: 0.055, y: 0.09, z: 0.05 } },
    { name: 'right main gear', position: mainMid(1), area: { x: 0.055, y: 0.09, z: 0.05 } },
    // Oleo, fork and the 22 x 8.00-8 wheel.
    { name: 'nose gear', position: { x: g.nose.x, y: 0, z: 0.5 * (T + 0.6 + g.nose.z) }, area: { x: 0.04, y: 0.07, z: 0.03 } },
    // Streamlined lift struts, about 2.5 m long, 0.17 m chord.
    { name: 'left strut', position: strutMid(-1), area: { x: 0.02, y: 0.1, z: 0.33 } },
    { name: 'right strut', position: strutMid(1), area: { x: 0.02, y: 0.1, z: 0.33 } },
    // Oil cooler, the inertial separator's bypass and the exhaust stack, in the slipstream.
    { name: 'cooling', position: { x: 3.0, y: 0, z: T + 0.3 }, area: { x: 0.04, y: 0, z: 0 } },
    // Leakage and protuberances (antennas, steps, cargo door seams, vents, the flap tracks and gaps) plus the
    // junctions' interference: about 12 % of the zero-lift drag of a strut-braced fixed-gear aircraft (Raymer 12.5).
    { name: 'miscellaneous', position: { x: 0, y: 0, z: T - 0.5 }, area: { x: 0.09, y: 0.05, z: 0.05 } },
  ];
}

/** The two lift struts: streamlined tubes of 0.17 m chord from the lower fuselage to the wing. */
function struts(): LiftingStrut[] {
  const s = G.wing.strut!;
  const side = (k: number): LiftingStrut => ({
    name: k < 0 ? 'left strut' : 'right strut',
    root: { x: s.fuselage.x, y: k * s.fuselage.y, z: s.fuselage.z },
    tip: { x: s.wing.x, y: k * s.wing.y, z: s.wing.z },
    chord: 0.17,
    liftSlope: 4.5,
    clMax: 0.6,
  });
  return [side(-1), side(1)];
}

/**
 * Stall warning: a lift detector in the left wing leading edge over the flap, set to sound about 5-10 kt before the
 * stall. With the Fowler flap down the leading edge's loading rises much less than the wing's lift, so the margin
 * that does this flaps up is far too small flaps down: the threshold is switched with the flap (as the PA-34's
 * two detectors are).
 */
const WARNING_MARGIN = { clean: 5 * DEG, flaps: 10.5 * DEG };
/** Flap deflection at which the flaps-down margin takes over, rad. */
const WARNING_FLAP_SWITCH = 5 * DEG;
/** Largest dynamic-pressure loss of the wing's wake at the tail (c152/aero.ts WAKE_MAX_LOSS). */
const WAKE_MAX_LOSS = 0.1;

export function createC208AeroDefinition(): AircraftAeroDefinition {
  const wing = buildStrips(c208WingPlanform());
  // The lift detector is on the left wing leading edge outboard of the strut (POH sect. 7).
  const sensor = wing.findIndex((s) => s.side === -1 && s.span > G.wing.taperStartY && s.span < 3.8);
  const prop = G.propellers[0];
  return {
    referenceArea: G.wing.area,
    referenceChord: G.wing.meanChord,
    referenceSpan: G.wing.span,
    wing,
    tail: [...buildStrips(c208TailplanePlanform()), ...buildFin(c208FinPlanform())],
    fuselage: FUSELAGE,
    dragItems: dragItems(),
    struts: struts(),
    propellers: [{ hub: { ...prop.hub }, radius: prop.diameter / 2 }],
    stallWarning: [
      { strip: sensor, margin: WARNING_MARGIN.clean, flaps: [0, WARNING_FLAP_SWITCH] },
      { strip: sensor, margin: WARNING_MARGIN.flaps, flaps: [WARNING_FLAP_SWITCH, G.wing.flap.maxDeflection + DEG] },
    ],
    wake: { maxLoss: WAKE_MAX_LOSS },
  };
}
