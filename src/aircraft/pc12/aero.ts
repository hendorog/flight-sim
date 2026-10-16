// Pilatus PC-12/47: the aerodynamic definition (a factory: strips carry section objects), built from the shared
// geometry (geometry.ts) the way the other types' are (aircraft/pa38/aero.ts, aircraft/da20/aero.ts, where each
// modelling choice is explained): geometry and section data, no stability derivatives and no correction factors
// on whole-aircraft totals.
//
// The airframe: a low, straight-tapered wing of NASA LS(1)-0417 MOD at the root and LS(1)-0313 at the tip (UIUC
// guide, SECONDARY) with its spar through the fuselage, single-piece Fowler flaps a side running out to about 62 %
// of the semi-span, small upturned winglets; a T-tail whose TRIMMABLE STABILISER carries a plain elevator (the
// pitch trim turns the whole stabiliser: PitchTrimDef 'stabilizer', SurfaceState.elevatorTrim = its incidence
// change, + = leading edge up = nose down); a long, slender pressurised fuselage with the PT6A-67B in the nose.
// Of the calibration knobs (contract 3.1) these are moved from their first estimates, each where it is set: the
// wing sections' stall (pneumatic boots on the leading edge), the flaps' Fowler motion, the fuselage's and the
// drag items' areas.

import { DEG, type Vec3 } from '../../core/math';
import { bodyAxisZ, type DragItem, type FuselageDefinition } from '../../physics/aero/bodies';
import { viternaCd90, type AircraftAeroDefinition } from '../../physics/aero/definition';
import { NACA_0012, NASA_LS1_0417 } from '../../physics/aero/sections';
import { buildFin, buildStrips, type FinPlanform, type Planform, type PlanformStation } from '../../physics/aero/strips';
import { PC12_FUSELAGE, PC12_GEOMETRY, PC12_REST_HEIGHT, PC12_TAIL, PC12_THRUST_Z } from './geometry';

const G = PC12_GEOMETRY;

/** Lift effectiveness of the plain control surfaces relative to thin-aerofoil theory (c172Aero.ts VISCOUS). */
const VISCOUS = { aileron: 0.6, elevator: 0.88, rudder: 0.8 };
/** Lift-slope loss through the elevator's hinge gap (c172Aero.ts HINGE_GAP_LEAKAGE): gap-sealed surfaces (47E 7-3). */
const HINGE_GAP_LEAKAGE = 0.95;
/** Flush-riveted, painted aluminium with pneumatic de-ice boots on the leading edges. */
const WING_SKIN = 1.3;
const TAIL_SKIN = 1.3;

/** How much earlier than the clean record the boot-covered wing breaks, rad (CALIBRATED: see WING_ROOT). */
const STALL_SHIFT = 3.8 * DEG;
/**
 * The Fowler flap (CALIBRATED with STALL_SHIFT on the pusher speeds with the pusher at 0.90-0.93 of C_L,max, plan 5.2,
 * and on the attitudes: about 3 deg nose-down on a 3 deg flaps-40 approach at Vref, a flare to a few degrees
 * nose-up). A single-slotted Fowler on tracks: the chord extension (0.30 of the chord, 3V ESTIMATE) comes first, by
 * 20 deg; the camber's effectiveness at large deflection, relative to its 10 deg value, falls as the slotted table's
 * less 10 % (FOWLER_LARGE_DEFLECTION, at 0 / 10 / 20 / 30 / 45 / 60 / 90 deg); and the slot re-energises the flap so
 * that the section's break moves out by 1.22 x the zero-lift shift (FOWLER_CLMAX_RATIO; the generic slotted 0.8 put
 * the flaps-40 C_L,max at 0.98 of the pusher's and the stall 9 deg of body angle below the clean one).
 */
const FOWLER_LARGE_DEFLECTION = [1, 0.8, 0.72, 0.64, 0.52, 0.42, 0.3];
const FOWLER_CLMAX_RATIO = 1.22;
const FOWLER_FULL_AT = 20 * DEG;
/**
 * The Fowler's profile drag at deflection, on the slotted fit's (FlapGeometry.dragFactor): 2 x, for the big flap run
 * aft on three tracks under their fairings with an open slot. CALIBRATED: 13 psi on a 3 deg flaps-40 approach at Vref
 * (plan 5.7: 8-18 psi; the governing point) and a 6.8 deg flight-idle descent at 85 KIAS with flaps 40 and the gear down
 * (7.4 deg since the flight-idle power came down, docs/pc12-flight-model.md "Flight idle").
 */
