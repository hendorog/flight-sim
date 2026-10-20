// Resume on reload: a compact snapshot of the flight, written to localStorage about once a second while
// flying (and on pagehide / visibilitychange / beforeunload), restored on the next boot.
//
// WHAT IS SAVED (schema SNAPSHOT_SCHEMA, JSON, ~3 kB; ~10 kB during a Flight School lesson): the type flown,
// the flight-model clock, its rigid-body state (reference-point position NED, CG velocity NED, attitude
// quaternion, body rates), the systems (every engine and propeller: running, rpm, blade angle, temperatures,
// carburettor ice, cowl flap; fuel per tank, battery charge, control-surface, trim and flap positions, gear),
// every ControlInputs field, the weather (including the time of day and date), camera mode, graphics quality,
// render scale, the scenario id, the autoflight (phase, plan, autopilot targets and integrators), the save time
// and a `resume` flag. The schema-2 fields (engine 0, the two-tank fuel view, battery, surfaces) are still
// written: lesson checkpoints, tests and the e2e scripts read them.
//
// ONE SNAPSHOT PER TYPE (snapshotKey): flying another type never overwrites a flight in progress, and a
// snapshot of another type than the one booted is never restored (decideBoot).
//
// ERAS (Deep Time): a snapshot taken in another era than the present day carries `era` (optional; absent means
// 'present', so present-day snapshots are unchanged and SNAPSHOT_SCHEMA did not move). A snapshot of another era
// than the one booted is never restored (decideBoot), exactly as for another aircraft.
//
// WHEN IT IS RESTORED (decideBoot): a snapshot that parses, has the current schema and is younger than
// MAX_AGE_MS, with `resume` set, of an aircraft that is not crashed and not parked (on the ground, stationary,
// engine off; a parked aircraft in the middle of a lesson, e.g. before the engine start of L02, still resumes). A deliberate scenario restart writes `resume: false` (the restarted scenario is booted fresh
// on a reload) until the aircraft has flown RESUME_ARM_SECONDS of simulated time since the restart.
// Anything unreadable is ignored silently; every storage access is guarded (private windows, quota).
//
// Node-safe (no DOM): tests/sim/resume.test.ts round-trips snapshots through the real flight model.

import type { PanelView } from '../instruments/fixedPanel';
import type { CameraMode, QualityLevel, ScenarioId } from '../core/context';
import type { Quat, Vec3 } from '../core/math';
import { isRotorcraftId } from '../core/types';
import { emptyRotorcraftState } from '../physics/rotorcraft/definition';
import { MAIN_ROTOR_BLADES as S269_BLADES } from '../aircraft/s269/dimensions';
import { MAIN_ROTOR_BLADES as MD500_BLADES } from '../aircraft/md500/dimensions';
import { MD500_N2_BEEP } from '../aircraft/md500/facts';
import { DEFAULT_AIRCRAFT_ID, isAircraftId, type AircraftId, type ControlInputs, type SurfaceState, type WeatherSettings } from '../core/types';
import type { AutopilotSettings } from '../physics';
import type { EngineSnapshot, SystemsSnapshot } from '../physics/interfaces';
import type { AutoflightPhase } from './autoflight';
import type { AutoflightPlan } from './scenarios';
import { SCENARIO_IDS } from './scenarios';
import type { StartSpec } from './starts';
import { ERA_SCENARIO_IDS } from './eraChoice';
import { isEraId } from '../world/era/registry';
import { sanitizeExtras } from '../core/weatherFields';
import type { EraId } from '../world/era/types';
import { MAX_CRACKS, type HailDamageSnapshot } from './weather/hailDamage';

/**
 * Bump when the snapshot layout changes. Snapshots from MIN_SNAPSHOT_SCHEMA up are read (migrated to this
 * layout on read); older ones are ignored. Schema 4: `weather.storms` absent means cells derived from the
 * conditions and the empty list means none. Schema 3 snapshots written before the derived cells carry `storms: []`,
 * the neutral value of that time; an empty list read from schema 3 or older is dropped, so the flight resumes with
 * derived cells. Schema 5: `damage`, the hail damage; a snapshot of schema 4 or older is read with no damage.
 */
