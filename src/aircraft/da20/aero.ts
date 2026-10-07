// Diamond DA20-C1: the aerodynamic definition (a factory: strips carry section objects), built from the shared
// geometry (geometry.ts) the way physics/aero/c172Aero.ts builds the Cessna 172S's: geometry and section data, no
// stability derivatives and no correction factors on whole-aircraft totals.
//
// Sources beyond geometry.ts: the type's engineering data sheet (aircraft-data/da20.md in the design work folder,
// "s.N" its section N) and the section data of aircraft-data/sections.md (FX 63-137). The airframe is a smooth,
// rivet-free composite: low cantilever wing carried through the fuselage, upturned raked tips, a pod-and-boom
// fuselage, a swept fin with the tailplane on its tip, spatted fixed gear. Of the calibration knobs of contract 3.1,
// incidence and washout are the sheet's estimates (root -2, tip -4 degrees); the wing section's stall break, the skin
// factor and the fuselage's drag moved from their first estimates and say so where they are set.

import { DEG, type Vec3 } from '../../core/math';
import { bodyAxisZ, type DragItem, type FuselageDefinition } from '../../physics/aero/bodies';
import { viternaCd90, type AircraftAeroDefinition } from '../../physics/aero/definition';
import { FX_63_137, NACA_0012 } from '../../physics/aero/sections';
import { buildFin, buildStrips, type FinPlanform, type Planform, type PlanformStation } from '../../physics/aero/strips';
import { DA20_GEOMETRY, da20FrlZ, da20NoseX } from './geometry';

const G = DA20_GEOMETRY;

/** Lift effectiveness of the plain control surfaces relative to thin-aerofoil theory (c172Aero.ts VISCOUS). */
const VISCOUS = { aileron: 0.6, elevator: 0.88, rudder: 0.8 };
/** Lift-slope loss through the elevator's hinge gap (c172Aero.ts HINGE_GAP_LEAKAGE): a smaller gap on the moulded tail. */
const HINGE_GAP_LEAKAGE = 0.95;
/**
 * Surface drag factor on the smooth section's: a painted composite skin without rivets or laps (contract 3.1: about
 * 1.0-1.1), at the top of the range for a trainer's wing in service (bugs, rain erosion, the stall strips).
 */
const COMPOSITE_SKIN = 1.1;

/**
 * The wing section: Wortmann FX 63-137/20 HOAC from root to tip (AFM 1.5.2; s.2.2), a per-type copy of the
 * provisional record of sections.ts (fitted at Re 0.5e6 on the clean wind-tunnel model, c_l,max 1.75 held at every
 * Reynolds number), refitted here as sections.md 3.6 and 5.4 item 5 ask (contract 3.1's knob: stallPos within the
 * published c_l,max range):
 *  - The break 3 degrees earlier: c_l,max 1.56 at 17 degrees at the stall's Reynolds number (2.5e6), against the
 *    record's 1.75. sections.md 3.6 gives 1.70-1.80 for a clean section and 1.50-1.60 with early transition (the
 *    tripped model: 1.53): a production wing in service with the outboard stall strips (s.2.2) is the latter.
 *    Calibrated on the AFM's stall speeds at the forward limit (5.3.4): with the record the clean stall came at 49.8
 *    KCAS (AFM 54), and the whole aircraft's C_L,max was 1.68 where the AFM implies 1.43.
 *  - The collapse past the break stays the record's (8.7 degrees after it, now from 17 degrees): a stall that is
 *    soft, well signalled and breaks straight ahead (s.11), not measured.
 *  - Drag and moment are the record's: cd,min 0.0087 at Re 0.5e6 falls as Re^-0.2 to 0.0063 at 2.5e6 (XFOIL 0.0073
 *    at 1e6), times the composite skin factor below.
 */
const WING = { ...FX_63_137, stallPos: FX_63_137.stallPos - 3 * DEG };

/** Span coordinate (arc length) at the end of the upturned tip. */
const TIP_SPAN = G.wing.winglet!.rootY! + G.wing.winglet!.height;