const FOWLER_DRAG_FACTOR = 2;
/**
 * Root section: NASA LS(1)-0417 MOD (UIUC guide, SECONDARY), the per-type copy of sections.ts's record (TN D-7428).
 * The PC-12 flies its stall at about Re 6-7e6 on a 2 m chord, where the clean section reaches c_l,max 1.9; the
 * de-ice boots over the leading edge cost about 0.15-0.25 of it (boot-on aerofoil data), and the break is set
 * STALL_SHIFT (3.8 deg) earlier than the record's: the wing's C_L,max 1.36 clean. CALIBRATED with the pusher schedule on the pusher speeds (the published
 * stall speeds ARE pusher speeds, 47E-PROXY sect. 5): the pusher must trip at 0.90-0.93 of the wing's C_L,max.
 */
const WING_ROOT = { ...NASA_LS1_0417, name: 'NASA LS(1)-0417 MOD (PC-12 copy)', stallPos: NASA_LS1_0417.stallPos - STALL_SHIFT };
/** Tip section: LS(1)-0313, 13 % thick: lower drag, an earlier break (thinner leading edge). */
const WING_TIP = { ...WING_ROOT, name: 'NASA LS(1)-0313 (PC-12 copy)', cdMin: 0.0088, stallPos: WING_ROOT.stallPos - 3.5 * DEG, cm0: -0.1 };

const WINGLET = G.wing.winglet!;
/** Span coordinate (arc length) at the winglet's top. */
const TIP_SPAN = WINGLET.rootY! + WINGLET.height;

/** The wing's planform (a fresh object on every call): one straight-tapered panel and the upturned winglet. */
export function pc12WingPlanform(): Planform {
  const w = G.wing;
  const half = w.span / 2;
  /** The flat wing's tip, where the winglet starts. */
  const tip = WINGLET.rootY!;
  const zAt = (y: number) => w.quarterChord.z - Math.max(y - w.rootY, 0) * Math.tan(w.dihedral);
  // The straight taper runs from 2.10 m on the centre line to 1.08 m at the half span (geometry.ts).
  const chordAt = (y: number) => w.rootChord + ((w.tipChord - w.rootChord) * y) / half;
  // Linear washout from the fuselage side to the tip.
  const incAt = (y: number) => w.rootIncidence + ((w.tipIncidence - w.rootIncidence) * Math.max(y - w.rootY, 0)) / (tip - w.rootY);
  const station = (y: number, section = WING_ROOT): PlanformStation => ({ span: y, qc: { x: w.quarterChord.x, y, z: zAt(y) }, chord: chordAt(y), incidence: incAt(y), section });
  // The winglet as one straight piece along its cant, its leading edge swept back, reaching the TCDS half span.
  const leTip = w.quarterChord.x + 0.25 * chordAt(tip);
  const top: PlanformStation = {
    span: TIP_SPAN,
    qc: {
      x: leTip - WINGLET.height * Math.tan(WINGLET.sweep) - 0.25 * WINGLET.tipChord,
      y: half,
      z: zAt(tip) - WINGLET.height * Math.sin(WINGLET.cant),
    },
    chord: WINGLET.tipChord,
    incidence: w.tipIncidence,
    section: WING_TIP,
  };
  return {
    surface: 'wing',
    section: WING_ROOT,
    mirror: true,
    stations: [station(0), station(w.rootY), station(tip, WING_TIP), top],
    // The carry-over strip across the fuselage (contract 3.1 "Low wing"), then 8 strips a side on the panel (5 over
    // the flap, 3 over the aileron, the flap's and the aileron's ends inside strips) and one on the winglet: the cost
    // of a trim and reset (contract 3.10).
    centre: 'carryover',
    edges: [w.rootY, 1.75, 2.7, 3.65, 4.4, 5.1, 5.9, 6.7, tip, TIP_SPAN],
    controls: [
      {
        source: 'flaps',
        gain: 1,
        // Single-piece Fowler on three tracks (47E-PROXY 7-3): it runs well aft before it turns down; about 30 %
        // of the local chord of extension at 40 deg (3V ESTIMATE; the drawing runs it 0.42 m aft).
        geometry: { kind: 'slotted', chordFraction: w.flap.chordFraction, fowler: 0.3, fowlerDeflection: FOWLER_FULL_AT, largeDeflection: FOWLER_LARGE_DEFLECTION, clMaxRatio: FOWLER_CLMAX_RATIO, dragFactor: FOWLER_DRAG_FACTOR },
        from: w.flap.innerY,
        to: w.flap.outerY,
      },
      {
        source: 'aileronRight',
        mirrorSource: 'aileronLeft',
        gain: 1,
        // Mass-balanced, gap-sealed, with geared (Flettner) balance tabs (47E-PROXY 7-3).
        geometry: { kind: 'plain', chordFraction: w.aileron.chordFraction, viscousEffectiveness: VISCOUS.aileron },
        from: w.aileron.innerY,
        to: w.aileron.outerY,
      },
    ],
    cd90: viternaCd90((w.span * w.span) / w.area),
    skinFactor: WING_SKIN,
  };
}

