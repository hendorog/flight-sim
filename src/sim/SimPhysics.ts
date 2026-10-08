// The simulation core of the application: flight model, world environment, pilot controls, autoflight,
// scenario resets and fixed-step time keeping. No DOM or WebGL, so node tests run exactly what the
// browser runs.
//
// TIME KEEPING
//   The flight model is advanced in fixed steps of 1/physicsRate s (240 Hz), each preceded by one
//   autoflight update. Rendering calls advance(frameDt): frame time (times the time scale) accumulates and
//   whole steps are run; catch-up is clamped (at most MAX_FRAME_SIM s of simulation per frame, the excess is
//   dropped) so a slow frame can never cause a spiral of death. The remainder gives an interpolation factor:
//   `renderState` is a copy of the flight model's state with position/attitude interpolated between the
//   last two steps, so motion is smooth at any refresh rate (at the cost of <= one step of latency).
//   step(seconds) runs an exact number of steps as fast as possible (scripts, tests, run=).
//
// TIME ACCELERATION
//   The physics costs ~0.12-0.15 ms per 240 Hz step, so 16x would need ~0.5 s of CPU per wall second on top
//   of rendering. Two measures keep the display smooth (as X-Plane / MSFS do):
//   - above COARSE_TIME_SCALE, while airborne and clear of the ground, the flight model runs at
//     COARSE_RATE (120 Hz) instead of 240 Hz, and above 8x at 60 Hz (X-Plane runs its whole flight model
//     at the frame rate): cruise and pattern states agree within 0.2 kt / 0.1 m / 0.1 deg over 5 minutes
//     with turbulence (tests/sim/timeAcceleration.test.ts); gear contact always gets the full rate;
//   - advance() takes a CPU budget: when the steps due would exceed it, the remaining backlog is dropped
//     (the achieved time scale drops) instead of the frame rate collapsing. `lastAdvance` is the simulated
//     time that actually elapsed in the rendered state, which is what the subsystems should receive.
//
// THE AIRCRAFT
//   One type for the life of the instance (SimPhysicsOptions.aircraft, default the Cessna 172S): its flight
//   model, its scenarios and its scripted pilot. Everything goes through the AircraftFlightModel interface.

import type { AircraftDefinition } from '../aircraft/types';
import { quat, v3, type Quat, type Vec3 } from '../core/math';
import type { CameraMode, EventBus, QualityLevel, ScenarioId } from '../core/context';
import {
  applyControls,
  cloneControls,
  copyControls,
  defaultControls,
  DEFAULT_AIRCRAFT_ID,
  type AircraftState,
  type ControlInputs,
  type Environment,
  type GearState,
  type InitialConditions,
  type WeatherSettings,
} from '../core/types';
import { createFlightModel, createFlightModelFor, type SimEnvironment } from '../physics';
import type { AircraftFlightModel } from '../physics/interfaces';
import type { StepController } from '../training/types';
import { Autoflight } from './autoflight';
import { SNAPSHOT_SCHEMA, snapshotSystems, type FlightSnapshot } from './resume';
import { buildScenario, type Scenario } from './scenarios';
import type { StartSpec } from './starts';
import { createWorldEnvironment } from './worldEnvironment';

/** Most simulated time one advance() call may run per unit of time scale, s. */
const MAX_FRAME_SIM = 0.1;
/** Time scales above this may run the flight model at COARSE_RATE while airborne. */
export const COARSE_TIME_SCALE = 4;
/** Physics rate for accelerated airborne flight, Hz (above 8x: half of it). */
export const COARSE_RATE = 120;
/** Height above ground (and no wheel contact) required for the coarse rate, m. */
const COARSE_MIN_AGL = 60;

/**
 * Emits the 'gear' events of a retractable gear (sound and UI) by comparing state.gear after each step with the
 * step before: a leg leaving its down lock ('unlock'), reaching it ('downLocked'), reaching up ('up'). A fixed
 * gear never moves, so nothing is compared.
 */
export class GearEvents {
  private readonly locked = [true, true, true];
  private readonly up = [false, false, false];

  /** Take the present gear as the starting point (after a reset or a restore): no event for it. */
  sync(g: GearState): void {
    for (let i = 0; i < 3; i++) {
      this.locked[i] = g.locked[i];
      this.up[i] = g.extension[i] <= 0;
    }
  }

