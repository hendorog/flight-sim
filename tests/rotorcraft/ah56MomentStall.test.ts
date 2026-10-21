// AH-56A stage 5 (AH): ICS blade moment stall (H4), ICS maneuvering stability (H5) and the AMCS manoeuvres (H6). Plan revision 2
// section 7.4; docs/ah56-high-speed.md sections 1 (the mechanism, H11) and 3.
//
// The test (ASTA-72 para 62-65, P): 4,600 ft density altitude, 20,000 lb, external stores, collective 7 / 5 / 5 deg at 122 / 154 /
// 190 KCAS (ICS). A scripted test pilot winds up a turn at 0.1 g/s to a target load factor and tries to stabilise there for 7 s
// (bank for the load factor, stick for n_z, pedals for zero sideslip, the prop lever for the airspeed; the collective held).
// UNCOMMANDED MOTION is the difference from the same flight, same pilot, on the section without stall (Cl max 9): roll to the right
// (deg) and load factor above it (g, the pitch-up). ASTA-72 para 65: "When the pilot attempted to stabilize at 1.4g at 122 KCAS,
// the aircraft pitched nose-up and rolled right ... The same type excursion occurred when attempting to stabilize at 1.5g at 154
// KCAS ... No uncommanded aircraft motions were encountered at envelope limit load factors of 1.43 at 190 KCAS". Onset: the first
// target with >= 2 deg of right roll and >= 0.03 g of pitch-up.
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, FT, KT, clamp, quat } from '../../src/core/math';
import { cloneControls } from '../../src/core/types';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import { AH56_SECTION } from '../../src/aircraft/ah56/highSpeed';
import { ah56Loading } from '../../src/aircraft/ah56/mass';
import { createFlightModelFor } from '../../src/physics';
import { atmosphereAt } from '../../src/physics/atmosphere';
import type { BladeElementFlightModel } from '../../src/physics/flightModel';
import type { RotorcraftDefinition } from '../../src/physics/rotorcraft/definition';
import type { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import type { GyroConfigId } from '../../src/physics/rotorcraft/controlGyro';
import type { RotorSectionDef } from '../../src/physics/rotorcraft/section';
import { environment, gyroDef, report, writeTrace } from './ah56Rig';

const trace: Record<string, unknown> = {};
afterAll(() => writeTrace('ah56MomentStall', trace));

const def = AH56_DEFINITION.rotorcraft!;
const P = AH56_SECTION.polar!;
const NO_STALL: RotorSectionDef = { ...AH56_SECTION, polar: { ...P, clMax: { ...P.clMax, value: P.clMax.value.map(() => 9) } } };
const variantOf = (patch: (r: RotorcraftDefinition) => RotorcraftDefinition): AircraftDefinition =>
  ({ ...AH56_DEFINITION, rotorcraft: patch(AH56_DEFINITION.rotorcraft!) });
const noStall = variantOf((r) => ({ ...r, main: { ...r.main, section: NO_STALL } }));
const fixedBeta = (deg: number, base: AircraftDefinition): AircraftDefinition => ({ ...base, rotorcraft: { ...base.rotorcraft!,
  pusher: { ...base.rotorcraft!.pusher!, trimSchedule: { x: [0, 1], y: [deg * DEG, deg * DEG] }, trimScheduleByConfig: undefined } } });

interface Condition { cfg: GyroConfigId; kcas: number; coll?: number; lb: number; ft: number }
function trimRig(base: AircraftDefinition, o: Condition, beta?: number) {
  const d = beta === undefined ? base : fixedBeta(beta, base);
  const fm = createFlightModelFor(d) as BladeElementFlightModel, env = environment(o.ft);
  fm.setLoading(ah56Loading(o.lb, undefined, 1));
  const ktas = o.kcas / Math.sqrt(atmosphereAt(o.ft * FT).density / 1.225);
  const rotor = (fm as unknown as { rotorcraft: Rotorcraft }).rotorcraft;
  rotor.gyro!.setAirData({ hub: { x: ktas * KT, y: 0, z: 0 }, density: env.atmosphere().density });
  fm.reset({ position: { x: 0, y: 0, z: -(o.ft * FT + 1500 * FT) }, heading: 0, airspeed: ktas * KT, flightPathAngle: 0, onGround: false,
    engineRunning: true, fuelFraction: 1, rotorcraftConfig: o.cfg, gearDown: false }, env);
  return { fm, rotor, env, c: cloneControls(fm.trimControls) };
}
const collective075 = (c: { collective?: number }) => (def.main.minPitch + (c.collective ?? 0) * (def.main.maxPitch - def.main.minPitch)) / DEG;
/** The prop blade angle (deg) that trims the condition on its collective (secant, bracketed). */
const betaCache = new Map<string, number>();
function betaFor(o: Condition): number | undefined {
  if (o.coll === undefined) return undefined;
  const key = JSON.stringify(o);
  if (betaCache.has(key)) return betaCache.get(key);
  const f = (b: number) => ({ b, e: collective075(trimRig(AH56_DEFINITION, o, b).c) - o.coll! });
  let a = f(10), c = f(40.8);
  for (let i = 0; i < 16 && Math.abs(c.e) > 0.02; i++) {
    const s = c.b - c.e * (c.b - a.b) / (c.e - a.e);
    const m = f(Number.isFinite(s) && s > Math.min(a.b, c.b) && s < Math.max(a.b, c.b) ? s : (a.b + c.b) / 2);
    if (m.e * a.e > 0) a = m; else c = m;
    if (Math.abs(m.e) < 0.02) { c = m; break; }
  }
  betaCache.set(key, c.b);
  return c.b;
}

interface Sample { t: number; nCmd: number; nz: number; p: number; q: number; roll: number; lonIn: number; latIn: number; kias: number }
/** Wind up at `rate` g/s to `target` and hold for `hold` s: the scripted test pilot (file header). Left turn. */
function windup(base: AircraftDefinition, o: Condition, target: number, hold = 7, rate = 0.1) {
  const r = trimRig(base, o, betaFor(o)), { fm, rotor, env, c } = r, g = rotor.gyro!;
  const travel = gyroDef.configs[o.cfg].stickTravel;
  const dt = 1 / 240, start = 2, e0 = c.elevator, a0 = c.aileron, r0 = c.rudder, l0 = c.propLever ?? 0.5;
  let iN = 0, iPhi = 0, iB = 0, iV = 0;
  const rows: Sample[] = [];
  const tEnd = start + (target - 1) / rate + hold;
  for (let i = 0; i * dt < tEnd; i++) {
    const t = i * dt, s = fm.state;
    g.setAirData({ hub: quat.rotateInv(s.orientation, s.velocity), density: env.atmosphere().density });
    const nCmd = Math.min(target, 1 + rate * Math.max(0, t - start));
    const phiCmd = -Math.acos(Math.min(1, 1 / nCmd));
    const w = s.angularVelocity, V = Math.max(s.tas, 1), vb = quat.rotateInv(s.orientation, s.velocity);
    const sideslip = Math.asin(clamp(vb.y / V, -1, 1)), qTurn = 9.80665 * Math.tan(-phiCmd) / V * Math.sin(-phiCmd);
    iN += (nCmd - s.gLoad) * dt; iPhi += (phiCmd - s.roll) * dt; iB += sideslip * dt; iV += (o.kcas - s.ias / KT) * dt;
    c.elevator = clamp(e0 + 0.6 * (nCmd - s.gLoad) + 1.2 * iN - 0.4 * (w.y - qTurn), -1, 1);
    c.aileron = clamp(a0 + 2.0 * (phiCmd - s.roll) - 0.3 * w.x + 0.8 * iPhi, -1, 1);
    c.rudder = clamp(r0 + 1.5 * sideslip + 0.5 * iB, -1, 1);
    c.propLever = clamp(l0 + 0.003 * (o.kcas - s.ias / KT) + 0.0008 * iV, 0, 1);
    if (i % 12 === 0) rows.push({ t, nCmd, nz: s.gLoad, p: w.x / DEG, q: w.y / DEG, roll: s.roll / DEG, lonIn: c.elevator * travel.longitudinal / 0.0254,
      latIn: c.aileron * travel.lateral / 0.0254, kias: s.ias / KT });
    fm.step(dt, c, env);
    if ((fm as unknown as { crashReason: string }).crashReason) break;
  }
  return { rows, crash: (fm as unknown as { crashReason: string }).crashReason };
}
/** The uncommanded motion while stabilising at `target`: the largest differences from the no-stall flight. */
function excursion(o: Condition, target: number) {
  const A = windup(AH56_DEFINITION, o, target), B = windup(noStall, o, target);
  let rollRight = 0, pitchUp = 0, q = 0, p = 0, nMax = 0;
  for (let i = 0; i < Math.min(A.rows.length, B.rows.length); i++) {
    const a = A.rows[i], b = B.rows[i];
    if (a.nCmd < target - 0.1) continue;
    rollRight = Math.max(rollRight, a.roll - b.roll); pitchUp = Math.max(pitchUp, a.nz - b.nz);
    q = Math.max(q, a.q - b.q); p = Math.max(p, a.p - b.p); nMax = Math.max(nMax, a.nz);
  }
  const tail = (rows: Sample[]) => rows.slice(-Math.round(2 / (12 / 240)));
  const mean = (rows: Sample[], k: keyof Sample) => rows.reduce((x, r) => x + (r[k] as number), 0) / rows.length;
  return { target, rollRight, pitchUp, q, p, nMax, crash: A.crash, onset: rollRight >= 2 && pitchUp >= 0.03,
    lonIn: mean(tail(A.rows), 'lonIn'), nz: mean(tail(A.rows), 'nz'), lonInRef: mean(tail(B.rows), 'lonIn'), nzRef: mean(tail(B.rows), 'nz') };
}
const ICS_122: Condition = { cfg: 'ics', kcas: 122, coll: 7, lb: 20_000, ft: 4600 };
const ICS_154: Condition = { cfg: 'ics', kcas: 154, coll: 5, lb: 20_000, ft: 4600 };
const ICS_190: Condition = { cfg: 'ics', kcas: 190, coll: 5, lb: 20_000, ft: 4600 };

const h5: ReturnType<typeof excursion>[] = [];
describe('H4: ICS moment stall, pitch-up and RIGHT roll (P ASTA-72 paras 63-65)', () => {
  const onsetOf = (rows: ReturnType<typeof excursion>[]) => rows.find((r) => r.onset)?.target;
  it('154 KCAS: begins at 1.5 +/- 0.2 g', () => {
    const rows = [1.3, 1.4, 1.5, 1.6, 1.65, 1.7].map((n) => excursion(ICS_154, n));
    const onset = onsetOf(rows);
    for (const r of rows) report(`H4 154 KCAS stabilise at ${r.target} g`, { rollRightDeg: r.rollRight, pitchUpG: r.pitchUp, qDegS: r.q, pDegS: r.p, nMax: r.nMax });
    report('H4 154 KCAS onset', { onsetG: onset ?? 'none', target: '1.5 +/- 0.2 g (P)' });
    trace.H4at154 = { rows, onset };
    expect(rows.every((r) => !r.crash)).toBe(true);
    expect(onset).toBeDefined();
    expect(onset!).toBeGreaterThanOrEqual(1.3); expect(onset!).toBeLessThanOrEqual(1.7);
    // The sense at the onset: right roll and pitch-up together (P: "pitched nose-up and rolled right").
    const at = rows.find((r) => r.onset)!;
    expect(at.rollRight).toBeGreaterThan(0); expect(at.pitchUp).toBeGreaterThan(0); expect(at.q).toBeGreaterThan(0);
  }, 1_800_000);
  it('122 KCAS: begins at 1.4 +/- 0.2 g', () => {
    const rows = [1.2, 1.3, 1.4, 1.5, 1.6].map((n) => excursion(ICS_122, n));
    h5.push(...rows);
    const onset = onsetOf(rows);
    for (const r of rows) report(`H4 122 KCAS stabilise at ${r.target} g`, { rollRightDeg: r.rollRight, pitchUpG: r.pitchUp, qDegS: r.q, pDegS: r.p, nMax: r.nMax });
    report('H4 122 KCAS onset', { onsetG: onset ?? 'none', target: '1.4 +/- 0.2 g (P)' });
    trace.H4at122 = { rows, onset };
    expect(rows.every((r) => !r.crash)).toBe(true);
    expect(onset).toBeDefined();
    expect(onset!).toBeGreaterThanOrEqual(1.2); expect(onset!).toBeLessThanOrEqual(1.6);
    const at = rows.find((r) => r.onset)!;
    expect(at.rollRight).toBeGreaterThan(0); expect(at.pitchUp).toBeGreaterThan(0); expect(at.q).toBeGreaterThan(0);
  }, 1_800_000);
  it('190 KCAS: no uncommanded motion to the 1.43 g envelope limit', () => {
    const r = excursion(ICS_190, 1.43);
    report('H4 190 KCAS stabilise at 1.43 g', { rollRightDeg: r.rollRight, pitchUpG: r.pitchUp, qDegS: r.q, pDegS: r.p, nMax: r.nMax, target: 'none (P)' });
    trace.H4at190 = r;
    expect(r.crash).toBe('');
    expect(r.rollRight).toBeLessThan(0.5); expect(r.pitchUp).toBeLessThan(0.01);
  }, 1_800_000);
});

describe('H5: ICS stick per g above 1.3 g at 122 KCAS (P ASTA-72 para 63: neutral slightly above 1.3 g)', () => {
  let gradient = NaN;
  it('measured from the stabilised turns (the moment stall flattens it past the onset)', () => {
    expect(h5.length).toBeGreaterThan(0);
    const rows = h5.map((r) => ({ g: r.nz, lonIn: r.lonIn, gRef: r.nzRef, lonInRef: r.lonInRef }));
    const at = (n: number) => rows.reduce((b, r) => (Math.abs(r.g - n) < Math.abs(b.g - n) ? r : b));
    const lo = at(1.3), hi = at(1.4);
    gradient = (hi.lonIn - lo.lonIn) / (hi.g - lo.g);
    const below = at(1.2), gradientBelow = (lo.lonIn - below.lonIn) / (lo.g - below.g);
    report('H5 122 KCAS stick per g', { above13InPerG: gradient, from12to13InPerG: gradientBelow,
      noStallAbove13: (hi.lonInRef - lo.lonInRef) / (hi.gRef - lo.gRef), target: '<= 0.1 in/g above 1.3 g (P)' });
    trace.H5 = { rows, gradient, gradientBelow };
    expect(Number.isFinite(gradient)).toBe(true);
  });
  // KNOWN GAP (docs section 3): AG/AC's ICS airframe and gyro need about 4-5 in of aft stick per g at 122 KCAS before the stall
  // (the gyro sets the hub moment the stabiliser's strong pitch stiffness asks for); the moment stall reduces it only past onset.
  it.fails('PLAN H5 BAND: stick per g <= 0.1 in/g above 1.3 g at 122 KCAS', () => {
    expect(Math.abs(gradient)).toBeLessThanOrEqual(0.1);
  });
});

describe('H6: AMCS, the same manoeuvres (P AMCS-73 para 37: positive and linear to the envelope; no moment stall)', () => {
  // The AMCS stick stop (longitudinal half travel), in: the steady turns end on it before 2.5 g (docs section 3, H6).
  const stopIn = gyroDef.configs.amcs.stickTravel.longitudinal / 0.0254;
  const h6: Record<number, { rows: ReturnType<typeof excursion>[]; nMax: number; atStop: boolean }> = {};
  for (const kcas of [155, 180]) it(`${kcas} KCAS: no uncommanded motion to the g the stick reaches; stick per g positive from 1.5 to 2 g`, () => {
    const o: Condition = { cfg: 'amcs', kcas, lb: 18_300, ft: 0 };
    const rows = [1.5, 2.0, 2.5].map((n) => excursion(o, n));
    const g1 = (rows[1].lonIn - rows[0].lonIn) / (rows[1].nz - rows[0].nz);
    const nMax = Math.max(...rows.map((r) => r.nMax)), atStop = rows[2].lonIn >= stopIn - 0.05;
    // From 2 g to the 2.5 g target the stick ends on its stop: that gradient is the stop's, not a stick per g.
    const toStop = (rows[2].lonIn - rows[1].lonIn) / (rows[2].nz - rows[1].nz);
    // D, for the AG handover: a steady turn needs q = (g / V)(n - 1 / n); on the P 6 deg/s/in AMCS rate command (AMCS-73 para 33)
    // that is (g / V)(n - 1 / n) / 6 deg/s per in, about 1.8 in from 1 to 2 g at 155 KCAS.
    const V = kcas * KT, rate = 6 * DEG, inPerG = (9.80665 / V) * (2 - 1 / 2) / rate;
    for (const r of rows) report(`H6 AMCS ${kcas} KCAS at ${r.target} g`, { nz: r.nz, nMax: r.nMax, lonIn: r.lonIn, rollRightDeg: r.rollRight, pitchUpG: r.pitchUp });
    report(`H6 AMCS ${kcas} KCAS stick per g`, { from15to20InPerG: g1, from20toStopInPerG: toStop, stopIn, atStop, nMaxG: nMax,
      steadyTurnFromRateCommandInPerG: inPerG, target: 'positive and linear to 2.5 g (P); about 1.8 in/g from the P rate command (D)' });
    trace[`H6at${kcas}`] = { rows, g1, toStop, nMax, atStop, inPerG };
    h6[kcas] = { rows, nMax, atStop };
    expect(rows.every((r) => !r.crash)).toBe(true);
    // AMCS has no feathering-moment path: the moment stall cannot reach the gyro; the lift stall alone is small.
    for (const r of rows) { expect(Math.abs(r.rollRight)).toBeLessThan(2); expect(r.pitchUp).toBeLessThan(0.03); }
    expect(g1).toBeGreaterThan(0);
  }, 1_800_000);
  // KNOWN GAP (docs section 3 H6; AG handover in section 8.1): in a steady turn the AMCS needs 4-5 in of aft stick per g (AG's
  // first-peak rate calibration against the steady state: the P rate command implies about 1.8 in/g), so full aft stick (the
  // 4.95 in stop) holds only 2.29 g at 155 and 2.48 g at 180 KCAS (peaks 2.34 / 2.49): "to 2.5 g" is shown only to those.
  for (const kcas of [155, 180]) it.fails(`PLAN H6 BAND: ${kcas} KCAS reaches 2.5 g inside the stick travel (measured at the 4.95 in stop: 2.29 / 2.48 g)`, () => {
    expect(h6[kcas]).toBeDefined();
    expect(h6[kcas].nMax).toBeGreaterThanOrEqual(2.5);
    expect(h6[kcas].atStop).toBe(false);
  });
});
