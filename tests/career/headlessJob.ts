// The headless job host (docs/career.md "Build plan", 2b): a real SimPhysics of any Career type placed at a field
// as the Career places a job, the job monitor (src/career/runtime/monitor.ts) wired to the physics' own event bus
// exactly as the CareerSystem wires it, and small scripted pilots to start the engine, fly a circuit and set a
// helicopter down. No DOM, no curtain: placements happen at once, between frames.
//
// PLACEMENT. As src/career/placement.ts will (2a, written in parallel; this host builds its own): setStartField
// (null at home) and buildScenario('apron' | 'runway' | 'final') for the type, the fuel as `ic.fuelFraction`, and
// the job's loading (src/career/loading.ts loadingFor) as `loading` on the scenario. Until 2a's SimPhysics hook
// reads `Scenario.loading`, resetTo ignores that field and flies the 'typical' loading; the monitor does not care
// about the mass. Every placement emits the 'reset' SimEvent with lessonId 'career:<jobId>' (SimPhysics itself
// emits none: the Simulator's startFrom does), which the monitor takes as its own (re)placement; foreignReset()
// emits one without it.
//
// FRAME LOOP (frame()): the pilot (if any) acts, the physics advances FRAME_DT of sim time in whole fixed steps
// (touchdown and crash events step-exact from inside them), then the monitor updates with the same dt.
//
// PILOTS. startPiston: master, fuel pump to prime, mixture rich, throttle cracked, both magnetos, starter until it
// fires. CircuitPilot: the physics' own scripted pilot (src/sim/autoflight.ts) with its runway set to the field's,
// leg by leg round the ATC's circuit for that field (src/atc/circuit.ts circuitPath, as src/atc/trafficPilot.ts flies
// it): take-off, crosswind and downwind at circuit height, base, then the 'approach' plan down the 3 deg path to a
// stop on the runway with the parking brake set; the pilot then shuts the engine down (mixture to cut-off, magnetos
// off). Taxiing from the stand to the runway is not scripted: the job is started at the stand (the monitor sees the
// engine run) and then re-placed lined up, engine running, through a Career placement, as a refuel at a stop does.
// HeliPilot: the R44's start-up from tests/rotorcraft/r44Flights.test.ts (prime, start, clutch, governor, warm-up)
// and src/sim/rotorcraft/scriptedPilot.ts's ScriptedPilot in the physics step (physics.copilot) to lift to a hover,
// hold it, set down and lower the collective; then the start-up reversed (governor off, throttle closed, mixture
// cut-off, clutch out, magnetos off).

import type { AircraftDefinition } from '../../src/aircraft/types';
import { activeFrame } from '../../src/atc/calls';
import { CIRCUIT_HEIGHT, circuitPath, legPosition, legTrack, turnLead, type CircuitPath } from '../../src/atc/circuit';
import { loadingFor } from '../../src/career/loading';
import { JobMonitor, monitorAircraftOf, type JobMonitorEvent, type JobSources } from '../../src/career/runtime/monitor';
import { assignStations } from '../../src/career/stations';
import { CAREER_RESET_PREFIX, type CareerAircraftId, type JobOffer, type OfferItem } from '../../src/career/types';
import { createEventBus, type EventBus, type ScenarioId } from '../../src/core/context';
import { clamp, DEG, FPM, FT, KT, wrapPi } from '../../src/core/math';
import { defaultWeather, type AircraftState, type ControlInputs, type WeatherSettings } from '../../src/core/types';
import type { AutoflightRunway } from '../../src/sim/autoflight';
import { observePilot, ScriptedPilot } from '../../src/sim/rotorcraft/scriptedPilot';
import { buildScenario, flapLever, type Scenario } from '../../src/sim/scenarios';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { setStartField } from '../../src/sim/startField';
import { airfields, type Airfield } from '../../src/world/airfields';

/** Rendered-frame period of the headless loop, s (as tests/training/headlessHost.ts). */
export const FRAME_DT = 1 / 30;

