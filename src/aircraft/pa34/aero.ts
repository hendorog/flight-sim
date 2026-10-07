// Piper PA-34-200 Seneca I: the aerodynamic definition (a factory: strips carry section objects), built from the
// shared geometry (geometry.ts) the way physics/aero/c172Aero.ts builds the Cessna 172S's: geometry and section data,
// no stability derivatives and no correction factors on whole-aircraft totals.
//
// Sources beyond geometry.ts: the type's engineering data sheet (aircraft-data/pa34.md in the design work folder,
// "s.N" its section N) and the section data of aircraft-data/sections.md (section 2: NACA 65(2)-415). What the
// mechanisms are: a low wing of one section with its carry-over strip across the fuselage and a leading-edge glove
// inboard of the nacelles; two wing propellers whose jets wash the wing behind them, each with a nacelle body over
// which the wing strips are a body band; single-slotted flaps passing behind the nacelles and Frise ailerons; an
// all-moving stabilator low on the tail cone with an anti-servo tab that is also the trim tab (contract 3.1
// "Stabilator"); a swept fin; gear legs and cooling air whose drag scales with the gear and the cowl flaps. Of the
// contract's calibration knobs (section 3.1) these are moved from their first estimates, each where it is set: the
// fuselage's axial drag and the miscellaneous item (the top speed), the gear legs' drag (the gear-down climb), the
// rudder's large-deflection table (Vmca and the pedal fractions), the flap's model (the landing stall) and the stall
// vanes' margins. The wing section (WING) and the wing blowing (0.7) are the first estimates: the clean stall is in
// band with the record, and the blowing moved neither the pedal fractions nor the stall speeds by more than 0.1.

import { DEG, type Vec3 } from '../../core/math';
import { bodyAxisZ, type DragItem, type FuselageDefinition } from '../../physics/aero/bodies';
import { viternaCd90, type AircraftAeroDefinition, type PropellerStation } from '../../physics/aero/definition';
import { NACA_0012, NACA_65_2_415 } from '../../physics/aero/sections';
import { buildFin, buildStrips, type FinPlanform, type Planform } from '../../physics/aero/strips';
import { PA34_GEOMETRY, pa34StationX } from './geometry';

const G = PA34_GEOMETRY;

/**
 * Lift effectiveness of the plain control surfaces relative to thin-aerofoil theory at small deflection (DATCOM
 * fig. 6.1.1.1-39, as c172Aero.ts VISCOUS): the Frise ailerons with their open balance slot as the 172's, the
 * stabilator's tab and the rudder as the 172's tab and rudder.
 */
const VISCOUS = { aileron: 0.56, rudder: 0.8, tab: 0.75 };
/** Frise aileron balance-nose drag (FlapGeometry.friseNoseDrag; c172Aero.ts). */
const FRISE_NOSE_DRAG = 0.08;
/**
 * The rudder's effectiveness at large deflection relative to its 10 degree value, at 0 / 10 / 20 / 30 / 45 / 60 / 90
 * degrees: DATCOM 6.1.1.1's empirical correction K' for a plain surface of about 0.4 chord (Roskam, "Airplane
 * Design" VI fig. 8.13, as the PA-38's elevator), which keeps more of its effectiveness than the 0.2-0.25 chord
 * surfaces the generic plain table stands for. It sets the rudder force at the 35 degree stops, i.e. Vmca (contract
 * 5.4).
 */
const RUDDER_LARGE_DEFLECTION = [1, 1, 0.88, 0.74, 0.6, 0.5, 0.35];
/** Production-surface drag factor on the section's smooth drag: riveted, painted aluminium (c172Aero.ts). */
const WING_SKIN = 1.35;
const TAIL_SKIN = 1.35;

/**
 * The wing section: NACA 65(2)-415, root and tip (s.2.1). A per-type copy of sections.ts's record, which this type
 * calibrates (sections.ts is never edited).
 */
const WING = { ...NACA_65_2_415 };

/**
 * Finite-jet correction of the axial velocity increment on the wing strips in each jet (contract 3.1 "Blown
 * wing"): the starting value for a wing-mounted tractor whose jet is about a chord deep.
 */
const WING_BLOWING = 0.7;

/** Half the width of the cowling and nacelle (s.12: 0.95-1.0 m wide), m. */
const NACELLE_HALF_WIDTH = 0.475;
const [LEFT_PROP, RIGHT_PROP] = G.propellers;
const HUB_Y = RIGHT_PROP.hub.y;
const PROP_RADIUS = RIGHT_PROP.diameter / 2;

