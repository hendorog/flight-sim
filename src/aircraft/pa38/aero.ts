// Piper PA-38-112 Tomahawk II: the aerodynamic definition (a factory: strips carry section objects), built from the
// shared geometry (geometry.ts) the way physics/aero/c172Aero.ts builds the Cessna 172S's: geometry and section data,
// no stability derivatives and no correction factors on whole-aircraft totals.
//
// Sources beyond geometry.ts: the type's engineering data sheet (aircraft-data/pa38.md in the design work folder,
// "s.N" its section N) and the section data of aircraft-data/sections.md (section 1: NASA LS(1)-0417). What the
// mechanisms are: a low wing with its carry-over strip across the fuselage, a constant-chord wing of one section
// with 2 degrees of linear washout and four stall strips, plain flaps and ailerons, and a T-tail whose fin tip and
// tailplane root meet at one point (contract 3.1 "T-tail junction"). Of the contract's calibration knobs (section
// 3.1) these are moved from their first estimates, each where it is set: the wing section's stall (WING), the
// stall strips' bands (STALL_STRIPS), the plain flap's large-deflection table (FLAP), the skin factor and the
// fuselage and drag-item areas.

import { DEG, type Vec3 } from '../../core/math';
import { bodyAxisZ, type DragItem, type FuselageDefinition } from '../../physics/aero/bodies';
import { viternaCd90, type AircraftAeroDefinition } from '../../physics/aero/definition';
import { NACA_0012, NASA_LS1_0417 } from '../../physics/aero/sections';
import { buildFin, buildStrips, type FinPlanform, type Planform } from '../../physics/aero/strips';
import { PA38_GEOMETRY } from './geometry';

const G = PA38_GEOMETRY;
const IN = 0.0254;
/** Body x of a fuselage station (inches aft of the Piper datum). */
const sta = (station: number) => (77.25 - station) * IN;

/**
 * Lift effectiveness of the plain control surfaces relative to thin-aerofoil theory at small deflection. Flap and
 * aileron: the LS(1)-0417's own 20 % plain surface (sections.md 1.6, NASA CR-2833, gap sealed): 0.54 of theory
 * trailing edge down, 0.69 up; the aileron takes the mean of the two, the flap the downward figure. Elevator,
 * rudder: the 172's (c172Aero.ts VISCOUS).
 */
const VISCOUS = { flap: 0.54, aileron: 0.6, elevator: 0.88, rudder: 0.8 };
/**
 * The elevator's effectiveness at large deflection relative to its 10 degree value, at 0 / 10 / 20 / 30 / 45 / 60 /
 * 90 degrees: DATCOM 6.1.1.1's empirical correction K' for a plain surface of 0.4-0.45 chord (Roskam, "Airplane
 * Design" VI fig. 8.13), which keeps more of its effectiveness than the 0.2-0.25 chord surfaces the generic plain
 * table stands for (0.8 / 0.64 / 0.5 at 20 / 30 / 45 degrees). It sets the speed at which full up elevator lifts the
 * nosewheel (contract 5.2: about 35 KIAS; the T-tail is out of the slipstream).
 */
const ELEVATOR_LARGE_DEFLECTION = [1, 1, 0.88, 0.74, 0.6, 0.5, 0.35];
/** Lift-slope loss through the unsealed elevator hinge gap (c172Aero.ts HINGE_GAP_LEAKAGE). */
const HINGE_GAP_LEAKAGE = 0.9;
/**
 * The plain flap's effectiveness at large deflection relative to its 10 degree value, at 0 / 10 / 20 / 30 / 45 / 60
 * / 90 degrees: the measured ratios of sections.md 1.6 (1.7 / 2.4 / 2.9 / 3.4 times the 10 degree increment at 20 /
 * 30 / 40 / 60 degrees), where the generic plain table falls faster (contract 5.2: brings the large-deflection
 * increments within 8 %).
 */
const FLAP_LARGE_DEFLECTION = [1, 1, 0.86, 0.8, 0.69, 0.57, 0.4];
/**
 * Production-surface drag factor on the section's fully turbulent smooth drag: riveted, painted aluminium. 1.28
 * reproduces TN D-7428's strip-roughness polar (sections.ts, NASA_LS1_0417); the tails' thin sections as the
 * Cessnas'.
 */
const WING_SKIN = 1.3;
const TAIL_SKIN = 1.35;

/**
 * The wing section: NASA LS(1)-0417 (GA(W)-1), the whole span (s.2.1). A per-type copy of sections.ts's record,
 * which this type calibrates (sections.ts is never edited).
 */
