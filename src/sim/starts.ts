// Flight School starts: a declarative StartSpec (where and how a lesson begins) turned into an ordinary
// Scenario that SimPhysics.resetTo() flies from. Pure and node-safe like scenarios.ts; the types are
// re-exported from src/training/types.ts (spec section 2.8).
//
//   scenario  one of the five free-flight scenarios, unchanged
//   ground    a named ground spot from src/world/airport/layout.ts, engine running or cold and dark
//   air       a trimmed in-flight start over a training area (or a NED point) at an altitude, heading and IAS
//   final     on the 3 degree path to runway 07 at a distance, optionally offset above/below the path
//   circuit   on the left-hand circuit for 07 (downwind or base) at a named position
//   attitude  a trimmed start then rotated to an unusual attitude behind the curtain (fm.setKinematics)
//
// Every airborne start reuses the flight model's trim path (fm.reset(ic) + trimControls), so it begins in
// equilibrium. The `scenario` id of the built Scenario is baseScenario(spec): the reset event and the resume
// snapshot keep using the existing ScenarioId (ScenarioId is deliberately not widened).

import type { ScenarioId } from '../core/context';
import { DEG, FT, NM, wrapTwoPi } from '../core/math';
import { mergeControlPatches, type ControlPatch, type Environment, type InitialConditions } from '../core/types';
import { AIRPORT, runwayDirection, runwayThreshold } from '../core/world';
import { C172S_SIM } from '../aircraft/c172s/sim';
import type { SimProfile } from '../aircraft/types';
import { flapLeverFor } from '../training/aircraft/c172s';
import { getAircraftType } from '../training/aircraft/registry';
import { AREAS } from '../training/geo/areas';
import type { AircraftTypeDef, Ref } from '../training/types';
import { HOLD_SHORT, LINE_UP, PARKING, type NamedPosition } from '../world/airport/layout';
import { DOWNWIND_OFFSET, PATTERN_ALTITUDE, kiasToTas, startOnDownwind, startOnFinal, type AutoflightPlan, type Scenario } from './scenarios';

export type GroundSpot = 'parking' | 'holdA1' | 'holdA2' | 'lineup07';
export type AreaId = 'trainingArea' | 'fieldOverhead' | 'pflHighKey';

export type StartSpec =
  | { kind: 'scenario'; id: ScenarioId }
  | { kind: 'ground'; spot: GroundSpot; engine: 'running' | 'cold' }
  | {
      kind: 'air';
      /** A training area (src/training/geo/areas.ts) or an explicit NED point, m. */
      at: AreaId | { north: number; east: number };
      altFt: number;
      /** 'msl' or 'field' (above the aerodrome elevation, 394 ft). */
      altRef: 'msl' | 'field';
      hdgDeg: number;
      kias: Ref;
      flapsDeg?: number;
      /** Flight path angle, degrees (+ climbing). Default 0. */
      gammaDeg?: number;
    }
  /** On final for 07; heightOffsetFt is the offset from the 3 degree path (+ above). */
  | { kind: 'final'; distNm: number; kias: Ref; flapsDeg: number; heightOffsetFt?: number }
  | { kind: 'circuit'; leg: 'downwind' | 'base'; position: 'early' | 'abeamMid' | 'abeamThr'; kias: Ref; flapsDeg?: number }
  | { kind: 'attitude'; at: AreaId; altFt: number; kias: number; pitchDeg: number; bankDeg: number; hdgDeg: number };

export interface StartOptions {
  /** Fraction of full fuel, 0..1. */
  fuelFraction?: number;
  /** 'forward' (default for all lessons): forward-to-typical CG, where the stall is benign. */
  payload?: 'forward' | 'typical';
  /** Applied on top of the trimmed controls after the reset (switches, lights, flap lever...); merged into the start's own preset. */
  controls?: ControlPatch;
}

/**
 * Resolves a `Ref` (kias fields) to a number. Lesson starts may name a V-speed (`{ vspeed: 'Vcruise' }`);
 * the caller passes a resolver bound to the lesson's aircraft and vars. Without one, implementations
 * resolve plain numbers and `{ vspeed }` against the default aircraft type and reject other ref kinds.
 */
export type StartRefResolver = (r: Ref) => number;

/**
 * Build the Scenario for a StartSpec. `env` supplies the atmosphere (IAS -> TAS) and terrain.
 * (Section 2.8 signature plus the optional resolver: buildStart has no aircraft or vars of its own.)
 * `type` resolves V-speeds and flap detents, `sim` gives the switch presets and the speeds a spec leaves open;
 * both default to the Cessna 172S.
 * Throws on a spec it cannot build (unknown area or ground spot, unresolvable ref): lesson data is linted,
 * so that is a bug, and failing loudly behind the curtain beats starting somewhere wrong.
 */
