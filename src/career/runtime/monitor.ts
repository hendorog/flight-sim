// The job monitor (docs/career.md "The job runtime"): built when a job is placed and disposed when it ends, it
// watches the flight and hands the CareerSystem the JobFlightReport the settlement prices. It reuses the Flight
// School's telemetry, detectors and logbook timer without changing them, on its own instances:
//
//   Telemetry([core, fieldGeo, powerplant])   the school's core and powerplant providers, and the field geo
//                                             provider (fieldGeo.ts) in place of the home-07 one
//   TrainingBus, DerivedEventDetector         liftoff (aeroplanes), stall warning
//   LandingDetector                           touchdowns from fieldTouchdownData (the type's own main gear)
//   FlightTimer(false)                        block, airborne and night time, landings, take-offs
//   ComfortMeter (comfort.ts)                 the passengers' ride
//   CompletionTracker (completion.ts)         arrival, stops and outlandings
//
// PHASES. dispatched (placed, engines not yet started) -> ground (an engine running) -> airborne (the detector's
// liftoff, or 3 s with no wheel on the ground above 15 ft AGL: the liftoff detector wants the throttle at 0.5 or
// more, which a helicopter's governed grip never is) -> landed (the landing detector's landing ended with the
// aircraft on the ground, or 10 s on the ground after flying if no landing was detected) -> done. From landed a
// take-off is airborne again (a touch and go, or carrying on); a shutdown at another field is 'stopped' (held
// until continueJob(); lifting off from there carries on too). A shutdown before the first take-off decides
// nothing, as the completion tracker requires the job to have flown.
//
// TIME. Job time is elapsedBaseS (the seconds before this placement) plus the sum of the frames' sim dt: the
// shell feeds the frame's simulated time (frameSimDt: physics.lastAdvance, or the whole run= fast-forward), 0
// while held or paused, so it equals physics.time since the placement and never runs while the sim does not.
//
// EVENTS. connect(events, stepState) subscribes to the SimEvents: 'touchdown' (step-exact, the flight model's
// own state), 'crash' (ends the job 'crashed'; the CareerSystem keeps it as active.pendingReport), 'reset' (one
// whose lessonId starts with CAREER_RESET_PREFIX is the Career's own (re)placement and only restarts the
// detectors; any other reset ends the job 'abandoned'). The same handlers are public (onTouchdown, onCrash,
// onReset) for a host that delivers them itself. Every ending and stop is also passed to `onEvent`.
//
// STATE. exportState() is plain JSON (the resume block's `monitor`); restoreState() takes it back, or returns
// false for anything malformed (the caller then keeps a fresh monitor built with the store's elapsedS). The
// detectors restart on a restore, as they do on any placement: resume on the ground or in cruise, not mid-flare.
//
// Node-safe and three.js-free; imports no aircraft module: the type's numbers arrive as MonitorAircraft
// (monitorAircraftOf(def)) and its performance row (CareerPerf).

import type { EventBus } from '../../core/context';
import { FPM, FT, KT, type Vec3 } from '../../core/math';
import type { AircraftState, ControlInputs, Environment, WeatherSettings } from '../../core/types';
import type { InstrumentReadings } from '../../instruments/dynamics/instrumentSet';
import { FlightTimer } from '../../training/career/logbook';
import { TrainingBus } from '../../training/engine/bus';
import { DerivedEventDetector, LandingDetector } from '../../training/engine/events';
import { createCoreProvider } from '../../training/telemetry/providers/core';
import { createPowerplantProvider } from '../../training/telemetry/providers/powerplant';
import { Telemetry } from '../../training/telemetry/telemetry';
import type { AircraftTypeDef, FlightTimerState, LandingData, SignalFrame, TelemetrySources } from '../../training/types';
import type { Airfield } from '../../world/airfields';
import { fieldArea, fieldAt, fieldByCode } from '../geo';
import { careerPerf } from '../perf';
import {
  CAREER_RESET_PREFIX, COMPLETION_RULES, type CareerAircraftId, type CareerPerf, type JobFlightReport, type JobOffer, type JobOutcome, type JobPhase,
  type JobStripModel, type LandingSummary,
} from '../types';
import { ComfortMeter, comfortSample } from './comfort';
import { CompletionTracker } from './completion';
import { createFieldGeoProvider, fieldTouchdownData, mainsMidpoint, type FieldGeoProvider } from './fieldGeo';
import { scoreAeroplaneLanding, scoreHeliLanding, type HeliContact } from './landingScore';
import { jobHint, jobStrip, landingSpot } from './strip';