/**
 * Tailplane on the fin's tip (contract 3.1 "T-tail junction"): the two halves meet in the plane of symmetry at the
 * fin's tip. The whole stabiliser turns with the pitch trim (an all-moving link on SurfaceState.elevatorTrim:
 * + = leading edge up, more lift up = nose down, the sign of PitchTrimDef 'stabilizer'); the elevator is a plain
 * surface on it. Symmetric section (ESTIMATE: the 0012 record).
 */
export function pc12TailplanePlanform(): Planform {
  const h = G.hTail;
  const half = h.span / 2;
  const tipX = h.tipQuarterChordX ?? h.quarterChord.x;
  return {
    surface: 'hTail',
    section: NACA_0012,
    mirror: true,
    stations: [
      { span: 0, qc: { x: h.quarterChord.x, y: 0, z: h.quarterChord.z }, chord: h.rootChord, incidence: h.incidence },
      { span: half, qc: { x: tipX, y: half, z: h.quarterChord.z }, chord: h.tipChord, incidence: h.incidence },
    ],
    centre: 'none',
    // The bullet-fairing strip, then three a side.
    edges: [0, 0.3, 1.05, 1.8, half],
    controls: [
      { source: 'elevatorTrim', gain: 1, geometry: { kind: 'allMoving', chordFraction: 1 }, from: 0, to: half },
      {
        source: 'elevator',
        gain: 1,
        geometry: { kind: 'plain', chordFraction: h.elevator.chordFraction, viscousEffectiveness: VISCOUS.elevator },
        from: 0.3,
        to: half,
      },
    ],
    cd90: viternaCd90((h.span * h.span) / h.area),
    skinFactor: TAIL_SKIN,
    liftSlopeFactor: HINGE_GAP_LEAKAGE,
  };
}

/** Fin: swept, continued down to the tailcone axis (see buildFin), its tip at the tailplane's root quarter-chord. */
export function pc12FinPlanform(): FinPlanform {
  const v = G.vTail;
  const h = G.hTail;
  return {
    section: NACA_0012,
    base: v.base,
    tip: { x: h.quarterChord.x, z: h.quarterChord.z },
    rootChord: v.rootChord,
    tipChord: v.tipChord,
    axisZ: bodyAxisZ(FUSELAGE, v.base.x),
    edges: [0.5, 1.0, 1.5],
    controls: [
      {
        source: 'rudder',
        gain: 1,
        geometry: { kind: 'plain', chordFraction: v.rudder.chordFraction, viscousEffectiveness: VISCOUS.rudder },
        from: 0,
        to: v.height,
      },
      // The electric rudder trim acts through the rudder it holds (PC12_CONTROLS.rudder.trim), as on the C208.
    ],
    cd90: viternaCd90((v.height * v.height) / v.area),
    skinFactor: TAIL_SKIN,
  };
}