  update(g: GearState, emit: (kind: 'unlock' | 'downLocked' | 'up', leg: 0 | 1 | 2) => void): void {
    if (!g.retractable) return;
    for (let i = 0; i < 3; i++) {
      const leg = i as 0 | 1 | 2;
      const locked = g.locked[i];
      const up = g.extension[i] <= 0;
      if (this.locked[i] && !locked) emit('unlock', leg);
      else if (!this.locked[i] && locked) emit('downLocked', leg);
      if (up && !this.up[i]) emit('up', leg);
      this.locked[i] = locked;
      this.up[i] = up;
    }
  }
}

export interface SimPhysicsOptions {
  /** The live weather object (shared with the UI and the renderer). */
  weather: WeatherSettings;
  /** Where touchdown / crash events go. Optional (tests). */
  events?: EventBus;
  /** Live controls object to drive (ctx.controls). Default: a fresh one for the aircraft. */
  controls?: ControlInputs;
  /** The type flown. Default: the Cessna 172S. */
  aircraft?: AircraftDefinition;
}

/** Deep-copy plain data (numbers, booleans, strings, nested objects and arrays) from src into dst. */
function copyInto<T extends object>(dst: T, src: T): T {
  for (const key of Object.keys(src) as (keyof T)[]) {
    const v = src[key];
    if (v !== null && typeof v === 'object') {
      if (dst[key] === null || typeof dst[key] !== 'object') (dst as Record<keyof T, unknown>)[key] = Array.isArray(v) ? [] : {};
      copyInto(dst[key] as object, v as object);
    } else dst[key] = v;
  }
  return dst;
}

export class SimPhysics {
  readonly fm: AircraftFlightModel;
  /** The type flown (fm.definition). */
  readonly definition: AircraftDefinition;
  readonly env: SimEnvironment;
  readonly controls: ControlInputs;
  readonly autoflight: Autoflight;
  /** State for rendering: fm.state with interpolated position and attitude. Same object for the whole run. */
  readonly renderState: AircraftState;
  readonly stepSize: number;
  scenario!: Scenario;
  /** Engage the autoflight on every reset (ap=1). */
  autoflightOnReset = false;
  /** Total simulated steps since the last reset. */
  steps = 0;
  /** Simulated time the rendered state advanced during the last advance() / step() call, s. */
  lastAdvance = 0;
  /** True when the last advance() stopped at its CPU budget and dropped simulated time. */
  budgetLimited = false;
  /**
   * The Flight School instructor-pilot, or null. Called every physics step after the autoflight and before
   * the flight model: it writes the controls while `flying` and applies instructor holds even when not.
   */
  copilot: StepController | null = null;
  /**
   * Carburettor icing (the realism switch, ctx.carbIcing): while false the flight model meets dry air (no
   * moisture, so no carburettor ice). Default true.
   */
  carbIcing = true;

  private readonly events: EventBus | undefined;
  /** `env` without its moisture: what the flight model steps in while carburettor icing is off. */
  private readonly dryEnv: Environment;
  private readonly gearEvents = new GearEvents();
  private readonly emitGear = (kind: 'unlock' | 'downLocked' | 'up', leg: 0 | 1 | 2): void => this.events?.emit('gear', { kind, leg });
  private accumulator = 0;
  private wasCrashed = false;
  private readonly prevPos: Vec3 = v3.zero();
  private readonly prevQuat: Quat = quat.identity();
  private alpha = 1;
  /** Current step size, s: stepSize, or 1 / COARSE_RATE during accelerated airborne flight. */
  private h: number;

  constructor(opts: SimPhysicsOptions) {
    this.events = opts.events;
    this.controls = opts.controls ?? defaultControls(opts.aircraft);
    this.env = createWorldEnvironment(opts.weather);
    this.dryEnv = Object.assign(Object.create(this.env) as Environment, { moisture: undefined });
    this.fm = opts.aircraft ? createFlightModelFor(opts.aircraft) : createFlightModel();
    const def = (this.definition = this.fm.definition);
    this.autoflight = new Autoflight(def.sim.autoflight, def.reference, def.geometry.restHeight, { gains: def.autopilot, flaps: def.controls.flaps });
    this.stepSize = 1 / this.fm.physicsRate;
    this.h = this.stepSize;
    this.renderState = copyInto({} as AircraftState, this.fm.state);
  }