/** The wing's planform (a fresh object on every call). */
export function pa34WingPlanform(): Planform {
  const w = G.wing;
  // The dihedral starts at the fuselage side (geometry.ts: quarterChord.z is the chord plane at the root rib).
  const zAt = (y: number) => w.quarterChord.z - Math.max(y - w.rootY, 0) * Math.tan(w.dihedral);
  // No washout (s.2.1): the incidence is the root's everywhere.
  const station = (b: { y: number; chord: number; qcX: number }) => ({
    span: b.y,
    qc: { x: w.quarterChord.x + b.qcX, y: b.y, z: zAt(b.y) } as Vec3,
    chord: b.chord,
    incidence: w.rootIncidence,
  });
  const tip = w.span / 2;
  return {
    surface: 'wing',
    section: WING,
    mirror: true,
    // The planform is geometry.ts's `breaks`: the glove from the fuselage side to the nacelle's inboard face, then
    // the constant chord.
    stations: w.breaks!.map(station),
    // The low wing's spar runs through the fuselage: one carry-over strip across it (contract 3.1 "Low wing"), then
    // 11 strips a side with edges on the jet's edges and axis (contract 3.1 "Blown wing"), the nacelle's sides
    // (the body band), the flap's and the aileron's ends.
    centre: 'carryover',
    edges: [w.rootY, HUB_Y - PROP_RADIUS, HUB_Y - NACELLE_HALF_WIDTH, HUB_Y, HUB_Y + NACELLE_HALF_WIDTH, HUB_Y + PROP_RADIUS, 3.27, w.flap.outerY, 4.2, 4.75, w.aileron.outerY, tip],
    bodyBands: [{ from: HUB_Y - NACELLE_HALF_WIDTH, to: HUB_Y + NACELLE_HALF_WIDTH }],
    controls: [
      {
        source: 'flaps',
        gain: 1,
        // Single-slotted, in one piece from the fuselage side to the aileron behind the nacelle (s.2.1). CALIBRATED on
        // the handbook's landing stall (contract 5.4: 60 KCAS, CL,max 1.65, below the usual 1.8-2.4 of a slotted flap;
        // the sheet's s.8 note: the flap span broken by the nacelles and a slot that only half works at 40 degrees):
        // the slotted model's increment gives 56-57 KCAS whatever its chord, so the flap takes the plain surface's
        // large-deflection law at the full thin-aerofoil effectiveness of a slotted flap at small deflection.
        geometry: { kind: 'plain', chordFraction: w.flap.chordFraction, viscousEffectiveness: 1 },
        from: w.flap.innerY,
        to: w.flap.outerY,
      },
      {
        source: 'aileronRight',
        mirrorSource: 'aileronLeft',
        gain: 1,
        // Frise-type, differential (s.2.1).
        geometry: { kind: 'plain', chordFraction: w.aileron.chordFraction, viscousEffectiveness: VISCOUS.aileron, friseNoseDrag: FRISE_NOSE_DRAG },
        from: w.aileron.innerY,
        to: w.aileron.outerY,
      },
    ],
    cd90: viternaCd90((w.span * w.span) / w.area),
    skinFactor: WING_SKIN,
  };
}

/** Half-width of the tail cone where the stabilator passes through it (s.12: about 0.25 m wide at FS 285). */
const TAIL_CONE_HALF = 0.125;
/** The anti-servo tab spans about +/-1.52 m (BL 60), 20 % of the chord (s.2.2). */
const TAB_END = 1.52;
const TAB = { kind: 'plain' as const, chordFraction: 0.2, viscousEffectiveness: VISCOUS.tab };

/**
 * Stabilator: constant chord, NACA 0012 (s.2.2 ESTIMATE), carried through the tail cone, all-moving (contract 3.1
 * "Stabilator": a rotation of the strip, no hinge gap). The anti-servo tab is two plain links on the same strips:
 * geared to the stabilator (systems.ts PA34_TAB_GEARING) and the trim's offset.
 */
