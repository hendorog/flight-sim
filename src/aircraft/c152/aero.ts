// Cessna 152 (1978 model): the aerodynamic definition (a factory: strips carry section objects), built from the
// shared geometry (geometry.ts) the way physics/aero/c172Aero.ts builds the Cessna 172S's: geometry and section data,
// no stability derivatives and no correction factors on whole-aircraft totals.
//
// Sources beyond geometry.ts: the type's engineering data sheet (aircraft-data/c152.md in the design work folder,
// "s.N" its section N) and, for what the two Cessnas share (the Frise ailerons, the unsealed elevator hinge, the
// production skin, the Para-Lift flaps on tracks), the reasoning written out in c172Aero.ts. Of the contract's
// calibration knobs (section 3.1) one is moved from its first estimate: the root section's stall break
// (WING_ROOT). Incidence and washout are the sheet's; skin factor, fuselage drag and drag items are first
// estimates that already give the handbook's speeds, climb and glide.

import { DEG, type Vec3 } from '../../core/math';
import { bodyAxisZ, type DragItem, type FuselageDefinition, type LiftingStrut } from '../../physics/aero/bodies';
import { viternaCd90, type AircraftAeroDefinition } from '../../physics/aero/definition';
import { NACA_0009, NACA_0012, NACA_2412 } from '../../physics/aero/sections';
import { buildFin, buildStrips, type FinPlanform, type Planform } from '../../physics/aero/strips';
import { C152_GEOMETRY } from './geometry';

const G = C152_GEOMETRY;

/** Lift effectiveness of the plain control surfaces relative to thin-aerofoil theory (c172Aero.ts VISCOUS): the same family of surfaces. */
const VISCOUS = { aileron: 0.56, elevator: 0.88, rudder: 0.8, tab: 0.75 };
/** Lift-slope loss through the unsealed elevator hinge gap (c172Aero.ts HINGE_GAP_LEAKAGE). */
const HINGE_GAP_LEAKAGE = 0.9;
/** Frise aileron balance-nose drag (FlapGeometry.friseNoseDrag). */
const FRISE_NOSE_DRAG = 0.08;
/**
 * Production-surface drag factor on the smooth section's: riveted, painted aluminium with corrugated control
 * surfaces ("V" beads on the ailerons and flaps, s.2.1, s.12), between the NACA smooth and standard-roughness data.
 */
const PRODUCTION_SKIN = 1.35;

/**
 * Wing sections (contract 3.1: the C152 is the user of the spanwise blend). NACA 2412 from the root to the strut
 * station, blending linearly to NACA 0012 at the tip rib (s.2.1: Jane's "tips symmetrical"; UIUC list "root 2412,
 * tip 0012"). The blend adds about 2 degrees of aerodynamic washout on top of the 1 degree of twist. Per-type
 * copies of sections.ts's records, which this type calibrates (sections.ts is never edited).
 *
 * Root: the stall break 2 degrees earlier than the smooth-model record, which puts c_l,max at 1.44 at the
 * stall's Reynolds number (2.5e6; 1.50 at 5.7e6) where the record gives 1.62 (1.69): between Abbott & von
 * Doenhoff's smooth (about 1.6) and standard-roughness (about 1.3) polars, as the production skin's drag is.
 * Calibrated on the POH stall speeds at the forward limit (fig 5-3: 48 KCAS clean, 43 KCAS flaps 30), which the
 * record undershot by 2 kt clean, and on the stall-recovery block: with the record's later break, full aft yoke
 * at idle could not take the wing past its maximum lift at the forward limit (the elevator ran out first).
 */
const WING_ROOT = { ...NACA_2412, stallPos: NACA_2412.stallPos - 2 * DEG };
const WING_TIP = { ...NACA_0012 };