/** Constants of the monitor's own rules (the rest are COMPLETION_RULES, COMFORT_RULES, LANDING_SCORE_RULES). */
export const MONITOR_RULES = {
  /** Airborne without the liftoff detector: no wheel on the ground for this long, s... */
  airborneS: 3,
  /** ...above this height (reference point), ft. */
  airborneAboveFt: 15,
  /** Landed without a landing event: on the ground this long after flying, s. */
  landedFallbackS: 10,
  /** Version of exportState(). */
  stateVersion: 1,
} as const;

/** The numbers of the flown type the monitor needs (monitorAircraftOf). */
export interface MonitorAircraft {
  helicopter: boolean;
  /** Never-exceed speed, KIAS (def.reference.vne). */
  vneKt: number;
  /** Main-gear (skid) midpoint, body m (def.geometry.gear). */
  mainsBody: Vec3;
  /** Spinner, body x m (def.geometry.fuselage.noseX). */
  noseX: number;
}

/** MonitorAircraft from a definition (the definition is passed in; this module imports no aircraft). */
export function monitorAircraftOf(def: {
  rotorcraft?: unknown;
  reference: { vne: number };
  geometry: { gear: { leftMain: Vec3; rightMain: Vec3 }; fuselage: { noseX: number } };
}): MonitorAircraft {
  return { helicopter: !!def.rotorcraft, vneKt: def.reference.vne, mainsBody: mainsMidpoint(def.geometry.gear), noseX: def.geometry.fuselage.noseX };
}

/** What the monitor samples each frame (the TrainingSystem's TelemetrySources, less what no provider here reads). */
export interface JobSources {
  state: Readonly<AircraftState>;
  controls: Readonly<ControlInputs>;
  weather: Readonly<WeatherSettings>;
  env: Environment;
  /** Panel readings (null: truth stands in for the indicated signals, as headless). */
  readings?: Readonly<InstrumentReadings> | null;
  timeScale?: number;
}

/** A stop or an ending, as it happens (also the return of update()). */
export type JobMonitorEvent =
  | { kind: 'stopped'; field: string }
  | { kind: 'ended'; report: JobFlightReport };

/** What a JobMonitor is built with: the job, the flown type, the world's fields and the job's state at this placement. */
export interface JobMonitorOptions {
  offer: JobOffer;
  type: CareerAircraftId;
  aircraft: MonitorAircraft;
  /** Every field of the world (src/world/airfields.ts airfields()). */
  fields: readonly Airfield[];
  /** Job seconds before this placement (ActiveJob.elapsedBaseS; the store's elapsedS for a fresh monitor after a reload). */
  elapsedBaseS?: number;
  /** The job's phase at this placement (default 'dispatched'; a refuel at a stop places with the job's own). */
  phase?: JobPhase;
  /** The job has flown already (ActiveJob.everAirborne). */
  everAirborne?: boolean;
  /** Phase 'stopped': the field it is held at. */
  stoppedAt?: string;
  /** The performance row (default careerPerf(type)). */
  perf?: CareerPerf;
  /** Every stop and ending, as it happens. */
  onEvent?: (e: JobMonitorEvent) => void;
}

/** exportState()'s shape (plain JSON). */
export interface JobMonitorState {
  v: 1;
  offerId: string;
  phase: JobPhase;
  everAirborne: boolean;
  stoppedAt: string | null;
  elapsedBaseS: number;
  simT: number;
  airS: number;
  groundS: number;
  timer: FlightTimerState;
  comfort: unknown;
  completion: unknown;
  maxG: number;
  minG: number;
  overspeedS: number;
  stallWarningS: number;
  landing: LandingSummary | null;
  nextWaypoint: number;
  waypointsDone: number;
  lastKnown: { north: number; east: number; onGround: boolean };
}

