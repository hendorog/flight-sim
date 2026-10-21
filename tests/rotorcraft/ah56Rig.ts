// AH-56A test rigs (AG, stage 2): the aircraft at a weight and configuration (AMCS default, ICS selectable), held ISA
// atmospheres, a test pilot that only moves the controls, the stick-step measurements the AMCS-73 / ASTA-72 responses
// are defined by (maximum rate and maximum acceleration per inch; ASTA-72's pitch time constant = time to 63 % of the
// maximum rate), and an optional trace (AH56_TRACE=<directory> writes each file's report there as JSON).
//
// AIR DATA. The gyro's speed-scheduled augmentation reads the hub air velocity, which Rotorcraft.compute does not yet
// pass to ControlGyro.advanceCoupled (contract request to RC/the integrator: the one-line call in rotorcraft.ts,
// work/rigid/ag-integrator-requests.patch). Until then the rig hands the same data to the gyro before the trim (so the
// trim includes the augmentation, as it will with the wiring) and once per step from the flight state; `airData: false`
// flies the production wiring of today (augmentation dormant). The stand-in retires itself: PRODUCTION_AIR_WIRED detects
// the wiring (one compute, does advanceCoupled receive `air`?) and then the rig flies the production path by default.
// AH56_AIRDATA=off forces the production path (the rig-vs-sim comparison, docs/control-gyro-model.md section 5).
import { AH56_DEFINITION as def } from '../../src/aircraft/ah56';
import { createFlightModelFor } from '../../src/physics';
import type { BladeElementFlightModel } from '../../src/physics/flightModel';
import type { ControlGyro, GyroConfigId } from '../../src/physics/rotorcraft/controlGyro';
import type { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { atmosphereAt } from '../../src/physics/atmosphere';
import { cloneControls, type ControlInputs } from '../../src/core/types';
import { DEG, FT, KT, LB, clamp, quat } from '../../src/core/math';
import { flatEnvironment } from '../fdm/helpers';
import { ah56Loading } from '../../src/aircraft/ah56/mass';

export const DT = 1 / 240;
export const IN = 0.0254;
export const d = def.rotorcraft!;
export const gyroDef = d.controlGyro!;
export { def };

/** Whether Rotorcraft.compute passes the hub air data to the gyro (RC's wiring; the stand-in below is then off). */
export const PRODUCTION_AIR_WIRED: boolean = (() => {
  const fm = createFlightModelFor(def) as BladeElementFlightModel, rotor = (fm as unknown as { rotorcraft: Rotorcraft }).rotorcraft;
  const g = rotor.gyro!, orig = g.advanceCoupled.bind(g);
  let wired = false;
  (g as unknown as { advanceCoupled: typeof orig }).advanceCoupled = (...a: Parameters<typeof orig>) => { if (a[6]) wired = true; return orig(...a); };
  fm.reset({ position: { x: 0, y: 0, z: -500 }, heading: 0, airspeed: 50 * KT, flightPathAngle: 0, onGround: false, engineRunning: true,
    fuelFraction: 1 }, environment());
  fm.step(DT, cloneControls(fm.trimControls), environment());
  return wired;
})();
const STAND_IN = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.AH56_AIRDATA !== 'off' && !PRODUCTION_AIR_WIRED;

/** A flat world whose atmosphere is held at `ft` pressure altitude and ISA + `isaDev` K, whatever the height flown. */
export function environment(ft = 0, isaDev = 0) {
  const a = atmosphereAt(ft * FT);
  a.temperature += isaDev; a.density = a.pressure / (287.05287 * a.temperature);
  a.speedOfSound = Math.sqrt(1.4 * 287.05287 * a.temperature);
  return { ...flatEnvironment(undefined, 0), atmosphere: () => a };
}
export type Env = ReturnType<typeof environment>;

export interface RigOptions {
  cfg?: GyroConfigId; kt?: number; height?: number; running?: boolean; onGround?: boolean; ft?: number; isaDev?: number;
  pathDeg?: number; fuelFraction?: number; lb?: number; airData?: boolean; gearDown?: boolean;
}
/** The AH-56A at `lb` total (18,300 lb test loading by default) in the `cfg` configuration. */
export function rig(o: RigOptions = {}) {
  const fm = createFlightModelFor(def) as BladeElementFlightModel, env = environment(o.ft ?? 0, o.isaDev ?? 0);
  fm.setLoading(ah56Loading(o.lb ?? 18_300, undefined, o.fuelFraction ?? 1));
  // The air data the trim's settle sees (the stand-in for RC's wiring, which passes it on every compute).
  const rotor = (fm as unknown as { rotorcraft: Rotorcraft }).rotorcraft;
  if (o.airData ?? STAND_IN) rotor.gyro!.setAirData({ hub: { x: (o.kt ?? 0) * KT, y: 0, z: 0 }, density: env.atmosphere().density });
  fm.reset({ position: { x: 0, y: 0, z: -(o.onGround ? 0 : o.height ?? 1500 * FT) }, heading: 0, airspeed: (o.kt ?? 0) * KT,
    flightPathAngle: (o.pathDeg ?? 0) * DEG, onGround: o.onGround ?? false, engineRunning: o.running ?? true,
    fuelFraction: o.fuelFraction ?? 1, rotorcraftConfig: o.cfg, ...(o.gearDown !== undefined ? { gearDown: o.gearDown } : {}) }, env);
  return { fm, c: cloneControls(fm.trimControls), env, cfg: o.cfg ?? gyroDef.default, airData: o.airData ?? STAND_IN };
}
export type Ah56Rig = ReturnType<typeof rig>;

/** The flight model's rotor and gyro (read-only use in tests). */
export function rotorOf(r: Ah56Rig): Rotorcraft { return (r.fm as unknown as { rotorcraft: Rotorcraft }).rotorcraft; }
export function gyroOf(r: Ah56Rig): ControlGyro { return rotorOf(r).gyro!; }

/** The hub air velocity from the flight state (still air), for the stand-in of RC's air-data call. */
function feedAir(r: Ah56Rig): void {
  if (!r.airData) return;
  const s = r.fm.state, hub = quat.rotateInv(s.orientation, s.velocity);
  gyroOf(r).setAirData({ hub, density: r.env.atmosphere().density });
}

export function run(r: Ah56Rig, seconds: number, each?: (t: number) => void): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) { each?.(i * DT); feedAir(r); r.fm.step(DT, r.c, r.env); }
}

