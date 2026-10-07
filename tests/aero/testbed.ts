// Aerodynamic test-bed pieces: synthetic definitions built from the Cessna 172S that switch on ONE mechanism of
// the aerodynamic model each, so that mechanism is proven before any real aircraft data exists. None of them is
// an aircraft: the numbers are round, the airframe is the C172's. The assembly's test-beds (tests/fixtures) are
// built from these.
//
//   twinAeroDefinition()        two wing propellers (two jets), nacelle bodies, body bands, the twins' jet grid
//   twinSlipstreams()           the two jets of a co- or counter-rotating pair
//   tTailAeroDefinition()       tailplane on the fin's tip (centre 'none', closed junction)
//   stabilatorAeroDefinition()  all-moving tailplane, with or without its anti-servo tab
//   lowWingAeroDefinition()     wing through the fuselage (centre 'carryover'), at any height
//   wingletWingPlanform()       the C172 wing continued upward at the tips (one lifting line)

import { C172 } from '../../src/core/c172';
import { DEG, type Vec3 } from '../../src/core/math';
import { createC172AeroDefinition, type AircraftAeroDefinition } from '../../src/physics/aero';
import type { FuselageDefinition } from '../../src/physics/aero/bodies';
import { c172FinPlanform, c172TailplanePlanform, c172WingPlanform } from '../../src/physics/aero/c172Aero';
import type { PropellerStation } from '../../src/physics/aero/definition';
import { buildFin, buildStrips, type Planform, type Strip } from '../../src/physics/aero/strips';
import type { Slipstream } from '../../src/physics/interfaces';

/**
 * The C172S definition as the base of a synthetic one (a fresh object each call, free to be changed). Until the
 * C172S golden update it also removed the C172S's legacy linear solve and deficit jet; none is left.
 */
export function baseDefinition(): AircraftAeroDefinition {
  return createC172AeroDefinition();
}

/** Index of the stall-warning strip the C172 definition uses (left wing, just outboard of the flap), in any strip list. */
export function stallSensorStrip(wing: Strip[]): number {
  const flapEnd = C172.wing.flap.outerY;
  const k = wing.findIndex((s) => s.side === -1 && s.span > flapEnd && s.span < flapEnd + 0.9);
  if (k < 0) throw new Error('test-bed: no wing strip just outboard of the flap for the stall sensor');
  return k;
}

// ---------------------------------------------------------------------------------------------- twin

export interface TwinOptions {
  /** Lateral station of the two hubs, m. Default 1.9 (the contract's test-bed twin). */
  hubY?: number;
  /** Nacelle bodies behind the propellers, and the wing strips across them as body bands. Default true. */
  nacelles?: boolean;
  /** PropellerStation.wingBlowing of both propellers. Default: absent (1). */
  wingBlowing?: number;
  /** Jet path grid about each hub (the twins' 3 x 9 x 8). Default true; false = the model's absolute default tables. */
  hubGrid?: boolean;
}

/** Half-width of the test-bed nacelle, m (the band of wing strips that lie on it). */
export const TWIN_NACELLE_HALF_WIDTH = 0.3;
/** Hub position of the right propeller: 1.1 m ahead of the leading edge, 0.17 m below the wing's chord plane. */
export const twinHub = (hubY = 1.9): Vec3 => ({ x: 1.5, y: hubY, z: C172.wing.quarterChord.z + 0.17 });
export const TWIN_PROP_RADIUS = C172.prop.diameter / 2;

/** A nacelle 2.3 m long and 0.6 m wide behind the disc at `hub` (stations relative to its own axis). */
export function twinNacelle(hub: Vec3): FuselageDefinition {
  return {
    stations: [
      { x: hub.x - 0.05, width: 0, height: 0, z: 0 },
      { x: hub.x - 0.2, width: 0.3, height: 0.3, z: 0 },
      { x: hub.x - 0.5, width: 2 * TWIN_NACELLE_HALF_WIDTH, height: 0.66, z: 0.03 },
      { x: hub.x - 1.3, width: 2 * TWIN_NACELLE_HALF_WIDTH, height: 0.7, z: 0.05 },
      { x: hub.x - 1.9, width: 0.4, height: 0.45, z: 0.02 },
      { x: hub.x - 2.35, width: 0.08, height: 0.12, z: 0 },
    ],
    axialDragArea: 0.03,
    skinFrictionFraction: 0.7,
    referenceReynolds: (1.225 * 51.4 * 2.3) / 1.79e-5,
    crossflowDrag: 0.8,
    apparentMass: 0.85,
    axis: { y: hub.y, z: hub.z },
  };
}

/**
 * The C172 airframe with two wing propellers at y = -/+ hubY (left first, as PowerplantDef.engines), strip edges
 * at each hub and one disc radius to either side of it, a nacelle behind each disc with the wing strips across
 * it as a body band, and no propeller on the nose.
 */