const PHASES: readonly JobPhase[] = ['dispatched', 'ground', 'airborne', 'landed', 'stopped', 'done'];
/** Duration test with an allowance for summed frame times (as src/training/engine/events.ts). */
const reached = (t: number, s: number): boolean => t >= s - 1e-9;
/** No provider in the monitor's list reads the training type definition; TelemetrySources wants one. */
const NO_TYPE_DEF = {} as AircraftTypeDef;

/** Total fuel aboard, kg (the authoritative tanks; the legacy pair on a state without them). */
export function fuelOnBoardKg(s: Readonly<AircraftState>): number {
  const tanks = s.fuel.tanks;
  if (tanks && tanks.length > 0) return tanks.reduce((a, t) => a + t.quantity, 0);
  return s.fuel.left + s.fuel.right;
}

/** Every engine stopped. */
export function enginesStopped(s: Readonly<AircraftState>): boolean {
  const es = s.engines && s.engines.length > 0 ? s.engines : [s.engine];
  return es.every((e) => !e.running);
}

/** Present burn of all engines, kg/h. */
export function fuelFlowKgH(s: Readonly<AircraftState>): number {
  const es = s.engines && s.engines.length > 0 ? s.engines : [s.engine];
  return es.reduce((a, e) => a + (Number.isFinite(e.fuelFlow) ? e.fuelFlow : 0), 0) * 3600;
}

/**
 * A report with no flight in it (a job ended where no monitor ran: 'lost' after a reload with no snapshot,
 * 'diverted' by Give up or Rest, 'abandoned' before placement). The CareerSystem fills what it knows.
 */
export function blankReport(outcome: JobOutcome, at: { north: number; east: number }, elapsedS: number, fuelKg: number, atField: string | null = null, waypointsTotal = 0): JobFlightReport {
  return {
    outcome, atField, position: { north: at.north, east: at.east }, elapsedMin: Math.max(0, elapsedS) / 60,
    blockS: 0, airborneS: 0, nightS: 0, landingsDay: 0, landingsNight: 0, takeoffs: 0, landing: null,
    comfort: { score: 100, deductions: { vertical: 0, lateral: 0, bank: 0, pitch: 0, descent: 0, stall: 0, landing: 0 } },
    maxG: 1, minG: 1, overspeedS: 0, stallWarningS: 0, fuelAtEndKg: Math.max(0, fuelKg), onApron: false, onRunway: false,
    waypointsDone: 0, waypointsTotal,
  };
}

/** Watches one job's flight (see the header). */
export class JobMonitor {
  readonly offer: JobOffer;
  readonly type: CareerAircraftId;
  readonly aircraft: MonitorAircraft;
  readonly perf: CareerPerf;
  private readonly fields: readonly Airfield[];
  private readonly destField: Airfield | null;
  private readonly onEvent?: (e: JobMonitorEvent) => void;

  private tel!: Telemetry;
  private geo!: FieldGeoProvider;
  private bus!: TrainingBus;
  private det!: DerivedEventDetector;
  private land!: LandingDetector;
  private busOff: (() => void)[] = [];
  private timer = new FlightTimer(false);
  private comfort: ComfortMeter;
  private completion: CompletionTracker;
  private unsubscribe: (() => void)[] = [];

  private _phase: JobPhase;
  private _everAirborne: boolean;
  private _stoppedAt: string | null;
  private elapsedBaseS: number;
  /** Sim seconds since this placement (the detectors' clock). */
  private simT = 0;
  private airS = 0;
  private groundS = 0;
  private maxG = 1;
  private minG = 1;
  private overspeedS = 0;
  private stallWarningS = 0;
  private landing: LandingSummary | null = null;
  private nextWaypoint = 0;
  private waypointsDone = 0;
  private lastKnown = { north: 0, east: 0, onGround: true };
  private _ended: JobFlightReport | null = null;
  /** The state of the call in progress (touchdown handler or frame), for the bus handlers. */
  private cur: Readonly<AircraftState> | null = null;
  private last: JobSources | null = null;
  private frame: SignalFrame | null = null;
  private contact: HeliContact | null = null;