/** A synthetic offer for the host: `to` is the destination (default: back to the origin). */
export function hostOffer(id: string, from: Airfield, to: Airfield = from, over: Partial<JobOffer> = {}): JobOffer {
  return {
    id,
    kind: 'positioning',
    day: 1,
    origin: from.code,
    destination: { kind: 'field', code: to.code },
    client: 'Headless',
    title: `Position to ${to.name}`,
    pax: 0,
    payload: [],
    payloadKg: 0,
    distanceNm: 10,
    pay: 100,
    deadlineMin: 120,
    minClass: 'tourer',
    refType: 'c172s',
    repRequired: 0,
    premium: false,
    weather: 'clear',
    windDirDeg: 0,
    windKt: 0,
    ...over,
  };
}

export interface HeadlessJobOptions {
  type: CareerAircraftId;
  def: AircraftDefinition;
  offer: JobOffer;
  /** Where and how the job is first placed (default 'apron' at the offer's origin). */
  start?: ScenarioId;
  /** Fuel fraction of the usable fuel at the placement (default 0.8). */
  fuelFraction?: number;
  /** Weather over defaultWeather() (default: calm, no turbulence, midday). */
  weather?: Partial<WeatherSettings>;
}

/** One job flown headless: `physics` the real SimPhysics, `monitor` the real JobMonitor connected to its events. */
export class HeadlessJob {
  readonly physics: SimPhysics;
  readonly weather: WeatherSettings;
  readonly events: EventBus;
  readonly monitor: JobMonitor;
  readonly fields: readonly Airfield[];
  /** Every SimEvents touchdown (wheel, sink fpm, sim time of the job) and crash, in order. */
  readonly touchdowns: { wheel: 'nose' | 'left' | 'right'; sinkFpm: number; t: number; onGround: boolean }[] = [];
  readonly crashes: string[] = [];
  /** Every monitor event, in order. */
  readonly monitorEvents: JobMonitorEvent[] = [];
  /** Sim seconds flown by the host. */
  t = 0;
  pilot: ((job: HeadlessJob, dt: number) => void) | null = null;

  constructor(readonly opts: HeadlessJobOptions) {
    this.fields = airfields();
    this.weather = { ...defaultWeather(), windSpeedKt: 0, gustKt: 0, turbulence: 0, timeOfDay: 12, ...opts.weather };
    this.events = createEventBus();
    this.physics = new SimPhysics({ weather: this.weather, events: this.events, aircraft: opts.def });
    this.events.on('touchdown', (e) => this.touchdowns.push({ wheel: e.wheel, sinkFpm: e.sinkRate / FPM, t: this.t, onGround: this.physics.state.onGround }));
    this.events.on('crash', (e) => this.crashes.push(e.reason));
    this.monitor = new JobMonitor({
      offer: opts.offer,
      type: opts.type,
      aircraft: monitorAircraftOf(opts.def),
      fields: this.fields,
      onEvent: (e) => this.monitorEvents.push(e),
    });
    this.place(opts.start ?? 'apron', this.field(opts.offer.origin), opts.fuelFraction ?? 0.8, false);
    this.monitor.connect(this.events, () => this.physics.state);
  }

  /** The field with this code. */
  field(code: string): Airfield {
    const f = this.fields.find((x) => x.code === code);
    if (!f) throw new Error(`headlessJob: no field ${code}`);
    return f;
  }

  /** The Career's placement scenario at a field (see the header). */
  scenario(id: ScenarioId, f: Airfield, fuelFraction: number): Scenario {
    setStartField(f.kind === 'home' ? null : f.code);
    const sc = buildScenario(id, this.physics.env, this.opts.def);
    const items = assignStations(this.opts.offer.payload as OfferItem[], this.opts.type);
    const loading = loadingFor(this.opts.type, items.ok ? items.items : []);
    // `loading` is 2a's Scenario field (contract: docs/career.md "Placement"); spread in so this compiles before it lands.
    const placed: Scenario & { loading?: unknown } = { ...sc, title: `${f.name} (${f.code}), job ${this.opts.offer.id}`, ic: { ...sc.ic, fuelFraction } };
    placed.loading = loading;
    return placed;
  }