export function pa34StabilatorPlanform(gearing: number): Planform {
  const h = G.hTail;
  const half = h.span / 2;
  return {
    surface: 'hTail',
    section: NACA_0012,
    mirror: true,
    stations: [
      { span: 0, qc: { x: h.quarterChord.x, y: 0, z: h.quarterChord.z }, chord: h.rootChord, incidence: h.incidence },
      { span: half, qc: { x: h.quarterChord.x, y: half, z: h.quarterChord.z }, chord: h.tipChord, incidence: h.incidence },
    ],
    // The strip across the tail cone, then four a side with an edge at the tab's outer end.
    edges: [TAIL_CONE_HALF, 0.55, 1.0, TAB_END, half],
    controls: [
      { source: 'elevator', gain: 1, geometry: { kind: 'allMoving', chordFraction: 1 }, from: 0, to: half },
      { source: 'elevator', gain: gearing, geometry: TAB, from: TAIL_CONE_HALF, to: TAB_END },
      { source: 'elevatorTrim', gain: 1, geometry: TAB, from: TAIL_CONE_HALF, to: TAB_END },
    ],
    cd90: viternaCd90((h.span * h.span) / h.area),
    skinFactor: TAIL_SKIN,
    liftSlopeFactor: 1,
  };
}

/** Fin and rudder: swept 45 degrees, continued down to the tail-cone axis (see buildFin). */
export function pa34FinPlanform(): FinPlanform {
  const v = G.vTail;
  return {
    // Symmetric, about 0012 (s.2.3 gives no section).
    section: NACA_0012,
    base: v.base,
    tip: v.tip,
    rootChord: v.rootChord,
    tipChord: v.tipChord,
    axisZ: bodyAxisZ(FUSELAGE, v.base.x),
    edges: [0.4, 0.8, 1.2],
    controls: [
      {
        source: 'rudder',
        gain: 1,
        // Full height with the horn balance at the top (s.2.3).
        geometry: { kind: 'plain', chordFraction: v.rudder.chordFraction, viscousEffectiveness: VISCOUS.rudder, largeDeflection: RUDDER_LARGE_DEFLECTION },
        from: 0,
        to: v.height,
      },
    ],
    cd90: viternaCd90((v.height * v.height) / v.area),
    skinFactor: TAIL_SKIN,
  };
}

/** Lateral added mass of the flat-sided cabin relative to its inscribed ellipse (c172Aero.ts CABIN_LATERAL_MASS). */
const CABIN_LATERAL_MASS = 1.3;
/** Body x of a point given as metres aft of the nose tip (s.12's table). */
const fromNose = (x: number) => G.fuselage.noseX - x;
/**
 * Body z of a section centre given as its offset above the fuselage reference line (s.12): the mid-height of the
 * constant cabin section, 1.31 m above the ground at rest.
 */
const centre = (offset: number) => G.restHeight - 1.31 - offset;
/** The tail cone ends near FS 311 (s.12); the rudder's trailing edge overhangs to tailX. The body ends here. */
const TAILCONE_X = pa34StationX(311);

/** Fuselage cross-sections (x, width, height, centre z), nose tip to tail-cone end: s.12's table. */
const FUSELAGE: FuselageDefinition = {
  stations: [
    { x: G.fuselage.noseX, width: 0, height: 0, z: centre(-0.2) },
    // Nose cone and the baggage bay, the forward cabin bulkhead, the windscreen base.
    { x: fromNose(0.4), width: 0.55, height: 0.5, z: centre(-0.2) },
    { x: fromNose(1.0), width: 0.95, height: 0.8, z: centre(-0.17) },
    { x: fromNose(1.96), width: 1.15, height: 0.98, z: centre(-0.13) },
    { x: fromNose(2.06), width: 1.22, height: 1.02, z: centre(-0.11), lateralMass: CABIN_LATERAL_MASS },
    // The windscreen top and the front seats, the centre seats, the rear seats: flat sides, a curved roof.
    { x: fromNose(2.8), width: G.fuselage.maxWidth, height: G.fuselage.maxHeight, z: centre(0), lateralMass: CABIN_LATERAL_MASS },
    { x: fromNose(3.7), width: G.fuselage.maxWidth, height: G.fuselage.maxHeight, z: centre(0), lateralMass: CABIN_LATERAL_MASS },
    { x: fromNose(4.65), width: 1.15, height: 1.17, z: centre(0), lateralMass: CABIN_LATERAL_MASS },
    // The aft cabin bulkhead (the belly sweeps up), the fin-root fillet, the stabilator, the tail-cone end.
    { x: fromNose(5.47), width: 0.95, height: 1.07, z: centre(-0.03) },
    { x: fromNose(6.5), width: 0.55, height: 0.8, z: centre(-0.1) },
    { x: fromNose(7.94), width: 0.25, height: 0.5, z: centre(-0.1) },
    { x: TAILCONE_X, width: 0.08, height: 0.25, z: centre(-0.08) },
  ],
  // The long cabin with its baggage nose and the tail cone: C_D about 0.15 on the 1.25 m^2 frontal area (Hoerner,
  // "Fluid-Dynamic Drag", ch. 14: 0.15-0.3 for light-aircraft cabin fuselages; no cowling on this one). CALIBRATED
  // with the miscellaneous item on the maximum level speed (contract 5.4 calibration order, step 1: 170 kt).
  axialDragArea: 0.185,
  // About 70 % of it is skin friction; referred to 150 KTAS at sea level.
  skinFrictionFraction: 0.7,
  referenceReynolds: (1.225 * 77.2 * (G.fuselage.noseX - TAILCONE_X)) / 1.79e-5,
  // As the 172's: eta about 0.65 for its fineness times Cdc about 1.2 for a rounded-box section.
  crossflowDrag: 0.8,
  apparentMass: 0.9,
};