export function buildStart(
  spec: StartSpec,
  env: Environment,
  opts: StartOptions = {},
  resolve?: StartRefResolver,
  type: AircraftTypeDef = getAircraftType(),
  sim: SimProfile = C172S_SIM,
): Scenario {
  const kias = (r: Ref): number => {
    const v = resolve ? resolve(r) : resolveDefault(r, type);
    if (!Number.isFinite(v) || v <= 0) throw new Error(`buildStart: airspeed ${JSON.stringify(r)} resolved to ${v}`);
    return v;
  };
  const lever = (deg: number | undefined): number => flapLeverFor(type, deg ?? 0);
  const sc = buildBase(spec, env, kias, lever, sim);
  if (opts.fuelFraction !== undefined) sc.ic.fuelFraction = Math.min(1, Math.max(0, opts.fuelFraction));
  sc.payload = opts.payload ?? 'forward';
  if (opts.controls) sc.controls = mergeControlPatches(sc.controls, opts.controls);
  sc.start = JSON.parse(JSON.stringify(spec)) as StartSpec;
  return sc;
}

/** Plain numbers, V-speeds, settings and the field elevation; other refs need the lesson's resolver. */
function resolveDefault(r: Ref, type: AircraftTypeDef): number {
  if (typeof r === 'number') return r;
  const add = r.add ?? 0;
  if ('vspeed' in r) return type.vspeeds[r.vspeed] + add;
  if ('setting' in r) return type.settings[r.setting] + add;
  if ('field' in r) return AIRPORT.elevation / FT + add;
  throw new Error(`buildStart: ${JSON.stringify(r)} needs a lesson resolver`);
}

// The switch presets of the Cessna 172S (C172S_SIM.presets), by their names from before they moved there.
/** Switch settings of an aircraft with the engine running on the ground (after the after-start checks). */
export const GROUND_RUNNING: ControlPatch = C172S_SIM.presets.groundRunning;
/** Lined up: strobes and landing light on, taxi light off (the before-take-off checks done). */
export const LINED_UP: ControlPatch = C172S_SIM.presets.linedUp;
/** Cold and dark, as the 'apron' scenario. */
export const COLD: ControlPatch = C172S_SIM.presets.cold;
/** In flight: everything on that a pilot has on in the air. */
export const AIRBORNE: ControlPatch = C172S_SIM.presets.airborne;
export const ON_APPROACH: ControlPatch = C172S_SIM.presets.approach;

/** Circuit start positions along the downwind leg, m from the runway centre (+ toward the 07 upwind end). */
const DOWNWIND_ALONG: Record<'early' | 'abeamMid' | 'abeamThr', number> = {
  early: AIRPORT.runway.length / 2 - 100, // just turned downwind, abeam the upwind end
  abeamMid: 0,
  abeamThr: -AIRPORT.runway.length / 2, // abeam the 07 threshold
};
/**
 * Base-leg starts (heading 160, BASE_BEYOND_THR m before the 07 threshold): 'early' just after the turn
 * from downwind, 'abeamMid' half-way to the extended centreline, 'abeamThr' late base, about to turn final.
 * Across is m from the centreline (left = negative); height ft above the field, descending 3 degrees.
 */
const BASE_BEYOND_THR = 1500;
/** Flap setting of a base-leg start that names none on the Cessna 172S, degrees (C172S_SIM.scenario.baseFlapsDeg). */
export const BASE_FLAPS_DEG = C172S_SIM.scenario.baseFlapsDeg;
const BASE_POINTS: Record<'early' | 'abeamMid' | 'abeamThr', { across: number; heightFt: number }> = {
  early: { across: -(DOWNWIND_OFFSET - 100), heightFt: 750 },
  abeamMid: { across: -DOWNWIND_OFFSET / 2, heightFt: 650 },
  abeamThr: { across: -200, heightFt: 550 },
};

function groundSpot(spot: GroundSpot): NamedPosition {
  const find = (p: NamedPosition | undefined): NamedPosition => {
    if (!p) throw new Error(`buildStart: no ground spot '${spot}' in the airport layout`);
    return p;
  };
  switch (spot) {
    case 'parking':
      return PARKING;
    case 'holdA1':
      return find(HOLD_SHORT.find((h) => h.name === 'A1'));
    case 'holdA2':
      return find(HOLD_SHORT.find((h) => h.name === 'A2'));
    case 'lineup07':
      return find(LINE_UP.find((l) => l.runway === '07'));
  }
}

function areaPoint(at: AreaId | { north: number; east: number }): { north: number; east: number; name: string } {
  if (typeof at !== 'string') return { north: at.north, east: at.east, name: `${Math.round(at.north)} N ${Math.round(at.east)} E` };
  const a = AREAS[at];
  if (!a) throw new Error(`buildStart: unknown area '${at}'`);
  return { north: a.north, east: a.east, name: a.name };
}

const holdPlan = (ic: InitialConditions, kias: number): AutoflightPlan => ({ kind: 'hold', heading: ic.heading, altitude: -ic.position.z, kias });
const fmtFt = (ft: number): string => `${Math.round(ft).toLocaleString('en-GB')} ft`;