  /** Place the aircraft (cold at the stand, lined up, or on final) and tell the monitor (unless `silent`). */
  place(id: ScenarioId, f: Airfield, fuelFraction: number, emit = true): void {
    this.physics.copilot = null;
    this.physics.resetTo(this.scenario(id, f, fuelFraction), this.weather);
    if (emit) this.events.emit('reset', { scenario: id, lessonId: `${CAREER_RESET_PREFIX}${this.opts.offer.id}` });
  }

  /** A reset from outside the Career (Shift+R, a menu scenario): the monitor abandons the job. */
  foreignReset(id: ScenarioId = 'runway'): void {
    this.physics.resetTo(buildScenario(id, this.physics.env, this.opts.def), this.weather);
    this.events.emit('reset', { scenario: id });
  }

  get state(): AircraftState {
    return this.physics.state;
  }

  get controls(): ControlInputs {
    return this.physics.controls;
  }

  sources(): JobSources {
    return { state: this.physics.state, controls: this.physics.controls, weather: this.weather, env: this.physics.env };
  }

  /** One frame: the pilot, FRAME_DT of physics, the monitor. */
  frame(dt = FRAME_DT): void {
    this.pilot?.(this, dt);
    this.physics.step(dt);
    this.t += dt;
    this.monitor.update(dt, this.sources());
  }

  /** Frames for up to `seconds`, stopping early when `until` holds (checked after each frame). Returns the time run. */
  run(seconds: number, until?: (job: HeadlessJob) => boolean): number {
    const t0 = this.t;
    while (this.t - t0 < seconds - 1e-9) {
      this.frame();
      if (until?.(this)) break;
    }
    return this.t - t0;
  }
}

// ------------------------------------------------------------------------------------------------ pilots

/** Start a piston aeroplane's engine at the stand (see the header). Returns the sim seconds it took, or NaN if it never ran. */
export function startPiston(job: HeadlessJob): number {
  const c = job.controls;
  Object.assign(c, { masterBattery: true, mixture: 1, throttle: 0.1, magnetos: 3, fuelSelector: 'both', fuelPump: true });
  job.run(3);
  c.fuelPump = false;
  c.starter = true;
  const t = job.run(10, (j) => j.state.engine.running);
  c.starter = false;
  return job.state.engine.running ? 3 + t : NaN;
}

/** Cut the engine(s): throttle closed, mixture to cut-off, magnetos off. */
export function shutDownPiston(c: ControlInputs): void {
  Object.assign(c, { throttle: 0, mixture: 0, magnetos: 0 });
  if (c.engines) for (const e of c.engines) Object.assign(e, { throttle: 0, mixture: 0 });
}

/** The scripted pilot's frame for a field's runway end (as trafficPilot.ts runwayFrame). */
export function fieldRunway(path: CircuitPath): AutoflightRunway {
  const f = path.field;
  return { heading: f.heading + (path.end === 1 ? Math.PI : 0), halfLength: f.length / 2, elevation: f.elevation, coords: (n, e) => activeFrame(f, path.end, n, e) };
}

/** Not below this height on the climb-out does the crosswind turn begin, m (as trafficPilot.ts). */
const CROSSWIND_MIN = 450 * FT;
/** Descent from abeam the threshold toward base height, m/s (500 fpm). */
const CIRCUIT_DESCENT = (500 * FT) / 60;

/**
 * Round the circuit of `f` (landing end 0) from lined up, engine running, to a stop on the runway with the parking
 * brake set, then the engine shut down. `phase` reads 'takeoff' | 'circuit' | 'approach' | 'shutdown' | 'done'.
 */
export class CircuitPilot {
  readonly path: CircuitPath;
  leg = 0;
  phase: 'takeoff' | 'circuit' | 'approach' | 'shutdown' | 'done' = 'takeoff';
  private drift = 0;
  private stoppedS = 0;

  constructor(readonly job: HeadlessJob, readonly f: Airfield) {
    this.path = circuitPath(f, 0);
  }

  private get def(): AircraftDefinition {
    return this.job.opts.def;
  }

  /** Engage the take-off (call once lined up). */
  begin(): void {
    const af = this.job.physics.autoflight;
    af.runway = fieldRunway(this.path);
    const s = this.job.state;
    af.engage({ kind: 'takeoff', heading: af.runway.heading, climbTo: this.f.elevation + CIRCUIT_HEIGHT, cruiseKias: this.def.sim.scenario.downwindKias }, s, this.job.controls);
    this.phase = 'takeoff';
    this.leg = 0;
  }

