// Twin turboshaft test rig (TW, plan revision 2 section 5): the Bo 105 definition with both engines coupled to the one
// rotor, flying the Bo 105 engine indication (BO105_TURBOSHAFT_INDICATION: the torque gauge in percent of 298 kW and the
// TCDS limits in that unit). The rows it serves are drivetrain behaviour (two governors, two freewheels, the warning
// unit): numbers in pilot units, independent of the Bo 105 rotor. A trace (TWIN_TRACE=<directory>) writes each file's
// report there as JSON.
import { BO105_DEFINITION } from '../../src/aircraft/bo105';
import { BO105_INSTALLED_C20B, BO105_TURBOSHAFT_INDICATION } from '../../src/aircraft/bo105/twin';
import { BO105_INERTIA } from '../../src/aircraft/bo105/facts';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { createFlightModelFor } from '../../src/physics';
import type { BladeElementFlightModel } from '../../src/physics/flightModel';
import { cloneControls, type ControlInputs, type InitialConditions } from '../../src/core/types';
import { DEG, FT, KT, clamp } from '../../src/core/math';
import { environment } from './md500Rig';

export const DT = 1 / 240;
const base = BO105_DEFINITION.rotorcraft!;

/**
 * The rig's definition: the Bo 105 with the Bo 105 engine indication on its turboshaft control, both engines the
 * installed 250-C20B (BO105_INSTALLED_C20B) and the airframe inertia of the Bo 105 at 2200 kg (P AR-280, facts.ts),
 * so yaw rates are the Bo 105's whatever airframe the definition carries.
 */
export const TWIN_DEF: AircraftDefinition = {
  ...BO105_DEFINITION,
  rotorcraft: { ...base, systems: { ...base.systems,
    turboshaft: { ...base.systems.turboshaft!, ...BO105_TURBOSHAFT_INDICATION } } },
  powerplant: { ...BO105_DEFINITION.powerplant,
    engines: BO105_DEFINITION.powerplant.engines.map((e) => ({ ...e, engine: BO105_INSTALLED_C20B })) },
  mass: { ...BO105_DEFINITION.mass, inertia: { about: 'cg', ...BO105_INERTIA } },
};
/** The same with the MD 500E's engine map (the shared ALLISON_250_C20B), for the comparison rows. */
export const TWIN_DEF_MD500_ENGINE: AircraftDefinition = { ...TWIN_DEF, powerplant: BO105_DEFINITION.powerplant };
export const d = TWIN_DEF.rotorcraft!;
export const ts = d.systems.turboshaft!;
export const twin = d.systems.twinTurboshaft!;
export { environment };

export interface TwinRigOptions {
  /** Total mass, kg (the maximum-gross seat distribution scaled to the payload, full fuel). Absent: the max-gross loading. */
  kg?: number; kt?: number; height?: number; onGround?: boolean; running?: boolean; enginesRunning?: boolean[];
  pathDeg?: number; ft?: number; isaDev?: number; def?: AircraftDefinition;
}

export function rig(o: TwinRigOptions = {}) {
  const def = o.def ?? TWIN_DEF;
  const fm = createFlightModelFor(def) as BladeElementFlightModel, env = environment(o.ft ?? 0, o.isaDev ?? 0);
  const loading = def.mass.loadings.maxGross;
  if (o.kg !== undefined) {
    const fuel = def.powerplant.fuel.tanks.reduce((sum, t) => sum + t.capacity, 0);
    fm.setLoading({ ...loading, payload: o.kg - def.mass.empty - fuel });
  } else fm.setLoading(loading);
  const ic: InitialConditions = { position: { x: 0, y: 0, z: -(o.onGround ? 0 : o.height ?? 1500) }, heading: 0,
    airspeed: (o.kt ?? 0) * KT, flightPathAngle: (o.pathDeg ?? 0) * DEG, onGround: o.onGround ?? false,
    engineRunning: o.running ?? true, fuelFraction: 1, ...(o.enginesRunning ? { enginesRunning: o.enginesRunning } : {}) };
  fm.reset(ic, env);
  return { fm, c: cloneControls(fm.trimControls), env };
}
export type TwinRig = ReturnType<typeof rig>;

export function run(r: TwinRig, seconds: number, each?: (t: number) => void): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) { each?.(i * DT); r.fm.step(DT, r.c, r.env); }
}

