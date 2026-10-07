// Start conditions of the five scenarios (ScenarioId). Pure data + a little geometry, usable in node. The
// speeds, flap settings and switches are the aircraft's sim profile (def.sim); the Cessna 172S's are:
//
//   runway    lined up on runway 07, engine running at idle, parking brake set: ready for take-off
//   apron     parked cold and dark at the airport layout's player spot (PARKING)
//   final     3 NM final for runway 07 on a 3 degree glide path, 70 KIAS, flaps 20, trimmed
//   cruise    4500 ft MSL (below the default 1500 m cloud base), trimmed at ~110 KIAS, eastbound along the foothills, Alps on the left
//   downwind  mid-field left downwind for 07 at pattern altitude (1000 ft AGL), 90 KIAS, trimmed

import { FT, KT, NM, DEG, clamp, wrapTwoPi } from '../core/math';
import type { ScenarioId } from '../core/context';
import type { ControlPatch, Environment, InitialConditions } from '../core/types';
import { AIRPORT, runwayDirection, runwayThreshold } from '../core/world';
import { C172S_GEOMETRY } from '../aircraft/c172s/geometry';
import { C172S_SIM } from '../aircraft/c172s/sim';
import { C172S_CONTROLS } from '../aircraft/c172s/systems';
import type { AircraftDefinition, ControlSystemDef } from '../aircraft/types';
// Not from the '../physics' barrel (see sim/autoflight.ts): it carries the flight model.
import { tasFromCas } from '../physics/atmosphere';
import { LINE_UP, PARKING } from '../world/airport/layout';
import type { StartSpec } from './starts';

export const SCENARIO_IDS: readonly ScenarioId[] = ['runway', 'apron', 'final', 'cruise', 'downwind'];

/** Pattern altitude, m MSL (1000 ft above the field). */
export const PATTERN_ALTITUDE = AIRPORT.elevation + 1000 * FT;
/** Downwind leg offset from the runway centreline, m (left-hand traffic for 07: north-west of the runway). */
export const DOWNWIND_OFFSET = 900;
/** Glide path of the final-approach scenario and the aim point beyond the threshold (m). */
export const GLIDE_PATH = 3 * DEG;
export const AIM_POINT = 150;

/** What a scenario needs of the aircraft: the sim profile, the flap detents and whether the gear retracts. */
export type ScenarioAircraft = Pick<AircraftDefinition, 'sim' | 'controls' | 'geometry'>;
/** The Cessna 172S's (the parts of C172S_DEFINITION, from their own files). */
const C172S_SCENARIO_AIRCRAFT: ScenarioAircraft = { sim: C172S_SIM, controls: C172S_CONTROLS, geometry: C172S_GEOMETRY };

/**
 * The flap lever (ControlInputs.flaps, 0..1) that selects `deg` degrees of flap. A setting that is one of the
 * detents gives that detent's lever value exactly (detents[i] / maxDeflection); between detents the lever is
 * proportional to the deflection.
 */
export function flapLever(flaps: Pick<ControlSystemDef['flaps'], 'maxDeflection' | 'detents'>, deg: number): number {
  const rad = deg * DEG;
  for (const d of flaps.detents) if (Math.abs(d - rad) < 1e-6) return d / flaps.maxDeflection;
  return clamp(rad / flaps.maxDeflection, 0, 1);
}

// The scenario numbers of the Cessna 172S, as they were named before they moved to C172S_SIM.scenario.
/** Final-approach speed, KIAS, and flap lever (2/3 = 20 degrees). */
export const FINAL_KIAS = C172S_SIM.scenario.finalKias;
export const FINAL_FLAPS = flapLever(C172S_CONTROLS.flaps, C172S_SIM.scenario.finalFlapsDeg);
/** Cruise speed, KIAS, and altitude, ft MSL. */
export const CRUISE_KIAS = C172S_SIM.scenario.cruiseKias;
export const CRUISE_ALT_FT = C172S_SIM.scenario.cruiseAltFt;
/** Downwind speed, KIAS. */
export const DOWNWIND_KIAS = C172S_SIM.scenario.downwindKias;
/** Speed held after the take-off's climb to pattern altitude, KIAS. */
export const AFTER_TAKEOFF_KIAS = C172S_SIM.scenario.afterTakeoffKias;