export function twinAeroDefinition(o: TwinOptions = {}): AircraftAeroDefinition {
  const def = baseDefinition();
  const hubY = o.hubY ?? 1.9;
  const R = TWIN_PROP_RADIUS;
  const w = C172.wing;
  const half = TWIN_NACELLE_HALF_WIDTH;
  const withNacelles = o.nacelles ?? true;
  const planform: Planform = {
    ...c172WingPlanform(),
    // The jet's edges and axis, the nacelle's sides, the flap's and the aileron's ends; 11 strips a side.
    edges: [w.rootY, hubY - R, hubY - half, hubY, hubY + half, w.flap.outerY, hubY + R, 3.5, 4.2, 4.7, w.aileron.outerY, w.span / 2],
    bodyBands: withNacelles ? [{ from: hubY - half, to: hubY + half }] : undefined,
  };
  def.wing = buildStrips(planform);
  const right = twinHub(hubY);
  const station = (side: -1 | 1): PropellerStation => {
    const s: PropellerStation = { hub: { x: right.x, y: side * hubY, z: right.z }, radius: R };
    if (o.wingBlowing !== undefined) s.wingBlowing = o.wingBlowing;
    return s;
  };
  def.propellers = [station(-1), station(1)];
  if (withNacelles) def.nacelles = def.propellers.map((p) => twinNacelle(p.hub));
  if (o.hubGrid ?? true) {
    // Rows 1.2 m either side of the hub, 9 heights at 0.3 m, and with the hub's own station 8 path stations from
    // 0.4 m behind the disc to 0.8 m behind the tail: 216 points a jet.
    const first = right.x - 0.4, last = C172.fuselage.tailX - 0.8;
    def.jetStations = Array.from({ length: 7 }, (_, k) => first + ((last - first) * k) / 6);
    def.jetGrid = { rows: [-1.2, 0, 1.2], column: Array.from({ length: 9 }, (_, k) => -1.2 + 0.3 * k) };
  }
  def.stallWarning = { strip: stallSensorStrip(def.wing), margin: 7.8 * DEG };
  return def;
}

export interface JetOptions {
  /** True airspeed, m/s (for the far-wake contraction). */
  V: number;
  /** Induced velocity at the disc, m/s; negative = a windmilling propeller taking energy out of the stream. */
  vi: number;
  /**
   * Magnitude of the mean swirl rate, rad/s. Default: 0.6 |vi| / R (a typical cruise-climb ratio). Its sense follows
   * the torque on the air: the rotation's for a driving propeller, the opposite for a windmilling one (vi < 0),
   * which the air drives (propeller.ts: the swirl carries the signed shaft torque).
   */
  swirl?: number;
}

/**
 * One propeller's slipstream at its station, by actuator-disc momentum theory (the far wake contracts behind a
 * driving propeller and expands behind a windmilling one); `rotation` +1 = clockwise from the cockpit.
 */
export function jetAt(station: PropellerStation, o: JetOptions, rotation: 1 | -1 = 1): Slipstream {
  const far = o.V + 2 * o.vi > 0.1 ? Math.sqrt((o.V + o.vi) / (o.V + 2 * o.vi)) : 1;
  const swirl = o.swirl ?? (0.6 * Math.abs(o.vi)) / station.radius;
  const sense = o.vi < 0 ? -rotation : rotation;
  return { origin: { ...station.hub }, radius: station.radius * far, inducedVelocity: o.vi, swirlRate: sense * swirl };
}

/**
 * Both jets of the twin test-bed. 'co': both propellers turn clockwise seen from the cockpit; 'counter': the right
 * one turns the other way (the PA-34 pattern), so the pair is its own mirror image. `left` / `right`: that
 * side's jet, or null for a propeller that makes none (feathered, stopped).
 */
export function twinSlipstreams(def: AircraftAeroDefinition, kind: 'co' | 'counter', left: JetOptions | null, right: JetOptions | null): (Slipstream | null)[] {
  const [l, r] = def.propellers!;
  return [left ? jetAt(l, left, 1) : null, right ? jetAt(r, right, kind === 'co' ? 1 : -1) : null];
}

// ---------------------------------------------------------------------------------------------- tails

/**
 * The C172 with its tailplane moved to the fin's tip: the two halves meet in the plane of symmetry (centre
 * 'none') exactly at the fin tip's quarter-chord point, so the fin-tip trailing leg and the two root legs of the
 * tailplane leave from one point. `tailplane: false` leaves the fin alone (for the end-plate comparison).
 */
export function tTailAeroDefinition(o: { tailplane?: boolean } = {}): AircraftAeroDefinition {
  const def = baseDefinition();
  const fin = c172FinPlanform();
  const base = c172TailplanePlanform();
  const half = C172.hTail.span / 2;
  const planform: Planform = {
    ...base,
    centre: 'none',
    stations: base.stations.map((s) => ({ ...s, qc: { x: fin.tip.x, y: s.qc.y, z: fin.tip.z } })),
    edges: [0, 0.3, 0.65, 1.0, 1.4, half],
    // The elevator runs to the root (no cut-out for a tail cone).
    controls: base.controls.map((c) => (c.source === 'elevator' ? { ...c, from: 0 } : c)),
  };
  def.tail = [...((o.tailplane ?? true) ? buildStrips(planform) : []), ...buildFin(fin)];
  return def;
}