const WING = { ...NASA_LS1_0417 };
/**
 * The four flow (stall) strips, two a wing (s.2.1: Tomahawk II, inboard and outboard pairs; AD 83-14-08): small
 * triangular strips on the leading edge that trip the flow early over their span, so the wing stalls there first
 * and the ailerons keep working. Their stations are not published (Piper SL 876; s.2.1 "exact span stations not
 * found"): ESTIMATE, the inboard pair just outboard of the flap's inboard end, the outboard pair just inboard of
 * the aileron. Each band is a copy of the section with the stall break earlier (sections.ts: no lower than
 * 2 s1).
 */
const STRIP_SECTION = { ...WING, stallPos: WING.stallPos - 5 * DEG };
const STALL_STRIPS = [
  { from: G.wing.flap.innerY, to: 1.27, section: STRIP_SECTION },
  { from: 2.5, to: G.wing.flap.outerY, section: STRIP_SECTION },
];

/** Root and tip ribs, where the maintenance manual prints the incidence: wing stations 22.7 and 194.38 in (s.2.1). */
const ROOT_RIB_Y = 22.7 * IN;
const TIP_RIB_Y = 194.38 * IN;

/** The wing's planform (a fresh object on every call). */
export function pa38WingPlanform(): Planform {
  const w = G.wing;
  // The dihedral starts at the fuselage side (geometry.ts: quarterChord.z is the chord plane at the root).
  const zAt = (y: number) => w.quarterChord.z - Math.max(y - w.rootY, 0) * Math.tan(w.dihedral);
  // Linear washout from the root rib to the tip rib (MM fig 1), carried on to the tip cap.
  const incAt = (y: number) => w.rootIncidence + ((w.tipIncidence - w.rootIncidence) * Math.max(y - ROOT_RIB_Y, 0)) / (TIP_RIB_Y - ROOT_RIB_Y);
  const qc = (y: number): Vec3 => ({ x: w.quarterChord.x, y, z: zAt(y) });
  const tip = w.span / 2;
  return {
    surface: 'wing',
    section: WING,
    mirror: true,
    stations: [
      { span: 0, qc: qc(0), chord: w.rootChord, incidence: incAt(0) },
      { span: w.rootY, qc: qc(w.rootY), chord: w.rootChord, incidence: incAt(w.rootY) },
      { span: tip, qc: qc(tip), chord: w.tipChord, incidence: incAt(tip) },
    ],
    // The low wing's spar runs through the fuselage: one carry-over strip across it (contract 3.1 "Low wing"), then
    // 10 strips per side, as the 172's: 4 over the flap (the stall strips' bands on strip edges), 4 over the
    // aileron, the root and the tip cap.
    centre: 'carryover',
    edges: [w.rootY, w.flap.innerY, 1.27, 1.75, 2.5, w.flap.outerY, 3.48, 3.99, 4.49, w.aileron.outerY, tip],
    controls: [
      {
        source: 'flaps',
        gain: 1,
        // Plain flaps hinged at the lower surface (MM chart 2, s.2.2).
        geometry: { kind: 'plain', chordFraction: w.flap.chordFraction, viscousEffectiveness: VISCOUS.flap, largeDeflection: FLAP_LARGE_DEFLECTION },
        from: w.flap.innerY,
        to: w.flap.outerY,
      },
      {
        source: 'aileronRight',
        mirrorSource: 'aileronLeft',
        gain: 1,
        // Plain, differential, mass-balanced (s.2.3).
        geometry: { kind: 'plain', chordFraction: w.aileron.chordFraction, viscousEffectiveness: VISCOUS.aileron },
        from: w.aileron.innerY,
        to: w.aileron.outerY,
      },
    ],
    cd90: viternaCd90((w.span * w.span) / w.area),
    skinFactor: WING_SKIN,
    sectionBands: STALL_STRIPS,
  };
}

/** Inboard end of each elevator half, BL 7.90 (MM fig 2). */
const ELEVATOR_ROOT = 7.9 * IN;

/**
 * Tailplane: a constant-chord fixed stabiliser with a 0.44-chord elevator on top of the fin (s.2.4), symmetric
 * section of about 10-12 % (s.2.4 ESTIMATE: the 0012 record). The two halves meet at the fin tip with nothing
 * between (contract 3.1 "T-tail junction"): the fin's tip station is put at this root quarter-chord.
 */
