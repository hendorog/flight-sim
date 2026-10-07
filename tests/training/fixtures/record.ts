// Recorded telemetry fixtures (spec section 6.4.2): real flights of the flight model in node - the existing
// autoflight, the physics autopilot and the scripted keyboard pilot (tests/input/keyboardPilot.ts) - sampled
// through the real Telemetry at 30 Hz and stored as JSON, so the event, grading and coach tests replay
// flown data instead of synthetic series.
//
// What a fixture holds: the signal frames the training engine consumes (TelemetrySources are an
// AircraftState-sized object per frame; the frames Telemetry derives from them are what every consumer
// reads), and the step-exact touchdowns the SimEvents handler delivers (TouchdownData), with the crashes.
// The step.* signals are left out: they depend on the runner's step marks, which a replay sets itself.
//
// scripts/record-telemetry.mjs loads this module through Vite and writes tests/training/fixtures/*.json;
// the flights are deterministic (calm air or seeded turbulence), so recording again reproduces the files.

import { createEventBus } from '../../../src/core/context';
import { DEG, FPM, FT, KT } from '../../../src/core/math';
import { defaultWeather, type WeatherSettings } from '../../../src/core/types';
import { AIRPORT } from '../../../src/core/world';
import { SimPhysics } from '../../../src/sim/SimPhysics';
import { buildStart, type StartSpec } from '../../../src/sim/starts';
import { C172S } from '../../../src/training/aircraft/c172s';
import { touchdownData } from '../../../src/training/engine/events';
import { Telemetry } from '../../../src/training/telemetry/telemetry';
import type { SignalValue, TelemetrySources, TouchdownData } from '../../../src/training/types';
import { createCircuitPilot, frame as keyboardFrame, makeRig, FRAME as KEYBOARD_FRAME } from '../../input/keyboardPilot';

/** Recording rate, Hz. */
export const FIXTURE_HZ = 30;

/** The signals stored per frame (events, landing, grading and coach inputs). */
export const FIXTURE_SIGNALS = [
  'asiKt', 'kias', 'altFt', 'altMslFt', 'aglFt', 'hafFt', 'vsiFpm', 'vsFpm', 'hdgDeg', 'hdgTrueDeg', 'trackDeg', 'aiBankDeg',
  'bankDeg', 'aiPitchDeg', 'pitchDeg', 'pitchRateDps', 'turnRate', 'ball', 'gLoad', 'stallWarn', 'stallFrac', 'onGround',
  'mainsOnGround', 'noseOnGround', 'crashed', 'gsKt', 'rpm', 'throttle', 'flapsDeg', 'elevator', 'untrimmedS', 'engineRunning',
  'rwyAlongM', 'rwyAcrossM', 'distAimFt', 'gpDevFt', 'onRunway', 'circuitLeg', 'driftDeg', 'crosswindKt',
] as const;

export interface TelemetryFixture {
  name: string;
  description: string;
  hz: number;
  signals: string[];
  /** Run sim time of each frame, s. */
  t: number[];
  /** One array per signal, aligned with `t`. */
  columns: Record<string, SignalValue[]>;
  /** Every wheel contact, step-exact (the SimEvents touchdown, as TrainingSystem forwards it). */
  touchdowns: { t: number; wheel: 'nose' | 'left' | 'right'; sinkFpm: number; td: TouchdownData }[];
  crashes: { t: number; reason: string }[];
}

/**
 * Decimals stored per signal (default 2): far finer than anything is graded, and it keeps the files small.
 * Heights, rpm and runway distances to the foot, metre or rpm; positions near the ground keep a decimal.
 */
const DECIMALS: Partial<Record<string, number>> = {
  altFt: 0, altMslFt: 0, hafFt: 1, aglFt: 1, vsiFpm: 0, vsFpm: 0, rpm: 0, rwyAlongM: 0, distAimFt: 0, gpDevFt: 0,
  hdgDeg: 1, hdgTrueDeg: 1, trackDeg: 1, untrimmedS: 1, gsKt: 1, kias: 1, asiKt: 1,
};
const round = (x: number, d: number): number => {
  const k = 10 ** d;
  return Math.round(x * k) / k;
};
const q = (sig: string, v: SignalValue): SignalValue => (typeof v === 'number' ? (Number.isFinite(v) ? round(v, DECIMALS[sig] ?? 2) : 0) : v);

/** A recording session: real physics, the real Telemetry, frames every 1/30 s of sim time. */
class Recorder {
  readonly events = createEventBus();
  readonly physics: SimPhysics;
  readonly telemetry = new Telemetry();
  readonly fx: TelemetryFixture;
  private simT = 0;
  private sinceFrame = 0;