export const SNAPSHOT_SCHEMA = 5;
/** Last schema whose empty `weather.storms` list was the neutral value (dropped on read). */
const LEGACY_EMPTY_STORMS_SCHEMA = 3;
/**
 * Oldest schema still read: schema 1 is schema 2 without `start` and `training`; schema 2 is schema 3 without
 * `aircraft` (a Cessna 172S) and `systems` (built from its engine, fuel, battery and surfaces on read).
 */
export const MIN_SNAPSHOT_SCHEMA = 1;
/** localStorage key of the Cessna 172S's snapshot (snapshotKey('c172s')). */
export const SNAPSHOT_KEY = 'fs.resume.snapshot';

/** The C172S keeps today's key 'fs.resume.snapshot'; every other type uses 'fs.resume.snapshot.<id>'. */
export function snapshotKey(id: AircraftId): string {
  return id === 'c172s' ? SNAPSHOT_KEY : `${SNAPSHOT_KEY}.${id}`;
}
/** localStorage key of the "Resume where I left off on reload" preference ('0' = off; absent = on). */
export const RESUME_PREF_KEY = 'fs.resume.enabled';
/** Snapshots older than this start the scenario normally, ms (12 h). */
export const MAX_AGE_MS = 12 * 3600 * 1000;
/** Wall time between periodic saves while flying, s. */
export const SAVE_INTERVAL_S = 1;
/** Simulated time after a scenario restart before snapshots carry `resume: true` again, s. */
export const RESUME_ARM_SECONDS = 5;
/** Below this ground speed, on the ground with the engine stopped, the aircraft counts as parked, m/s. */
const PARKED_SPEED = 0.5;

const CAMERA_MODES: readonly CameraMode[] = ['cockpit', 'chase', 'orbit', 'flyby', 'tower'];
const QUALITIES: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

/** Autoflight state (see Autoflight.exportState). */
export interface AutoflightSnapshot {
  phase: AutoflightPhase;
  plan: AutoflightPlan | null;
  settings: AutopilotSettings;
  drift: number;
  dgOffset: number;
  flareStartPitch: number | null;
  flareHeight: number | null;
  /** The physics autopilot's integrators (numbers by field name; absent ones start bumpless). */
  integrators: Record<string, number | boolean | string>;
}

export interface FlightSnapshot {
  schema: number;
  /** (schema 3) The type flown. Absent on read (schema 1, 2): 'c172s'. */
  aircraft: AircraftId;
  /** The era the flight was in; written only for a non-present era. Absent: 'present'. */
  era?: EraId;
  /** Epoch ms of the save. */
  savedAt: number;
  /** False right after a deliberate scenario restart: a reload then starts that scenario fresh. */
  resume: boolean;
  scenario: ScenarioId;
  /** Flight-model clock, s (the wind field's turbulence, gusts and thermals are functions of it). */
  simTime: number;
  body: { position: Vec3; velocity: Vec3; orientation: Quat; angularVelocity: Vec3 };
  /** Engine 0 (schema 1, 2; still written). */
  engine: { running: boolean; rpm: number; egt: number; cht: number; oilTemp: number; oilPressure: number };
  /** The two-tank view of the fuel, kg (schema 1, 2; still written). */
  fuel: { left: number; right: number };
  batteryCharge: number;
  surfaces: SurfaceState;
  /** (schema 3) Authoritative systems state. Absent on read: built from engine / fuel / batteryCharge / surfaces. */
  systems: SystemsSnapshot;
  controls: ControlInputs;
  weather: WeatherSettings;
  cameraMode: CameraMode;
  quality: QualityLevel;
  renderScale: number | null;
  autoflight: AutoflightSnapshot | null;
  /** For the boot decision and the log (not restored: the flight model recomputes them). */
  status: { onGround: boolean; crashed: boolean; groundSpeed: number; altitudeMSL: number; heading: number; ias: number };
  /** (schema 2) The Flight School start the last reset came from (src/sim/starts.ts), when it came from one. */
  start?: StartSpec;
  /**
   * (schema 2) The running Flight School lesson (src/training/types.ts TrainingResumeBlock). Opaque here and
   * validated by the shell with validateTrainingBlock; an invalid block resumes the flight as free flight.
   */
  training?: unknown;
  /** (schema 5) The hail damage (sim/weather/hailDamage.ts). Absent on read (schema 4 and older): none. */
  damage?: HailDamageSnapshot;
}

const START_KINDS: readonly StartSpec['kind'][] = ['scenario', 'ground', 'air', 'final', 'circuit', 'attitude'];

