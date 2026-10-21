// Bo 105 CB-4 test rigs (BO, plan revision 2 section 6.2): the REAL definition (src/aircraft/bo105) at a total mass and
// CG, held ISA atmospheres (md500Rig's environment), the pilot's gauges in pilot units, a test pilot that only moves the
// controls, quasi-static derivatives (the R18 method of RC's hingelessFixture.ts, here on the real aircraft) and the
// trace (BO105_TRACE=<directory> writes each file's report there as JSON; every file also prints one line per row).
import { BO105_DEFINITION as def } from '../../src/aircraft/bo105';
import { BO105_CG_MM, BO105_INERTIA } from '../../src/aircraft/bo105/facts';
import { x as stationX } from '../../src/aircraft/bo105/dimensions';
import { bo105Payload } from '../../src/aircraft/bo105/mass';
import { createMassModel } from '../../src/physics/massModel';
import { createFlightModelFor } from '../../src/physics';
import type { BladeElementFlightModel } from '../../src/physics/flightModel';
import type { AircraftDefinition } from '../../src/aircraft/types';
import type { BodyState } from '../../src/physics/interfaces';
import { cloneControls, type ControlInputs, type InitialConditions } from '../../src/core/types';
import { DEG, FT, KT, clamp, quat, v3 } from '../../src/core/math';
import { environment } from './md500Rig';

export const DT = 1 / 240;
export const d = def.rotorcraft!;
export const ts = d.systems.turboshaft!;
export { def, environment };