  get state(): AircraftState {
    return this.fm.state;
  }

  /** Simulation time of the rendered state, s (resets to 0 with the scenario). */
  get time(): number {
    return this.fm.state.time + (this.alpha - 1) * this.h;
  }

  /**
   * Put the aircraft at a scenario's start. ctx.controls is initialised from the flight model's trimmed
   * controls (plus the scenario's switch settings), so nothing jumps on the first step.
   */
  reset(id: ScenarioId, weather?: WeatherSettings): Scenario {
    return this.resetTo(buildScenario(id, this.env, this.definition), weather);
  }

  /**
   * Put the aircraft at any Scenario's start: one of the five free-flight scenarios (reset) or a Flight School
   * start (starts.ts buildStart). Applies the scenario's payload (default 'typical'), fuel and switches, and
   * for an unusual-attitude start rotates the trimmed aircraft to the requested attitude with the airspeed
   * kept along the nose. The copilot, if any, is left to its owner (TrainingSystem).
   */
  resetTo(sc: Scenario, weather?: WeatherSettings): Scenario {
    this.scenario = sc;
    this.applyLoading(sc.payload ?? 'typical');
    this.fm.reset(sc.ic, this.env);
    if (sc.attitude) this.rotateTo(sc.attitude.pitch, sc.attitude.roll);
    const c = this.controls;
    const trim = this.fm.trimControls;
    copyControls(c, trim);
    applyControls(c, sc.controls ?? {});
    c.starter = false;
    c.dgAlign = false;
    c.kollsmanHpa = weather?.qnhHpa ?? c.kollsmanHpa;
    const hdgDeg = (this.fm.state.heading * 180) / Math.PI;
    c.headingBugDeg = ((Math.round(hdgDeg) % 360) + 360) % 360;
    c.obsDeg = 70;
    // fm.reset() computed the electrical state with its own default switches (master on); until the first
    // step runs, make it agree with the scenario's switches (cold and dark = dead bus).
    if (!c.masterBattery) {
      const e = this.fm.state.electrical;
      e.busVoltage = 0;
      e.alternatorAmps = 0;
      e.batteryAmps = 0;
    }
    this.accumulator = 0;
    this.steps = 0;
    this.lastAdvance = 0;
    this.budgetLimited = false;
    this.setRate(1 / this.stepSize);
    this.wasCrashed = false;
    this.gearEvents.sync(this.fm.state.gear);
    this.autoflight.disengage();
    if (this.autoflightOnReset && !this.definition.rotorcraft) this.autoflight.engage(sc.autoflight, this.fm.state, c);
    this.snapshot();
    this.alpha = 1;
    this.publishRenderState();
    return sc;
  }

  /**
   * Set the payload before a reset (the flight model rebuilds its mass properties from it in reset()).
   * 'typical' is the flight model's default (C172S: front seats plus 40 kg of baggage, CG ~28 % MAC).
   * 'forward' is the loading the inertia is given for, on the C172S the two front-seat occupants alone, which
   * with full fuel balances at the reference point (25 % MAC): near the forward limit, where the stall is benign
   * (Flight School stalls).
   */
  private applyLoading(kind: 'forward' | 'typical'): void {
    const m = this.definition.mass;
    this.fm.setLoading(kind === 'forward' ? m.inertiaLoading : m.loadings.typical);
  }

  /**
   * Rotate the (just trimmed) aircraft to a pitch and bank at its present heading, keeping its airspeed along
   * the new nose direction and zero body rates (the flight model's setKinematics, as in restore()).
   */
  private rotateTo(pitch: number, roll: number): void {
    const s = this.fm.state;
    const q = quat.fromEuler(roll, pitch, s.heading);
    const tas = Math.max(s.tas, 1);
    const air = quat.rotate(q, { x: tas, y: 0, z: 0 });
    const wind = this.env.wind(s.position, 0);
    this.fm.setKinematics({ position: { ...s.position }, orientation: q, velocity: v3.add(air, wind), angularVelocity: v3.zero() });
  }