/** The wing's planform (a fresh object on every call). */
export function c152WingPlanform(): Planform {
  const w = G.wing;
  const zAt = (y: number) => w.quarterChord.z - Math.max(y - w.rootY, 0) * Math.tan(w.dihedral);
  // The inboard panel is a constant-chord box at the root incidence ("no twist from root to lift strut station",
  // SM 17-8); the 1 degree of washout lies in the tapered outer panel only.
  const incAt = (y: number) =>
    y <= w.taperStartY ? w.rootIncidence : w.rootIncidence + ((w.tipIncidence - w.rootIncidence) * (y - w.taperStartY)) / (w.span / 2 - w.taperStartY);
  const qc = (y: number): Vec3 => ({ x: w.quarterChord.x, y, z: zAt(y) });
  const tip = w.span / 2;
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
    // The centre section over the cabin roof (two lifting strips, no flap: see Strip.bodySection), then 10 strips
    // per side: 4 over the flap (root rib to the strut rib), 5 over the aileron and the tip.
    centre: 'body',
    edges: [w.rootY, 0.92, 1.33, 1.73, w.flap.outerY, 2.67, 3.21, 3.75, 4.29, w.aileron.outerY, tip],
    controls: [
      {
        source: 'flaps',
        gain: 1,
        // Single-slotted "Para-Lift" flaps that run aft on tracks as they extend (s.2.1), like the 172's.
        geometry: { kind: 'slotted', chordFraction: w.flap.chordFraction, fowler: 0.1, fowlerDeflection: w.flap.maxDeflection },
        from: w.flap.innerY,
        to: w.flap.outerY,
      },
      {
        source: 'aileronRight',
        mirrorSource: 'aileronLeft',
        gain: 1,
        // Modified Frise ailerons, differential (s.2.1).
        geometry: { kind: 'plain', chordFraction: w.aileron.chordFraction, viscousEffectiveness: VISCOUS.aileron, friseNoseDrag: FRISE_NOSE_DRAG },
        from: w.aileron.innerY,
        to: w.aileron.outerY,
      },
    ],
    cd90: viternaCd90((w.span * w.span) / w.area),
    skinFactor: PRODUCTION_SKIN,
  };
}

/**
 * Tailplane: fixed stabiliser and elevator low on the tailcone, leading edge swept, straight hinge line (s.2.2),
 * thin symmetric section (about NACA 0009, s.2.2 ESTIMATE). The quarter-chord runs from the root point to the tip's.
 */
export function c152TailplanePlanform(): Planform {
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
    // Centre strip across the tailcone (0.27 m wide at the stabiliser's leading edge, s.12), then 4 per side.
    edges: [0.15, 0.5, 0.85, 1.2, half],
    controls: [
      {
        source: 'elevator',
        gain: 1,
        geometry: { kind: 'plain', chordFraction: h.elevator.chordFraction, viscousEffectiveness: VISCOUS.elevator },
        from: 0.15,
        to: half,
      },
      // Trim tab along the trailing edge of the right elevator (POH sect. 7, s.2.2); about 0.08 m of chord.
      {
        source: 'elevatorTrim',
        mirrorSource: null,
        gain: 1,
        geometry: { kind: 'plain', chordFraction: 0.09, viscousEffectiveness: VISCOUS.tab },
        from: 0.2,
        to: 1.35,
      },
    ],
    cd90: viternaCd90((h.span * h.span) / h.area),
    skinFactor: PRODUCTION_SKIN,
    liftSlopeFactor: HINGE_GAP_LEAKAGE,
  };
}

/** Fin: swept, continued down to the tailcone axis (see buildFin), one strip inside the tailcone and four above it. */
export function c152FinPlanform(): FinPlanform {
  const v = G.vTail;
  return {
    // Thin symmetric, about NACA 0009 (s.2.3 ESTIMATE); the 0012 record as the 172's fin, its thicker
    // stall a stand-in for the dorsal fairing's.
    section: NACA_0012,
    base: v.base,
    tip: v.tip,
    rootChord: v.rootChord,
    tipChord: v.tipChord,
    axisZ: bodyAxisZ(FUSELAGE, v.base.x),
    edges: [0.3, 0.65, 1.0],
    controls: [
      {
        source: 'rudder',
        gain: 1,
        geometry: { kind: 'plain', chordFraction: v.rudder.chordFraction, viscousEffectiveness: VISCOUS.rudder },
        // The rudder runs the full height, horn included.
        from: 0,
        to: v.height,
      },
    ],
    cd90: viternaCd90((v.height * v.height) / v.area),
    skinFactor: PRODUCTION_SKIN,
  };
}