/** The wing's planform (a fresh object on every call): one tapered panel and the raked, upturned tip. */
export function da20WingPlanform(): Planform {
  const w = G.wing;
  const tip = w.winglet!;
  const [centre, outer] = w.breaks!;
  const zAt = (y: number) => w.quarterChord.z - Math.max(y - w.rootY, 0) * Math.tan(w.dihedral);
  const qcXAt = (y: number) => centre.qcX + ((outer.qcX - centre.qcX) * y) / outer.y;
  const chordAt = (y: number) => centre.chord + ((outer.chord - centre.chord) * y) / outer.y;
  // The washout runs linearly from the root rib to the start of the tip; the tip keeps the outer incidence.
  const incAt = (y: number) => w.rootIncidence + ((w.tipIncidence - w.rootIncidence) * Math.max(y - w.rootY, 0)) / (outer.y - w.rootY);
  const station = (y: number): PlanformStation => ({ span: y, qc: { x: qcXAt(y), y, z: zAt(y) }, chord: chordAt(y), incidence: incAt(y) });
  // The tip as one straight piece along its cant, its leading edge raked back by `sweep` (geometry.ts).
  const leOuter = outer.qcX + 0.25 * outer.chord;
  const leEnd = leOuter - (G.wing.span / 2 - outer.y) * Math.tan(tip.sweep);
  const end: PlanformStation = {
    span: TIP_SPAN,
    qc: { x: leEnd - 0.25 * tip.tipChord, y: G.wing.span / 2, z: zAt(outer.y) - tip.height * Math.sin(tip.cant) },
    chord: tip.tipChord,
    incidence: w.tipIncidence,
  };
  return {
    surface: 'wing',
    section: WING,
    mirror: true,
    stations: [station(0), station(w.rootY), station(outer.y), end],
    // The carry-over strip across the fuselage, then 9 strips per side on the panel (one inboard of the flap, 5 over
    // the flap, 3 over the aileron, the last one running to the start of the tip) and two on the tip: 23 strips,
    // the C172S's 22 (contract 3.10: the cost of a trim and reset).
    centre: 'carryover',
    edges: [w.rootY, w.flap.innerY, 1.35, 1.85, 2.35, 2.8, w.flap.outerY, 3.83, 4.4, outer.y, outer.y + tip.height / 2, TIP_SPAN],
    controls: [
      {
        source: 'flaps',
        gain: 1,
        // Slotted flaps hinged on external brackets below the wing (s.2.3): little aft travel.
        geometry: { kind: 'slotted', chordFraction: w.flap.chordFraction, fowler: 0.04, fowlerDeflection: w.flap.maxDeflection },
        from: w.flap.innerY,
        to: w.flap.outerY,
      },
      {
        source: 'aileronRight',
        mirrorSource: 'aileronLeft',
        gain: 1,
        // Plain, push-rod operated, mass-balanced (s.2.3).
        geometry: { kind: 'plain', chordFraction: w.aileron.chordFraction, viscousEffectiveness: VISCOUS.aileron },
        from: w.aileron.innerY,
        to: w.aileron.outerY,
      },
    ],
    cd90: viternaCd90((w.span * w.span) / w.area),
    skinFactor: COMPOSITE_SKIN,
  };
}

/**
 * Tailplane on the fin's tip (contract 3.1 "T-tail junction"): no centre strip, the two halves meet in the plane of
 * symmetry at the fin's tip. Leading edge swept, straight hinge line, symmetric section (s.2.4: believed FX
 * 71-L-150/30; the NACA 0012 record is the sheet's stand-in). The one-piece elevator runs the full span.
 */
export function da20TailplanePlanform(): Planform {
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
    // Three strips a side (the cost of a trim and reset, contract 3.10).
    edges: [0, 0.45, 0.9, half],
    controls: [
      {
        source: 'elevator',
        gain: 1,
        geometry: { kind: 'plain', chordFraction: h.elevator.chordFraction, viscousEffectiveness: VISCOUS.elevator },
        from: 0,
        to: half,
      },
    ],
    cd90: viternaCd90((h.span * h.span) / h.area),
    skinFactor: COMPOSITE_SKIN,
    liftSlopeFactor: HINGE_GAP_LEAKAGE,
  };
}