  /**
   * The flight as a resume snapshot (resume.ts). `view` adds what the shell owns (weather, camera, quality).
   * Uses the flight model's stepped state, not the interpolated render state.
   */
  captureSnapshot(view: { weather: WeatherSettings; cameraMode: CameraMode; quality: QualityLevel; renderScale: number | null; resume: boolean; now?: number }): FlightSnapshot {
    const s = this.fm.state;
    const systems = this.fm.captureSystems();
    const e0 = systems.engines[0];
    const snap: FlightSnapshot = {
      schema: SNAPSHOT_SCHEMA,
      aircraft: this.definition.id,
      savedAt: view.now ?? Date.now(),
      resume: view.resume,
      scenario: this.scenario.id,
      simTime: s.time,
      body: {
        position: { ...s.position },
        velocity: { ...s.velocity },
        orientation: { ...s.orientation },
        angularVelocity: { ...s.angularVelocity },
      },
      // The schema-2 fields: engine 0, the two-tank view, the battery and the surfaces.
      engine: { running: s.engine.running, rpm: e0.rpm, egt: e0.egt, cht: e0.cht, oilTemp: e0.oilTemp, oilPressure: e0.oilPressure },
      fuel: { left: s.fuel.left, right: s.fuel.right },
      batteryCharge: s.electrical.batteryCharge,
      surfaces: { ...systems.surfaces },
      systems,
      controls: cloneControls(this.controls),
      weather: { ...view.weather },
      cameraMode: view.cameraMode,
      quality: view.quality,
      renderScale: view.renderScale,
      autoflight: this.autoflight.exportState(),
      status: { onGround: s.onGround, crashed: s.crashed, groundSpeed: s.groundSpeed, altitudeMSL: s.altitudeMSL, heading: s.heading, ias: s.ias },
    };
    // `start` (spec 6.1): the lesson start the last reset came from, when it came from one.
    if (this.scenario.start) snap.start = JSON.parse(JSON.stringify(this.scenario.start)) as StartSpec;
    return snap;
  }

  /**
   * Continue a saved flight. The flight model's own API only: reset() into a nearby trimmed condition (sets
   * up the environment, mass and lag states), then the systems (powerplant, tanks, battery, surfaces), the
   * model clock, the exact rigid-body state (setKinematics), the pilot's controls and the autoflight. The caller
   * restores the weather first (it is shared with the environment). The scenario becomes the snapshot's, so a
   * restart goes back to it. Throws for a snapshot of another type (the shell never hands one over).
   */
  restore(snap: FlightSnapshot): Scenario {
    const fm = this.fm;
    const def = this.definition;
    const aircraft = snap.aircraft ?? DEFAULT_AIRCRAFT_ID;
    if (aircraft !== def.id) throw new Error(`a snapshot of the ${aircraft} cannot be restored into the ${def.id}`);
    const sys = snapshotSystems(snap);
    const sc = buildScenario(snap.scenario, this.env, def);
    this.scenario = sc;
    const b = snap.body;
    const v = b.velocity;
    const speed = Math.hypot(v.x, v.y, v.z);
    const onGround = snap.status.onGround;
    let fuel = 0;
    let capacity = 0;
    for (const q of sys.tanks) fuel += q;
    for (const q of fm.powerplant.tankCapacities) capacity += q;
    const restoreSpeeds = def.sim.scenario;
    const ic: InitialConditions = {
      position: { ...b.position },
      heading: snap.status.heading,
      // Trimmed near the saved condition so the reset's solve converges quickly; replaced below anyway.
      airspeed: Math.max(restoreSpeeds.restoreMinTas, speed),
      onGround,
      engineRunning: sys.engines[0].running,
      fuelFraction: Math.min(1, Math.max(0, fuel / capacity)),
      flaps: snap.controls.flaps,
      flightPathAngle: onGround || speed < 1 ? 0 : Math.max(-0.2, Math.min(0.2, Math.asin(Math.max(-1, Math.min(1, -v.z / speed))))),
    };
    if (def.engineCount > 1) {
      ic.engineRunning = sys.engines.some((e) => e.running);
      ic.enginesRunning = sys.engines.map((e) => e.running);
      ic.feathered = sys.engines.map((e) => e.featherLatched);
    }
    if (def.geometry.gear.retractable) ic.gearDown = sys.gear.extension.every((x) => x > 0.5);
    try {
      fm.reset(ic, this.env);
    } catch {
      fm.reset({ ...ic, flightPathAngle: 0, airspeed: restoreSpeeds.restoreFallbackTas }, this.env);
    }
    // Pilot controls exactly as saved (momentary switches released), over the type's defaults (a snapshot of an
    // older schema lacks the newer levers).
    const c = this.controls;
    copyControls(c, defaultControls(def));
    applyControls(c, snap.controls);
    c.starter = false;
    c.dgAlign = false;
    // Powerplant (shaft speeds, tanks, battery, temperatures) and the surfaces where they were (the flaps lag
    // their lever), the rudder pedal with them.
    fm.restoreSystems(sys, c, 0.5 * fm.state.airDensity * speed * speed);
    // The flight-model clock: the wind field (turbulence, gusts, thermals and their drift) is a function of
    // it, so the restored flight meets the same air.
    fm.setClock(snap.simTime);
    (this.env as Partial<SimEnvironment>).windField?.reset();
    // The exact rigid-body state (aerodynamic lags and tyre states restart from rest).
    fm.setKinematics({ position: b.position, orientation: b.orientation, velocity: b.velocity, angularVelocity: b.angularVelocity });
    // Until the first step republishes them, report the restored powerplant (the panel's gyros, the audio).
    const st = fm.state;
    for (let i = 0; i < sys.engines.length && i < st.engines.length; i++) {
      const e = sys.engines[i];
      st.engines[i].running = e.running;
      st.engines[i].rpm = e.rpm;
      st.propellers[i].rpm = e.propRpm;
    }
    if (st.rotorcraft) {
      st.propeller.rpm = st.rotorcraft.rotorRpm;
      st.propeller.rotation = st.rotorcraft.azimuth;
      st.engine.propRpm = st.rotorcraft.rotorRpm;
    }
    st.time = snap.simTime;
    this.accumulator = 0;
    this.steps = 0;
    this.lastAdvance = 0;
    this.budgetLimited = false;
    this.setRate(1 / this.stepSize);
    this.wasCrashed = false;
    this.gearEvents.sync(st.gear);
    if (!def.rotorcraft) this.autoflight.importState(snap.autoflight);
    this.snapshot();
    this.alpha = 1;
    this.publishRenderState();
    return sc;
  }