  constructor(o: JobMonitorOptions) {
    this.offer = o.offer;
    this.type = o.type;
    this.aircraft = o.aircraft;
    this.perf = o.perf ?? careerPerf(o.type);
    this.fields = o.fields;
    this.onEvent = o.onEvent;
    const d = o.offer.destination;
    this.destField = d.kind === 'field' ? fieldByCode(d.code, o.fields) ?? null : null;
    this.elapsedBaseS = Math.max(0, o.elapsedBaseS ?? 0);
    this._phase = o.phase && o.phase !== 'done' ? o.phase : 'dispatched';
    this._everAirborne = o.everAirborne ?? false;
    this._stoppedAt = this._phase === 'stopped' ? o.stoppedAt ?? null : null;
    this.comfort = new ComfortMeter(this.perf.pressurised);
    this.completion = new CompletionTracker(o.offer.destination, o.fields);
    this.buildDetectors();
  }

  // ------------------------------------------------------------------------------------------- read-outs

  get phase(): JobPhase {
    return this._phase;
  }

  get everAirborne(): boolean {
    return this._everAirborne;
  }

  /** Phase 'stopped': the field code held at. */
  get stoppedAt(): string | null {
    return this._stoppedAt;
  }

  /** Job sim seconds: elapsedBaseS + sim time since this placement. */
  get elapsedS(): number {
    return this.elapsedBaseS + this.simT;
  }

  /** The report the job ended with, or null while it runs. */
  get ended(): JobFlightReport | null {
    return this._ended;
  }

  /** The last full-stop landing's summary (the one the debrief grades), or null. */
  get lastLanding(): LandingSummary | null {
    return this.landing;
  }

  /** Running comfort score, 0..100. */
  get comfortScore(): number {
    return this.comfort.score;
  }

  /** Last known position (for ActiveJob.lastKnown). */
  get position(): { north: number; east: number; onGround: boolean } {
    return { ...this.lastKnown };
  }

  /** Scenic: turning points overflown so far. */
  get waypoints(): { done: number; next: number; total: number } {
    return { done: this.waypointsDone, next: this.nextWaypoint, total: this.offer.waypoints?.length ?? 0 };
  }

  // ------------------------------------------------------------------------------------------- wiring

  /** Subscribe to the sim's touchdown, crash and reset events; `stepState` is the step-exact state (physics.fm.state). */
  connect(events: EventBus, stepState: () => Readonly<AircraftState>): void {
    this.unsubscribe.push(
      events.on('touchdown', (e) => this.onTouchdown(stepState(), e.wheel, e.sinkRate / FPM)),
      events.on('crash', (e) => this.onCrash(e.reason, stepState())),
      events.on('reset', (e) => this.onReset(e.lessonId)),
    );
  }

  /** Unsubscribe everything (the job ended, or the CareerSystem is going away). */
  dispose(): void {
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
    for (const u of this.busOff) u();
    this.busOff = [];
  }

  /** A wheel (skid) contact, from inside the physics step. `sinkFpm` = the event's sinkRate (m/s) x 196.85. */
  onTouchdown(s: Readonly<AircraftState>, wheel: 'nose' | 'left' | 'right', sinkFpm: number): void {
    if (this._ended) return;
    this.cur = s;
    this.land.onTouchdown(fieldTouchdownData(s, wheel, sinkFpm, this.destField, this.aircraft.mainsBody, this.geo.landingEnd() ?? undefined), this.simT);
    this.cur = null;
  }

  /** The aircraft crashed: the job ends 'crashed'. */
  onCrash(reason: string, s?: Readonly<AircraftState>): JobFlightReport | null {
    if (this._ended) return null;
    if (s) this.keep(s);
    return this.end('crashed', null, reason);
  }

  /** A sim reset: the Career's own (re)placement (lessonId 'career:...') restarts the detectors; any other abandons the job. */
  onReset(lessonId?: string): void {
    if (this._ended) return;
    if (lessonId?.startsWith(CAREER_RESET_PREFIX)) this.placed();
    else this.end('abandoned', this.groundField(), undefined);
  }

  /**
   * A (re)placement by the Career (the first one, or a refuel at a stop): the detectors start again and the
   * sim time since the placement is folded into elapsedBaseS; the job's accumulators carry on.
   */
  placed(): void {
    this.elapsedBaseS += this.simT;
    this.simT = 0;
    this.airS = 0;
    this.groundS = 0;
    this.completion.reset();
    this.buildDetectors();
  }