/**
 * Fin: swept, continued down to the tail boom's axis (see buildFin), its tip at the tailplane's root quarter-chord
 * point so the junction closes (contract 3.1; geometry.ts's own fin tip is 2 cm aft of it). Symmetric, NACA 0012.
 */
export function da20FinPlanform(): FinPlanform {
  const v = G.vTail;
  const h = G.hTail;
  return {
    section: NACA_0012,
    base: v.base,
    tip: { x: h.quarterChord.x, z: h.quarterChord.z },
    rootChord: v.rootChord,
    tipChord: v.tipChord,
    axisZ: bodyAxisZ(FUSELAGE, v.base.x),
    edges: [0.3, 0.6],
    controls: [
      {
        source: 'rudder',
        gain: 1,
        geometry: { kind: 'plain', chordFraction: v.rudder.chordFraction, viscousEffectiveness: VISCOUS.rudder },
        // The rudder runs from the ventral skid to the tailplane.
        from: 0,
        to: v.height,
      },
    ],
    cd90: viternaCd90((v.height * v.height) / v.area),
    skinFactor: COMPOSITE_SKIN,
  };
}

/** Thrust line height in these axes (geometry.ts: 0.05 m above FRL, 0.12 m above the reference point). */
const THRUST_Z = G.propellers[0].hub.z;
/** End of the tail boom under the rudder hinge (s.12 station 12, x_nose 6.55), closed off 0.1 m behind it. */
const BOOM_END = da20NoseX(6.65);

/** A station of s.12's fuselage table: x from the spinner tip, width, height, section centre above FRL. */
const at = (xNose: number, width: number, height: number, up: number) => ({ x: da20NoseX(xNose), width, height, z: da20FrlZ(up) });

/**
 * Fuselage cross-sections, spinner to the end of the tail boom (s.12's table, 3V-EST). The rudder and the
 * elevator overhang the boom's end (geometry.fuselage.tailX is the elevator's trailing edge): the body ends there.
 */
const FUSELAGE: FuselageDefinition = {
  stations: [
    at(0, 0, 0, 0.06),
    // Cowl front face behind the propeller plane, firewall (the mid-cowl station, x_nose 0.60, lies on the line
    // between them).
    at(0.25, 0.62, 0.42, 0.05),
    at(1.05, 1.0, 0.83, -0.02),
    // Wing root leading edge (RD), canopy apex (the largest section), canopy rear hoop.
    at(1.75, 1.06, 1.12, 0.08),
    at(2.15, G.fuselage.maxWidth, G.fuselage.maxHeight, 0.1),
    at(2.7, 0.92, 1.1, 0.1),
    // The pod pinches into the tail boom (x_nose 5.0 lies on the line from here to the fin root).
    at(3.2, 0.62, 0.91, 0.05),
    at(4.0, 0.55, 0.61, -0.01),
    // Fin root, boom end.
    at(5.8, 0.24, 0.28, -0.04),
    at(6.55, 0.15, 0.17, -0.03),
    { x: BOOM_END, width: 0.04, height: 0.05, z: da20FrlZ(-0.03) },
  ],
  // The pod with its bubble canopy, the cowling and the slender boom: C_D about 0.14 on the ~1 m^2 frontal area
  // (Hoerner, "Fluid-Dynamic Drag", ch. 14: 0.08-0.12 for a faired pod and boom, more with an air-cooled engine's
  // cowling and the canopy frame). Calibrated with the drag items on the AFM's level speeds: 130 KTAS at 2800 rpm
  // (fig 5.7) and 127 KTAS at 76 % at 4000 ft (table 3), which ask about 87 % and 76 % of the 125 hp with this
  // propeller's efficiency (0.86); the sheet's power-on C_D0 of 0.028 assumed 0.78.
  axialDragArea: 0.13,
  // About 75 % of it is skin friction; referred to 100 KTAS at sea level.
  skinFrictionFraction: 0.75,
  referenceReynolds: (1.225 * 51.4 * (G.fuselage.noseX - BOOM_END)) / 1.79e-5,
  // eta about 0.65 for the pod's fineness times Cdc about 1.2 (c172Aero.ts).
  crossflowDrag: 0.8,
  apparentMass: 0.9,
};