  /** Engage (true) or disengage the autoflight; engaging mid-flight holds the current heading/altitude/speed. */
  setAutoflight(on: boolean, useScenarioPlan = false): void {
    if (this.definition.rotorcraft) { this.autoflight.disengage(); return; }
    if (!on) this.autoflight.disengage();
    else if (useScenarioPlan) this.autoflight.engage(this.scenario.autoflight, this.fm.state, this.controls);
    else this.autoflight.engageHere(this.fm.state, this.controls);
  }

  /**
   * Advance by a frame's worth of (already time-scaled) simulated time; returns the number of steps run.
   * `budgetMs` bounds the CPU time spent on steps: past it the backlog is dropped (see TIME ACCELERATION).
   */
  advance(simDt: number, timeScale = 1, budgetMs = Infinity): number {
    const t0 = this.time;
    this.budgetLimited = false;
    if (!(simDt > 0)) {
      this.publishRenderState();
      this.lastAdvance = 0;
      return 0;
    }
    const cap = MAX_FRAME_SIM * Math.max(1, timeScale);
    this.accumulator = Math.min(this.accumulator + simDt, cap);
    const start = budgetMs < Infinity ? performance.now() : 0;
    let n = 0;
    for (;;) {
      this.chooseRate(timeScale);
      if (this.accumulator < this.h) break;
      this.accumulator -= this.h;
      this.stepOnce();
      n++;
      if (budgetMs < Infinity && this.accumulator >= this.h && performance.now() - start > budgetMs) {
        // Out of time: keep only the sub-step remainder (for interpolation) and drop the rest.
        this.accumulator %= this.h;
        this.budgetLimited = true;
        break;
      }
    }
    this.alpha = this.accumulator / this.h;
    this.publishRenderState();
    this.lastAdvance = Math.max(0, this.time - t0);
    return n;
  }