// ------------------------------------------------------------------------------------------- validation

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isVec = (v: unknown): v is Vec3 => isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.z);
const isQuat = (v: unknown): v is Quat => {
  if (!isVec(v) || !isNum((v as unknown as Record<string, unknown>).w)) return false;
  const q = v as unknown as Quat;
  return Math.hypot(q.w, q.x, q.y, q.z) > 0.5;
};

const ENGINE_NUMBERS = ['rpm', 'propRpm', 'bladePitch', 'egt', 'cht', 'oilTemp', 'oilPressure', 'carbIce', 'cowlFlap'] as const;

/** Main-rotor blade count of each articulated-hub type (the per-blade pose array a save carries). Plain data imports. */
const ARTICULATED_BLADES: Partial<Record<AircraftId, number>> = { s269: S269_BLADES, md500: MD500_BLADES };
/** Turboshaft governor beep limits, % (the set point a save may carry). */
const TURBOSHAFT_SET_PCT: Partial<Record<AircraftId, readonly [number, number]>> = {
  md500: [100 * MD500_N2_BEEP.range[0], 100 * MD500_N2_BEEP.range[1]],
};
const GRIPS = ['cutoff', 'groundIdle', 'between', 'fullOpen'];

/** RotorcraftState.turboshaft of a save, field by field (finite numbers, enums in their sets, the set point in range). */
function isTurboshaft(t: unknown, aircraft: unknown): boolean {
  if (!isObj(t)) return false;
  if (!['n2SetPct', 'ptgIntegral', 'n2Pct', 'nrPct', 'torquePsi'].every((k) => isNum(t[k]))) return false;
  if (!['needlesSplit', 'engineOutLight', 'engineOutHorn', 'reignitionLight', 'overTorque', 'overTemp', 'avoidRange']
    .every((k) => typeof t[k] === 'boolean')) return false;
  if (t.lowRotorArmed !== undefined && typeof t.lowRotorArmed !== 'boolean') return false;
  if (!['n2Last', 'n2Rate'].every((k) => t[k] === undefined || isNum(t[k]))) return false;
  if (t.n2Last !== undefined && (t.n2Last as number) < 0) return false;
  if (!GRIPS.includes(t.grip as string) || !['governed', 'manual'].includes(t.governorMode as string)) return false;
  const range = isAircraftId(aircraft) ? TURBOSHAFT_SET_PCT[aircraft] : undefined;
  if (range && ((t.n2SetPct as number) < range[0] - 1e-9 || (t.n2SetPct as number) > range[1] + 1e-9)) return false;
  return Math.abs(t.ptgIntegral as number) <= 1 && (t.n2Pct as number) >= 0 && (t.nrPct as number) >= 0;
}
const SURFACE_KEYS = ['elevator', 'aileronLeft', 'aileronRight', 'rudder', 'flaps', 'elevatorTrim'];

function isEngineSnapshot(v: unknown): v is EngineSnapshot {
  if (!(isObj(v) && typeof v.running === 'boolean' && typeof v.featherLatched === 'boolean' && ENGINE_NUMBERS.every((k) => isNum(v[k])))) return false;
  // Gas turbines: Ng (fraction), ITT (C) and the flame; a latching start switch (PC-12).
  const g = v.gasGenerator;
  if (g !== undefined && !(isObj(g) && isNum(g.ng) && g.ng >= 0 && g.ng <= 1.2 && isNum(g.itt) && typeof g.lit === 'boolean')) return false;
  const l = v.starterLatch;
  if (l !== undefined && !(isObj(l) && typeof l.latched === 'boolean' && isNum(l.seconds) && l.seconds >= 0 && typeof l.pressed === 'boolean')) return false;
  return true;
}

/** Stick shaker / pusher block (types with controls.stickPusher). */
function isStickPusher(v: unknown): boolean {
  return isObj(v) && typeof v.shaker === 'boolean' && typeof v.pusher === 'boolean' &&
    isNum(v.ramp) && v.ramp >= 0 && v.ramp <= 1 && isNum(v.airborneSeconds) && v.airborneSeconds >= 0;
}