/** The gauges a pilot reads: per engine [engine 1, engine 2] torque %, N1 %, N2 %, TOT C, needles split; NR %; the
 *  warning unit; yaw rate (deg/s, + nose right). */
export function gauges(r: TwinRig) {
  const s = r.fm.state, rc = s.rotorcraft!, t1 = rc.turboshaft!, tw = rc.twinTurboshaft!, t2 = tw.second;
  return {
    nr: t1.nrPct, n2: [t1.n2Pct, t2.n2Pct], n1: [s.engines[0].ng ?? 0, s.engines[1].ng ?? 0],
    tq: [t1.torquePsi, t2.torquePsi], tot: [s.engines[0].itt ?? 0, s.engines[1].itt ?? 0],
    split: [t1.needlesSplit, t2.needlesSplit], set: [t1.n2SetPct, t2.n2SetPct], splitPct: tw.splitPct,
    n1SplitLight: tw.n1SplitLight, nrLowLight: tw.nrLowLight, nrLowTone: tw.nrLowTone, nrHighLight: tw.nrHighLight,
    nrHighTone: tw.nrHighTone, oei: tw.oei, oeiSeconds: tw.oeiSeconds, rpmLight: rc.lowRpmLight, horn: rc.lowRpmHorn,
    limit: rc.powerLimitExceeded, governed: [t1.governorMode === 'governed', t2.governorMode === 'governed'],
    kias: s.ias / KT, fpm: s.verticalSpeed / FT * 60, yawRate: s.angularVelocity.z / DEG, roll: s.roll / DEG, pitch: s.pitch / DEG,
    collective: r.c.collective ?? 0,
  };
}

/** Engine `i`'s power lever (engines[i].throttle): OFF below the cut-off stop, IDLE at the stop, FLIGHT at 1. */
export function lever(c: ControlInputs, i: number, value: number): void {
  c.engines[i] = { ...c.engines[i], throttle: value };
}
export const LEVER = { off: 0, idle: ts.grip.groundIdle, flight: 1 } as const;

/**
 * Test pilot that holds pitch and roll attitude with the cyclic (and, with `heading`, the heading with the pedals);
 * collective and power levers are the caller's. No writes to rotor or rigid-body state.
 */
export function attitudePilot(r: TwinRig, heading = false) {
  const s0 = r.fm.state, pitch0 = s0.pitch, e0 = r.c.elevator, a0 = r.c.aileron, p0 = r.c.rudder, h0 = s0.heading;
  let pi = 0, ri = 0, yi = 0;
  return (dt: number): void => {
    const s = r.fm.state;
    pi += (pitch0 - s.pitch) * 0.25 * dt; ri -= s.roll * 0.25 * dt;
    r.c.elevator = clamp(e0 + 2.5 * (pitch0 - s.pitch) - s.angularVelocity.y + pi, -1, 1);
    r.c.aileron = clamp(a0 - 2.5 * s.roll - 0.8 * s.angularVelocity.x + ri, -1, 1);
    if (heading) {
      const e = Math.atan2(Math.sin(s.heading - h0), Math.cos(s.heading - h0));
      yi -= e * 0.2 * dt;
      r.c.rudder = clamp(p0 - 2 * e - 0.7 * s.angularVelocity.z + yi, -1, 1);
    }
  };
}

/** The mass (kg) at which each engine reads `pct` % torque in level flight at `kt` (sea level ISA), by bisection. */
export function massForTorque(pct: number, kt: number, o: TwinRigOptions = {}): number {
  let lo = 900, hi = 4500;
  for (let i = 0; i < 24; i++) {
    const kg = (lo + hi) / 2, g = gauges(rig({ ...o, kg, kt }));
    if ((g.tq[0] + g.tq[1]) / 2 > pct) hi = kg; else lo = kg;
  }
  return (lo + hi) / 2;
}

interface TraceFs { mkdirSync(path: string, options: { recursive: boolean }): void; writeFileSync(path: string, data: string): void }
const traceDir = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.TWIN_TRACE;
const fs = traceDir ? await import(/* @vite-ignore */ 'node:fs' as string) as TraceFs : undefined;
/** Write a report (TWIN_TRACE only). */
export function writeTrace(name: string, report: unknown): void {
  if (!fs || !traceDir) return;
  fs.mkdirSync(traceDir, { recursive: true });
  fs.writeFileSync(`${traceDir}/${name}.json`, JSON.stringify(report, null, 2));
}