/** What the autoflight should do in a scenario when engaged (see autoflight.ts). */
export type AutoflightPlan =
  | { kind: 'takeoff'; heading: number; climbTo: number; cruiseKias: number }
  | {
      kind: 'hold';
      heading: number;
      altitude: number;
      kias: number;
      /** Fly the heading bug (KAP 140 HDG mode) instead of the fixed heading. Default false. */
      followBug?: boolean;
      /** Hold the speed with the throttle. Default true (scenario demos); the pilot's A key leaves it off. */
      autothrottle?: boolean;
    }
  | { kind: 'approach'; kias: number }
  | { kind: 'parked' };

export interface Scenario {
  id: ScenarioId;
  title: string;
  ic: InitialConditions;
  /** Applied (applyControls) on top of the flight model's trimControls after the reset. */
  controls?: ControlPatch;
  autoflight: AutoflightPlan;
  // ---- Flight School starts (src/sim/starts.ts). Absent on the five free-flight scenarios. ----
  /** Payload loading: 'forward' (front seats only, CG near the forward limit) or 'typical' (the default). */
  payload?: 'forward' | 'typical';
  /** Rotate to this attitude after the trimmed reset (unusual-attitude starts), rad; airspeed kept along the nose. */
  attitude?: { pitch: number; roll: number };
  /** The lesson start this scenario was built from (stored in the resume snapshot). */
  start?: StartSpec;
}

/** True airspeed (m/s) for an indicated airspeed (kt) at an altitude MSL (m) in `env`'s atmosphere. */
export function kiasToTas(kias: number, altitudeMSL: number, env: Environment): number {
  return tasFromCas(kias * KT, env.atmosphere(altitudeMSL));
}

/**
 * Initial conditions on the 3 degree path to runway 07, `dist` m before the threshold (measured along the
 * extended centreline), trimmed at `kias` with the flap lever at `flaps`; `heightOffset` m above (+) or below
 * the path. Shared by the 'final' scenario and the Flight School's final starts.
 */
export function startOnFinal(env: Environment, dist: number, kias: number, flaps: number, heightOffset = 0): InitialConditions {
  const thr = runwayThreshold(0);
  const dir = runwayDirection();
  // Distance along the path to the aim point, then height above the threshold on the 3 degree path.
  const height = (dist + AIM_POINT) * Math.tan(GLIDE_PATH) + heightOffset;
  const alt = AIRPORT.elevation + height;
  return {
    position: { x: thr.x - dir.x * dist, y: thr.y - dir.y * dist, z: -alt },
    heading: AIRPORT.runway.heading,
    airspeed: kiasToTas(kias, alt, env),
    onGround: false,
    engineRunning: true,
    flaps,
    flightPathAngle: -GLIDE_PATH,
  };
}

/**
 * Initial conditions on the left-hand downwind leg for 07 (DOWNWIND_OFFSET to the left of the centreline,
 * heading 250) at pattern altitude, `along` m from the runway centre (+ toward the 07 upwind end), level and
 * trimmed at `kias` with the flap lever at `flaps`. Shared by the 'downwind' scenario and the circuit starts.
 */