/**
 * One nacelle behind the disc at `hub` (s.12): spinner (0.33 m, 0.36 m long), a boxy cowl about 0.95-1.0 m wide and
 * 0.70 m deep with rounded corners, then a fairing tapering over the wing to end on its upper surface near 55-60 %
 * chord. Stations relative to the nacelle's own axis (the thrust line).
 */
function nacelle(hub: Vec3): FuselageDefinition {
  const nacelleEnd = pa34StationX(78.4) - 0.57 * G.wing.meanChord;
  return {
    stations: [
      { x: hub.x + 0.36, width: 0, height: 0, z: 0 },
      { x: hub.x, width: 0.33, height: 0.33, z: 0 },
      { x: hub.x - 0.12, width: 0.85, height: 0.62, z: 0.04 },
      { x: hub.x - 0.55, width: 2 * NACELLE_HALF_WIDTH + 0.03, height: 0.7, z: 0.06 },
      { x: hub.x - 1.15, width: 2 * NACELLE_HALF_WIDTH, height: 0.66, z: 0.06 },
      { x: hub.x - 1.65, width: 0.75, height: 0.5, z: 0.02 },
      { x: nacelleEnd, width: 0.15, height: 0.15, z: -0.08 },
    ],
    // Cowling and fairing: C_D about 0.06 on the 0.6 m^2 face (the cooling air's loss is a drag item of its own).
    axialDragArea: 0.035,
    skinFrictionFraction: 0.7,
    referenceReynolds: (1.225 * 77.2 * (hub.x + 0.36 - nacelleEnd)) / 1.79e-5,
    crossflowDrag: 0.8,
    apparentMass: 0.85,
    axis: { y: hub.y, z: hub.z },
  };
}

/** Wing chord plane at span y (dihedral from the fuselage side). */
const wingZ = (y: number) => G.wing.quarterChord.z - Math.max(y - G.wing.rootY, 0) * Math.tan(G.wing.dihedral);

