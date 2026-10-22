// AH-56A stage 5 (AH): the blade section model, the advancing-tip Mach number (H1), V_H with the Mach terms (H2), the profile
// power rise (H3), periodic flap damping (H9) and the cost of the finer rotor (H10). Plan revision 2 section 7.4; docs
// docs/ah56-high-speed.md sections 2-3. Each row logs its numbers next to the target ([ah56] lines); AH56_TRACE=<dir> writes
// ah56HighSpeed.json. Known gaps against the plan are `it.fails` rows with the measured numbers in the logs and the docs.
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, FT, KT, quat, v3 } from '../../src/core/math';
import { cloneControls } from '../../src/core/types';
import type { AircraftDefinition } from '../../src/aircraft/types';
import { AH56_DEFINITION } from '../../src/aircraft/ah56';
import { AH56_REFERENCE } from '../../src/aircraft/ah56/reference';
import { AH56_SECTION, AH56_ROTOR_HIGH_SPEED } from '../../src/aircraft/ah56/highSpeed';
import { PROVISIONAL_SECTION } from '../../src/aircraft/ah56/compound';
import { ah56Loading } from '../../src/aircraft/ah56/mass';
import { MD500_DEFINITION } from '../../src/aircraft/md500';
import { createFlightModelFor } from '../../src/physics';
import type { BladeElementFlightModel } from '../../src/physics/flightModel';
import type { HingelessHub, RotorcraftDefinition } from '../../src/physics/rotorcraft/definition';
import type { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import type { GyroConfigId } from '../../src/physics/rotorcraft/controlGyro';
import { sectionCoefficients, sectionLimits, type RotorSectionDef } from '../../src/physics/rotorcraft/section';
import { advanceFlap, hingeMoment, hubForcing, type FlapHarmonics } from '../../src/physics/rotorcraft/articulated';
import { hingelessBlade, hingelessSpring } from '../../src/physics/rotorcraft/hingeless';
import { PRODUCTION_AIR_WIRED, environment, gauges, report, writeTrace } from './ah56Rig';

const trace: Record<string, unknown> = {};
afterAll(() => writeTrace('ah56HighSpeed', trace));
/** The machine's load for H10's report (node:os, imported the way ah56Rig imports node:fs: no Node types in the build). */
const os = await import(/* @vite-ignore */ 'node:os' as string) as { loadavg(): number[]; cpus(): unknown[] };

const S = AH56_SECTION, P = S.polar!;
const def = AH56_DEFINITION.rotorcraft!;
const STAND_IN = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.AH56_AIRDATA !== 'off' &&
  !PRODUCTION_AIR_WIRED;
const coeff = (s: RotorSectionDef, alphaDeg: number, mach: number) => {
  const a = alphaDeg * DEG, c = sectionCoefficients(s, a, mach, Math.abs(a) > Math.PI / 2);
  return { cl: c.cl, cd: c.cd, cm: c.cm };
};
const variantOf = (base: AircraftDefinition, patch: (r: RotorcraftDefinition) => RotorcraftDefinition): AircraftDefinition =>
  ({ ...base, rotorcraft: patch(base.rotorcraft!) });
const withSection = (section: RotorSectionDef | undefined, base = AH56_DEFINITION) =>
  variantOf(base, (r) => ({ ...r, main: { ...r.main, section } }));
/** The section with no Mach terms: no Prandtl-Glauert, no drag rise, no tuck (H3's "Mach law off"). */
const NO_MACH: RotorSectionDef = { ...S, polar: { ...P, machCap: 1, dragDivergence: { ...P.dragDivergence, rise: 0 }, machTuck: { slope: 0, max: 0 } } };

// ------------------------------------------------------------------------------------------------------------- the section
describe('section.ts: the blade section model (docs section 2)', () => {
  it('without `polar` the S0 stub arithmetic is unchanged (AC\'s provisional placeholder flies it)', () => {
    for (const [alphaDeg, mach] of [[3, 0.3], [-2, 0.85], [20, 0.4], [170, 0.1], [-175, 0.05]]) {
      const a = alphaDeg * DEG, s = PROVISIONAL_SECTION;
      const pg = 1 / Math.sqrt(Math.max(1 - mach * mach, 1e-6));
      const cl = Math.max(-s.maxCl, Math.min(s.maxCl, s.liftSlope * Math.min(pg, s.machCap ?? 1) * a));
      const rise = mach > 0.78 ? 3 * (mach - 0.78) ** 2 : 0;
      const c = sectionCoefficients(s, a, mach, Math.abs(a) > Math.PI / 2);
      expect(c.cl).toBe(cl); expect(c.cd).toBe(s.cd0 + s.cd2 * cl * cl + rise); expect(c.cm).toBe(s.cm0);
    }
  });
  it('attached flow: the base polar at low Mach; Prandtl-Glauert lift slope capped at its M_dd value (1.79)', () => {
    const low = coeff(S, 4, 0.05);
    expect(low.cl).toBeCloseTo(5.73 * 4 * DEG / Math.sqrt(1 - 0.05 ** 2), 9);
    expect(low.cd).toBeCloseTo(0.0085 + 0.01 * low.cl ** 2, 12);
    expect(low.cm).toBe(-0.012);
    expect(sectionLimits(S, 0.6).slope / 5.73).toBeCloseTo(1.25, 3);
    expect(sectionLimits(S, 0.9).slope / 5.73).toBeCloseTo(1 / Math.sqrt(1 - 0.83 ** 2), 9);
  });
  it('drag divergence: Lock\'s fourth-power law fits P NACA WR L-357 Fig 3(a) (the 23012) and P ACR L5E21 Fig 75(a) (6 % sections)', () => {
    // The law with the 23012's M_dd 0.69 at Cl 0.13 (alpha 0, Becker) against Fig 3(a): +0.0010 / +0.0040 / +0.0105 above the
    // minimum at M 0.69 / 0.71 / 0.745; and the tip's 0.83 against Fig 75(a): +0.004-0.006 at M 0.86, +0.010-0.016 at 0.90.
    const rise = (mach0: number, cl: number, m: number) => {
      const s: RotorSectionDef = { ...S, polar: { ...P, dragDivergence: { ...P.dragDivergence, mach0 } } };
      const a = cl / sectionLimits(s, m).slope, c = sectionCoefficients(s, a, m, false);
      return c.cd - 0.0085 - 0.01 * c.cl * c.cl;
    };
    const becker = [0.69, 0.71, 0.745].map((m) => rise(0.69 + 0.1 * 0.13, 0.13, m));
    const ferri = [0.86, 0.9].map((m) => rise(0.83, 0, m));
    report('section drag rise', { becker069: becker[0], becker071: becker[1], becker0745: becker[2], P: '0.0010 / 0.0040 / 0.0105',
      ferri086: ferri[0], ferri090: ferri[1], P6pct: '0.004-0.006 / 0.010-0.016' });
    trace.dragRise = { becker, ferri };
    expect(becker[0]).toBeGreaterThan(0.0005); expect(becker[0]).toBeLessThan(0.0025);
    expect(becker[1]).toBeGreaterThan(0.0025); expect(becker[1]).toBeLessThan(0.006);
    expect(becker[2]).toBeGreaterThan(0.008); expect(becker[2]).toBeLessThan(0.014);
    expect(ferri[0]).toBeGreaterThan(0.004); expect(ferri[0]).toBeLessThan(0.007);
    expect(ferri[1]).toBeGreaterThan(0.010); expect(ferri[1]).toBeLessThan(0.018);
    expect(sectionLimits(S, 0.8, 0).dragDivergence).toBe(0.83);
  });
  it('static stall and the moment break: the P NACA Report 530 Table IV shape (0.14 c over 12 deg) reproduces the 23012; the flown break is the dynamic one', () => {
    // Report 530 Table IV (full-scale tunnel, Re 1.7e6): cm_c/4 -0.012 at Cl max, -0.056 / -0.086 / -0.107 at +3.2 / +6.5 / +10 deg;
    // Cl 1.1 / 1.0 / 0.9. The static shape on a section with Cl max 1.26 (that test's) at M 0.1:
    const statik: RotorSectionDef = { ...S, maxCl: 1.26, polar: { ...P, clMax: { mach: [0.1], value: [1.26], negativeFraction: 0.8 },
      momentStall: { ...P.momentStall, shift: 0.14, over: 12 * DEG } } };
    const stall = sectionLimits(statik, 0.1).stall / DEG;
    const rows = [3.2, 6.5, 10].map((past) => ({ past, ...coeff(statik, stall + past, 0.1) }));
    report('section moment stall, static (Report 530)', { stallDeg: stall, cm32: rows[0].cm, cm65: rows[1].cm, cm10: rows[2].cm,
      cl32: rows[0].cl, cl65: rows[1].cl, cl10: rows[2].cl, P: 'cm -0.056 / -0.086 / -0.107, Cl 1.1 / 1.0 / 0.9' });
    trace.momentStallStatic = rows;
    for (const [i, cm] of [-0.056, -0.086, -0.107].entries()) expect(Math.abs(rows[i].cm - cm)).toBeLessThan(0.015);
    for (const [i, cl] of [1.1, 1.0, 0.9].entries()) expect(Math.abs(rows[i].cl - cl)).toBeLessThan(0.08);
    // The flown (dynamic) break, FITTED to H4: continuous at the stall, -0.2 c x cn within 1.5 deg (about -0.24; refitted in the tuning
    // round with the flap-rate incidence in the ICS gyro's blade moments, KNOWN_ISSUES T6: the stage-5 0.4 c, about -0.45, the deep
    // end of the dynamic-stall moment peaks of 12 % sections at k about 0.1, made the stall a departure); none above M 0.6 (shock
    // stall).
    const at = sectionLimits(S, 0.35).stall / DEG;
    const below = coeff(S, at - 1e-6, 0.35), above = coeff(S, at + 1e-6, 0.35), past15 = coeff(S, at + 1.5, 0.35), past4 = coeff(S, at + 4, 0.35);
    expect(Math.abs(above.cm - below.cm)).toBeLessThan(1e-4); expect(Math.abs(above.cl - below.cl)).toBeLessThan(1e-4);
    expect(past15.cm).toBeLessThan(-0.2); expect(past15.cm).toBeGreaterThan(-0.3);
    expect(past4.cm).toBeLessThan(-0.15); expect(past4.cm).toBeGreaterThan(-0.3);
    const fast = sectionLimits(S, 0.7).stall / DEG, beyond = coeff(S, fast + 4, 0.7);
    expect(beyond.cm).toBeGreaterThan(-0.06);
    report('section moment stall, flown', { stallDegM035: at, cmPast15M035: past15.cm, cmPast4M035: past4.cm, cmPast4M070: beyond.cm });
  });
  it('maximum lift against Mach (ESTIMATE, no cliff below M 0.4): 1.30 / 1.26 / 1.14 / 0.95 / 0.88 / 0.80 at M 0.2 / 0.3 / 0.4 / 0.5 / 0.6 / 0.7', () => {
    const rows = [0.1, 0.2, 0.3, 0.35, 0.4, 0.5, 0.6, 0.9].map((m) => ({ m, ...sectionLimits(S, m) }));
    trace.clMax = rows;
    report('section maximum lift', Object.fromEntries(rows.map((r) => [`M${r.m}`, `${r.clMax.toFixed(3)} @ ${(r.stall / DEG).toFixed(2)} deg`])));
    for (let i = 1; i < rows.length; i++) expect(rows[i].clMax).toBeLessThanOrEqual(rows[i - 1].clMax);
    // No cliff where the retreating tip flies (M 0.2-0.4 in the HQRS-10 turns): the low-speed value (P Report 530: 1.26 at
    // Re 1.7e6) held to M 0.3, at most 10 % lost per 0.1 M below M 0.4.
    const lim = (m: number) => sectionLimits(S, m).clMax;
    expect(lim(0.3)).toBeGreaterThanOrEqual(1.26);
    for (const m of [0.2, 0.25, 0.3]) expect(lim(m + 0.1) / lim(m)).toBeGreaterThanOrEqual(0.9);
  });
  it('reversed flow: P NACA TN 3361 (lift slope 0.10 per deg about 180 deg, peak 0.77, drag twice the minimum, the lift at 0.75 c)', () => {
    const c178 = coeff(S, -178, 0.1), c172 = coeff(S, -172, 0.1), c182 = coeff(S, 178, 0.1);
    // In this convention alpha = -178 deg is TN 3361's 182 deg: the reversed section at +2 deg.
    expect(c178.cl / (2 * DEG)).toBeCloseTo(5.73, 6);
    expect(c182.cl).toBeCloseTo(-c178.cl, 9);
    expect(coeff(S, -180 + 0.77 / 5.73 / DEG, 0.1).cl).toBeCloseTo(0.77, 9);
    expect(c178.cd).toBeCloseTo(2 * 0.0085 + 0.01 * c178.cl ** 2, 9);
    // Moment of the reversed lift about the quarter chord: +0.5 cl (nose up for a positive reversed lift), TN 3361 Fig 1 sense.
    const cn = c172.cl * Math.cos(-172 * DEG) + c172.cd * Math.sin(-172 * DEG);
    expect(c172.cm).toBeCloseTo(-0.5 * (172 / 180) * cn, 9);
    expect(c172.cm).toBeGreaterThan(0.3);
  });
  it('reversed flow reproduces the linear hub forcing to first order (the normal force q c (cl cos phi - cd sin phi))', () => {
    // ut < 0 (reverse), small up: the linear model k |ut| (ut theta - up) against the section's normal force.
    const k = 0.5 * 1.225 * 5.73 * 0.711;
    for (const [ut, up, thetaDeg] of [[-20, 0.5, 3], [-10, -1, 2], [-35, 1, 4]]) {
      const theta = thetaDeg * DEG, phi = Math.atan2(up, ut), alpha = Math.atan2(Math.sin(theta - phi), Math.cos(theta - phi));
      const c = sectionCoefficients(S, alpha, Math.hypot(ut, up) / 340, true);
      const section = 0.5 * 1.225 * (ut * ut + up * up) * 0.711 * (c.cl * Math.cos(phi) - c.cd * Math.sin(phi));
      const linear = k * Math.abs(ut) * (ut * theta - up);
      expect(Math.abs(section / linear - 1)).toBeLessThan(0.1);
    }
  });
  it('the flat plate: cn 2.0 at 90 deg, the centre of pressure at 0.5 c (cm -0.5), continuous across 90 deg (P TN 3361: 2.08, about -0.5)', () => {
    const f = coeff(S, 89.999, 0.2), r = coeff(S, 90.001, 0.2);
    expect(f.cd).toBeCloseTo(0.0085 + 2.0, 3); expect(f.cm).toBeCloseTo(-0.5, 2);
    expect(Math.abs(f.cl - r.cl)).toBeLessThan(1e-3); expect(Math.abs(f.cd - r.cd)).toBeLessThan(1e-3); expect(Math.abs(f.cm - r.cm)).toBeLessThan(1e-3);
  });
});

// ------------------------------------------------------------------------------------------------------------- rigs
interface RigOptions { cfg?: GyroConfigId; kt: number; lb?: number; ft?: number; physicsRate?: number; gearDown?: boolean }
function rigOn(d: AircraftDefinition, o: RigOptions) {
  const fm = createFlightModelFor(d, o.physicsRate ? { physicsRate: o.physicsRate } : undefined) as BladeElementFlightModel;
  const env = environment(o.ft ?? 0);
  fm.setLoading(ah56Loading(o.lb ?? 18_300, undefined, 1));
  const rotor = (fm as unknown as { rotorcraft: Rotorcraft }).rotorcraft;
  if (STAND_IN) rotor.gyro!.setAirData({ hub: { x: o.kt * KT, y: 0, z: 0 }, density: env.atmosphere().density });
  fm.reset({ position: { x: 0, y: 0, z: -((o.ft ?? 0) * FT + 1500 * FT) }, heading: 0, airspeed: o.kt * KT, flightPathAngle: 0,
    onGround: false, engineRunning: true, fuelFraction: 1, rotorcraftConfig: o.cfg, gearDown: o.gearDown ?? o.kt < 100 }, env);
  return { fm, c: cloneControls(fm.trimControls), env, cfg: o.cfg ?? 'amcs', airData: STAND_IN, rotor };
}
type Rig = ReturnType<typeof rigOn>;
function step(r: Rig, seconds: number, dt = 1 / 240): void {
  for (let i = 0, n = Math.round(seconds / dt); i < n; i++) {
    if (r.airData) { const s = r.fm.state; r.rotor.gyro!.setAirData({ hub: quat.rotateInv(s.orientation, s.velocity), density: r.env.atmosphere().density }); }
    r.fm.step(dt, r.c, r.env);
  }
}
const collective075 = (r: Rig) => (def.main.minPitch + (r.c.collective ?? 0) * (def.main.maxPitch - def.main.minPitch)) / DEG;
const fixedBeta = (deg: number, base: AircraftDefinition) => variantOf(base, (r) => ({ ...r, pusher: { ...r.pusher!,
  trimSchedule: { x: [0, 1], y: [deg * DEG, deg * DEG] }, trimScheduleByConfig: undefined } }));
/** The level trim at `kt` with the prop set so the collective is `coll` deg at 0.75 R (AC's C4/C5 procedure). */
function trimOnCollective(base: AircraftDefinition, o: RigOptions, coll: number, lo = 15, hi = 40.8) {
  const at = (b: number) => { const r = rigOn(fixedBeta(b, base), o); return { b, r, e: collective075(r) - coll }; };
  let a = at(lo), c = at(hi);
  if (a.e * c.e > 0) return Math.abs(a.e) < Math.abs(c.e) ? a : c;
  for (let i = 0; i < 12; i++) {
    const s = c.b - c.e * (c.b - a.b) / (c.e - a.e);
    const m = at(Number.isFinite(s) && s > Math.min(a.b, c.b) && s < Math.max(a.b, c.b) ? s : (a.b + c.b) / 2);
    if (Math.abs(m.e) < 0.03 && m.r.fm.lastTrim!.converged) return m;
    if (m.e * a.e > 0) a = m; else c = m;
  }
  return Math.abs(a.e) < Math.abs(c.e) ? a : c;
}
/** The speed (KTAS) at which the trim on `coll` needs `torque` %: bisection between `lo` and `hi`. */
function speedAtTorque(base: AircraftDefinition, o: Omit<RigOptions, 'kt'>, coll: number, torque: number, lo: number, hi: number, betaHi = 40.8,
  betaLo = 15) {
  const tq = (kt: number) => gauges(trimOnCollective(base, { ...o, kt }, coll, betaLo, betaHi).r as never).torque;
  let tlo = tq(lo), thi = tq(hi);
  for (let i = 0; i < 5 && tlo < torque && thi > torque; i++) {
    const mid = (lo + hi) / 2, t = tq(mid);
    if (t < torque) { lo = mid; tlo = t; } else { hi = mid; thi = t; }
  }
  return { kt: lo + (torque - tlo) / (thi - tlo) * (hi - lo), lo, hi, tlo, thi };
}
const clean = (base: AircraftDefinition) => variantOf(base, (r) => ({ ...r, wings: r.wings!.map((w) => ({ ...w, stores: undefined })) }));
/** ASTA-72's ICS aircraft flown on the AMCS gyro's mechanics at 246 rpm (AC's C4 stand-in: the ICS trim runs out of stick). */
const icsRpm = (base: AircraftDefinition) => variantOf(base, (r) => ({ ...r, controlGyro: { ...r.controlGyro!, configs: { ...r.controlGyro!.configs,
  ics: { ...r.controlGyro!.configs.amcs, nominalRpmFraction: 1, collectiveIndicatedOffset: 0 } } } }));

// ------------------------------------------------------------------------------------------------------------- H1
describe('the trim sees the atmosphere\'s speed of sound (settle takes it, as compute does)', () => {
  // The section's Mach terms and the pusher read the speed of sound. Rotorcraft.settle (the trim's relaxation) used its 340.3 m/s
  // default while flight used the atmosphere's (328 m/s at 9,000 ft): the converged trim then started off balance.
  it('AMCS at 9,000 ft and 180 KTAS: the trimmed state balances with 328 m/s and not with 340.3', () => {
    const r = rigOn(AH56_DEFINITION, { cfg: 'amcs', kt: 180, ft: 9000 });
    const atm = r.env.atmosphere(), t = r.fm.lastTrim!, mp = (r.fm as unknown as { mp: { cgOffset: { x: number; y: number; z: number }; mass: number;
      inertia: { Ixx: number; Iyy: number; Izz: number } } }).mp;
    const c = cloneControls(r.fm.trimControls);
    c.collective = r.fm.trimControls.collective; c.elevator = t.elevator; c.aileron = t.aileron; c.rudder = t.rudder;
    const residual = (sound?: number) => {
      const b = { time: 0, position: { ...r.fm.state.position }, orientation: t.orientation, velocityBody: t.velocityBody,
        angularVelocity: v3.zero(), cgOffset: mp.cgOffset, mass: mp.mass };
      const f = r.rotor.settle(b, v3.zero(), atm.density, -r.fm.state.position.z, c, true, sound);
      const g = quat.rotateInv(t.orientation, { x: 0, y: 0, z: 9.80665 });
      return { ax: f.force.x / mp.mass + g.x, ay: f.force.y / mp.mass + g.y, az: f.force.z / mp.mass + g.z,
        p: f.moment.x / mp.inertia.Ixx, q: f.moment.y / mp.inertia.Iyy, r: f.moment.z / mp.inertia.Izz };
    };
    const real = residual(atm.speedOfSound), sea = residual(undefined);
    const worst = (o: Record<string, number>) => Math.max(...Object.values(o).map(Math.abs));
    report('trim speed of sound, 9,000 ft 180 KTAS AMCS', { soundSpeed: atm.speedOfSound, converged: String(t.converged),
      residualReal: worst(real), residualDefault: worst(sea), azDefault: sea.az, rDefault: sea.r });
    expect(t.converged).toBe(true);
    expect(worst(real)).toBeLessThan(1e-3);
    // The default's residual is what the old trim left: tens of times larger (vertical about 0.06 m/s^2, 489 N, codex's probe).
    expect(worst(sea)).toBeGreaterThan(20 * worst(real));
  }, 300_000);
});

describe('H1: advancing-tip Mach number at 194 KTAS and 246 rpm (D: 0.885)', () => {
  it('0.885 +/- 0.01 at sea level (ICS, 18,750 lb)', () => {
    const r = rigOn(AH56_DEFINITION, { cfg: 'ics', kt: 194, lb: 18_750 });
    const s = r.fm.state, rc = s.rotorcraft!, air = quat.rotateInv(s.orientation, s.velocity);
    const hub = v3.add(air, v3.cross(s.angularVelocity, v3.sub(def.main.hub, (r.fm as unknown as { mp: { cgOffset: { x: number; y: number; z: number } } }).mp.cgOffset)));
    const a = r.env.atmosphere().speedOfSound, tip = (rc.omega * def.main.radius + Math.hypot(hub.x, hub.y)) / a;
    report('H1 advancing tip', { mach: tip, rpm: rc.rotorRpm, ktas: s.tas / KT, speedOfSound: a, target: '0.885 +/- 0.01 (D)' });
    trace.H1 = { mach: tip, rpm: rc.rotorRpm };
    expect(rc.rotorRpm).toBeCloseTo(246, 0);
    expect(Math.abs(tip - 0.885)).toBeLessThanOrEqual(0.01);
  }, 300_000);
});

// ------------------------------------------------------------------------------------------------------------- H2
describe('H2: V_H re-checked with the section\'s Mach terms (plan C4 / C5, P)', () => {
  // C4 on the ICS configuration itself. Until the final fix round the ICS gyro ran out of forward stick before 194 KTAS and the row flew
  // the AMCS gyro's mechanics at 246 rpm instead (icsRpm, kept as a reported reference); with the wing section Cm and the DATCOM
  // downwash (compound.ts) the ICS trims there (4.3 in forward at 194 KTAS, 5.1 in at 202).
  it('C4: the ICS configuration, TOW (stores), 18,750 lb, SL, collective 5 deg, 114 % torque: 194 KTAS +/- 5 % inside the stick travel (P ASTA-72 para 14)', () => {
    // Bracket to 202 KTAS: the ICS trims there with 5.1 in of forward stick; at 206 it is on the 5.5 in stop and does not converge.
    // The prop bracket is 25-39 deg: at either end (15 or 40.8 deg) the ICS's trim at these speeds needs more than the forward stick
    // and does not converge, which the bracket's sign check would read as a root outside it (the roots sit at 34-37 deg).
    const v = speedAtTorque(AH56_DEFINITION, { cfg: 'ics', lb: 18_750 }, 5, 114, 190, 202, 39, 25);
    const amcsMechanics = speedAtTorque(icsRpm(AH56_DEFINITION), { cfg: 'ics', lb: 18_750 }, 5, 114, 190, 204);
    const at = trimOnCollective(AH56_DEFINITION, { cfg: 'ics', lb: 18_750, kt: v.kt }, 5, 25, 39), t = at.r.fm.lastTrim!;
    const lon = def.controlGyro!.configs.ics.stickTravel.longitudinal / 0.0254;
    report('H2 C4 V_H', { icsKtas: v.kt, icsLonInAtVh: t.elevator * lon, convergedAtVh: String(t.converged), amcsMechanicsAt246RpmKtas: amcsMechanics.kt,
      target: '194 +/- 5 % (184.3-203.7)' });
    trace.H2C4 = { v, amcsMechanics, lonIn: t.elevator * lon };
    expect(t.converged).toBe(true);
    expect(Math.abs(t.elevator)).toBeLessThan(0.999);
    expect(Math.abs(v.kt / AH56_REFERENCE.vh - 1)).toBeLessThanOrEqual(0.05);
  }, 1_800_000);
  it('C5: AMCS clean, 18,300 lb, 13 deg indicated (6 deg at 0.75 R), 114 %: 210-225 KTAS (P Hoh-74 220; S 215)', () => {
    const v = speedAtTorque(clean(AH56_DEFINITION), { cfg: 'amcs', lb: 18_300 }, 6, 114, 204, 218);
    report('H2 C5 AMCS maximum level speed', { cleanKtas: v.kt, target: '210-225' });
    trace.H2C5 = v;
    expect(v.kt).toBeGreaterThanOrEqual(210); expect(v.kt).toBeLessThanOrEqual(225);
  }, 1_800_000);
});

// ------------------------------------------------------------------------------------------------------------- H3
/** Level trim on 6 deg at 0.75 R (13 deg AMCS indicated) at `kt` with a section: torque and the rotor's profile power. */
function powerAt(section: RotorSectionDef, kt: number) {
  // Bracketed inside the prop's travel: at the 40.8 deg stop some variants' trims do not converge (a 200 KTAS level trim on 6 deg
  // needs about 38 deg). Integrator, at the AH merge: 40 -> 39 deg. With the gyro air data wired in Rotorcraft.compute the
  // Mach-off variant's trim at 40 deg no longer converges (collective at its stop), so the secant kept the 32 deg end (14.0 deg
  // of collective); the roots sit at 38.0-38.4 deg.
  const t = trimOnCollective(withSection(section), { cfg: 'amcs', kt, lb: 18_300 }, 6, 32, 39);
  return { beta: t.b, collective: collective075(t.r), torque: gauges(t.r as never).torque, profileShp: -t.r.rotor.power.mainProfile / 745.7,
    mainShp: -t.r.rotor.power.mainShaft / 745.7, converged: t.r.fm.lastTrim!.converged };
}
let h3: { on: ReturnType<typeof powerAt>; off: ReturnType<typeof powerAt>; noRise: ReturnType<typeof powerAt> } | undefined;
describe('H3: the profile power rise with the Mach terms, 200 KTAS (AMCS, 18,300 lb, SL, stores, 13 deg indicated)', () => {
  it('measured: the drag rise adds rotor profile power and total power; the whole Mach law (with Prandtl-Glauert) is reported', () => {
    const noRise: RotorSectionDef = { ...S, polar: { ...P, dragDivergence: { ...P.dragDivergence, rise: 0 } } };
    h3 = { on: powerAt(S, 200), off: powerAt(NO_MACH, 200), noRise: powerAt(noRise, 200) };
    const { on, off } = h3;
    report('H3 200 KTAS', { torqueOn: on.torque, torqueOff: off.torque, torqueNoRise: h3.noRise.torque,
      totalRisePct: (on.torque / off.torque - 1) * 100, profileOnShp: on.profileShp, profileOffShp: off.profileShp,
      profileRisePct: (on.profileShp / off.profileShp - 1) * 100, dragRiseTorquePct: (on.torque / h3.noRise.torque - 1) * 100,
      target: '>= 10 % (D, plan; from the 0.78 ESTIMATE)' });
    trace.H3 = h3;
    // The comparison is at the same collective: every variant trimmed on 6 deg (the secant on the prop blade angle converged).
    for (const v of [on, off, h3.noRise]) { expect(v.converged).toBe(true); expect(Math.abs(v.collective - 6)).toBeLessThan(0.1); }
    expect(on.torque).toBeGreaterThan(h3.noRise.torque);
    expect(on.profileShp).toBeGreaterThan(off.profileShp);
  }, 1_800_000);
  // KNOWN GAP (docs section 3, PR text): "power required" read as the aircraft's (the torque gauge): -1.6 %. The rotor's own profile
  // power rises 9.9 % (reported above). The P-anchored tip divergence (M_dd 0.83, Ferri Fig 75(a)) leaves the 200 KTAS tip (M 0.89)
  // 0.06 past it, and at 200 KTAS the prop, not the rotor, carries most of the power; the plan's 10 % rested on the 0.78 ESTIMATE.
  it.fails('PLAN H3 BAND: power required at 200 KTAS rises >= 10 % with the Mach law on vs off', () => {
    expect(h3!.on.torque / h3!.off.torque - 1).toBeGreaterThanOrEqual(0.10);
  });
});

// ------------------------------------------------------------------------------------------------------------- H9
/** Rotor-level: the converged flap harmonics and the hub moment for a cyclic, at advance ratio mu, on a fixed shaft (no
 *  gyro: the cyclic is the blade's directly), with or without the periodic flap damping. */
function settledFlap(mu: number, pitchCos: number, pitchSin: number, periodic: boolean) {
  const hub = def.hubModel as HingelessHub, main = { ...def.main, periodicFlapDamping: periodic };
  const p = { flapOffset: hub.equivalentHingeOffset, lagOffset: hub.equivalentHingeOffset, blade: hingelessBlade(def) };
  const spring = { stiffness: hingelessSpring(def), precone: hub.precone };
  const omega = 246 * Math.PI / 30, air = { x: mu * omega * def.main.radius, y: 0, z: 0 };
  let flap: FlapHarmonics = { cone: hub.precone, cosine: 0, sine: 0 };
  for (let i = 0; i < 2000; i++) {
    const f = hubForcing(main, p, omega, 1.225, 5 * DEG, pitchCos, pitchSin, air, 3, v3.zero(), def.rotation,
      { flap, radialFlow: hub.radialFlow, periodicDamping: periodic, section: main.section, soundSpeed: 340.3 });
    flap = advanceFlap(p, omega, f, flap, def.rotation, 1 / 240, 0, { ...spring, aerodynamic: f.stiffness });
  }
  return { flap, moment: hingeMoment(p, def.main.blades, omega, flap, spring) };
}
let h9Change = 0;
describe('H9: periodic flap damping at mu 0.5 (RC\'s option, on for the AH-56)', () => {
  it('on in the definition; the hub moment per unit lateral cyclic with it on vs off is measured and reported', () => {
    expect(AH56_ROTOR_HIGH_SPEED.periodicFlapDamping).toBe(true);
    const per = (periodic: boolean) => {
      const a = settledFlap(0.5, 1 * DEG, 0, periodic), b = settledFlap(0.5, -1 * DEG, 0, periodic);
      return { flap: Math.hypot(a.flap.cosine - b.flap.cosine, a.flap.sine - b.flap.sine) / 2, moment: Math.hypot(a.moment.x - b.moment.x, a.moment.y - b.moment.y) / 2 };
    };
    const on = per(true), off = per(false);
    h9Change = on.moment / off.moment - 1;
    report('H9 periodic flap damping, mu 0.5', { hubMomentPerDegOn: on.moment, hubMomentPerDegOff: off.moment, changePct: h9Change * 100,
      flapPerDegOn: on.flap / DEG, flapPerDegOff: off.flap / DEG, target: '8-15 % (D, plan; RC R23 measured 1-3 % at mu 0.35)' });
    trace.H9 = { on, off, change: h9Change };
    expect(Number.isFinite(h9Change)).toBe(true);
    expect(Math.abs(h9Change)).toBeGreaterThan(0.005);
    // Plan amendment A2 (plan section 15): the periodic damping reaches the first harmonics only through the cone and the
    // reverse-flow region, so the change is second order: |change| <= 5 % (D). The 8-15 % stays as the PLAN BAND row below.
    expect(Math.abs(h9Change)).toBeLessThanOrEqual(0.05);
  });
  // KNOWN GAP shared with RC's R23 (docs/rotor-hingeless-model.md): the plan's 8-15 % assumed a first-harmonic periodic damping;
  // the linear-in-ut damping is 1/rev and reaches the harmonics through the cone and the reverse-flow region only.
  it.fails('PLAN H9 BAND: the response with the periodic term on vs off differs by 8-15 %', () => {
    expect(Math.abs(h9Change)).toBeGreaterThanOrEqual(0.08);
    expect(Math.abs(h9Change)).toBeLessThanOrEqual(0.15);
  });
  it('rate convergence (R15) still holds at 200 KTAS: roll rate 0.5 s after a 0.2 lateral step at 240 / 480 / 960 Hz within 2 %', () => {
    const rates = [240, 480, 960].map((hz) => {
      const r = rigOn(AH56_DEFINITION, { cfg: 'amcs', kt: 200, physicsRate: hz });
      r.c.aileron += 0.2;
      step(r, 0.5, 1 / hz);
      return r.fm.state.angularVelocity.x / DEG;
    });
    report('H9 rate convergence 200 KTAS', { hz240: rates[0], hz480: rates[1], hz960: rates[2] });
    trace.H9rates = rates;
    expect(Math.abs(rates[0] / rates[2] - 1)).toBeLessThan(0.02);
    expect(Math.abs(rates[1] / rates[2] - 1)).toBeLessThan(0.02);
  }, 600_000);
});

// ------------------------------------------------------------------------------------------------------------- H10
describe('H10: physics cost at 200 KTAS <= 2 x MD 500E (same machine, headless)', () => {
  // The plan's bound (2.0, AGENT) is asserted as it stands, on the best of seven interleaved samples of each model (the minimum is
  // the sample least disturbed by other processes). On a loaded machine (1-min load average above half the cores) the two models
  // do not slow down equally, so the row is SKIPPED there with the numbers reported, never passed on a looser bound.
  it('mean step time, best of seven interleaved samples each', (ctx) => {
    const ah = rigOn(AH56_DEFINITION, { cfg: 'amcs', kt: 200 }), ics = rigOn(AH56_DEFINITION, { cfg: 'ics', kt: 160 });
    const md = createFlightModelFor(MD500_DEFINITION) as BladeElementFlightModel, env = environment();
    md.reset({ position: { x: 0, y: 0, z: -500 }, heading: 0, airspeed: 120 * KT, flightPathAngle: 0, onGround: false, engineRunning: true, fuelFraction: 1 }, env);
    const mdc = cloneControls(md.trimControls);
    const time = (f: () => void, n: number) => { const t0 = performance.now(); for (let i = 0; i < n; i++) f(); return (performance.now() - t0) / n * 1000; };
    for (let i = 0; i < 240; i++) { ah.fm.step(1 / 240, ah.c, ah.env); ics.fm.step(1 / 240, ics.c, ics.env); md.step(1 / 240, mdc, env); }
    const a: number[] = [], m: number[] = [], i: number[] = [];
    for (let k = 0; k < 7; k++) {
      a.push(time(() => ah.fm.step(1 / 240, ah.c, ah.env), 600)); m.push(time(() => md.step(1 / 240, mdc, env), 600));
      i.push(time(() => ics.fm.step(1 / 240, ics.c, ics.env), 600));
    }
    const ahUs = Math.min(...a), mdUs = Math.min(...m), icsUs = Math.min(...i);
    const load = os.loadavg()[0], cpus = os.cpus().length, loaded = load > 0.5 * cpus;
    // The ICS configuration at 160 KTAS (it does not trim at 200; reported, not the plan's row, which flies the default): its
    // feathering-moment feedback reads the blade moments with the blade's flap-rate incidence, a second section evaluation per
    // element (about 2.15 x the MD 500E, against 1.85 x before that term).
    report('H10 cost', { ah56Us: ahUs, md500Us: mdUs, ratio: ahUs / mdUs, withinPlanTarget: ahUs / mdUs <= 2, icsUs, icsRatio: icsUs / mdUs,
      loadAverage1m: load, cpus,
      skippedUnderLoad: loaded, grid: `${def.main.radialStations} x ${def.main.azimuthStations}`, target: '<= 2 (AGENT, plan H10)' });
    trace.H10 = { ahUs, mdUs, icsUs, load, cpus };
    if (loaded) { ctx.skip(); return; }
    expect(ahUs / mdUs).toBeLessThanOrEqual(2);
  }, 300_000);
});