  /** Run `seconds` of simulation now, in whole fixed (full-rate) steps, without interpolation. Returns steps run. */
  step(seconds: number): number {
    const t0 = this.time;
    this.setRate(1 / this.stepSize);
    const n = Math.max(0, Math.round(seconds / this.stepSize));
    for (let i = 0; i < n; i++) this.stepOnce();
    this.accumulator = 0;
    this.alpha = 1;
    this.publishRenderState();
    this.lastAdvance = Math.max(0, this.time - t0);
    return n;
  }

  /** Full rate, or COARSE_RATE when accelerated and well clear of the ground. Changes only between steps. */
  private chooseRate(timeScale: number): void {
    const s = this.fm.state;
    const coarse =
      !this.definition.rotorcraft && timeScale > COARSE_TIME_SCALE && !s.onGround && !s.crashed && s.altitudeAGL > COARSE_MIN_AGL && !s.wheels.some((w) => w.onGround);
    const rate = coarse ? Math.min(timeScale > 8 ? COARSE_RATE / 2 : COARSE_RATE, 1 / this.stepSize) : 1 / this.stepSize;
    if (Math.abs(1 / this.h - rate) > 1e-9) {
      // Keep the interpolation fraction when switching (the accumulator is in seconds).
      this.setRate(rate);
    }
  }

  private setRate(rate: number): void {
    this.fm.setPhysicsRate(rate);
    this.h = 1 / rate;
  }

  private snapshot(): void {
    const s = this.fm.state;
    Object.assign(this.prevPos, s.position);
    Object.assign(this.prevQuat, s.orientation);
  }

  private stepOnce(): void {
    this.snapshot();
    this.autoflight.update(this.h, this.fm.state, this.controls);
    // The instructor-pilot: every step (it applies holds even while the student flies).
    const copilot = this.copilot;
    copilot?.update(this.h, this.fm.state, this.controls);
    // Feet off the pedals: the rudder floats and the nosewheel follows it (the input module decides; the
    // autoflight and the copilot always have their feet on the pedals).
    this.fm.rudderFree = !!this.controls.feetOffRudder && !this.autoflight.engaged && !copilot?.flying;
    this.fm.step(this.h, this.controls, this.carbIcing ? this.env : this.dryEnv);
    this.steps++;
    const s = this.fm.state;
    const ev = this.events;
    if (ev) {
      for (const t of this.fm.touchdowns) ev.emit('touchdown', { wheel: t.wheel, sinkRate: t.sinkRate });
      if (s.crashed && !this.wasCrashed) ev.emit('crash', { reason: s.crashReason });
      this.gearEvents.update(s.gear, this.emitGear);
    }
    this.wasCrashed = s.crashed;
  }

  /** Copy the flight model's state into renderState, interpolating the pose by the accumulator fraction. */
  private publishRenderState(): void {
    const r = copyInto(this.renderState, this.fm.state);
    const a = this.alpha;
    if (a < 1) {
      const p = this.prevPos;
      const c = this.fm.state.position;
      r.position.x = p.x + (c.x - p.x) * a;
      r.position.y = p.y + (c.y - p.y) * a;
      r.position.z = p.z + (c.z - p.z) * a;
      r.altitudeMSL = -r.position.z;
      r.altitudeAGL += r.altitudeMSL - this.fm.state.altitudeMSL;
      slerpInto(r.orientation, this.prevQuat, this.fm.state.orientation, a);
      r.time = this.time;
    }
  }
}

/** Spherical interpolation of unit quaternions {w, x, y, z}, shortest arc. */
function slerpInto(out: Quat, a: Quat, b: Quat, t: number): void {
  let bw = b.w, bx = b.x, by = b.y, bz = b.z;
  let cos = a.w * bw + a.x * bx + a.y * by + a.z * bz;
  if (cos < 0) {
    cos = -cos;
    bw = -bw;
    bx = -bx;
    by = -by;
    bz = -bz;
  }
  let k0 = 1 - t;
  let k1 = t;
  if (cos < 0.9995) {
    const th = Math.acos(cos);
    const s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s;
    k1 = Math.sin(t * th) / s;
  }
  out.w = k0 * a.w + k1 * bw;
  out.x = k0 * a.x + k1 * bx;
  out.y = k0 * a.y + k1 * by;
  out.z = k0 * a.z + k1 * bz;
  const n = Math.hypot(out.w, out.x, out.y, out.z) || 1;
  out.w /= n;
  out.x /= n;
  out.y /= n;
  out.z /= n;
}