function buildBase(spec: StartSpec, env: Environment, kias: (r: Ref) => number, lever: (deg: number | undefined) => number, sim: SimProfile): Scenario {
  const id = baseScenario(spec);
  const presets = sim.presets;
  switch (spec.kind) {
    case 'scenario':
      throw new Error("buildStart: a { kind: 'scenario' } start is SimPhysics.reset(id), not a built scenario");
    case 'ground': {
      const p = groundSpot(spec.spot);
      const running = spec.engine === 'running';
      const lineup = spec.spot === 'lineup07';
      const ic: InitialConditions = { position: { x: p.north, y: p.east, z: -AIRPORT.elevation }, heading: p.heading, airspeed: 0, onGround: true, engineRunning: running };
      const where = lineup ? 'Runway 07' : spec.spot === 'parking' ? `Apron, stand ${PARKING.name}` : `Holding point ${p.name}, runway 07`;
      return {
        id,
        title: `${where}, ${running ? 'engine running' : 'cold and dark'}`,
        ic,
        controls: running ? (lineup ? presets.linedUp : presets.groundRunning) : presets.cold,
        autoflight: lineup && running ? { kind: 'takeoff', heading: p.heading, climbTo: PATTERN_ALTITUDE, cruiseKias: sim.scenario.afterTakeoffKias } : { kind: 'parked' },
      };
    }
    case 'air':
    case 'attitude': {
      const pt = areaPoint(spec.at);
      const altMsl = (spec.kind === 'air' && spec.altRef === 'field' ? AIRPORT.elevation : 0) + spec.altFt * FT;
      const speed = kias(spec.kind === 'air' ? spec.kias : spec.kias);
      const ic: InitialConditions = {
        position: { x: pt.north, y: pt.east, z: -altMsl },
        heading: wrapTwoPi(spec.hdgDeg * DEG),
        airspeed: kiasToTas(speed, altMsl, env),
        onGround: false,
        engineRunning: true,
      };
      if (spec.kind === 'air') {
        if (spec.flapsDeg) ic.flaps = lever(spec.flapsDeg);
        if (spec.gammaDeg) ic.flightPathAngle = spec.gammaDeg * DEG;
      }
      const sc: Scenario = {
        id,
        title: `${pt.name}, ${fmtFt(altMsl / FT)}`,
        ic,
        controls: presets.airborne,
        autoflight: holdPlan(ic, speed),
      };
      if (spec.kind === 'attitude') sc.attitude = { pitch: spec.pitchDeg * DEG, roll: spec.bankDeg * DEG };
      return sc;
    }
    case 'final': {
      const speed = kias(spec.kias);
      const ic = startOnFinal(env, spec.distNm * NM, speed, lever(spec.flapsDeg), (spec.heightOffsetFt ?? 0) * FT);
      return { id, title: `${spec.distNm} NM final, runway 07`, ic, controls: presets.approach, autoflight: { kind: 'approach', kias: speed } };
    }
    case 'circuit': {
      const speed = kias(spec.kias);
      if (spec.leg === 'downwind') {
        const ic = startOnDownwind(env, DOWNWIND_ALONG[spec.position], speed, lever(spec.flapsDeg));
        return { id, title: 'Left downwind, runway 07', ic, controls: presets.airborne, autoflight: holdPlan(ic, speed) };
      }
      const b = BASE_POINTS[spec.position];
      const thr = runwayThreshold(0);
      const dir = runwayDirection();
      // Along the extended centreline before the threshold, then across to the left (north-west) side.
      const n = thr.x - dir.x * BASE_BEYOND_THR - dir.y * b.across;
      const e = thr.y - dir.y * BASE_BEYOND_THR + dir.x * b.across;
      const alt = AIRPORT.elevation + b.heightFt * FT;
      const ic: InitialConditions = {
        position: { x: n, y: e, z: -alt },
        heading: wrapTwoPi(AIRPORT.runway.heading + Math.PI / 2),
        airspeed: kiasToTas(speed, alt, env),
        onGround: false,
        engineRunning: true,
        flaps: lever(spec.flapsDeg ?? sim.scenario.baseFlapsDeg),
        flightPathAngle: -3 * DEG,
      };
      return { id, title: 'Left base, runway 07', ic, controls: presets.approach, autoflight: { kind: 'approach', kias: speed } };
    }
  }
}

/**
 * The free-flight scenario a start maps onto (for the reset event, the snapshot and Shift+R outside a lesson):
 * ground parking/hold -> 'apron', lineup -> 'runway', air/attitude -> 'cruise', final -> 'final',
 * circuit -> 'downwind'.
 */
export function baseScenario(spec: StartSpec): ScenarioId {
  switch (spec.kind) {
    case 'scenario':
      return spec.id;
    case 'ground':
      return spec.spot === 'lineup07' ? 'runway' : 'apron';
    case 'air':
    case 'attitude':
      return 'cruise';
    case 'final':
      return 'final';
    case 'circuit':
      return 'downwind';
  }
}