/** A schema-3 `systems` block: every engine, the tanks, the battery, the surfaces and the gear. */
function isSystems(v: unknown, aircraft?: unknown): v is SystemsSnapshot {
  if (!isObj(v) || !Array.isArray(v.engines) || v.engines.length === 0 || !v.engines.every(isEngineSnapshot)) return false;
  if (!Array.isArray(v.tanks) || !v.tanks.every((q) => isNum(q) && q >= 0) || !isNum(v.batteryCharge)) return false;
  const rotor = v.rotorcraft;
  if (rotor !== undefined) {
    if (!isObj(rotor)) return false;
    if (rotor.articulated !== undefined) {
      const a = rotor.articulated;
      const blades = (isAircraftId(aircraft) ? ARTICULATED_BLADES[aircraft] : undefined) ?? 3;
      if (!isObj(a) ||
        !Array.isArray(a.blades) || a.blades.length !== blades ||
        !a.blades.every(b => isObj(b) && ['flap', 'lag', 'pitch'].every(k => isNum(b[k])))) return false;
    }
    if (rotor.clutchDisengaged !== undefined && typeof rotor.clutchDisengaged !== 'boolean') return false;
    if (rotor.turboshaft !== undefined && !isTurboshaft(rotor.turboshaft, aircraft)) return false;
    if (rotor.transmission !== undefined) {
      const t = rotor.transmission;
      if (!isObj(t) || !isNum(t.oilPressurePsi) || t.oilPressurePsi < 0 ||
        !isNum(t.oilTemperatureC) || typeof t.tailChips !== 'boolean') return false;
    }
    if (rotor.springTrim !== undefined) {
      const t = rotor.springTrim;
      if (!isObj(t) || !['pitch', 'roll', 'pitchForce', 'rollForce'].every(k => isNum(t[k])) ||
        Math.abs(t.pitch as number) > 1 || Math.abs(t.roll as number) > 1) return false;
    }
    // Older schema-3 R22 saves predate the latched tail-contact report.
    if (rotor.tailContact === undefined) rotor.tailContact = 'none';
    if (rotor.lowRpmLight === undefined) rotor.lowRpmLight = rotor.lowRpmHorn;
    if (rotor.takeoffMass === undefined) rotor.takeoffMass = 0;
    if (!['none', 'stinger-touch', 'stinger-impact', 'fin-strike', 'rotor-strike'].includes(rotor.tailContact as string)) return false;
    for (const [key, value] of Object.entries(emptyRotorcraftState())) {
      if (key === 'tailContact') continue;
      if (typeof value === 'boolean' ? typeof rotor[key] !== 'boolean' : !isNum(rotor[key])) return false;
    }
    if ((rotor.omega as number) < 0 || (rotor.rotorRpm as number) < 0 ||
      (rotor.clutchEngagement as number) < 0 || (rotor.clutchEngagement as number) > 1 ||
      (rotor.takeoffPowerSeconds as number) < 0 || (rotor.takeoffMass as number) < 0) return false;
  }
  if (v.stickPusher !== undefined && !isStickPusher(v.stickPusher)) return false;
  const s = v.surfaces;
  if (!isObj(s) || !SURFACE_KEYS.every((k) => isNum(s[k]))) return false;
  const g = v.gear;
  return isObj(g) && Array.isArray(g.extension) && g.extension.length === 3 && g.extension.every(isNum) && typeof g.emergency === 'boolean';
}

/** The systems block of a schema 1 / 2 snapshot (a Cessna 172S): engine 0, the two tanks, battery and surfaces. */
function systemsOfLegacy(v: Pick<FlightSnapshot, 'engine' | 'fuel' | 'batteryCharge' | 'surfaces'>): SystemsSnapshot {
  return {
    engines: [{ ...v.engine, propRpm: v.engine.rpm, bladePitch: 0, featherLatched: false, carbIce: 0, cowlFlap: 1 }],
    tanks: [v.fuel.left, v.fuel.right],
    batteryCharge: v.batteryCharge,
    surfaces: { ...v.surfaces, rudderTrim: 0 },
    gear: { extension: [1, 1, 1], emergency: false },
  };
}

/**
 * The systems of a snapshot: its `systems` block, or for a schema 1 / 2 object that did not come through
 * validateSnapshot (a lesson checkpoint kept from before schema 3) the block built from its legacy fields.
 */
export function snapshotSystems(snap: FlightSnapshot): SystemsSnapshot {
  return (snap as Partial<FlightSnapshot>).systems ?? systemsOfLegacy(snap);
}