/** CG envelope limits at a mass, STA m (P TCDS p11, straight lines between the points). */
export function cgLimits(kg: number): { forward: number; aft: number; mid: number } {
  const lerp = (pts: readonly (readonly [number, number])[], m: number): number => {
    if (m <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (m <= pts[i][0]) {
      const [m0, v0] = pts[i - 1], [m1, v1] = pts[i];
      return v0 + (v1 - v0) * (m - m0) / (m1 - m0);
    }
    return pts[pts.length - 1][1];
  };
  const forward = lerp(BO105_CG_MM.forward, kg) / 1000, aft = lerp(BO105_CG_MM.aft, kg) / 1000;
  return { forward, aft, mid: (forward + aft) / 2 };
}

export interface RigOptions {
  kt?: number; height?: number; running?: boolean; onGround?: boolean; ft?: number; isaDev?: number; pathDeg?: number;
  fuelFraction?: number;
  /** CG station, m aft of the datum, or 'mid' / 'forward' / 'aft' of the TCDS envelope at this mass, or 'natural' (the
   *  seats as they are). Default 'mid'; a pilot-only loading (below 1812 kg) defaults to 'natural'. */
  cg?: number | 'mid' | 'forward' | 'aft' | 'natural';
  enginesRunning?: boolean[];
  /** Override the definition (decompositions, sensitivity rows). */
  def?: AircraftDefinition;
  physicsRate?: number;
}

/** The lightest payload the rigs fly: the pilot alone, kg (ESTIMATE, a lightly dressed pilot). */
export const PILOT_KG = 80;

/**
 * The loading for `kg` total: full fuel (or `fuelFraction`) with the typical (AR-280) loading's seat distribution scaled
 * to the payload; below full fuel plus a pilot (1812 kg) the pilot alone and the fuel that makes up the mass (every
 * tank at the same fraction: 1400 kg carries 44 kg). The payload centroid is then moved fore and aft so that the CG
 * sits at the requested station (default mid-envelope at that mass, P TCDS p11).
 */
export function loadingFor(kg: number, o: Pick<RigOptions, 'fuelFraction' | 'cg' | 'def'> = {}) {
  const dd = o.def ?? def, tanks = dd.powerplant.fuel.tanks, full = tanks.reduce((sum, t) => sum + t.capacity, 0);
  let fuelFraction = o.fuelFraction ?? 1, payload = kg - dd.mass.empty - full * fuelFraction;
  const base = payload >= PILOT_KG ? dd.mass.loadings.typical : bo105PilotOnly;
  if (payload < PILOT_KG) { payload = PILOT_KG; fuelFraction = (kg - dd.mass.empty - PILOT_KG) / full; }
  if (!(fuelFraction >= 0 && fuelFraction <= 1)) throw new Error(`Bo 105 rig: no loading for ${kg} kg`);
  const model = createMassModel(dd.mass, tanks);
  const at = (x: number) => model.properties({ payload, payloadPosition: { ...base.payloadPosition, x },
    payloadDistribution: base.payloadDistribution, tanks: tanks.map((t) => t.capacity * fuelFraction) }).cgOffset.x;
  const cg = o.cg ?? (base === bo105PilotOnly ? 'natural' : 'mid'), limits = cgLimits(kg);
  const target = cg === 'natural' ? at(base.payloadPosition.x) : stationX(typeof cg === 'number' ? cg : limits[cg]);
  const x = base.payloadPosition.x + (target - at(base.payloadPosition.x)) * kg / payload;
  return { payload: { ...base, payload, payloadPosition: { ...base.payloadPosition, x } }, fuelFraction, cgStation: stationX(at(x)) };
}
const bo105PilotOnly = bo105Payload([PILOT_KG, 0, 0, 0, 0, 0]);

/** The Bo 105 at `kg` total (loadingFor), reset at `kt` (trimmed level flight or `pathDeg`), `height` m up. */
export function rig(kg: number, o: RigOptions = {}) {
  const dd = o.def ?? def;
  const fm = createFlightModelFor(dd, o.physicsRate ? { physicsRate: o.physicsRate } : undefined) as BladeElementFlightModel;
  const env = environment(o.ft ?? 0, o.isaDev ?? 0);
  const l = loadingFor(kg, o);
  fm.setLoading(l.payload);
  const ic: InitialConditions = { position: { x: 0, y: 0, z: -(o.onGround ? 0 : o.height ?? 1500) }, heading: 0,
    airspeed: (o.kt ?? 0) * KT, flightPathAngle: (o.pathDeg ?? 0) * DEG, onGround: o.onGround ?? false,
    engineRunning: o.running ?? true, fuelFraction: l.fuelFraction, ...(o.enginesRunning ? { enginesRunning: o.enginesRunning } : {}) };
  fm.reset(ic, env);
  return { fm, c: cloneControls(fm.trimControls), env, def: dd, loading: l };
}
export type Bo105Rig = ReturnType<typeof rig>;

export function run(r: Bo105Rig, seconds: number, each?: (t: number) => void): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) { each?.(i * DT); r.fm.step(DT, r.c, r.env); }
}

/** The gauges a pilot reads (per engine [1, 2]): torque %, N1 %, N2 %, TOT C; NR %; attitudes, rates, controls. */
export function gauges(r: Bo105Rig) {
  const s = r.fm.state, rc = s.rotorcraft!, t1 = rc.turboshaft!, tw = rc.twinTurboshaft!, t2 = tw.second;
  return {
    kias: s.ias / KT, ktas: v3.len(s.velocity) / KT, fpm: s.verticalSpeed / FT * 60, pitch: s.pitch / DEG, roll: s.roll / DEG,
    nr: t1.nrPct, nrRpm: rc.rotorRpm, n2: [t1.n2Pct, t2.n2Pct], n1: [s.engines[0].ng ?? 0, s.engines[1].ng ?? 0],
    tq: [t1.torquePsi, t2.torquePsi], tot: [s.engines[0].itt ?? 0, s.engines[1].itt ?? 0], set: [t1.n2SetPct, t2.n2SetPct],
    split: [t1.needlesSplit, t2.needlesSplit], fuelKgH: ((s.engines[0].fuelFlow ?? 0) + (s.engines[1].fuelFlow ?? 0)) * 3600,
    collective: r.c.collective ?? 0, elevator: r.c.elevator, aileron: r.c.aileron, rudder: r.c.rudder,
    p: s.angularVelocity.x / DEG, q: s.angularVelocity.y / DEG, yawRate: s.angularVelocity.z / DEG,
    beta: Math.atan2(quat.rotateInv(s.orientation, s.velocity).y, quat.rotateInv(s.orientation, s.velocity).x) / DEG,
    mastMoment: rc.mastMoment ?? 0, oei: tw.oei, rpmLight: rc.lowRpmLight, nrLowTone: tw.nrLowTone, nrLowLight: tw.nrLowLight,
    n1SplitLight: tw.n1SplitLight, limit: rc.powerLimitExceeded,
  };
}
export type Gauges = ReturnType<typeof gauges>;