  private hold(height: number, kias: number): void {
    const s = this.job.state;
    this.job.physics.autoflight.engage({ kind: 'hold', heading: s.heading, altitude: this.f.elevation + height + this.def.geometry.restHeight, kias }, s, this.job.controls);
  }

  /** The pilot's decisions for one frame. */
  step(dt: number): void {
    const job = this.job;
    const s = job.state;
    const c = job.controls;
    const af = job.physics.autoflight;
    const sc = this.def.sim.scenario;
    const fl = this.def.controls.flaps;
    if (!s.onGround && s.groundSpeed > 15) this.drift += (wrapPi(s.heading - s.track) - this.drift) * Math.min(1, dt / 3);
    if (this.phase === 'approach' && (af.phase === 'stopped' || (s.onGround && s.groundSpeed < 0.3 && af.phase === 'rollout'))) {
      this.stoppedS += dt;
      if (this.stoppedS > 1) {
        af.disengage();
        c.parkingBrake = true;
        c.brakeLeft = c.brakeRight = 0;
        shutDownPiston(c);
        this.phase = 'shutdown';
      }
      return;
    }
    if (this.phase === 'shutdown') {
      if (!s.engines.some((e) => e.running)) this.phase = 'done';
      return;
    }
    if (this.phase === 'done' || s.onGround) return;
    if (this.phase === 'takeoff' && (af.phase === 'climb' || af.phase === 'cruise')) this.phase = 'circuit';
    if (this.phase !== 'circuit') return;
    af.autopilot.settings.maxBank = 22 * DEG;
    const height = s.altitudeMSL - this.f.elevation - this.def.geometry.restHeight;
    const leg = this.path.legs[this.leg];
    const pos = legPosition(this.path, this.leg, s.position.x, s.position.y);
    if (leg.id !== 'final' && pos.toGo < turnLead(s.groundSpeed) && (leg.id !== 'upwind' || height > CROSSWIND_MIN)) {
      this.leg++;
      const next = this.path.legs[this.leg];
      if (next.id === 'final') {
        c.flaps = flapLever(fl, sc.finalFlapsDeg);
        af.engage({ kind: 'approach', kias: sc.finalKias }, s, c);
        this.phase = 'approach';
        return;
      }
      if (next.id === 'base') {
        c.flaps = flapLever(fl, sc.baseFlapsDeg);
        this.hold(this.path.legs[3].height, sc.finalKias + 5);
        af.autopilot.settings.verticalSpeed = CIRCUIT_DESCENT;
      } else {
        c.flaps = 0;
        this.hold(CIRCUIT_HEIGHT, sc.downwindKias);
      }
    }
    if (af.phase === 'hold') {
      const p = legPosition(this.path, this.leg, s.position.x, s.position.y);
      af.autopilot.settings.heading = wrapPi(legTrack(this.path, this.leg, p.cross) + this.drift);
      const now = this.path.legs[this.leg];
      if (now.id === 'downwind' && activeFrame(this.f, 0, s.position.x, s.position.y).along < -this.f.length / 2 && af.autopilot.settings.altitude > this.f.elevation + this.path.legs[3].height + this.def.geometry.restHeight + 1) {
        c.flaps = Math.max(c.flaps, flapLever(fl, sc.baseFlapsDeg) / 2);
        af.autopilot.settings.airspeed = (sc.finalKias + 10) * KT;
        af.autopilot.settings.altitude = this.f.elevation + this.path.legs[3].height + this.def.geometry.restHeight;
        af.autopilot.settings.verticalSpeed = CIRCUIT_DESCENT;
      }
    }
  }
}

/**
 * The R44 from cold to a hover and back down to a shutdown, in the physics step (physics.copilot). `hoverM` is the
 * skid height of the hover, m; `hoverS` how long it is held. `phase` reads the stage reached.
 */
export class HeliPilot {
  phase: 'start' | 'runup' | 'warmup' | 'hover' | 'descend' | 'down' | 'shutdown' | 'done' = 'start';
  t = 0;
  private fired: number | null = null;
  private hoverAt = NaN;
  private downAt = NaN;
  private pilot: ScriptedPilot | null = null;