  /** At a stop: carry on from here (phase back to 'ground'). False unless stopped. */
  continueJob(): boolean {
    if (this._phase !== 'stopped' || this._ended) return false;
    this._phase = 'ground';
    this._stoppedAt = null;
    this.completion.reset();
    return true;
  }

  /** End the job as abandoned now (the player's Abandon, or a confirmed outside reset). */
  abandon(): JobFlightReport {
    return this._ended ?? this.end('abandoned', this.groundField(), undefined);
  }

  // ------------------------------------------------------------------------------------------- frame

  /** One frame of `dt` sim seconds (0 while held or paused). Returns a stop or ending that happened in it. */
  update(dt: number, src: JobSources): JobMonitorEvent | null {
    if (this._ended) return null;
    const h = dt > 0 && Number.isFinite(dt) ? dt : 0;
    const s = src.state;
    this.last = src;
    this.cur = s;
    if (h > 0) this.simT += h;
    const f = this.tel.sample(this.sources(src), h);
    this.frame = f;
    this.det.update(f, this.simT, h);
    this.land.update(f, this.simT, h);
    this.timer.update(f, h, false);
    this.comfort.update(comfortSample(s, src.weather.turbulence, this.aircraft.helicopter), h);
    this.keep(s);
    this.cur = null;

    let event: JobMonitorEvent | null = null;
    if (h > 0) {
      const kias = s.ias / KT;
      if (kias > this.aircraft.vneKt) this.overspeedS += h;
      if (!s.onGround) {
        this.maxG = Math.max(this.maxG, s.gLoad);
        this.minG = Math.min(this.minG, s.gLoad);
        const warn = this.aircraft.helicopter ? s.rotorcraft?.lowRpmHorn === true : s.stallWarning;
        if (warn && s.altitudeAGL / FT > 50) this.stallWarningS += h;
        this.waypointCheck(s);
      }
      event = this.phaseStep(s, src.controls, h);
    }
    this.bus.clear();
    if (this._ended) return { kind: 'ended', report: this._ended };
    return event;
  }

  /** The strip model now (null before the first frame). */
  strip(): JobStripModel | null {
    const src = this.last;
    if (!src) return null;
    const s = src.state;
    const wps = this.offer.waypoints ?? [];
    const next = this.nextWaypoint < wps.length ? { name: wps[this.nextWaypoint].name, index: this.nextWaypoint, total: wps.length } : null;
    const destLabel = this.destField ? `${this.destField.code} ${this.destField.name}` : this.offer.destination.kind === 'site' ? this.offer.destination.name : '';
    const hint = jobHint({
      phase: this._phase,
      everAirborne: this._everAirborne,
      helicopter: this.aircraft.helicopter,
      destination: destLabel,
      waypoint: next,
      atDestination: s.onGround && this.atDestination(s),
      brakeHint: this._phase === 'landed' && this.completion.brakeHint({ helicopter: this.aircraft.helicopter, parkingBrake: src.controls.parkingBrake }),
      stoppedAt: this._stoppedAt ?? undefined,
    });
    return jobStrip({
      offer: this.offer, fields: this.fields, perf: this.perf, helicopter: this.aircraft.helicopter,
      north: s.position.x, east: s.position.y, gsKt: s.groundSpeed / KT, fuelKg: fuelOnBoardKg(s), fuelFlowKgH: fuelFlowKgH(s),
      airborne: !s.onGround, elapsedS: this.elapsedS, phase: this._phase, nextWaypoint: this.nextWaypoint,
      comfort: this.comfort.score, hint,
    });
  }

  /** The flight report as it stands, with this outcome (the ending's own once ended). */
  report(outcome: JobOutcome, atField: string | null = null, crashReason?: string): JobFlightReport {
    if (this._ended) return this._ended;
    const s = this.last?.state;
    const t = this.timer.state.times;
    const pos = this.lastKnown;
    let area: ReturnType<typeof fieldArea> = null;
    if (atField && pos.onGround) {
      const f = fieldByCode(atField, this.fields);
      area = f ? fieldArea(f, pos.north, pos.east) : null;
    }
    const r: JobFlightReport = {
      outcome,
      atField,
      position: { north: pos.north, east: pos.east },
      elapsedMin: this.elapsedS / 60,
      blockS: t.blockS,
      airborneS: t.airborneS,
      nightS: t.nightS,
      landingsDay: t.landingsDay,
      landingsNight: t.landingsNight,
      takeoffs: t.takeoffs,
      landing: this.landing ? { ...this.landing } : null,
      comfort: this.comfort.summary(),
      maxG: this.maxG,
      minG: this.minG,
      overspeedS: this.overspeedS,
      stallWarningS: this.stallWarningS,
      fuelAtEndKg: s ? fuelOnBoardKg(s) : 0,
      onApron: area === 'apron',
      onRunway: area === 'runway',
      waypointsDone: this.waypointsDone,
      waypointsTotal: this.offer.waypoints?.length ?? 0,
    };
    if (crashReason !== undefined) r.crashReason = crashReason;
    return r;
  }