/** Engine `i`'s power lever: OFF below the cut-off stop, IDLE at the stop, FLIGHT at 1. */
export function lever(c: ControlInputs, i: number, value: number): void {
  c.engines[i] = { ...c.engines[i], throttle: value };
}
export const LEVER = { off: 0, idle: ts.grip.groundIdle, flight: 1 } as const;

/**
 * Test pilot: holds a speed (or a pitch), wings level and the heading with ordinary cyclic and pedals; the collective
 * is the caller's. No writes to rotor or rigid-body state (md500Rig's pilot, Bo 105 gains for the stiffer roll).
 */
export function pilot(r: Bo105Rig, kias: number, o: { heading?: boolean } = {}) {
  const s0 = r.fm.state, pitchTrim = s0.pitch, elevatorTrim = r.c.elevator, aileronTrim = r.c.aileron, rudderTrim = r.c.rudder;
  const heading0 = s0.heading, holdHeading = o.heading ?? true;
  let pitchI = 0, rollI = 0, yawI = 0, speedI = 0;
  return (dt: number, commandedPitch?: number): void => {
    const s = r.fm.state, heading = Math.atan2(Math.sin(s.heading - heading0), Math.cos(s.heading - heading0));
    speedI += 0.002 * (s.ias - kias * KT) * dt;
    const target = commandedPitch ?? clamp(pitchTrim + 0.06 * (s.ias - kias * KT) + speedI, -17 * DEG, 17 * DEG);
    pitchI += (target - s.pitch) * 0.25 * dt;
    rollI -= s.roll * 0.25 * dt; yawI -= heading * 0.2 * dt;
    r.c.elevator = clamp(elevatorTrim + 1.5 * (target - s.pitch) - 0.6 * s.angularVelocity.y + pitchI, -1, 1);
    r.c.aileron = clamp(aileronTrim - 1.2 * s.roll - 0.3 * s.angularVelocity.x + rollI, -1, 1);
    if (holdHeading) r.c.rudder = clamp(rudderTrim - 2 * heading - 0.7 * s.angularVelocity.z + yawI, -1, 1);
  };
}

/** A steady wind (NED m/s: the velocity of the air) that builds up linearly over `rampS` seconds of flight-model time. */
export function withWind(r: Bo105Rig, north: number, east: number, rampS = 10): void {
  const base = r.env, wind = (_p: unknown, t: number) => { const k = Math.min(1, Math.max(0, t / rampS)); return { x: k * north, y: k * east, z: 0 }; };
  r.env = { ...base, wind } as typeof base;
}

/**
 * Test pilot holding a hover over a point (ground velocity 0), the heading and the height: an outer loop from ground
 * velocity to attitude, the attitude held with the cyclic, the heading with the pedals and the vertical speed with the
 * collective. Returns the per-step closure. No writes to rotor or rigid-body state.
 */