const unit = (v: unknown): boolean => isNum(v) && v >= 0 && v <= 1;

/** A schema-5 damage block: levels 0..1, doses at least 0, at most MAX_CRACKS cracks of finite numbers. */
function isDamage(v: unknown): v is HailDamageSnapshot {
  if (!isObj(v) || !unit(v.windscreen) || !unit(v.leadingEdge) || !unit(v.crackDue)) return false;
  if (!isNum(v.windscreenDoseJm2) || v.windscreenDoseJm2 < 0 || !isNum(v.leadingEdgeDoseJm2) || v.leadingEdgeDoseJm2 < 0) return false;
  return Array.isArray(v.cracks) && v.cracks.length <= MAX_CRACKS &&
    v.cracks.every((c) => isObj(c) && isNum(c.az) && isNum(c.el) && unit(c.size) && unit(c.seed));
}

/** The damage of a flight that met no hail. */
export const noDamage = (): HailDamageSnapshot => ({ windscreen: 0, leadingEdge: 0, windscreenDoseJm2: 0, leadingEdgeDoseJm2: 0, crackDue: 0, cracks: [] });

/** Parse and validate a stored snapshot; null when it is corrupt, of another schema or implausible. */
export function parseSnapshot(raw: string | null | undefined): FlightSnapshot | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  return validateSnapshot(v);
}

export function validateSnapshot(v: unknown): FlightSnapshot | null {
  if (!isObj(v) || !isNum(v.schema) || v.schema < MIN_SNAPSHOT_SCHEMA || v.schema > SNAPSHOT_SCHEMA) return null;
  if (!isNum(v.savedAt) || typeof v.resume !== 'boolean') return null;
  if (v.aircraft !== undefined && !isAircraftId(v.aircraft)) return null;
  if (v.era !== undefined && !isEraId(v.era)) return null;
  if (!(SCENARIO_IDS.includes(v.scenario as ScenarioId) || ERA_SCENARIO_IDS.includes(v.scenario as ScenarioId)) || !isNum(v.simTime) || v.simTime < 0) return null;
  const b = v.body;
  if (!isObj(b) || !isVec(b.position) || !isVec(b.velocity) || !isQuat(b.orientation) || !isVec(b.angularVelocity)) return null;
  const e = v.engine;
  if (!isObj(e) || typeof e.running !== 'boolean' || !isNum(e.rpm) || !isNum(e.egt) || !isNum(e.cht) || !isNum(e.oilTemp) || !isNum(e.oilPressure)) return null;
  const f = v.fuel;
  if (!isObj(f) || !isNum(f.left) || !isNum(f.right) || f.left < 0 || f.right < 0) return null;
  if (!isNum(v.batteryCharge)) return null;
  const s = v.surfaces;
  if (!isObj(s) || !SURFACE_KEYS.every((k) => isNum(s[k]))) return null;
  if (v.systems !== undefined && !isSystems(v.systems, v.aircraft)) return null;
  const c = v.controls;
  if (!isObj(c) || !isObj(c.lights)) return null;
  if (c.collective !== undefined && (!isNum(c.collective) || c.collective < 0 || c.collective > 1)) return null;
  for (const key of ['rotorGovernor', 'rotorClutch', 'rotorClutchGuardOpen', 'rotorDoorsOff', 'fuelPrime']) if (c[key] !== undefined && typeof c[key] !== 'boolean') return null;
  if (c.rotorClutchCommand !== undefined && !['engage', 'hold', 'release'].includes(c.rotorClutchCommand as string)) return null;
  for (const key of ['cyclicTrimPitch', 'cyclicTrimRoll', 'n2Beep']) {
    if (c[key] !== undefined && (!isNum(c[key]) || Math.abs(c[key] as number) > 1)) return null;
    // Momentary switches (trim motors, the governor beep) cannot be held through a reload.
    if (c[key] !== undefined) c[key] = 0;
  }
  if (c.reverse !== undefined && (!isNum(c.reverse) || c.reverse < 0 || c.reverse > 1)) return null;
  if (c.lampTestId !== undefined) { if (typeof c.lampTestId !== 'string') return null; delete c.lampTestId; }
  // A held key cannot survive a reload. It must not leave the pump priming unattended.
  if (c.fuelPrime !== undefined) c.fuelPrime = false;
  // Held interrupt switches (stick pusher, STARTER INTERRUPT) are released by a reload too.
  for (const key of ['pusherInterrupt', 'starterInterrupt']) {
    if (c[key] !== undefined && typeof c[key] !== 'boolean') return null;
    if (c[key] !== undefined) c[key] = false;
  }
  if (isRotorcraftId(v.aircraft) && (!isObj(v.systems) || !isObj(v.systems.rotorcraft))) return null;
  for (const k of ['elevator', 'aileron', 'rudder', 'throttle', 'mixture', 'flaps', 'elevatorTrim', 'brakeLeft', 'brakeRight', 'magnetos', 'kollsmanHpa', 'headingBugDeg', 'obsDeg']) {
    if (!isNum(c[k])) return null;
  }
  const w = v.weather;
  if (!isObj(w)) return null;
  for (const k of ['windDirectionDeg', 'windSpeedKt', 'gustKt', 'turbulence', 'isaDeviation', 'qnhHpa', 'cloudCover', 'cloudBaseM', 'cloudTopM', 'visibilityM', 'timeOfDay', 'dayOfYear']) {
    if (!isNum(w[k])) return null;
  }
  // The optional weather fields (core/weatherFields.ts): a malformed one is dropped, not the flight. A copy, so
  // the caller's object is not edited.
  const weather = { ...w };
  sanitizeExtras(weather);
  if (v.schema <= LEGACY_EMPTY_STORMS_SCHEMA && Array.isArray(weather.storms) && weather.storms.length === 0) delete weather.storms;
  if (!CAMERA_MODES.includes(v.cameraMode as CameraMode) || !QUALITIES.includes(v.quality as QualityLevel)) return null;
  if (v.renderScale !== null && !isNum(v.renderScale)) return null;
  const st = v.status;
  if (!isObj(st) || typeof st.onGround !== 'boolean' || typeof st.crashed !== 'boolean' || !isNum(st.groundSpeed)) return null;
  const af = v.autoflight;
  if (af !== null && (!isObj(af) || typeof af.phase !== 'string' || !isObj(af.settings) || !isNum(af.drift))) return null;
  // Schema 2 extras: a malformed one is dropped, not the whole flight (the flight itself is fine).
  const out = { ...v, schema: SNAPSHOT_SCHEMA, weather } as unknown as FlightSnapshot;
  // Schema 1 and 2: a Cessna 172S, its systems in the legacy fields.
  out.aircraft ??= DEFAULT_AIRCRAFT_ID;
  out.systems ??= systemsOfLegacy(out);
  if (out.start !== undefined && !(isObj(out.start) && START_KINDS.includes(out.start.kind))) delete out.start;
  if (out.training === null) delete out.training;
  // Schema 5: the hail damage. Absent (schema 4 and older) or malformed: none.
  if (out.damage !== undefined && !isDamage(out.damage)) delete out.damage;
  if (out.damage === undefined) out.damage = noDamage();
  return out;
}