  // ------------------------------------------------------------------------------------------- state

  exportState(): JobMonitorState {
    return {
      v: 1,
      offerId: this.offer.id,
      phase: this._phase,
      everAirborne: this._everAirborne,
      stoppedAt: this._stoppedAt,
      elapsedBaseS: this.elapsedBaseS,
      simT: this.simT,
      airS: this.airS,
      groundS: this.groundS,
      timer: this.timer.state,
      comfort: this.comfort.exportState(),
      completion: this.completion.exportState(),
      maxG: this.maxG,
      minG: this.minG,
      overspeedS: this.overspeedS,
      stallWarningS: this.stallWarningS,
      landing: this.landing ? { ...this.landing } : null,
      nextWaypoint: this.nextWaypoint,
      waypointsDone: this.waypointsDone,
      lastKnown: { ...this.lastKnown },
    };
  }

  /**
   * Continue from exportState() (the resume block after a reload). False, with nothing changed, for anything
   * malformed or another job's state: the caller keeps this fresh monitor.
   */
  restoreState(v: unknown): boolean {
    const o = v as Partial<Record<keyof JobMonitorState, unknown>> | null;
    if (typeof o !== 'object' || o === null || o.v !== MONITOR_RULES.stateVersion || o.offerId !== this.offer.id) return false;
    const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
    const nonNeg = (x: unknown): x is number => fin(x) && x >= 0;
    if (!PHASES.includes(o.phase as JobPhase) || o.phase === 'done' || typeof o.everAirborne !== 'boolean') return false;
    if (!(o.stoppedAt === null || typeof o.stoppedAt === 'string')) return false;
    if (![o.elapsedBaseS, o.simT, o.airS, o.groundS, o.overspeedS, o.stallWarningS, o.nextWaypoint, o.waypointsDone].every(nonNeg)) return false;
    if (!fin(o.maxG) || !fin(o.minG)) return false;
    const timer = validTimer(o.timer);
    if (!timer) return false;
    const lk = o.lastKnown as { north?: unknown; east?: unknown; onGround?: unknown } | null;
    if (typeof lk !== 'object' || lk === null || !fin(lk.north) || !fin(lk.east) || typeof lk.onGround !== 'boolean') return false;
    const landing = o.landing === null ? null : validLanding(o.landing);
    if (landing === undefined) return false;
    const comfort = new ComfortMeter(this.perf.pressurised);
    const completion = new CompletionTracker(this.offer.destination, this.fields);
    if (!comfort.restoreState(o.comfort) || !completion.restoreState(o.completion)) return false;

    this._phase = o.phase as JobPhase;
    this._everAirborne = o.everAirborne;
    this._stoppedAt = this._phase === 'stopped' ? (o.stoppedAt as string | null) : null;
    this.elapsedBaseS = o.elapsedBaseS as number;
    this.simT = o.simT as number;
    this.airS = o.airS as number;
    this.groundS = o.groundS as number;
    this.timer = new FlightTimer(false, timer);
    this.comfort = comfort;
    this.completion = completion;
    this.maxG = o.maxG;
    this.minG = o.minG;
    this.overspeedS = o.overspeedS as number;
    this.stallWarningS = o.stallWarningS as number;
    this.landing = landing;
    this.nextWaypoint = o.nextWaypoint as number;
    this.waypointsDone = o.waypointsDone as number;
    this.lastKnown = { north: lk.north, east: lk.east, onGround: lk.onGround };
    this.buildDetectors();
    return true;
  }

  // ------------------------------------------------------------------------------------------- inside