  constructor(name: string, description: string, start: StartSpec | 'runway', readonly weather: WeatherSettings = calm()) {
    this.physics = new SimPhysics({ weather, events: this.events });
    if (start === 'runway') this.physics.reset('runway', weather);
    else this.physics.resetTo(buildStart(start, this.physics.env, { payload: 'forward' }), weather);
    this.fx = { name, description, hz: FIXTURE_HZ, signals: [...FIXTURE_SIGNALS], t: [], columns: Object.fromEntries(FIXTURE_SIGNALS.map((s) => [s, []])), touchdowns: [], crashes: [] };
    this.events.on('touchdown', (e) => {
      const sinkFpm = e.sinkRate / FPM;
      this.fx.touchdowns.push({ t: round3(this.simT), wheel: e.wheel, sinkFpm: round3(sinkFpm), td: roundTd(touchdownData(this.physics.fm.state, e.wheel, sinkFpm)) });
    });
    this.events.on('crash', (e) => this.fx.crashes.push({ t: round3(this.simT), reason: e.reason }));
    this.record(0);
  }

  get s() {
    return this.physics.state;
  }

  /** Advance `dt` of sim time in physics steps (the caller has set the controls), recording at 30 Hz. */
  advance(dt: number): void {
    this.physics.step(dt);
    this.simT += dt;
    this.sinceFrame += dt;
    if (this.sinceFrame >= 1 / FIXTURE_HZ - 1e-9) {
      this.record(this.sinceFrame);
      this.sinceFrame = 0;
    }
  }

  /** Fly with the autopilot / autoflight until `done` (or `maxS`). `each` runs before every 1/60 s chunk. */
  fly(maxS: number, done: () => boolean, each?: () => void): void {
    for (let t = 0; t < maxS && !done() && !this.s.crashed; t += 1 / 60) {
      each?.();
      this.advance(1 / 60);
    }
  }

  private record(dt: number): void {
    const p = this.physics;
    const src: TelemetrySources = {
      state: p.state, controls: p.controls, readings: null, weather: this.weather, env: p.env, aircraft: C172S,
      studentInput: false, timeScale: 1, route: null,
    };
    const f = this.telemetry.sample(src, dt);
    this.fx.t.push(round3(this.simT));
    for (const sig of FIXTURE_SIGNALS) this.fx.columns[sig].push(q(sig, f[sig] ?? NaN));
  }
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

function roundTd(td: TouchdownData): TouchdownData {
  const out = { ...td } as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) if (typeof v === 'number') out[k] = round3(v);
  return out as unknown as TouchdownData;
}

function calm(): WeatherSettings {
  return { ...defaultWeather(), windSpeedKt: 0, gustKt: 0, turbulence: 0, timeOfDay: 10 };
}

/** Approaches start 1 NM out (the fixtures only need the last minute of an approach). */
const FINAL_1NM: StartSpec = { kind: 'final', distNm: 1, kias: 70, flapsDeg: 30 };

/** A full left-hand circuit and landing by the scripted keyboard pilot, from the 07 line-up to a full stop. */
export function recordCircuit(): TelemetryFixture {
  const rig = makeRig({ windSpeedKt: 0, gustKt: 0, turbulence: 0, timeOfDay: 10 });
  const name = 'circuit';
  const fx: TelemetryFixture = { name, description: 'Keyboard-pilot circuit on 07 to a full-stop landing (calm)', hz: FIXTURE_HZ, signals: [...FIXTURE_SIGNALS], t: [], columns: Object.fromEntries(FIXTURE_SIGNALS.map((s) => [s, []])), touchdowns: [], crashes: [] };
  const telemetry = new Telemetry();
  let simT = 0;
  let since = 0;
  rig.ctx.events.on('touchdown', (e) => {
    const sinkFpm = e.sinkRate / FPM;
    fx.touchdowns.push({ t: round3(simT), wheel: e.wheel, sinkFpm: round3(sinkFpm), td: roundTd(touchdownData(rig.physics.fm.state, e.wheel, sinkFpm)) });
  });
  rig.ctx.events.on('crash', (e) => fx.crashes.push({ t: round3(simT), reason: e.reason }));
  const pilot = createCircuitPilot(rig.input, rig.physics.renderState, rig.physics.controls, rig.ctx.events);
  const sample = (dt: number): void => {
    const p = rig.physics;
    const f = telemetry.sample({ state: p.state, controls: p.controls, readings: null, weather: rig.weather, env: p.env, aircraft: C172S, studentInput: true, timeScale: 1, route: null }, dt);
    fx.t.push(round3(simT));
    for (const sig of FIXTURE_SIGNALS) fx.columns[sig].push(q(sig, f[sig] ?? NaN));
  };
  sample(0);
  for (let t = 0; t < 900; t += KEYBOARD_FRAME) {
    pilot.tick(t);
    keyboardFrame(rig);
    simT += KEYBOARD_FRAME;
    since += KEYBOARD_FRAME;
    if (since >= 1 / FIXTURE_HZ - 1e-9) {
      sample(since);
      since = 0;
    }
    if (pilot.observe()) break;
  }
  // A few seconds stopped, so the roll-out completes (the landing summary needs the full stop).
  for (let i = 0; i < 4 * FIXTURE_HZ; i++) {
    keyboardFrame(rig);
    simT += KEYBOARD_FRAME;
    keyboardFrame(rig);
    simT += KEYBOARD_FRAME;
    sample(1 / FIXTURE_HZ);
  }
  return fx;
}