export function startOnDownwind(env: Environment, along: number, kias: number, flaps = 0): InitialConditions {
  const rwyHdg = AIRPORT.runway.heading;
  const heading = wrapTwoPi(rwyHdg + Math.PI);
  // Left of runway 07 (across < 0).
  const n = AIRPORT.runway.center.north + DOWNWIND_OFFSET * Math.sin(rwyHdg) + along * Math.cos(rwyHdg);
  const e = AIRPORT.runway.center.east - DOWNWIND_OFFSET * Math.cos(rwyHdg) + along * Math.sin(rwyHdg);
  const ic: InitialConditions = { position: { x: n, y: e, z: -PATTERN_ALTITUDE }, heading, airspeed: kiasToTas(kias, PATTERN_ALTITUDE, env), onGround: false, engineRunning: true };
  if (flaps > 0) ic.flaps = flaps;
  return ic;
}

/**
 * Build a scenario's start conditions for an aircraft (default the Cessna 172S): its speeds, flap settings and
 * switch presets (def.sim). `env` supplies the atmosphere (IAS -> TAS) for the airborne starts. A retractable
 * gear is down on final and up in the cruise.
 */
export function buildScenario(id: ScenarioId, env: Environment, def: ScenarioAircraft = C172S_SCENARIO_AIRCRAFT): Scenario {
  const sc = def.sim.scenario;
  const presets = def.sim.presets;
  const retractable = def.geometry.gear.retractable;
  const lever = (deg: number): number => flapLever(def.controls.flaps, deg);
  switch (id) {
    case 'runway': {
      const p = LINE_UP.find((l) => l.runway === '07')!;
      return {
        id,
        title: 'Runway 07, ready for take-off',
        ic: { position: { x: p.north, y: p.east, z: -AIRPORT.elevation }, heading: p.heading, airspeed: 0, onGround: true, engineRunning: true },
        controls: presets.linedUp,
        autoflight: { kind: 'takeoff', heading: p.heading, climbTo: PATTERN_ALTITUDE, cruiseKias: sc.afterTakeoffKias },
      };
    }
    case 'apron':
      return {
        id,
        title: `Apron, stand ${PARKING.name}, cold and dark`,
        ic: { position: { x: PARKING.north, y: PARKING.east, z: -AIRPORT.elevation }, heading: PARKING.heading, airspeed: 0, onGround: true, engineRunning: false },
        controls: presets.cold,
        autoflight: { kind: 'parked' },
      };
    case 'final': {
      const ic = startOnFinal(env, 3 * NM, sc.finalKias, lever(sc.finalFlapsDeg));
      if (retractable) ic.gearDown = true;
      return {
        id,
        title: '3 NM final, runway 07',
        ic,
        controls: presets.approach,
        autoflight: { kind: 'approach', kias: sc.finalKias },
      };
    }
    case 'cruise': {
      const alt = sc.cruiseAltFt * FT;
      // Eastbound along the foothills, under the default 1500 m cloud base, with the Alps on the left and the
      // airfield passing 2.6 km to the right after ~2.5 min. Terrain within 5 NM of the track stays below
      // 630 m (at least 2400 ft of clearance) for the first 55 km (over 15 minutes at 110 KIAS); the same
      // start heading 015 (as before) meets 1400 m ridges 17.5 km out.
      const heading = 100 * DEG;
      const ic: InitialConditions = { position: { x: 4000, y: -8000, z: -alt }, heading, airspeed: kiasToTas(sc.cruiseKias, alt, env), onGround: false, engineRunning: true };
      if (retractable) ic.gearDown = false;
      return {
        id,
        title: `Cruise at ${sc.cruiseAltFt} ft along the Alps`,
        ic,
        controls: presets.airborne,
        autoflight: { kind: 'hold', heading, altitude: alt, kias: sc.cruiseKias },
      };
    }
    case 'downwind': {
      // Left of runway 07 (across < 0), abeam midfield.
      const ic = startOnDownwind(env, 0, sc.downwindKias, lever(sc.downwindFlapsDeg));
      return {
        id,
        title: 'Left downwind, runway 07',
        ic,
        controls: presets.airborne,
        autoflight: { kind: 'hold', heading: ic.heading, altitude: PATTERN_ALTITUDE, kias: sc.downwindKias },
      };
    }
  }
}