/** The gauges a pilot reads (and the tests assert on). */
export function gauges(r: Ah56Rig) {
  const s = r.fm.state, rc = s.rotorcraft!, t = rc.turboshaft!;
  return { kias: s.ias / KT, fpm: s.verticalSpeed / FT * 60, pitch: s.pitch / DEG, roll: s.roll / DEG, ng: s.engine.ng ?? 0,
    tit: s.engine.itt ?? 0, nf: t.n2Pct, nr: t.nrPct, nrRpm: rc.rotorRpm, torque: t.torquePsi, set: t.n2SetPct,
    split: t.needlesSplit, ffLbh: (s.engine.fuelFlow ?? 0) * 3600 / LB, collective: r.c.collective ?? 0,
    elevator: r.c.elevator, aileron: r.c.aileron, rudder: r.c.rudder, p: s.angularVelocity.x / DEG, q: s.angularVelocity.y / DEG,
    r: s.angularVelocity.z / DEG, gyroPitch: rc.controlGyro!.pitch / DEG, gyroRoll: rc.controlGyro!.roll / DEG };
}

/** Stick fraction for `inches` of travel in an axis of the active configuration. */
export function stick(r: Ah56Rig, axis: 'lon' | 'lat', inches: number): number {
  const t = gyroDef.configs[r.cfg].stickTravel;
  return inches * IN / (axis === 'lon' ? t.longitudinal : t.lateral);
}

export interface StepResponse {
  t: number[]; on: number[]; off: number[];
  /** Maximum rate of the commanded axis, deg/s, its time, s, and the off-axis rate then: the first peak of the response,
   *  the first sample no later sample exceeds for PEAK_HOLD s (the rate the stick commands, before the attitude change
   *  carries the aircraft into another condition). `peaked` false: the rate was still rising when the window closed
   *  (max is then the last value and tMax the window), and the row cannot be read as a maximum. */
  max: number; tMax: number; offAtMax: number; peaked: boolean; window: number;
  /** Maximum angular acceleration of the commanded axis, deg/s^2 (over 25 ms). */
  maxAcc: number;
  /** Rates at 1 s, deg/s. */
  at1: number; offAt1: number;
  /** Time to 63 % of the maximum rate, s (ASTA-72's time constant), interpolated between the 1/240 s samples. */
  tau63: number;
}
/**
 * A stick step of `inches` (aft +, right +) held for `seconds` from trim; rates of the commanded and the other axis. AMCS-73
 * para 33: "control response (maximum angular velocity per inch of control displacement) and sensitivity (maximum
 * angular acceleration per inch)".
 */