/**
 * A hard landing: the autoflight's approach to 10 m, then no round-out - a fixed 4° nose-up attitude with the
 * throttle closed - so the mains arrive at about 465 fpm and bounce once. (The spec asks for 700 fpm; this
 * flight model collapses the nose gear when the mains arrive above about 470 fpm, the nose slamming down
 * after them, so 465 fpm is about as hard as a landing gets without a crash - beyond the 400 fpm test limit.)
 */
export function recordHardLanding(): TelemetryFixture {
  const r = new Recorder('hardLanding', 'Approach from 1 NM, no round-out: mains first at about 465 fpm, one bounce (calm)', FINAL_1NM);
  const af = r.physics.autoflight;
  const c = r.physics.controls;
  af.engage({ kind: 'approach', kias: 70 }, r.s, c);
  r.fly(200, () => r.s.altitudeAGL < 10);
  af.disengage();
  r.fly(30, () => r.s.onGround && r.s.groundSpeed < 20 * KT, () => {
    c.throttle = 0;
    c.elevator = r.s.onGround ? 1 : Math.max(-1, Math.min(1, 3 * (4 * DEG - r.s.pitch) - 0.8 * r.s.angularVelocity.y));
    c.aileron = -2 * r.s.roll;
  });
  r.fly(8, () => false, () => {
    c.elevator = 0;
    c.brakeLeft = c.brakeRight = 0.6;
  });
  return r.fx;
}

/** A nose-first arrival: the approach to 4 m, then the approach attitude held with the throttle closed. */
export function recordNoseFirst(): TelemetryFixture {
  const r = new Recorder('noseFirst', 'Approach from 1 NM, no flare at all: nosewheel first (calm)', FINAL_1NM);
  const af = r.physics.autoflight;
  const c = r.physics.controls;
  af.engage({ kind: 'approach', kias: 70 }, r.s, c);
  r.fly(200, () => r.s.altitudeAGL < 4);
  af.disengage();
  const pitch0 = r.s.pitch;
  r.fly(30, () => r.s.onGround && r.s.groundSpeed < 20 * KT, () => {
    c.throttle = 0;
    c.elevator = r.s.onGround ? 0.2 : Math.max(-1, Math.min(1, 3 * (pitch0 - r.s.pitch) - 0.8 * r.s.angularVelocity.y));
    c.aileron = -2 * r.s.roll;
  });
  r.fly(8, () => false, () => {
    c.brakeLeft = c.brakeRight = 0.6;
  });
  return r.fx;
}

/** A go-around from 200 ft on the approach: full power, climb attitude, flap in stages, Vy to 600 ft. */
export function recordGoAround(): TelemetryFixture {
  const r = new Recorder('goAround', 'Approach from 1 NM, go-around at 200 ft above the field (calm)', FINAL_1NM);
  const af = r.physics.autoflight;
  const c = r.physics.controls;
  af.engage({ kind: 'approach', kias: 70 }, r.s, c);
  r.fly(200, () => (r.s.altitudeMSL - AIRPORT.elevation) / FT < 200);
  af.engage({ kind: 'hold', heading: r.s.heading, altitude: AIRPORT.elevation + 1000 * FT, kias: 74, autothrottle: false }, r.s, c);
  const ap = af.autopilot.settings;
  ap.vertical = 'pitch';
  ap.pitch = 6 * DEG;
  let t = 0;
  r.fly(90, () => (r.s.altitudeMSL - AIRPORT.elevation) / FT > 600, () => {
    t += 1 / 60;
    c.throttle = Math.min(1, c.throttle + 0.5 / 60);
    if (t > 3) {
      ap.vertical = 'airspeed';
      ap.airspeed = 74 * KT;
    }
    if (t > 2 && c.flaps > 0.7) c.flaps = 2 / 3;
    if (t > 8 && r.s.ias > 65 * KT) c.flaps = 1 / 3;
    if (t > 14 && r.s.ias > 70 * KT) c.flaps = 0;
  });
  return r.fx;
}

