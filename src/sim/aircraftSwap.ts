// Aircraft hot swap, the physics half: the flight state worth keeping when the pilot changes type mid-flight
// (captureSwapState), and the Scenario the new type is trimmed in before that state is put back
// (swapScenario). SimPhysics.setAircraft does the rest: it builds the new flight model, runs resetTo on this
// scenario so the new type starts trimmed (engine, rotor, governor, control surfaces and lag states settled for the
// old airspeed and flight path), then overwrites the rigid body with the old one exactly, so position, velocity,
// attitude and body rates are continuous across the swap. On the ground the new type is placed on its own wheels or
// skids at the old north/east and heading, with the old ground velocity and yaw rate.
//
// The TRIM speed is clamped into the new type's envelope (an R22 trimmed at its never-exceed speed when the
// Cessna was faster, a C172S trimmed above its stall speed when the helicopter hovered); the kinematic state is not:
// the aircraft keeps the speed it had and the pilot deals with it, as the owner chose. Each clamp is reported as a
// note for the toast. Pure data and node-safe: no DOM, no aircraft modules.

import { FT, KT, quat, wrapTwoPi, type Quat, type Vec3 } from '../core/math';
import type { ScenarioId } from '../core/context';
import type { AircraftId, Environment, InitialConditions } from '../core/types';
import type { AircraftDefinition } from '../aircraft/types';
import { flapLever, kiasToTas, type Scenario } from './scenarios';
import type { SimPhysics } from './SimPhysics';

/** Below this ground speed a swap on the ground counts as standing still (no velocity carried, brake kept), m/s. */
export const SWAP_STILL_SPEED = 0.2;
/** A retractable gear comes down when the swap is made below this height above the ground from a fixed gear, m. */
export const SWAP_GEAR_DOWN_AGL = 1000 * FT;
/** The fixed-wing trim speed floor as a multiple of the clean stall speed (vs1). */
const MIN_TRIM_VS1 = 1.3;
/** The trim's flight path is held within this, rad (as restore() does: a steeper solve may not converge). */
const MAX_TRIM_PATH = 0.2;

/** The flight state carried across a type swap. Plain data (JSON round-trips). */
export interface SwapState {
  /** The type flown before the swap and its name (for the notes). */
  aircraft: AircraftId;
  aircraftName: string;
  /** The scenario flown (the swap scenario keeps its id, so a restart goes back to it in the new type). */
  scenarioId: ScenarioId;
  /** Flight-model clock at the swap, s. */
  time: number;
  /** Reference point NED, m. */
  position: Vec3;
  /** Body -> NED. */
  orientation: Quat;
  /** Velocity over the ground NED, m/s. */
  velocity: Vec3;
  /** Body rates (p, q, r), rad/s. */
  angularVelocity: Vec3;
  onGround: boolean;
  /** Ground speed, m/s, and track, rad. */
  groundSpeed: number;
  track: number;
  /** True heading, rad. */
  heading: number;
  /** True airspeed, m/s (from the air velocity), and indicated airspeed, m/s. */
  tas: number;
  ias: number;
  /** Flight path through the air mass, rad (+ climbing; 0 below 1 m/s TAS). */
  flightPathAngle: number;
  /** Height of the CG above the terrain, m. */
  agl: number;
  /** Any engine running. */
  engineRunning: boolean;
  /** Fuel on board as a fraction of the usable capacity, 0..1. */
  fuelFraction: number;
  /** Flap lever 0..1 and the flap deflection it selects, deg (0 on a type without flaps). */
  flapLever: number;
  flapDeg: number;
  /** Retractable gear selected and locked down; null on a fixed gear. */
  gearDown: boolean | null;
  /** The old type is a helicopter. */
  rotorcraft: boolean;
  /** The pilot's throttle lever (scalar), 0..1, the brakes 0..1 and the parking brake. */
  throttle: number;
  brakeLeft: number;
  brakeRight: number;
  parkingBrake: boolean;
  /** The autoflight was engaged. */
  autoflightEngaged: boolean;
  /** Instrument knobs that belong to the pilot, not the type: altimeter setting hPa, heading bug and OBS deg, panel dimmer 0..1. */
  knobs: { kollsmanHpa: number; headingBugDeg: number; obsDeg: number; panelLight: number };
}

/** The flight state of `physics` worth keeping across a type swap (the flight model's stepped state). */
export function captureSwapState(physics: SimPhysics): SwapState {
  const s = physics.fm.state;
  const def = physics.definition;
  const c = physics.controls;
  const air = quat.rotate(s.orientation, s.airVelocityBody);
  const tas = Math.hypot(air.x, air.y, air.z);
  const fuelFraction = s.fuel.capacityEach > 0 ? (s.fuel.left + s.fuel.right) / (2 * s.fuel.capacityEach) : 0;
  const flaps = def.controls.flaps;
  const g = s.gear;
  return {
    aircraft: def.id,
    aircraftName: def.shortName,
    scenarioId: physics.scenario.id,
    time: s.time,
    position: { ...s.position },
    orientation: { ...s.orientation },
    velocity: { ...s.velocity },
    angularVelocity: { ...s.angularVelocity },
    onGround: s.onGround,
    groundSpeed: s.groundSpeed,
    track: s.track,
    heading: s.heading,
    tas,
    ias: s.ias,
    flightPathAngle: tas < 1 ? 0 : Math.asin(Math.max(-1, Math.min(1, -air.z / tas))),
    agl: s.altitudeAGL,
    engineRunning: s.engines.some((e) => e.running),
    fuelFraction: Math.min(1, Math.max(0, fuelFraction)),
    flapLever: c.flaps,
    flapDeg: flaps.detents.length > 1 ? (c.flaps * flaps.maxDeflection * 180) / Math.PI : 0,
    gearDown: g.retractable ? g.extension.every((x) => x > 0.5) : null,
    rotorcraft: def.rotorcraft !== undefined,
    throttle: c.throttle,
    brakeLeft: c.brakeLeft,
    brakeRight: c.brakeRight,
    parkingBrake: c.parkingBrake,
    autoflightEngaged: physics.autoflight.engaged,
    knobs: { kollsmanHpa: c.kollsmanHpa, headingBugDeg: c.headingBugDeg, obsDeg: c.obsDeg, panelLight: c.lights.panel },
  };
}