export function pa38TailplanePlanform(): Planform {
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
    centre: 'none',
    // The fin-top fairing strip, then three over the elevator half and its tip cap (the 172's count).
    edges: [0, ELEVATOR_ROOT, 0.7, 1.15, half],
    controls: [
      {
        // Each half from BL 7.90 to BL 59.13 (MM fig 2): the fin-top fairing between the halves, the tip caps
        // outboard. No tab: the trim is a spring in the circuit (systems.ts).
        source: 'elevator',
        gain: 1,
        geometry: { kind: 'plain', chordFraction: h.elevator.chordFraction, viscousEffectiveness: VISCOUS.elevator, largeDeflection: ELEVATOR_LARGE_DEFLECTION },
        from: ELEVATOR_ROOT,
        to: 59.13 * IN,
      },
    ],
    cd90: viternaCd90((h.span * h.span) / h.area),
    skinFactor: TAIL_SKIN,
    liftSlopeFactor: HINGE_GAP_LEAKAGE,
  };
}

/**
 * Fin: sharply swept, continued down to the tailcone axis (see buildFin). The tip station is the tailplane's root
 * quarter-chord (T-tail junction), 0.146 m ahead of the fin's own tip quarter-chord (geometry.ts: the tailplane sits
 * forward on the fin top), with the fin's tip chord.
 */