/** A power-off stall at the forward CG: altitude held with the throttle closed to the break, then recovered. */
export function recordStall(): TelemetryFixture {
  const r = new Recorder('stall', 'Power-off clean stall from 4,500 ft, recovery at the break (calm, forward CG)', {
    kind: 'air', at: 'trainingArea', altFt: 4500, altRef: 'msl', hdgDeg: 200, kias: 90,
  });
  const af = r.physics.autoflight;
  const c = r.physics.controls;
  af.engage({ kind: 'hold', heading: r.s.heading, altitude: r.s.altitudeMSL, kias: 90, autothrottle: false }, r.s, c);
  r.fly(120, () => r.s.stallFraction >= 0.5 || (r.s.stallWarning && r.s.angularVelocity.y < -4 * DEG), () => {
    c.throttle = Math.max(0, c.throttle - 0.5 / 60);
  });
  const ap = af.autopilot.settings;
  ap.vertical = 'pitch';
  ap.pitch = -3 * DEG;
  ap.lateral = 'wingLeveler';
  r.fly(20, () => r.s.ias > 65 * KT, () => {
    c.throttle = Math.min(1, c.throttle + 1 / 60);
  });
  ap.vertical = 'airspeed';
  ap.airspeed = 74 * KT;
  r.fly(25, () => false);
  return r.fx;
}

/** A steep turn: 45 degrees through 360 to the left at 95 kt with the altitude held, then the roll-out. */
export function recordSteepTurn(): TelemetryFixture {
  const r = new Recorder('steepTurn', 'Steep turn left, 45 degrees through 360 at 95 kt, 4,000 ft (calm)', {
    kind: 'air', at: 'trainingArea', altFt: 4000, altRef: 'msl', hdgDeg: 200, kias: 95,
  });
  const af = r.physics.autoflight;
  const c = r.physics.controls;
  af.engage({ kind: 'hold', heading: r.s.heading, altitude: r.s.altitudeMSL, kias: 95, autothrottle: true }, r.s, c);
  r.fly(5, () => false);
  const ap = af.autopilot.settings;
  const hdg0 = r.s.heading;
  ap.lateral = 'bank';
  ap.bank = -45 * DEG;
  ap.maxBank = 48 * DEG;
  let turned = 0;
  let last = r.s.heading;
  r.fly(120, () => turned < -(360 - 25) * DEG, () => {
    let d = r.s.heading - last;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    turned += d;
    last = r.s.heading;
  });
  ap.lateral = 'heading';
  ap.heading = hdg0;
  r.fly(20, () => false);
  return r.fx;
}

/**
 * A 500 fpm descent at 90 kt from 3,600 ft to 3,000 ft with a late level-off: the descent held until well
 * below the target, then the altitude captured - the lowest point is about 160 ft below 3,000 ft.
 */
export function recordDescentBust(): TelemetryFixture {
  const r = new Recorder('descentBust', '500 fpm descent at 90 kt to 3,000 ft levelled off late: about 160 ft low (calm)', {
    kind: 'air', at: 'trainingArea', altFt: 3600, altRef: 'msl', hdgDeg: 200, kias: 90,
  });
  const af = r.physics.autoflight;
  const c = r.physics.controls;
  af.engage({ kind: 'hold', heading: r.s.heading, altitude: r.s.altitudeMSL, kias: 90, autothrottle: true }, r.s, c);
  r.fly(5, () => false);
  const ap = af.autopilot.settings;
  const target = 3000 * FT;
  ap.vertical = 'verticalSpeed';
  ap.verticalSpeed = -500 * FPM;
  r.fly(240, () => r.s.altitudeMSL < target - 155 * FT);
  ap.vertical = 'altitude';
  ap.altitude = target;
  ap.verticalSpeed = 400 * FPM;
  r.fly(40, () => false);
  return r.fx;
}

/** Every fixture, by file name (scripts/record-telemetry.mjs writes `<name>.json`). */
export function recordAll(): Record<string, TelemetryFixture> {
  const all = [recordCircuit(), recordHardLanding(), recordNoseFirst(), recordGoAround(), recordStall(), recordSteepTurn(), recordDescentBust()];
  return Object.fromEntries(all.map((f) => [f.name, f]));
}