/** Lateral added mass of the slab-sided cabin relative to its inscribed ellipse (c172Aero.ts CABIN_LATERAL_MASS). */
const CABIN_LATERAL_MASS = 1.3;
/** Thrust line height in these axes (geometry.ts: 0.10 m below the reference point). */
const THRUST_Z = G.propellers[0].hub.z;
/** Tailcone end, below the rudder (FS 221, s.2.5): the body ends here, not at geometry.fuselage.tailX (the rudder's trailing edge). */
const TAILCONE_X = -4.76;

/**
 * Fuselage cross-sections (x, width, height, centre z), spinner to tailcone end: s.12's table (x from the spinner
 * tip; centre offset above the thrust line), converted to these axes.
 */
const FUSELAGE: FuselageDefinition = {
  stations: [
    { x: G.fuselage.noseX, width: 0, height: 0, z: THRUST_Z },
    // Spinner base, propeller plane, cowl nose cap.
    { x: 1.77, width: 0.88, height: 0.47, z: THRUST_Z + 0.03 },
    { x: 1.29, width: 0.95, height: 0.7, z: THRUST_Z + 0.09 },
    // Firewall.
    { x: 0.85, width: 0.97, height: 0.82, z: THRUST_Z + 0.13 },
    // Forward door post, windshield; the cabin is a slab-sided box (FuselageStation.lateralMass).
    { x: 0.38, width: 1.02, height: 1.23, z: THRUST_Z - 0.06, lateralMass: CABIN_LATERAL_MASS },
    { x: -0.07, width: G.fuselage.maxWidth, height: G.fuselage.maxHeight, z: THRUST_Z - 0.12, lateralMass: CABIN_LATERAL_MASS },
    // Rear door post, main gear bulkhead.
    { x: -0.59, width: 1.0, height: 1.28, z: THRUST_Z - 0.15, lateralMass: CABIN_LATERAL_MASS },
    // Aft cabin bulkhead, the end of the rear window.
    { x: -1.57, width: 0.74, height: 0.62, z: THRUST_Z + 0.04 },
    { x: -2.54, width: 0.5, height: 0.45, z: THRUST_Z - 0.02 },
    // Stabiliser leading edge, elevator hinge.
    { x: -3.56, width: 0.27, height: 0.27, z: THRUST_Z - 0.09 },
    { x: -4.24, width: 0.12, height: 0.15, z: THRUST_Z - 0.13 },
    { x: TAILCONE_X, width: 0.05, height: 0.08, z: THRUST_Z - 0.14 },
  ],
  // Cabin, cowling, windshield and tailcone: C_D about 0.2 on the ~1 m^2 frontal area (Hoerner, "Fluid-Dynamic
  // Drag", ch. 14: 0.15-0.3 for light-aircraft cabin fuselages).
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
  const s = G.wing.strut!;
  const strutMid = (side: number): Vec3 => ({ x: 0.5 * (s.fuselage.x + s.wing.x), y: side * 0.5 * (s.fuselage.y + s.wing.y), z: 0.5 * (s.fuselage.z + s.wing.z) });
  const mainMid = (side: number): Vec3 => ({ x: g.leftMain.x, y: side * 0.7 * g.rightMain.y, z: 0.5 * (0.6 + g.rightMain.z) });
  return [
    // Tapered tubular spring-steel main legs and 6.00-6 wheels with their brakes, unfaired (s.3: the optional
    // fairings are left off, as on most trainers; Hoerner ch. 13: an exposed tyre about 0.25 on its frontal area).
    { name: 'left main gear', position: mainMid(-1), area: { x: 0.04, y: 0.05, z: 0.03 } },
    { name: 'right main gear', position: mainMid(1), area: { x: 0.04, y: 0.05, z: 0.03 } },
    // Oleo, fork, shimmy damper and the 5.00-5 wheel, unfaired.
    { name: 'nose gear', position: { x: g.nose.x, y: 0, z: 0.5 * (0.55 + g.nose.z) }, area: { x: 0.035, y: 0.04, z: 0.02 } },
    // Streamlined lift struts, ~1.9 m long, 0.11 m chord (s.2.1).
    { name: 'left strut', position: strutMid(-1), area: { x: 0.0105, y: 0.05, z: 0.18 } },
    { name: 'right strut', position: strutMid(1), area: { x: 0.0105, y: 0.05, z: 0.18 } },
    // Momentum loss of the engine cooling air through the two nose-cowl inlets (fixed ram air, no cowl flaps,
    // s.4), inside the slipstream.
    { name: 'cooling', position: { x: 1.4, y: 0, z: THRUST_Z }, area: { x: 0.04, y: 0, z: 0 } },
    // Leakage and protuberances (antennas, steps, fuel caps, vents, the exhaust stub, door, flap and aileron gaps)
    // plus the junctions' interference drag: about 12 % of the zero-lift drag of a strut-braced, fixed-gear light
    // aircraft (Raymer, "Aircraft Design", sec. 12.5; Roskam Part VI ch. 4).
    { name: 'miscellaneous', position: { x: 0, y: 0, z: -0.3 }, area: { x: 0.055, y: 0.02, z: 0.02 } },
  ];
}