export function stepResponse(r: Ah56Rig, axis: 'lon' | 'lat', inches: number, seconds = 3): StepResponse {
  const s0 = stick(r, axis, inches);
  if (axis === 'lon') r.c.elevator += s0; else r.c.aileron += s0;
  const t: number[] = [], on: number[] = [], off: number[] = [];
  let prev = 0, maxAcc = 0;
  run(r, seconds, (time) => {
    const w = r.fm.state.angularVelocity;
    const a = (axis === 'lon' ? w.y : w.x) / DEG, b = (axis === 'lon' ? w.x : w.y) / DEG;
    t.push(time); on.push(a); off.push(b);
    const i = on.length - 1;
    if (i % 6 === 0 && i > 0) { const acc = (a - prev) / (6 * DT); if (Math.abs(acc) > Math.abs(maxAcc)) maxAcc = acc; prev = a; }
  });
  const k = firstPeak(on), peaked = k >= 0, kk = peaked ? k : on.length - 1;
  const i1 = Math.min(on.length - 1, Math.round(1 / DT));
  const level = 0.632 * Math.abs(on[kk]), j = on.findIndex((v) => Math.abs(v) >= level);
  const tau = j > 0 ? t[j - 1] + (level - Math.abs(on[j - 1])) / (Math.abs(on[j]) - Math.abs(on[j - 1])) * (t[j] - t[j - 1]) : t[Math.max(j, 0)];
  return { t, on, off, max: on[kk], tMax: peaked ? t[kk] : seconds, offAtMax: off[kk], peaked, window: seconds, maxAcc, at1: on[i1],
    offAt1: off[i1], tau63: tau };
}

/** How long the first peak of a step response must stay unexceeded, s. */
export const PEAK_HOLD = 0.5;
/** Index of the first sample of |x| that no sample in the following PEAK_HOLD s exceeds; -1 if there is none whose hold
 *  fits inside the record (still rising when the window closed). */
export function firstPeak(x: readonly number[]): number {
  const hold = Math.round(PEAK_HOLD / DT);
  for (let k = 1; k + hold < x.length; k++) {
    const v = Math.abs(x[k]);
    if (v <= Math.abs(x[k - 1])) continue;
    let ok = true;
    for (let i = k + 1; i <= k + hold; i++) if (Math.abs(x[i]) > v) { ok = false; break; }
    if (ok) return k;
  }
  return -1;
}

/** Margins of a value to the edges of a band [lo, hi], in % of the edge (negative: outside), for the reports. */
export function margins(x: number, lo: number, hi: number): string {
  return `${((x / lo - 1) * 100).toFixed(1)} % above ${lo}, ${((1 - x / hi) * 100).toFixed(1)} % below ${hi}`;
}

/**
 * Test pilot: holds attitude (or a pitch), the heading and, optionally, the speed with ordinary cyclic and pedals; the
 * collective is left to the caller. On the gyro the stick commands moments (a rate command on the AMCS), so the loops
 * are attitude-to-stick with rate damping, as on the other types. No writes to rotor or rigid-body state.
 */
export function pilot(r: Ah56Rig, kias?: number) {
  const s0 = r.fm.state, pitchTrim = s0.pitch, rollTrim = s0.roll, heading0 = s0.heading;
  const e0 = r.c.elevator, a0 = r.c.aileron, r0 = r.c.rudder;
  let pitchI = 0, rollI = 0, yawI = 0, speedI = 0;
  return (dt: number, commandedPitch?: number, commandedRoll?: number): void => {
    const s = r.fm.state, heading = Math.atan2(Math.sin(s.heading - heading0), Math.cos(s.heading - heading0));
    if (kias !== undefined) speedI += 0.002 * (s.ias - kias * KT) * dt;
    const target = commandedPitch ?? (kias !== undefined ? clamp(pitchTrim + 0.05 * (s.ias - kias * KT) + speedI, -15 * DEG, 15 * DEG) : pitchTrim);
    const bank = commandedRoll ?? rollTrim;
    pitchI += (target - s.pitch) * 0.3 * dt; rollI += (bank - s.roll) * 0.3 * dt; yawI -= heading * 0.2 * dt;
    r.c.elevator = clamp(e0 + 1.5 * (target - s.pitch) - 0.6 * s.angularVelocity.y + pitchI, -1, 1);
    r.c.aileron = clamp(a0 + 1.5 * (bank - s.roll) - 0.3 * s.angularVelocity.x + rollI, -1, 1);
    r.c.rudder = clamp(r0 - 2 * heading - 0.7 * s.angularVelocity.z + yawI, -1, 1);
  };
}

/** Collective servo on a measured value, rate-limited like a hand. */
export function collectiveServo(c: ControlInputs, error: number, gain: number, dt: number, rate = 0.3): void {
  c.collective = clamp((c.collective ?? 0) + clamp(gain * error, -rate, rate) * dt, 0, 1);
}

interface TraceFs { mkdirSync(path: string, options: { recursive: boolean }): void; writeFileSync(path: string, data: string): void }
const traceDir = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.AH56_TRACE;
const fs = traceDir ? await import(/* @vite-ignore */ 'node:fs' as string) as TraceFs : undefined;
/** Write a report (AH56_TRACE only). */
export function writeTrace(name: string, report: unknown): void {
  if (!fs || !traceDir) return;
  fs.mkdirSync(traceDir, { recursive: true });
  fs.writeFileSync(`${traceDir}/${name}.json`, JSON.stringify(report, null, 2));
}
/** Log a measured row next to its target (the reports the owner reads). */
export function report(label: string, values: Record<string, number | string | boolean>): void {
  console.log(`[ah56] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);
}
