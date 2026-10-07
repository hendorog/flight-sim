// Test rig for module 4 (copilot, starts, sim hooks): the real SimPhysics in node with an InstructorPilot
// installed, and an EvalContext rebuilt once per 60 Hz "frame" from the flight-model state, as the runner
// does in the browser (the copilot runs per physics step and evaluates once per context tick).
//
// The telemetry frame here is a small truth-only stand-in for module 1's providers (indicated = truth, the
// headless convention of TelemetrySources.readings = null). Until module 1's compile/resolveRef/AREAS land,
// the test files swap in the fallbacks of copilotFallbacks.ts through vi.mock; once the real ones exist the
// tests run against them unchanged.

import { DEG, FT, KT } from '../../src/core/math';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import { AIRPORT, runwayCoords } from '../../src/core/world';
import type { ScenarioId } from '../../src/core/context';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { buildStart, type StartOptions, type StartSpec } from '../../src/sim/starts';
import { C172S } from '../../src/training/aircraft/c172s';
import { InstructorPilot } from '../../src/training/copilot/instructorPilot';
import { STANDARDS } from '../../src/training/grading/standards';
import type { EvalContext, SignalDef, SignalFrame, SignalId } from '../../src/training/types';

export const FRAME_DT = 1 / 60;

/** Calm air: no wind, no turbulence (deterministic handover and accuracy checks). */
export function calmWeather(): WeatherSettings {
  return { ...defaultWeather(), windSpeedKt: 0, gustKt: 0, turbulence: 0 };
}

// ---- signals ----------------------------------------------------------------------------------------------

const ANGLES = new Set(['hdgDeg', 'hdgTrueDeg', 'trackDeg']);
const HYST: Record<string, number> = {
  asiKt: 1, kias: 1, altFt: 20, altMslFt: 20, hdgDeg: 2, bankDeg: 2, aiBankDeg: 2, vsFpm: 50, vsiFpm: 50, pitchDeg: 1, aiPitchDeg: 1,
  rwyAcrossM: 1, aglFt: 10, hafFt: 10, gLoad: 0.05, ball: 0.05,
};

export function signalDef(id: string): SignalDef | undefined {
  if (!(id in SAMPLE_IDS)) return undefined;
  return { id: id as SignalId, kind: ANGLES.has(id) ? 'angle' : 'number', unit: '', hyst: HYST[id] ?? 0, describe: id };
}
const SAMPLE_IDS: Record<string, true> = Object.fromEntries(
  ['kias', 'asiKt', 'altFt', 'altMslFt', 'aglFt', 'hafFt', 'vsFpm', 'vsiFpm', 'hdgDeg', 'hdgTrueDeg', 'trackDeg', 'bankDeg', 'aiBankDeg', 'pitchDeg',
    'aiPitchDeg', 'pitchRateDps', 'rollRateDps', 'gLoad', 'stallWarn', 'stallFrac', 'onGround', 'gsKt', 'rwyAlongM', 'rwyAcrossM', 'flapsDeg',
    'flapLever', 'throttle', 'mixture', 'rpm', 'untrimmedS', 'crashed', 'elevator'].map((k) => [k, true]),
);

const deg360 = (rad: number): number => ((rad / DEG) % 360 + 360) % 360;

/** Fill `f` from the physics state (truth = indicated in this rig). `untrimmed` carries the untrimmedS timer. */
export function sampleFrame(p: SimPhysics, f: SignalFrame, dt: number, untrimmed: { s: number; broken: number }): void {
  const s = p.state;
  const c = p.controls;
  const rc = runwayCoords(s.position.x, s.position.y);
  f.kias = f.asiKt = s.ias / KT;
  f.altFt = f.altMslFt = s.altitudeMSL / FT;
  f.aglFt = s.altitudeAGL / FT;
  f.hafFt = (s.altitudeMSL - AIRPORT.elevation) / FT;
  f.vsFpm = f.vsiFpm = (s.verticalSpeed / FT) * 60;
  f.hdgDeg = f.hdgTrueDeg = deg360(s.heading);
  f.trackDeg = deg360(s.track);
  f.bankDeg = f.aiBankDeg = s.roll / DEG;
  f.pitchDeg = f.aiPitchDeg = s.pitch / DEG;
  f.pitchRateDps = s.angularVelocity.y / DEG;
  f.rollRateDps = s.angularVelocity.x / DEG;
  f.gLoad = s.gLoad;
  f.stallWarn = s.stallWarning;
  f.stallFrac = s.stallFraction;
  f.onGround = s.onGround;
  f.crashed = s.crashed;
  f.gsKt = s.groundSpeed / KT;
  f.rwyAlongM = rc.along + AIRPORT.runway.length / 2;
  f.rwyAcrossM = rc.across;
  f.flapsDeg = s.surfaces.flaps / DEG;
  f.flapLever = c.flaps;
  f.throttle = c.throttle;
  f.mixture = c.mixture;
  f.elevator = c.elevator;
  f.rpm = s.engine.rpm;
  // untrimmedS (section 2.3): |elevator| > 0.08 while |vs| < 300 and |bank| < 10; reset after 1 s broken.
  const cond = Math.abs(c.elevator) > 0.08 && Math.abs(f.vsFpm) < 300 && Math.abs(f.bankDeg) < 10;
  if (cond) {
    untrimmed.s += dt;
    untrimmed.broken = 0;
  } else if ((untrimmed.broken += dt) >= 1) untrimmed.s = 0;
  f.untrimmedS = untrimmed.s;
}