export function pa38FinPlanform(): FinPlanform {
  const v = G.vTail;
  const h = G.hTail;
  return {
    // Symmetric, about 0012 (s.2.5 gives no section).
    section: NACA_0012,
    base: v.base,
    tip: { x: h.quarterChord.x, z: h.quarterChord.z },
    rootChord: v.rootChord,
    tipChord: v.tipChord,
    axisZ: bodyAxisZ(FUSELAGE, v.base.x),
    edges: [0.4, 0.8],
    controls: [
      {
        source: 'rudder',
        gain: 1,
        geometry: { kind: 'plain', chordFraction: v.rudder.chordFraction, viscousEffectiveness: VISCOUS.rudder },
        // The rudder runs from the fuselage's bottom line to the fin top (s.2.5).
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
/** Thrust line height in these axes (WL 40.00). */
const THRUST_Z = G.propellers[0].hub.z;
/** Body x of a point given as metres aft of the spinner tip (s.12's table; the spinner tip at STA -3). */
const fromSpinner = (x: number) => sta(x / IN - 3);
/**
 * Tail cone end at the sternpost, STA 261.07 (MM fig 2): the body ends here, not at geometry.fuselage.tailX (the
 * fin-top bullet).
 */
const TAILCONE_X = sta(261.07);

/**
 * Fuselage cross-sections (x, width, height, centre z), spinner to sternpost: s.12's table (x aft of the spinner
 * tip; centre above the thrust line), stations dimensioned in the maintenance manual at their stations.
 */
const FUSELAGE: FuselageDefinition = {
  stations: [
    { x: G.fuselage.noseX, width: 0, height: 0, z: THRUST_Z },
    // Spinner base and propeller disc, cowl front face, mid cowl with the deep chin.
    { x: sta(7.5), width: 0.26, height: 0.26, z: THRUST_Z },
    { x: sta(9.5), width: 0.86, height: 0.53, z: THRUST_Z + 0.08 },
    { x: fromSpinner(0.8), width: 0.96, height: 0.79, z: THRUST_Z + 0.17 },
    // Firewall, windshield base.
    { x: sta(45.3), width: 1.04, height: 0.89, z: THRUST_Z + 0.16 },
    // Wing leading edge, the canopy crown, the rear door post: a flat-sided lower half under the bubble.
    { x: sta(66.25), width: G.fuselage.maxWidth, height: 1.17, z: THRUST_Z + 0.03, lateralMass: CABIN_LATERAL_MASS },
    { x: fromSpinner(2.18), width: G.fuselage.maxWidth, height: G.fuselage.maxHeight, z: THRUST_Z - 0.04, lateralMass: CABIN_LATERAL_MASS },
    { x: sta(96.78), width: 1.1, height: 1.25, z: THRUST_Z - 0.02, lateralMass: CABIN_LATERAL_MASS },
    // Rear window's aft edge (tail cone joint), mid tail cone, fin leading edge, sternpost.
    { x: sta(134.0), width: 0.93, height: 0.91, z: THRUST_Z + 0.03 },
    { x: fromSpinner(4.39), width: 0.71, height: 0.76, z: THRUST_Z - 0.05 },
    { x: fromSpinner(5.28), width: 0.49, height: 0.61, z: THRUST_Z - 0.13 },
    { x: TAILCONE_X, width: 0.15, height: 0.31, z: THRUST_Z - 0.28 },
  ],
  // Cabin, bubble canopy, cowling and tail cone: C_D about 0.2 on the ~1 m^2 frontal area, as the C152's (Hoerner,
  // "Fluid-Dynamic Drag", ch. 14).
  axialDragArea: 0.18,
  // About 70 % of it is skin friction; referred to 90 KTAS at sea level.
  skinFrictionFraction: 0.7,
  referenceReynolds: (1.225 * 46.3 * (G.fuselage.noseX - TAILCONE_X)) / 1.79e-5,
  // As the 172's: eta about 0.65 for its fineness times Cdc about 1.2 for a rounded-box section.
  crossflowDrag: 0.8,
  apparentMass: 0.9,
};

function dragItems(): DragItem[] {
  const g = G.gear;
  // The leaf leg leaves the wing's underside at y = 1.24 m and runs down and out to the wheel (s.3, s.12).
  const mainMid = (side: number): Vec3 => ({ x: g.leftMain.x, y: side * 0.5 * (1.24 + g.rightMain.y), z: 0.5 * (0.45 + g.rightMain.z) });
  return [
    // Single-leaf steel legs and 6.00-6 wheels with their brakes, unfaired (s.3: no wheel fairings; Hoerner ch. 13:
    // an exposed tyre about 0.25 on its frontal area).
    { name: 'left main gear', position: mainMid(-1), area: { x: 0.045, y: 0.05, z: 0.035 } },
    { name: 'right main gear', position: mainMid(1), area: { x: 0.045, y: 0.05, z: 0.035 } },
    // Oleo, scissor link, steering arms and the 6.00-6 nose wheel, unfaired.
    { name: 'nose gear', position: { x: g.nose.x, y: 0, z: 0.5 * (0.45 + g.nose.z) }, area: { x: 0.04, y: 0.045, z: 0.02 } },
    // Momentum loss of the engine cooling air through the two inlets beside the spinner (no cowl flaps, s.4),
    // inside the slipstream.
    { name: 'cooling', position: { x: 1.4, y: 0, z: THRUST_Z }, area: { x: 0.04, y: 0, z: 0 } },
    // Leakage and protuberances (antennas, steps, fuel caps, vents, exhaust stacks, doors, flap and aileron gaps)
    // plus the wing-root and T-tail junctions' interference drag: about 12 % of the zero-lift drag of a fixed-gear
    // light aircraft (Raymer, "Aircraft Design", sec. 12.5; Roskam Part VI ch. 4).
    { name: 'miscellaneous', position: { x: 0, y: 0, z: 0 }, area: { x: 0.05, y: 0.02, z: 0.02 } },
  ];
}

/**
 * Stall-warning margin of the electric lift-detector vane: how far below the strip's stall break it sounds, rad.
 * Set so the horn sounds 5-10 kt before the stall (POH 4.35, s.9).
 */
const WARNING_MARGIN = 10 * DEG;
/**
 * With flap down the vane's margin is larger: the lowered flap's circulation moves the stagnation point down and
 * aft round the leading edge, past the vane, at a lower angle of attack (the C172S and the PA-34 have the same
 * trait; here the flapped strip's break also falls with the flap). Set for the same 5-10 kt with full flap.
 */
const WARNING_MARGIN_FLAPS = 14 * DEG;

export function createPA38AeroDefinition(): AircraftAeroDefinition {
  const wing = buildStrips(pa38WingPlanform());
  // The Safe Flight vane is in the left wing leading edge (POH 7.29, s.9), outboard of the inboard stall strip;
  // it works the horn through the bus.
  const sensor = wing.findIndex((s) => s.side === -1 && s.span > 1.75 && s.span < 2.5);
  const prop = G.propellers[0];
  return {
    referenceArea: G.wing.area,
    referenceChord: G.wing.meanChord,
    referenceSpan: G.wing.span,
    wing,
    tail: [...buildStrips(pa38TailplanePlanform()), ...buildFin(pa38FinPlanform())],
    fuselage: FUSELAGE,
    dragItems: dragItems(),
    struts: [],
    propellers: [{ hub: { ...prop.hub }, radius: prop.diameter / 2 }],
    stallWarning: [
      // The lift detector is electric (horn and light on the master): no warning with a dead bus.
      { strip: sensor, margin: WARNING_MARGIN, flaps: [-1, 10 * DEG], needsBus: true },
      { strip: sensor, margin: WARNING_MARGIN_FLAPS, flaps: [10 * DEG, 1], needsBus: true },
    ],
  };
}