function dragItems(): DragItem[] {
  const g = G.gear;
  // The oleo legs hang from the wing's lower surface (about 0.12 m below the chord plane) to the axle.
  const legMid = (p: Vec3): Vec3 => ({ x: p.x, y: p.y, z: 0.5 * (wingZ(Math.abs(p.y)) + 0.12 + p.z) });
  return [
    // Unfaired oleo struts with scissors, leg doors and 6.00-6 wheels with their brakes, the open wells behind them
    // (s.3, s.12; Hoerner ch. 13). Scaled by each leg's extension; the mains stay partly exposed in the wing root when
    // up (s.12), the nose leg is closed in by its doors. CALIBRATED on the gear-down climb (OH-8, weak: 1180 ft/min
    // against 1460 clean; OH-6: "gear down, about 75 % of the clean speed at the same power"): about 0.6 m^2 in all,
    // twice an exposed fixed gear's.
    { name: 'left main gear', position: legMid(g.leftMain), area: { x: 0.22, y: 0.06, z: 0.04 }, scale: { kind: 'gear', leg: 1 }, retractedFraction: 0.06 },
    { name: 'right main gear', position: legMid(g.rightMain), area: { x: 0.22, y: 0.06, z: 0.04 }, scale: { kind: 'gear', leg: 2 }, retractedFraction: 0.06 },
    { name: 'nose gear', position: { x: g.nose.x, y: 0, z: 0.5 * (0.36 + g.nose.z) }, area: { x: 0.16, y: 0.05, z: 0.03 }, scale: { kind: 'gear', leg: 0 }, retractedFraction: 0 },
    // Momentum loss of each engine's cooling air, at its cowl-flap exit under the nacelle (inside the jet): open,
    // about 8 % of the cruise drag of a twin's nacelle; closed, 40 % of it (contract 3.1 "Drag that scales").
    ...G.propellers.map(
      (p, i): DragItem => ({
        name: `cooling ${i}`,
        position: { x: p.hub.x - 0.6, y: p.hub.y, z: p.hub.z + 0.3 },
        area: { x: 0.05, y: 0, z: 0 },
        scale: { kind: 'cowlFlap', engine: i },
        retractedFraction: 0.4,
      }),
    ),
    // Leakage and protuberances (antennas, steps, fuel caps, vents, exhaust stacks, doors, flap and aileron gaps)
    // plus the wing-body, nacelle-wing and tail junctions' interference drag: about 10 % of the zero-lift drag of a
    // retractable twin (Raymer, "Aircraft Design", sec. 12.5; Roskam Part VI ch. 4).
    { name: 'miscellaneous', position: { x: 0, y: 0, z: 0 }, area: { x: 0.045, y: 0.02, z: 0.02 } },
  ];
}

/**
 * Stall-warning margins of the two electric lift detectors on the left wing's leading edge outboard of the nacelle
 * (s.9): the outboard vane works with flaps 0 and 10, the inboard one with 25 and 40. How far below the strip's stall
 * break each sounds, rad: the horn 5-10 mph before the stall (s.11).
 */
const OUTBOARD_VANE_MARGIN = 8 * DEG;
const INBOARD_VANE_MARGIN = 10 * DEG;
/** The flap angle at which the detectors change over: between the 10 and 25 degree detents. */
const VANE_CHANGEOVER = 17.5 * DEG;

/** One propeller station: the disc, and the wing blowing of its jet. */
const station = (p: (typeof G.propellers)[number]): PropellerStation => ({ hub: { ...p.hub }, radius: p.diameter / 2, wingBlowing: WING_BLOWING });

/** The aerodynamic definition with the stabilator's tab geared `gearing` : 1 (systems.ts). */
export function createPA34AeroDefinition(gearing: number): AircraftAeroDefinition {
  const wing = buildStrips(pa34WingPlanform());
  const outboard = HUB_Y + PROP_RADIUS;
  const inboardVane = wing.findIndex((s) => s.side === -1 && s.span > HUB_Y + NACELLE_HALF_WIDTH && s.span < outboard);
  const outboardVane = wing.findIndex((s) => s.side === -1 && s.span > outboard && s.span < G.wing.flap.outerY);
  const propellers = [station(LEFT_PROP), station(RIGHT_PROP)];
  // The jets' path grids (contract 3.1 "Jet-path grid"): rows 1.2 m either side of each hub, 9 heights at 0.3 m, and
  // with the hub's own station 8 path stations from 0.4 m behind the disc to 0.8 m behind the tail.
  const first = RIGHT_PROP.hub.x - 0.4, last = G.fuselage.tailX - 0.8;
  return {
    referenceArea: G.wing.area,
    referenceChord: G.wing.meanChord,
    referenceSpan: G.wing.span,
    wing,
    tail: [...buildStrips(pa34StabilatorPlanform(gearing)), ...buildFin(pa34FinPlanform())],
    fuselage: FUSELAGE,
    nacelles: propellers.map((p) => nacelle(p.hub)),
    dragItems: dragItems(),
    struts: [],
    propellers,
    jetStations: Array.from({ length: 7 }, (_, k) => first + ((last - first) * k) / 6),
    jetGrid: { rows: [-1.2, 0, 1.2], column: Array.from({ length: 9 }, (_, k) => -1.2 + 0.3 * k) },
    stallWarning: [
      { strip: outboardVane, margin: OUTBOARD_VANE_MARGIN, flaps: [-1, VANE_CHANGEOVER], needsBus: true },
      { strip: inboardVane, margin: INBOARD_VANE_MARGIN, flaps: [VANE_CHANGEOVER, 1], needsBus: true },
    ],
  };
}