  private buildDetectors(): void {
    for (const u of this.busOff) u();
    this.geo = createFieldGeoProvider(() => this.destField, { noseX: this.aircraft.noseX });
    this.tel = new Telemetry([createCoreProvider(), this.geo, createPowerplantProvider()]);
    this.bus = new TrainingBus();
    this.det = new DerivedEventDetector(this.bus);
    this.land = new LandingDetector(this.bus);
    this.busOff = [
      this.bus.on('liftoff', () => this.takeOff()),
      this.bus.on('mainsTouchdown', (r) => {
        const s = this.cur;
        const spot = landingSpot(this.offer, this.fields);
        this.contact = {
          sinkFpm: r.data.sinkFpm,
          bankDeg: r.data.bankDeg,
          gsKt: s ? s.groundSpeed / KT : 0,
          spotDistM: s && spot ? Math.hypot(s.position.x - spot.north, s.position.y - spot.east) : NaN,
          bounces: 0,
          crashed: false,
        };
      }),
      this.bus.on('landing', (r) => this.landed(r.data)),
    ];
  }

  private sources(src: JobSources): TelemetrySources {
    return {
      state: src.state, controls: src.controls, readings: src.readings ?? null, weather: src.weather, env: src.env,
      aircraft: NO_TYPE_DEF, studentInput: false, timeScale: src.timeScale ?? 1, route: null,
    };
  }

  private keep(s: Readonly<AircraftState>): void {
    this.lastKnown = { north: s.position.x, east: s.position.y, onGround: s.onGround };
  }

  /** The field code the aircraft stands in when on the ground, else null. */
  private groundField(): string | null {
    const p = this.lastKnown;
    if (!p.onGround) return null;
    return fieldAt(p.north, p.east, this.fields)?.field.code ?? null;
  }

  private atDestination(s: Readonly<AircraftState>): boolean {
    const d = this.offer.destination;
    if (d.kind === 'site') return Math.hypot(s.position.x - d.north, s.position.y - d.east) <= COMPLETION_RULES.siteRadiusM;
    return !!this.destField && fieldArea(this.destField, s.position.x, s.position.y) !== null;
  }

  /** The job is airborne (from ground, dispatched, landed or stopped). */
  private takeOff(): void {
    if (this._ended || this._phase === 'airborne') return;
    if (this._phase === 'stopped') this._stoppedAt = null;
    this._phase = 'airborne';
    this._everAirborne = true;
    this.groundS = 0;
    this.completion.reset();
    this.timer.takeoff();
  }

  /** A landing ended (LandingDetector 'landing'). */
  private landed(d: LandingData): void {
    if (this._ended || d.crashed) return;
    const night = this.frame?.night === true;
    this.timer.landing(night);
    this.comfort.landing(d.sinkFpm, d.bounces);
    const s = this.cur;
    if (d.fullStop) {
      if (this.aircraft.helicopter) {
        const c = this.contact ?? { sinkFpm: d.sinkFpm, bankDeg: d.bankDeg, gsKt: 0, spotDistM: NaN, bounces: 0, crashed: false };
        this.landing = scoreHeliLanding({ ...c, bounces: d.bounces });
      } else if (this.destField) {
        this.landing = scoreAeroplaneLanding(d, this.destField);
      } else {
        this.landing = scoreAeroplaneLanding({ ...d, onRunway: false }, { kind: 'grass', length: 0 });
      }
    }
    this.contact = null;
    if (this._phase === 'airborne' && (d.fullStop || s?.onGround === true)) this.toLanded();
  }

  private toLanded(): void {
    this._phase = 'landed';
    this.groundS = 0;
    this.completion.reset();
  }