/** Body x and z of a station (m aft of the datum) and a height above the ground (geometry.ts axes). */
const S = (station: number) => 6.0 - station;
const H = (height: number) => PC12_REST_HEIGHT - height;
/** Height of the thrust line above the ground, m. */
const T_H = PC12_REST_HEIGHT - PC12_THRUST_Z;
/** Lateral added mass of the round-shouldered pressure cabin relative to its inscribed ellipse (c172Aero.ts CABIN_LATERAL_MASS). */
const CABIN_LATERAL_MASS = 1.15;
/** Tailcone end under the rudder (3V station 13.55, P2): the rudder and the bullet fairing overhang it to PC12_FUSELAGE.tailX. */
const TAILCONE_X = S(13.6);

/** A station of the 3V loft (P2's keys, docs/pc12-exterior.md): station, top and bottom heights above the ground, width. */
const at = (station: number, top: number, bottom: number, width: number, lateralMass?: number) => ({
  x: S(station),
  width,
  height: top - bottom,
  z: H((top + bottom) / 2),
  ...(lateralMass ? { lateralMass } : {}),
});

/**
 * Fuselage cross-sections, spinner to tailcone (3V, the same keys as the drawing: the cowling under a straight top line
 * to the windscreen, the round cabin 1.69 m wide between a belly 0.93 m and a roof 2.73 m up, the tailcone's belly
 * sweeping up to 1.88 m at its end).
 */
const FUSELAGE: FuselageDefinition = {
  stations: [
    { x: PC12_FUSELAGE.noseX, width: 0, height: 0, z: PC12_THRUST_Z },
    at(1.025, T_H + 0.25, T_H - 0.27, 0.5),
    at(1.4, T_H + 0.32, T_H - 0.54, 0.88),
    at(2.2, T_H + 0.41, T_H - 0.65, 1.24),
    // The firewall (datum + 3.000 m, TCDS C.III.14), the windscreen sill, the cabin.
    at(3.0, T_H + 0.5, 0.93, 1.54),
    at(3.3, 2.18, 0.93, 1.66, CABIN_LATERAL_MASS),
    at(4.0, 2.54, 0.93, PC12_FUSELAGE.maxWidth, CABIN_LATERAL_MASS),
    at(4.7, 2.73, 0.93, PC12_FUSELAGE.maxWidth, CABIN_LATERAL_MASS),
    at(6.4, 2.73, 0.87, PC12_FUSELAGE.maxWidth, CABIN_LATERAL_MASS),
    at(8.6, 2.73, 0.98, 1.68, CABIN_LATERAL_MASS),
    // The tailcone.
    at(10.0, 2.64, 1.22, 1.46),
    at(11.0, 2.54, 1.4, 1.2),
    at(12.0, 2.45, 1.58, 0.9),
    at(12.8, 2.38, 1.73, 0.6),
    at(13.3, 2.35, 1.83, 0.32),
    { x: TAILCONE_X, width: 0.05, height: 0.1, z: H(2.11) },
  ],
  // The long, slender pressure cabin with its pointed nose and the faired windshield: C_D about 0.07 on the 2.4 m^2
  // frontal area (Hoerner ch. 14: 0.05-0.08 for a streamlined cabin body). CALIBRATED with the drag items on the
  // maximum-cruise rows (47E-PROXY Fig 5-2-31).
  axialDragArea: 0.17,
  skinFrictionFraction: 0.8,
  // Referred to 230 KTAS at sea level.
  referenceReynolds: (1.225 * 118 * (PC12_FUSELAGE.noseX - TAILCONE_X)) / 1.79e-5,
  crossflowDrag: 0.8,
  apparentMass: 0.9,
};