export interface StabilatorOptions {
  /** Fixed incidence added to the whole tailplane, rad (+ = leading edge up): "rotating the strips by hand". */
  incidence?: number;
  /** Anti-servo tab geared to the stabilator (tab angle = gearing x deflection + trim). Default: none. */
  tabGearing?: number;
  /** false: no control at all on the tailplane (the fixed surface of the hand-rotated comparison). Default true. */
  allMoving?: boolean;
  /** Strip edges of one half (the first is the tail cone's half-width). Default: the C172 tailplane's, 4 strips a side. */
  edges?: number[];
}

/** The C172 with an all-moving tailplane (no elevator, no hinge gap), carried through the tail cone. */
export function stabilatorAeroDefinition(o: StabilatorOptions = {}): AircraftAeroDefinition {
  const def = baseDefinition();
  const base = c172TailplanePlanform();
  const half = C172.hTail.span / 2;
  const tab = { kind: 'plain' as const, chordFraction: 0.15, viscousEffectiveness: 0.75 };
  const planform: Planform = {
    ...base,
    stations: base.stations.map((s) => ({ ...s, incidence: s.incidence + (o.incidence ?? 0) })),
    edges: o.edges ?? base.edges,
    liftSlopeFactor: 1,
    controls: [
      ...((o.allMoving ?? true) ? [{ source: 'elevator' as const, gain: 1, geometry: { kind: 'allMoving' as const, chordFraction: 1 }, from: 0, to: half }] : []),
      ...(o.tabGearing !== undefined
        ? [
            { source: 'elevator' as const, gain: o.tabGearing, geometry: tab, from: 0.3, to: half },
            { source: 'elevatorTrim' as const, gain: 1, geometry: tab, from: 0.3, to: half },
          ]
        : []),
    ],
  };
  def.tail = [...buildStrips(planform), ...buildFin(c172FinPlanform())];
  return def;
}

// ---------------------------------------------------------------------------------------------- wings

export interface LowWingOptions {
  /** Height (body z, + down) of the wing's root quarter chord. Default +0.45: through the cabin floor. */
  wingZ?: number;
  /** Dihedral, rad. Default 5 deg. */
  dihedral?: number;
}

/**
 * The C172 with its wing passed through the fuselage as a carry-over strip (the first use of 'carryover' on a
 * wing), with dihedral and without lift struts. `wingZ` puts the same wing anywhere between the cabin floor
 * and the roof line, for the comparison of the fuselage's cross-flow effect on a low and a high wing.
 */
export function lowWingAeroDefinition(o: LowWingOptions = {}): AircraftAeroDefinition {
  const def = baseDefinition();
  const w = C172.wing;
  const z0 = o.wingZ ?? 0.45;
  const dihedral = o.dihedral ?? 5 * DEG;
  const base = c172WingPlanform();
  const planform: Planform = {
    ...base,
    centre: 'carryover',
    stations: base.stations.map((s) => ({ ...s, qc: { x: s.qc.x, y: s.qc.y, z: z0 - Math.max(s.span - w.rootY, 0) * Math.tan(dihedral) } })),
  };
  def.wing = buildStrips(planform);
  def.struts = [];
  def.dragItems = def.dragItems.filter((d) => !d.name.includes('strut'));
  def.stallWarning = { strip: stallSensorStrip(def.wing), margin: 7.8 * DEG };
  return def;
}

/**
 * The C172 wing with a winglet of `height` m (arc length) standing on each tip at `cant` from the horizontal,
 * toed in by `toe` (rad, + = leading edge inboard): extra stations of the same planform, so the winglet's strips
 * are part of the wing's lifting line. Incidence is general (about each strip's own span axis).
 */
export function wingletWingPlanform(height: number, cant = 80 * DEG, toe = 0, strips = 3): Planform {
  const base = c172WingPlanform();
  const tip = base.stations[base.stations.length - 1];
  const chord = 0.6 * tip.chord;
  // The winglet's quarter chord leaves the tip's and sweeps back a little; its tip chord is 60 % of the wing's.
  const top = {
    span: tip.span + height,
    qc: { x: tip.qc.x - 0.3 * height, y: tip.qc.y + height * Math.cos(cant), z: tip.qc.z - height * Math.sin(cant) },
    chord,
    incidence: toe,
  };
  // A second station at the tip lets the incidence step from the wing's washout to the winglet's toe.
  const foot = { ...tip, span: tip.span + 1e-6, incidence: toe };
  return {
    ...base,
    generalIncidence: true,
    stations: [...base.stations, foot, top],
    edges: [...base.edges, ...Array.from({ length: strips }, (_, k) => tip.span + (height * (k + 1)) / strips)],
  };
}