  /** The phase machine and completion, once per frame with dt > 0. */
  private phaseStep(s: Readonly<AircraftState>, c: Readonly<ControlInputs>, h: number): JobMonitorEvent | null {
    const R = MONITOR_RULES;
    if (this._phase === 'dispatched' && !enginesStopped(s)) this._phase = 'ground';
    // Airborne without the liftoff detector (helicopters, a start in the air, a lift-off at low throttle).
    if (!s.onGround && s.altitudeAGL / FT > R.airborneAboveFt) {
      this.airS += h;
      if (reached(this.airS, R.airborneS) && this._phase !== 'airborne') this.takeOff();
    } else this.airS = 0;
    if (this._phase === 'airborne') {
      this.groundS = s.onGround ? this.groundS + h : 0;
      if (reached(this.groundS, R.landedFallbackS)) this.toLanded();
    }
    const decision = this.completion.update(
      {
        phase: this._phase, everAirborne: this._everAirborne, onGround: s.onGround, gsMs: s.groundSpeed, enginesStopped: enginesStopped(s),
        parkingBrake: c.parkingBrake, helicopter: this.aircraft.helicopter, north: s.position.x, east: s.position.y,
      },
      h,
    );
    if (!decision) return null;
    if (decision.kind === 'completed') {
      this.end('completed', decision.field, undefined, decision.area === 'site' ? null : decision.area);
      return null;
    }
    if (decision.kind === 'outlanded') {
      this.end('outlanded', null, undefined);
      return null;
    }
    this._phase = 'stopped';
    this._stoppedAt = decision.field;
    const e: JobMonitorEvent = { kind: 'stopped', field: decision.field };
    this.onEvent?.(e);
    return e;
  }

  private waypointCheck(s: Readonly<AircraftState>): void {
    const wps = this.offer.waypoints;
    if (!wps) return;
    const agl = s.altitudeAGL / FT;
    for (let j = this.nextWaypoint; j < wps.length; j++) {
      const w = wps[j];
      if (Math.hypot(s.position.x - w.north, s.position.y - w.east) > w.radiusM) continue;
      if (w.maxAglFt !== undefined && agl > w.maxAglFt) continue;
      this.waypointsDone++;
      this.nextWaypoint = j + 1;
      return;
    }
  }

  private end(outcome: JobOutcome, atField: string | null, crashReason?: string, area?: ReturnType<typeof fieldArea>): JobFlightReport {
    this.timer.stop();
    const r = this.report(outcome, atField, crashReason);
    if (area !== undefined) {
      r.onApron = area === 'apron';
      r.onRunway = area === 'runway';
    }
    this._ended = r;
    this._phase = 'done';
    this.onEvent?.({ kind: 'ended', report: r });
    return r;
  }
}

/** A FlightTimerState rebuilt, or null. */
function validTimer(v: unknown): FlightTimerState | null {
  const o = v as Record<string, unknown> | null;
  if (typeof o !== 'object' || o === null) return null;
  const t = o.times as Record<string, unknown> | null;
  const keys = ['blockS', 'airborneS', 'nightS', 'instrumentS', 'landingsDay', 'landingsNight', 'takeoffs'] as const;
  if (typeof t !== 'object' || t === null || !keys.every((k) => typeof t[k] === 'number' && Number.isFinite(t[k]) && (t[k] as number) >= 0)) return null;
  if (typeof o.blockOn !== 'boolean' || typeof o.airborne !== 'boolean') return null;
  if (typeof o.offGroundS !== 'number' || !Number.isFinite(o.offGroundS) || typeof o.onGroundS !== 'number' || !Number.isFinite(o.onGroundS)) return null;
  const times = {} as FlightTimerState['times'];
  for (const k of keys) times[k] = t[k] as number;
  return { times, blockOn: o.blockOn, airborne: o.airborne, offGroundS: o.offGroundS, onGroundS: o.onGroundS };
}

/** A LandingSummary rebuilt; undefined when malformed. */
function validLanding(v: unknown): LandingSummary | undefined {
  const o = v as Record<string, unknown> | null;
  if (typeof o !== 'object' || o === null) return undefined;
  const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  if (!fin(o.score) || !fin(o.sinkFpm) || !fin(o.bounces) || typeof o.helicopter !== 'boolean' || typeof o.onTarget !== 'boolean') return undefined;
  if (o.firstWheel !== 'nose' && o.firstWheel !== 'left' && o.firstWheel !== 'right') return undefined;
  const out: LandingSummary = { score: o.score, sinkFpm: o.sinkFpm, bounces: o.bounces, firstWheel: o.firstWheel, helicopter: o.helicopter, onTarget: o.onTarget };
  for (const k of ['distAimFt', 'centrelineM', 'spotDistM'] as const) {
    if (o[k] === undefined) continue;
    if (!fin(o[k])) return undefined;
    out[k] = o[k] as number;
  }
  return out;
}