export function positionHold(r: Bo105Rig) {
  const s0 = r.fm.state, e0 = r.c.elevator, a0 = r.c.aileron, p0 = r.c.rudder, c0 = r.c.collective ?? 0;
  const h0 = s0.heading, z0 = s0.position.z, pitch0 = s0.pitch, roll0 = s0.roll;
  let pi = 0, ri = 0, yi = 0, ci = 0, vxI = 0, vyI = 0;
  return (dt: number): void => {
    const s = r.fm.state, ch = Math.cos(s.heading), sh = Math.sin(s.heading);
    // Ground velocity in heading axes: forward, right.
    const vf = s.velocity.x * ch + s.velocity.y * sh, vr = -s.velocity.x * sh + s.velocity.y * ch;
    vxI += vf * dt; vyI += vr * dt;
    const pitchCmd = clamp(pitch0 + 0.02 * vf + 0.004 * vxI, pitch0 - 25 * DEG, pitch0 + 25 * DEG);
    const rollCmd = clamp(roll0 - 0.02 * vr - 0.004 * vyI, -30 * DEG, 30 * DEG);
    pi += (pitchCmd - s.pitch) * 0.5 * dt; ri += (rollCmd - s.roll) * 0.5 * dt;
    r.c.elevator = clamp(e0 + 1.5 * (pitchCmd - s.pitch) - 0.6 * s.angularVelocity.y + pi, -1, 1);
    r.c.aileron = clamp(a0 + 1.2 * (rollCmd - s.roll) - 0.3 * s.angularVelocity.x + ri, -1, 1);
    const e = Math.atan2(Math.sin(s.heading - h0), Math.cos(s.heading - h0));
    yi -= e * 0.4 * dt;
    r.c.rudder = clamp(p0 - 2 * e - 0.7 * s.angularVelocity.z + yi, -1, 1);
    // NED z down: climbing makes s.velocity.z negative.
    ci += (s.position.z - z0) * 0.002 * dt;
    r.c.collective = clamp(c0 + 0.05 * s.velocity.z + 0.01 * (s.position.z - z0) + ci, 0, 1);
  };
}

/** Collective servo on a measured value (torque %, rotor rpm, ...), rate-limited like a hand. */
export function collectiveServo(c: ControlInputs, error: number, gain: number, dt: number, rate = 0.3): void {
  c.collective = clamp((c.collective ?? 0) + clamp(gain * error, -rate, rate) * dt, 0, 1);
}

// ------------------------------------------------------------------------------------------------ quasi-static derivatives
/**
 * The six body accelerations the flight model integrates for a body state, with the rotor's slow states re-settled:
 * specific force (aerodynamic) and the angular accelerations of flightModel.ts's Ixz-coupled Euler equations,
 * I dw/dt = M - w x (I w + h). The method of RC's hingelessFixture.ts (settledAccelerations), on the real aircraft.
 */
export function settledAccelerations(r: Bo105Rig, b: BodyState, c: ControlInputs = r.c) {
  const rc = r.fm.rotorcraft!, mp = r.fm.massProperties, a = r.env.atmosphere();
  const f = rc.settle(b, v3.zero(), a.density, 1500, c);
  const { Ixx, Iyy, Izz, Ixz } = mp.inertia, w = b.angularVelocity, h = rc.angularMomentum;
  const Hx = Ixx * w.x - Ixz * w.z + h.x, Hy = Iyy * w.y + h.y, Hz = Izz * w.z - Ixz * w.x + h.z;
  const ex = f.moment.x - (w.y * Hz - w.z * Hy), ey = f.moment.y - (w.z * Hx - w.x * Hz), ez = f.moment.z - (w.x * Hy - w.y * Hx);
  const det = Ixx * Izz - Ixz * Ixz;
  return { X: f.force.x / mp.mass, Y: f.force.y / mp.mass, Z: f.force.z / mp.mass,
    L: (Izz * ex + Ixz * ez) / det, M: ey / Iyy, N: (Ixz * ex + Ixx * ez) / det };
}

/** The trimmed body state of a rig (copy). */
export function trimBody(r: Bo105Rig): BodyState {
  const s = r.fm.state, mp = r.fm.massProperties;
  return { time: 0, position: { ...s.position }, orientation: { ...s.orientation },
    velocityBody: quat.rotateInv(s.orientation, s.velocity), angularVelocity: v3.zero(), cgOffset: { ...mp.cgOffset }, mass: mp.mass };
}