// ---------------------------------------------------------------------------------------- boot decision

export type BootDecision =
  | { kind: 'resume'; snapshot: FlightSnapshot; ageMs: number }
  /** Start this scenario fresh (the last one deliberately restarted, or a parked aircraft's). */
  | { kind: 'scenario'; scenario: ScenarioId; reason: string }
  | { kind: 'normal'; reason: string };

export interface BootOptions {
  /** resume= URL parameter: true (resume=1), false (resume=0) or null (absent). */
  param: boolean | null;
  /** The URL names a scenario explicitly (scenario=...). */
  explicitScenario: boolean;
  /** The menu preference "Resume where I left off on reload". */
  enabled: boolean;
  now: number;
  /**
   * The type this session will fly. Optional (absent = DEFAULT_AIRCRAFT_ID): the twelve existing decideBoot
   * calls in tests/sim/resume.test.ts keep compiling and keep resuming.
   */
  aircraft?: AircraftId;
  /** The era this session is set in. Optional (absent = 'present'), like `aircraft`. */
  era?: EraId;
}

/**
 * What to boot: resume the snapshot, start the snapshot's scenario fresh, or start normally (URL / default).
 * resume=1 resumes even with scenario= in the URL or the preference off; resume=0 never resumes. A snapshot
 * of another type than the one booted is never used (not even with resume=1): the guard against a snapshot
 * stored under the wrong key. Likewise a snapshot of another era (absent on either side = the present day).
 */