/** The two lift struts: streamlined tubes of 0.11 m chord from the lower fuselage to the wing (c172Aero.ts struts). */
function struts(): LiftingStrut[] {
  const s = G.wing.strut!;
  const side = (k: number): LiftingStrut => ({
    name: k < 0 ? 'left strut' : 'right strut',
    root: { x: s.fuselage.x, y: k * s.fuselage.y, z: s.fuselage.z },
    tip: { x: s.wing.x, y: k * s.wing.y, z: s.wing.z },
    chord: 0.11,
    liftSlope: 4.5,
    clMax: 0.6,
  });
  return [side(-1), side(1)];
}

/**
 * Stall-warning margin of the pneumatic slot: how far below the strip's stall break it sounds, rad. Set so the horn
 * sounds about 6 kt (CAS) before the stall clean and with flaps 30 (the sheet's 5-10, s.9): about 52 and 49 KIAS,
 * clear of the 55-65 KIAS flaps-down approach.
 */
const WARNING_MARGIN = 6 * DEG;

/**
 * Largest dynamic-pressure loss of the wing's wake at the tail (AircraftAeroDefinition.wake.maxLoss; contract 3.1's
 * wake handle, request D-R-c152-phys-01). The tailplane sits at mid-height of the tailcone, 0.57 m below the wing
 * (s.2.2, "in the flap downwash"), just under the wake of the lowered flap: at 30 degrees its outer strips lie on
 * the lower flank of the flap's wake (centre 0.08-0.20 m above them, half-width 0.35 m; NACA TR 651's two-dimensional
 * centre-line loss there is 0.25). As the speed rises the wake comes down onto them, the loss grows from 0.11 to
 * 0.22 and takes the tail's download with it: with the floating elevator the 152 had no stick-free speed stability
 * with full flap and power, and selecting the last notch hands-off became a steepening dive (defect
 * D-accept-D1-01). The real one shows a mild trim change (s.11) and must be stick-free stable in the landing
 * configuration at the aft limit (CAR 3.120). Capped at 0.1, a tail efficiency of 0.9, the usual figure for a
 * fuselage-mounted tailplane. Flaps 0 to 20 leave the tail outside the wake and are not changed by it.
 */
const WAKE_MAX_LOSS = 0.1;

export function createC152AeroDefinition(): AircraftAeroDefinition {
  const wing = buildStrips(c152WingPlanform());
  // The pneumatic stall-warning slot is in the left wing leading edge just outboard of the strut station (s.9);
  // it sucks the reed horn by the windshield, so it works with the master off.
  const sensor = wing.findIndex((s) => s.side === -1 && s.span > G.wing.flap.outerY && s.span < 3.0);
  const prop = G.propellers[0];
  return {
    referenceArea: G.wing.area,
    referenceChord: G.wing.meanChord,
    referenceSpan: G.wing.span,
    wing,
    tail: [...buildStrips(c152TailplanePlanform()), ...buildFin(c152FinPlanform())],
    fuselage: FUSELAGE,
    dragItems: dragItems(),
    struts: struts(),
    propellers: [{ hub: { ...prop.hub }, radius: prop.diameter / 2 }],
    stallWarning: { strip: sensor, margin: WARNING_MARGIN },
    wake: { maxLoss: WAKE_MAX_LOSS },
  };
}