export type Rows = Record<'X' | 'Y' | 'Z' | 'L' | 'M' | 'N', number[]>;
/**
 * Quasi-static stability derivatives by central differences about the trim (rotor states re-settled at each perturbed
 * state): columns u, w, q, v, p, r, then the controls col, lon, lat, ped PER % OF FULL TRAVEL (0.02 of the sim's -1..1
 * axis for the cyclic and pedals, 0.01 of the collective's 0..1). Rows X..N as the AR-280 tables (ar280.ts).
 */
export function quasiStaticDerivatives(r: Bo105Rig, du = 0.5, dw = 0.02) {
  const b0 = trimBody(r), c0 = cloneControls(r.c);
  const states: ((b: BodyState, sign: number) => void)[] = [
    (b, s) => { b.velocityBody.x += s * du; }, (b, s) => { b.velocityBody.z += s * du; }, (b, s) => { b.angularVelocity.y += s * dw; },
    (b, s) => { b.velocityBody.y += s * du; }, (b, s) => { b.angularVelocity.x += s * dw; }, (b, s) => { b.angularVelocity.z += s * dw; },
  ];
  const steps = [du, du, dw, du, dw, dw];
  // One % of full travel: collective 0..1 -> 0.01; cyclic and pedals -1..1 -> 0.02. Signs as AR-280: +lon = aft stick
  // (elevator +), +lat = right (aileron +), +ped = right pedal (rudder +), +col = up.
  const controls: ((c: ControlInputs, sign: number) => void)[] = [
    (c, s) => { c.collective = (c0.collective ?? 0) + s * 0.01; }, (c, s) => { c.elevator = c0.elevator + s * 0.02; },
    (c, s) => { c.aileron = c0.aileron + s * 0.02; }, (c, s) => { c.rudder = c0.rudder + s * 0.02; },
  ];
  const rows: Rows = { X: [], Y: [], Z: [], L: [], M: [], N: [] };
  const keys = ['X', 'Y', 'Z', 'L', 'M', 'N'] as const;
  states.forEach((perturb, j) => {
    const plus = { ...b0, velocityBody: { ...b0.velocityBody }, angularVelocity: { ...b0.angularVelocity } };
    const minus = { ...b0, velocityBody: { ...b0.velocityBody }, angularVelocity: { ...b0.angularVelocity } };
    perturb(plus, 1); perturb(minus, -1);
    const ap = settledAccelerations(r, plus), am = settledAccelerations(r, minus);
    for (const k of keys) rows[k][j] = (ap[k] - am[k]) / (2 * steps[j]);
  });
  controls.forEach((perturb, j) => {
    const cp = cloneControls(c0), cm = cloneControls(c0);
    perturb(cp, 1); perturb(cm, -1);
    const ap = settledAccelerations(r, b0, cp), am = settledAccelerations(r, b0, cm);
    for (const k of keys) rows[k][6 + j] = (ap[k] - am[k]) / 2;
  });
  settledAccelerations(r, b0, c0);
  return { rows, u0: b0.velocityBody.x, w0: b0.velocityBody.z, theta0: r.fm.state.pitch };
}
export type Derivatives = ReturnType<typeof quasiStaticDerivatives>;

/** AR-280 inertia (P, Table 6.2.1), for reading moment ratios in the AR-280 form. */
export const AR280_INERTIA = BO105_INERTIA;

// ------------------------------------------------------------------------------------------------ trace
interface TraceFs { mkdirSync(path: string, options: { recursive: boolean }): void; writeFileSync(path: string, data: string): void }
const traceDir = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.BO105_TRACE;
const fs = traceDir ? await import(/* @vite-ignore */ 'node:fs' as string) as TraceFs : undefined;
/** A test file's measured numbers: printed as one JSON line per call, and written to BO105_TRACE=<dir>/<name>.json. */
export function writeTrace(name: string, report: unknown): void {
  console.info(`[${name}] ${JSON.stringify(report)}`);
  if (!fs || !traceDir) return;
  fs.mkdirSync(traceDir, { recursive: true });
  fs.writeFileSync(`${traceDir}/${name}.json`, JSON.stringify(report, null, 1));
}