  /** `engineRpm100`: the engine's 100 % rpm (the R44's R44_REFERENCE.engineRpm100, 2,665). */
  constructor(readonly job: HeadlessJob, readonly engineRpm100: number, readonly hoverM = 7, readonly hoverS = 15) {}

  /** Install in the physics step. */
  install(): void {
    this.job.physics.copilot = { flying: true, update: (h, s, c) => this.update(h, s, c) };
  }

  private update(dt: number, s: AircraftState, c: ControlInputs): void {
    const d = this.job.opts.def.rotorcraft!;
    const engineRpm100 = this.engineRpm100;
    const t = this.t;
    this.t += dt;
    const height = s.altitudeAGL - d.skids.z;
    switch (this.phase) {
      case 'start':
        if (t < 4) Object.assign(c, { rotorClutch: false, rotorGovernor: true, throttle: 0.05, mixture: 1, magnetos: 3, masterBattery: true, alternator: false, fuelPrime: true, collective: 0 });
        else {
          c.fuelPrime = false;
          c.mixture = this.fired === null ? 0 : 1;
          c.starter = this.fired === null;
          if (s.engine.running) {
            this.fired ??= t;
            c.mixture = 1;
            c.starter = false;
          }
          if (t >= 12) this.phase = 'runup';
          if (t < 12 && this.fired !== null) c.throttle = clamp(c.throttle + 0.0004 * (0.55 * engineRpm100 - s.engine.rpm) * dt, 0, 0.3);
        }
        return;
      case 'runup':
        if (t < 25) {
          c.throttle = clamp(c.throttle + 0.0004 * (0.55 * engineRpm100 - s.engine.rpm) * dt, 0, 0.3);
          return;
        }
        c.rotorClutch = true;
        c.alternator = true;
        c.rotorGovernor = false;
        c.throttle = clamp(c.throttle + 0.0003 * ((t < 70 ? 0.65 : 0.75) * engineRpm100 - s.engine.rpm) * dt, 0, 0.3);
        if (t >= 100) this.phase = 'warmup';
        return;
      case 'warmup':
        c.rotorGovernor = true;
        if (s.engine.rpm < 0.81 * engineRpm100) c.throttle += 0.02 * dt;
        if (t >= 130 && s.engine.cht >= 95 && s.engine.oilTemp >= 40) {
          this.phase = 'hover';
          this.hoverAt = t;
        }
        return;
      case 'hover':
      case 'descend': {
        this.pilot ??= new ScriptedPilot(observePilot(s, d), c);
        const o = observePilot(s, d);
        if (this.phase === 'hover' && t > this.hoverAt + 10 + this.hoverS) this.phase = 'descend';
        const target = this.phase === 'hover' ? this.hoverM : -0.3;
        const vs = this.phase === 'hover' ? clamp(0.5 * (target - height), -0.5, 0.8) : clamp(0.4 * (target - height), -0.6, -0.15);
        this.pilot.step(dt, o, c, 0, vs);
        if (this.phase === 'descend' && s.onGround) {
          this.phase = 'down';
          this.downAt = t;
        }
        return;
      }
      case 'down':
        this.pilot?.slide(dt, observePilot(s, d), c);
        c.collective = Math.max(0, (c.collective ?? 0) - 0.3 * dt);
        if (t > this.downAt + 8 && c.collective === 0) this.phase = 'shutdown';
        return;
      case 'shutdown':
        Object.assign(c, { collective: 0, rotorGovernor: false, throttle: 0, mixture: 0, elevator: 0, aileron: 0, rudder: 0 });
        if (!s.engine.running) {
          c.magnetos = 0;
          c.rotorClutch = false;
          this.phase = 'done';
        }
        return;
      case 'done':
        return;
    }
  }

  /** Height of the skids above the ground, m. */
  height(): number {
    const d = this.job.opts.def.rotorcraft!;
    return this.job.state.altitudeAGL - d.skids.z;
  }

  /** Ground speed, kt. */
  gsKt(): number {
    return this.job.state.groundSpeed / KT;
  }
}