// ---- the rig ----------------------------------------------------------------------------------------------

export interface Envelope {
  maxAbsBank: number; minPitch: number; maxPitch: number; maxKias: number; minKias: number; maxG: number; minG: number;
  minAglFt: number; maxStallFrac: number; crashed: boolean; minAltFt: number; maxAltFt: number;
}

export function freshEnvelope(): Envelope {
  return { maxAbsBank: 0, minPitch: 90, maxPitch: -90, maxKias: 0, minKias: 999, maxG: -9, minG: 9, minAglFt: 1e9, maxStallFrac: 0, crashed: false, minAltFt: 1e9, maxAltFt: -1e9 };
}

export class Rig {
  readonly p: SimPhysics;
  readonly pilot: InstructorPilot;
  readonly frame: SignalFrame = {};
  vars: Record<string, number> = {};
  env: Envelope = freshEnvelope();
  /** Cues the copilot asked to speak, in order. */
  readonly said: string[] = [];
  private simT = 0;
  private dt = 0;
  private stepT = 0;
  private readonly untrimmed = { s: 0, broken: 0 };
  readonly ctx: EvalContext;

  constructor(start: StartSpec | ScenarioId, opts: { weather?: WeatherSettings; startOptions?: StartOptions } = {}) {
    const weather = opts.weather ?? calmWeather();
    this.p = new SimPhysics({ weather });
    this.p.autoflightOnReset = false;
    if (typeof start === 'string') this.p.reset(start, weather);
    else if (start.kind === 'scenario') this.p.reset(start.id, weather);
    else this.p.resetTo(buildStart(start, this.p.env, opts.startOptions ?? {}), weather);
    // The context object is shared and refreshed in place, as the runner's is.
    const rig = this;
    this.ctx = {
      get frame() { return rig.frame; },
      signalDef: (id) => signalDef(id as string),
      get vars() { return rig.vars; },
      aircraft: C172S,
      fieldElevFt: AIRPORT.elevation / FT,
      standards: STANDARDS,
      authority: 'easa',
      standard: 'training',
      events: { mark: () => 0, since: () => [] },
      stepMark: 0,
      get stepT() { return rig.stepT; },
      get dt() { return rig.dt; },
      get simT() { return rig.simT; },
      pilot: 'instructor',
      speechIdle: true,
      exerciseGrade: () => null,
    };
    this.pilot = new InstructorPilot(C172S, { evalCtx: () => this.ctx });
    this.pilot.onSay = (cue) => this.said.push(typeof cue === 'string' ? cue : 'id' in cue ? cue.id : String(cue.text));
    this.p.copilot = this.pilot;
    this.refresh(0);
  }

  get s() {
    return this.p.state;
  }

  /** Rebuild the frame, as the runner does after each rendered frame. */
  refresh(dt: number): void {
    this.dt = dt;
    this.simT += dt;
    this.stepT += dt;
    sampleFrame(this.p, this.frame, dt, this.untrimmed);
  }

  /** Fly `seconds` in 60 Hz frames; `each` runs after every frame (return true to stop early). Returns time flown. */
  fly(seconds: number, each?: (t: number) => boolean | void): number {
    const n = Math.round(seconds / FRAME_DT);
    for (let i = 0; i < n; i++) {
      this.p.step(FRAME_DT);
      this.refresh(FRAME_DT);
      this.track();
      if (each?.((i + 1) * FRAME_DT)) return (i + 1) * FRAME_DT;
    }
    return n * FRAME_DT;
  }

  /** Fly until `done()` or `maxS`; returns the time taken (Infinity on timeout). */
  flyUntil(done: () => boolean, maxS: number, each?: (t: number) => void): number {
    let took = Infinity;
    this.fly(maxS, (t) => {
      each?.(t);
      if (done()) {
        took = t;
        return true;
      }
      return false;
    });
    return took;
  }

  /** Run a demo script to its end (demoResult set) or `maxS`. */
  runDemo(script: Parameters<InstructorPilot['run']>[0], maxS: number): { result: string | null; seconds: number } {
    this.pilot.run(script, () => this.ctx);
    const seconds = this.flyUntil(() => this.pilot.demoResult !== null, maxS);
    return { result: this.pilot.demoResult, seconds };
  }

  private track(): void {
    const f = this.frame;
    const e = this.env;
    const n = (k: string) => f[k] as number;
    e.maxAbsBank = Math.max(e.maxAbsBank, Math.abs(n('bankDeg')));
    e.minPitch = Math.min(e.minPitch, n('pitchDeg'));
    e.maxPitch = Math.max(e.maxPitch, n('pitchDeg'));
    e.maxKias = Math.max(e.maxKias, n('kias'));
    if (!f.onGround) e.minKias = Math.min(e.minKias, n('kias'));
    e.maxG = Math.max(e.maxG, n('gLoad'));
    e.minG = Math.min(e.minG, n('gLoad'));
    if (!f.onGround) e.minAglFt = Math.min(e.minAglFt, n('aglFt'));
    // The wing's stalled fraction is meaningless at taxi speeds (it reads high at rest).
    if (!f.onGround && n('kias') > 30) e.maxStallFrac = Math.max(e.maxStallFrac, n('stallFrac'));
    e.crashed ||= !!f.crashed;
    e.minAltFt = Math.min(e.minAltFt, n('altFt'));
    e.maxAltFt = Math.max(e.maxAltFt, n('altFt'));
  }
}
