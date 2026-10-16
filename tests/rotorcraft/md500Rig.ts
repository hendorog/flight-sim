// MD 500E test rigs (T2): loadings by total weight, held ISA atmospheres, a test pilot that only moves the controls,
// and an optional trace (MD500_TRACE=<directory> writes each file's report there as JSON).
import { MD500_DEFINITION as def } from '../../src/aircraft/md500';
import { createFlightModelFor } from '../../src/physics';
import type { BladeElementFlightModel } from '../../src/physics/flightModel';
import { atmosphereAt } from '../../src/physics/atmosphere';
import { cloneControls, type ControlInputs } from '../../src/core/types';
import { DEG, FT, KT, LB, clamp } from '../../src/core/math';
import { flatEnvironment } from '../fdm/helpers';

export const DT = 1 / 240;
export const d = def.rotorcraft!;
export const ts = d.systems.turboshaft!;
export { def };

/** A flat world whose atmosphere is held at `ft` pressure altitude and ISA + `isaDev` K, whatever the height flown. */
export function environment(ft = 0, isaDev = 0) {
  const a = atmosphereAt(ft * FT);
  a.temperature += isaDev; a.density = a.pressure / (287.05287 * a.temperature);
  a.speedOfSound = Math.sqrt(1.4 * 287.05287 * a.temperature);
  return { ...flatEnvironment(undefined, 0), atmosphere: () => a };
}
export type Env = ReturnType<typeof environment>;

export interface RigOptions { kt?: number; height?: number; running?: boolean; onGround?: boolean; ft?: number; isaDev?: number;
  pathDeg?: number; fuelFraction?: number }
/** The 500E at `lb` total (the maxGross seat distribution scaled to the payload; full fuel unless fuelFraction). */
export function rig(lb: number, o: RigOptions = {}) {
  const fm = createFlightModelFor(def) as BladeElementFlightModel, env = environment(o.ft ?? 0, o.isaDev ?? 0);
  const fuel = def.powerplant.fuel.tanks.reduce((sum, t) => sum + t.capacity, 0) * (o.fuelFraction ?? 1);
  fm.setLoading({ ...def.mass.loadings.maxGross, payload: lb * LB - def.mass.empty - fuel });
  fm.reset({ position: { x: 0, y: 0, z: -(o.onGround ? 0 : o.height ?? 1500) }, heading: 0, airspeed: (o.kt ?? 0) * KT,
    flightPathAngle: (o.pathDeg ?? 0) * DEG, onGround: o.onGround ?? false, engineRunning: o.running ?? true,
    fuelFraction: o.fuelFraction ?? 1 }, env);
  return { fm, c: cloneControls(fm.trimControls), env };
}
export type Md500Rig = ReturnType<typeof rig>;

export function run(r: Md500Rig, seconds: number, each?: (t: number) => void): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) { each?.(i * DT); r.fm.step(DT, r.c, r.env); }
}

/** The gauges a pilot reads (and the tests assert on). */
export function gauges(r: Md500Rig) {
  const s = r.fm.state, rc = s.rotorcraft!, t = rc.turboshaft!;
  return { kias: s.ias / KT, fpm: s.verticalSpeed / FT * 60, pitch: s.pitch / DEG, roll: s.roll / DEG, n1: s.engine.ng ?? 0,
    tot: s.engine.itt ?? 0, n2: t.n2Pct, nr: t.nrPct, nrRpm: rc.rotorRpm, psi: t.torquePsi, set: t.n2SetPct,
    split: t.needlesSplit, ffLbh: (s.engine.fuelFlow ?? 0) * 3600 / LB, collective: r.c.collective ?? 0,
    elevator: r.c.elevator, aileron: r.c.aileron, rudder: r.c.rudder, yawRate: s.angularVelocity.z / DEG };
}

/**
 * Test pilot: holds a speed (or a pitch), wings level and the heading with ordinary cyclic and pedals; collective is
 * left to the caller. No writes to rotor or rigid-body state.
 */
export function pilot(r: Md500Rig, kias: number) {
  const s0 = r.fm.state, pitchTrim = s0.pitch, elevatorTrim = r.c.elevator, aileronTrim = r.c.aileron, rudderTrim = r.c.rudder;
  const heading0 = s0.heading;
  let pitchI = 0, rollI = 0, yawI = 0, speedI = 0;
  return (dt: number, commandedPitch?: number): void => {
    const s = r.fm.state, heading = Math.atan2(Math.sin(s.heading - heading0), Math.cos(s.heading - heading0));
    speedI += 0.002 * (s.ias - kias * KT) * dt;
    const target = commandedPitch ?? clamp(pitchTrim + 0.06 * (s.ias - kias * KT) + speedI, -17 * DEG, 17 * DEG);
    pitchI += (target - s.pitch) * 0.25 * dt;
    rollI -= s.roll * 0.25 * dt; yawI -= heading * 0.2 * dt;
    r.c.elevator = clamp(elevatorTrim + 2.5 * (target - s.pitch) - s.angularVelocity.y + pitchI, -1, 1);
    r.c.aileron = clamp(aileronTrim - 2.5 * s.roll - 0.8 * s.angularVelocity.x + rollI, -1, 1);
    r.c.rudder = clamp(rudderTrim - 2 * heading - 0.7 * s.angularVelocity.z + yawI, -1, 1);
  };
}

/** Collective servo on a measured value (torque psi, rotor rpm, ...), rate-limited like a hand. */
export function collectiveServo(c: ControlInputs, error: number, gain: number, dt: number, rate = 0.3): void {
  c.collective = clamp((c.collective ?? 0) + clamp(gain * error, -rate, rate) * dt, 0, 1);
}

interface TraceFs { mkdirSync(path: string, options: { recursive: boolean }): void; writeFileSync(path: string, data: string): void }
const traceDir = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.MD500_TRACE;
const fs = traceDir ? await import(/* @vite-ignore */ 'node:fs' as string) as TraceFs : undefined;
/** Write a report (MD500_TRACE only). */
export function writeTrace(name: string, report: unknown): void {
  if (!fs || !traceDir) return;
  fs.mkdirSync(traceDir, { recursive: true });
  fs.writeFileSync(`${traceDir}/${name}.json`, JSON.stringify(report, null, 2));
}