/**
 * The Scenario the new type is trimmed in at a swap: `state`'s place, heading and flight path, at the old true
 * airspeed clamped into `def`'s envelope (fixed wing: MIN_TRIM_VS1 x vs1, or vs0 with flap out, and the type's
 * restore floor, up to vne; helicopter: 0 up to vne), its 'typical' payload, the old fuel fraction, the flap detent nearest the old deflection
 * that is allowed at that speed, a retractable gear per the old gear (from a fixed gear: down below SWAP_GEAR_DOWN_AGL
 * or with flap out), the switch preset of the phase (airborne, ground running or cold). `env` supplies the atmosphere
 * (IAS -> TAS). The notes say what was clamped, for the pilot.
 */
export function swapScenario(state: SwapState, def: AircraftDefinition, env: Environment): { scenario: Scenario; notes: string[] } {
  const notes: string[] = [];
  const presets = def.sim.presets;
  const heli = def.rotorcraft !== undefined;
  const alt = -state.position.z;
  const ref = def.reference;
  const name = def.shortName;
  const ic: InitialConditions = {
    position: { ...state.position },
    heading: wrapTwoPi(state.heading),
    airspeed: 0,
    onGround: state.onGround,
    engineRunning: state.engineRunning,
    fuelFraction: state.fuelFraction,
  };
  if (state.onGround) {
    // Flap as set (a take-off roll with flap 10): the nearest detent, no limit speed to keep on the ground.
    const lever = nearestFlap(def, state.flapDeg, 0, (k) => k);
    if (lever > 0) ic.flaps = lever;
    return {
      scenario: {
        id: state.scenarioId,
        title: `${def.name}, swapped on the ground`,
        ic,
        controls: state.engineRunning ? presets.groundRunning : presets.cold,
        payload: 'typical',
        autoflight: { kind: 'parked' },
      },
      notes,
    };
  }
  // The trim speed: the old airspeed inside the new type's envelope.
  const vne = kiasToTas(ref.vne, alt, env);
  // With flap out (old and new type) the floor is over the landing-flap stall speed (vs0), clean over vs1.
  const flapOut = state.flapDeg > 0 && def.controls.flaps.detents.length > 1;
  const vs = flapOut ? ref.vs0 : ref.vs1;
  const floor = heli ? 0 : Math.max(def.sim.scenario.restoreMinTas, kiasToTas(MIN_TRIM_VS1 * vs, alt, env));
  let tas = state.tas;
  if (tas > vne) {
    tas = vne;
    notes.push(`faster than the ${name}'s never-exceed speed (${ref.vne} KIAS)`);
  } else if (tas < floor) {
    tas = floor;
    notes.push(`slower than the ${name} can fly (stall ${vs} KIAS)`);
  }
  ic.airspeed = tas;
  ic.flightPathAngle = Math.max(-MAX_TRIM_PATH, Math.min(MAX_TRIM_PATH, state.flightPathAngle));
  // Flap: the detent nearest the old deflection whose limit speed the trim speed is within.
  const lever = nearestFlap(def, state.flapDeg, tas, (k) => kiasToTas(k, alt, env));
  if (lever > 0) ic.flaps = lever;
  if (def.geometry.gear.retractable) {
    const want = state.gearDown ?? ((ic.flaps ?? 0) > 0 || state.agl < SWAP_GEAR_DOWN_AGL);
    const vle = ref.vle !== undefined ? kiasToTas(ref.vle, alt, env) : Infinity;
    ic.gearDown = want && tas <= vle;
    if (want && !ic.gearDown) notes.push(`${name} gear up: faster than its gear limit (${ref.vle} KIAS)`);
  }
  // The hold (if re-engaged by plan) keeps the old indicated speed, inside the new type's limits.
  const kias = Math.min(ref.vne, Math.max(heli ? 0 : MIN_TRIM_VS1 * vs, Math.round(state.ias / KT)));
  return {
    scenario: {
      id: state.scenarioId,
      title: `${def.name}, swapped in flight`,
      ic,
      controls: (ic.flaps ?? 0) > 0 ? presets.approach : presets.airborne,
      payload: 'typical',
      autoflight: { kind: 'hold', heading: ic.heading, altitude: alt, kias },
    },
    notes,
  };
}

/**
 * The flap lever (0..1) of `def`'s detent nearest `deg` degrees among those whose limit speed (KIAS, converted to TAS
 * by `tasOf`) is at or above `tas` m/s; 0 without flap, on a type without flaps or when only clean is allowed.
 */
function nearestFlap(def: AircraftDefinition, deg: number, tas: number, tasOf: (kias: number) => number): number {
  const flaps = def.controls.flaps;
  if (flaps.detents.length < 2 || !(deg > 0)) return 0;
  let best = 0;
  let bestErr = Infinity;
  flaps.detents.forEach((d, i) => {
    const vfe = i === 0 ? Infinity : def.reference.vfe[i - 1] ?? Infinity;
    const err = Math.abs((d * 180) / Math.PI - deg);
    if (tasOf(vfe) >= tas && err < bestErr) { best = i; bestErr = err; }
  });
  return best > 0 ? flapLever(flaps, (flaps.detents[best] * 180) / Math.PI) : 0;
}