export function decideBoot(snap: FlightSnapshot | null, o: BootOptions): BootDecision {
  if (o.param === false) return { kind: 'normal', reason: 'resume=0' };
  if (o.param !== true) {
    if (o.explicitScenario) return { kind: 'normal', reason: 'scenario= in the URL' };
    if (!o.enabled) return { kind: 'normal', reason: 'resume preference off' };
  }
  if (!snap) return { kind: 'normal', reason: 'no valid snapshot' };
  if ((snap.aircraft ?? DEFAULT_AIRCRAFT_ID) !== (o.aircraft ?? DEFAULT_AIRCRAFT_ID)) return { kind: 'normal', reason: 'snapshot is for another aircraft' };
  if ((snap.era ?? 'present') !== (o.era ?? 'present')) return { kind: 'normal', reason: 'snapshot is from another era' };
  const ageMs = o.now - snap.savedAt;
  if (!(ageMs >= 0) || ageMs > MAX_AGE_MS) return { kind: 'normal', reason: 'snapshot too old' };
  if (snap.status.crashed) return { kind: 'normal', reason: 'crashed' };
  if (!snap.resume) return { kind: 'scenario', scenario: snap.scenario, reason: 'scenario restarted' };
  // A lesson in progress resumes wherever it is (a cold-and-dark start before the engine start counts).
  if (snap.training !== undefined) return { kind: 'resume', snapshot: snap, ageMs };
  if (isParked(snap)) return { kind: 'scenario', scenario: snap.scenario, reason: 'parked with the engine off' };
  return { kind: 'resume', snapshot: snap, ageMs };
}

/** On the ground, stationary, no engine running: nothing worth resuming. */
export function isParked(snap: FlightSnapshot): boolean {
  const engines = snap.systems?.engines ?? [snap.engine];
  return snap.status.onGround && snap.status.groundSpeed < PARKED_SPEED && !engines.some((e) => e.running);
}

/** "m:ss" (or "h:mm:ss") of an age in ms. */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// ------------------------------------------------------------------------------------------- storage

/** The subset of the Web Storage API used here (tests pass a fake). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** window.localStorage, or null where it is unavailable or throws on access (sandboxed / private pages). */
export function browserStore(): KeyValueStore | null {
  try {
    const s = (globalThis as { localStorage?: KeyValueStore }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/** The stored snapshot of a type (default the Cessna 172S), or null. */
export function loadSnapshot(store: KeyValueStore | null, id: AircraftId = DEFAULT_AIRCRAFT_ID): FlightSnapshot | null {
  if (!store) return null;
  try {
    return parseSnapshot(store.getItem(snapshotKey(id)));
  } catch {
    return null;
  }
}

/** Write a snapshot under its type's key (default the Cessna 172S's); false when storage is missing or refused it (quota, security). Never throws. */
export function saveSnapshot(store: KeyValueStore | null, snap: FlightSnapshot, id: AircraftId = DEFAULT_AIRCRAFT_ID): boolean {
  if (!store) return false;
  try {
    store.setItem(snapshotKey(id), JSON.stringify(snap));
    return true;
  } catch {
    return false;
  }
}

export function clearSnapshot(store: KeyValueStore | null, id: AircraftId = DEFAULT_AIRCRAFT_ID): void {
  try {
    store?.removeItem(snapshotKey(id));
  } catch {
    /* ignore */
  }
}

/** The "Resume where I left off on reload" preference (default on). */
export function loadResumePreference(store: KeyValueStore | null): boolean {
  try {
    return store?.getItem(RESUME_PREF_KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveResumePreference(store: KeyValueStore | null, on: boolean): void {
  try {
    store?.setItem(RESUME_PREF_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Cockpit presentation is a preference even when resuming a flight is disabled. */
export const PANEL_VIEW_PREF_KEY = 'fs.panelView';
export function loadPanelView(store: KeyValueStore | null): PanelView {
  try {
    const v = store?.getItem(PANEL_VIEW_PREF_KEY);
    return v === 'upper' || v === 'lower' || v === 'hidden' ? v : '3d';
  } catch { return '3d'; }
}
export function savePanelView(store: KeyValueStore | null, view: PanelView): void {
  try { store?.setItem(PANEL_VIEW_PREF_KEY, view); } catch { /* private browsing / quota */ }
}