function dragItems(): DragItem[] {
  const g = G.gear;
  // The trailing-link legs hang from the wing's lower surface (about 0.12 m below the chord plane) to the axle.
  const wingZ = (y: number) => G.wing.quarterChord.z - Math.max(y - G.wing.rootY, 0) * Math.tan(G.wing.dihedral) + 0.12;
  const legMid = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: 0.5 * (wingZ(Math.abs(p.y)) + p.z) });
  return [
    // Trailing-link legs with their doors and the 8.50-10 wheels and brakes, the open wells behind them. Scaled by
    // each leg's extension: the main wheels stay about 25 mm proud when up (47E-PROXY 7-4), the nose is enclosed.
    { name: 'left main gear', position: legMid(g.leftMain), area: { x: 0.2, y: 0.06, z: 0.04 }, scale: { kind: 'gear', leg: 1 }, retractedFraction: 0.04 },
    { name: 'right main gear', position: legMid(g.rightMain), area: { x: 0.2, y: 0.06, z: 0.04 }, scale: { kind: 'gear', leg: 2 }, retractedFraction: 0.04 },
    { name: 'nose gear', position: { x: g.nose.x, y: 0, z: 0.5 * (H(0.93) + g.nose.z) }, area: { x: 0.13, y: 0.05, z: 0.03 }, scale: { kind: 'gear', leg: 0 }, retractedFraction: 0 },
    // Oil cooler, the chin inlet's spill and the bifurcated exhaust stubs, in the slipstream.
    { name: 'cooling and exhaust', position: { x: S(1.8), y: 0, z: H(T_H - 0.3) }, area: { x: 0.05, y: 0, z: 0 } },
    // Leakage and protuberances (antennas, the boots' seams, door seals, the ventral strakes and fin, the flap
    // tracks' fairings, the stall vanes) and the junctions' interference: about 12 % of the zero-lift drag of a
    // clean retractable single (Raymer 12.5).
    { name: 'miscellaneous', position: { x: 0, y: 0, z: 0 }, area: { x: 0.07, y: 0.05, z: 0.05 } },
  ];
}

/**
 * The aural stall warning. The PC-12's stall warning is the stick shaker driven by the two AOA vanes of the stall
 * warning and identification system (PC12_CONTROLS.stickPusher, systems.ts); this sensor stands for the vane on
 * the generic FlightState.stallWarning (the horn, the HUD and the coach): set to sound with the shaker, about
 * 5-10 kt before the push (47E-PROXY 7-21). Electric: no warning with a dead bus.
 */
const WARNING_MARGIN = { clean: 4.6 * DEG, flaps: 5.5 * DEG };
const WARNING_FLAP_SWITCH = 7 * DEG;
/** Largest dynamic-pressure loss of the wing's wake at the T-tail (aeroModel.ts applyWingWake; the PA-38's knob). */
const WAKE_MAX_LOSS = 0.25;

export function createPC12AeroDefinition(): AircraftAeroDefinition {
  const wing = buildStrips(pc12WingPlanform());
  // The vanes are on the wing leading edges, inboard of the ailerons (the left one here).
  const sensor = wing.findIndex((s) => s.side === -1 && s.span > 3.65 && s.span < 4.4);
  const prop = G.propellers[0];
  return {
    referenceArea: G.wing.area,
    referenceChord: G.wing.meanChord,
    referenceSpan: G.wing.span,
    wing,
    tail: [...buildStrips(pc12TailplanePlanform()), ...buildFin(pc12FinPlanform())],
    fuselage: FUSELAGE,
    dragItems: dragItems(),
    struts: [],
    // The low wing's root sections and the wing-body junction straighten part of the jet's swirl before the fin
    // (PropellerStation.swirlBehindWing, ESTIMATE: the DA20's 0.5); the T-tail stands above the jet. At 0.6 (the first
    // estimate) the full-power roll with the rudder trim at zero took 0.67 of the pedal at 15 kt (plan 5.7: 0.6).
    propellers: [{ hub: { ...prop.hub }, radius: prop.diameter / 2, swirlBehindWing: 0.5 }],
    stallWarning: [
      { strip: sensor, margin: WARNING_MARGIN.clean, flaps: [0, WARNING_FLAP_SWITCH], referenceReynolds: WING_ROOT.reRef, needsBus: true },
      { strip: sensor, margin: WARNING_MARGIN.flaps, flaps: [WARNING_FLAP_SWITCH, G.wing.flap.maxDeflection + DEG], referenceReynolds: WING_ROOT.reRef, needsBus: true },
    ],
    wake: { maxLoss: WAKE_MAX_LOSS },
  };
}

/** The tail's arm (fin junction to the reference point), for the documentation: about 7.85 m. */
export const PC12_TAIL_ARM = -PC12_TAIL.hQuarterChord.x;