function dragItems(): DragItem[] {
  const g = G.gear;
  const mainMid = (side: number): Vec3 => ({ x: g.leftMain.x, y: side * 0.6 * g.rightMain.y, z: 0.5 * (0.45 + g.rightMain.z) });
  return [
    // Flat aluminium leaf-spring legs and spatted 5.00-5 wheels (s.3, s.12; the AFM's speeds are with the fairings:
    // without them climb -3 %, cruise -5 %, AFM 5.3.7, 5.3.9).
    { name: 'left main gear', position: mainMid(-1), area: { x: 0.014, y: 0.05, z: 0.02 } },
    { name: 'right main gear', position: mainMid(1), area: { x: 0.014, y: 0.05, z: 0.02 } },
    // Slim tubular leg and the spatted 5.00-4 nose wheel.
    { name: 'nose gear', position: { x: g.nose.x, y: 0, z: 0.5 * (0.5 + g.nose.z) }, area: { x: 0.012, y: 0.04, z: 0.015 } },
    // Momentum loss of the engine cooling air (two oval inlets beside the spinner and the chin inlet; no cowl
    // flaps, s.12), inside the slipstream.
    { name: 'cooling', position: { x: 1.5, y: 0, z: THRUST_Z + 0.05 }, area: { x: 0.035, y: 0, z: 0 } },
    // Leakage and protuberances (canopy and control-surface gaps, flap hinge brackets, the aileron balance arms,
    // the exhaust stub, steps, antennas) and the junctions' interference: about 10 % of the zero-lift drag of a
    // clean composite trainer (Raymer, "Aircraft Design", sec. 12.5).
    { name: 'miscellaneous', position: { x: 0, y: 0, z: 0 }, area: { x: 0.035, y: 0.02, z: 0.02 } },
  ];
}

/**
 * Stall-warning margin of the pneumatic port (the red-ringed hole in the left wing's leading edge, s.9): how far
 * below the strip's stall break the reed horn sounds, rad. It must sound at least 5 kt before the stall (AFM 7.13):
 * about 9 kt (CAS) clean and 6 kt with flaps LDG, where the FX section's soft break lets the warning come early.
 */
const WARNING_MARGIN = 6 * DEG;

/** Fraction of the propeller's swirl the tail strips see (PropellerStation.swirlBehindWing; see the station below). */
const SWIRL_BEHIND_WING = 0.5;

export function createDA20AeroDefinition(): AircraftAeroDefinition {
  const wing = buildStrips(da20WingPlanform());
  // The port sits in the left wing's leading edge just outboard of the flap, where the washed-out panel still
  // stalls with flaps LDG; its suction drives the horn in the panel, so it works with the master off.
  const sensor = wing.findIndex((s) => s.side === -1 && s.span > 3.27 && s.span < 3.83);
  const prop = G.propellers[0];
  return {
    referenceArea: G.wing.area,
    referenceChord: G.wing.meanChord,
    referenceSpan: G.wing.span,
    wing,
    tail: [...buildStrips(da20TailplanePlanform()), ...buildFin(da20FinPlanform())],
    fuselage: FUSELAGE,
    dragItems: dragItems(),
    struts: [],
    // The low wing's root sections and the wing-body junction lie across the jet and straighten much of its swirl
    // before the fin, which stands in the jet's core behind the slim boom (contract 3.1 PropellerStation,
    // D-D-da20-phys-04): with the full swirl the idle slipstream alone turned the aircraft 10.8 deg/s on a 5 kt
    // taxi, and the take-off roll swung 3.5 x the 172S's. Set on the pedal-taxi item and the roll's swing.
    propellers: [{ hub: { ...prop.hub }, radius: prop.diameter / 2, swirlBehindWing: SWIRL_BEHIND_WING }],
    stallWarning: { strip: sensor, margin: WARNING_MARGIN },
  };
}
