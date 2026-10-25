// Bo 105 CB-4 (BO, plan revision 2 section 6.2): the 80 kt stability and control derivatives, modes and the coupled
// roll/flap mode of the REAL definition against AGARD AR-280 (Tables 6.2.8-6.2.13, P; tests/rotorcraft/ar280.ts) and
// LS-178 (P), under the section 4 fitting rule (harmonic inflow ON, nu 1.10-1.12, polar inertia 850-950 kg m^2; the knobs
// are controlPhase and the inertia; known misses are reported as it.fails, never fitted). Control derivatives are per %
// of FULL travel (an assumption, docs/bo105-flight-model.md). The hover rows are against the flight-identified Bo 105
// hover (P: Kaletka & Gimonet, ERF 1995 VII-7, Table 1 and Fig 13; ar280.ts ERF1995_HOVER) under the same envelope rule;
// owner judgement overrides. BO105_TRACE=<dir> writes bo105Derivatives.json.
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, FT, KT, v3 } from '../../src/core/math';
import type { AircraftDefinition } from '../../src/aircraft/types';
import type { HingelessHub } from '../../src/physics/rotorcraft/definition';
import { matrixPencil } from '../../src/physics/identification/matrixPencil';
import { AR280_AFDD, AR280_DLR, AR280_MODES, COLUMN, ERF1995_HOVER, ERF1995_HOVER_PHUGOID, LS178_ROLL_FLAP, derivative, eigenvalues,
  envelope, hoverEnvelope, linearModel, modes, type DerivativeName, type Erf1995HoverName } from './ar280';
import { AR280_INERTIA, DT, d, def, quasiStaticDerivatives, rig, trimBody, writeTrace, type Derivatives } from './bo105Rig';

const report: Record<string, unknown> = {};
afterAll(() => writeTrace('bo105Derivatives', report));

/** AR-280 flight condition (p 36): 80 kt at about 3000 ft density altitude, 2200 kg; 80 KCAS there is 83.6 KTAS. */
const ISA3000 = 1.12094, KTAS80 = 80 * Math.sqrt(1.225 / ISA3000);
const hub = d.hubModel as HingelessHub;
/** The definition with hub fields replaced (diagnostics only: the inflow on/off line, the phase-off row). */
const withHub = (o: Partial<HingelessHub>): AircraftDefinition => ({ ...def, rotorcraft: { ...d, hubModel: { ...hub, ...o } } });

const cache = new Map<string, Derivatives>();
function derivatives(key = 'real', dd: AircraftDefinition = def, kt = KTAS80, ft = 3000): Derivatives {
  if (!cache.has(key)) cache.set(key, quasiStaticDerivatives(rig(2200, { kt, ft, def: dd })));
  return cache.get(key)!;
}
const value = (x: Derivatives, name: DerivativeName) => x.rows[name[0] as 'X'][COLUMN[name[1] as 'u']];
const linear = (x: Derivatives) => modes(eigenvalues(linearModel({ u0: x.u0, w0: x.w0, theta0: x.theta0, ...x.rows })));
const ROWS: DerivativeName[] = ['Lp', 'Mq', 'Nr', 'Mw', 'Zw', 'Lv', 'Nv', 'Xu'];
/**
 * KNOWN MISSES on the real definition (reported, not fitted; docs/bo105-flight-model.md "R18-R20"):
 *  - Zw: ROTOR/INFLOW, structural (RC docs section 10): uniform momentum inflow with blade elements gives D Zw = -0.70
 *    here; DLR -1.00 would need a lift slope of about 9.6. In the cockpit: a climb-rate settling time of about 1.5 s
 *    against DLR's 1.0 s after a collective step.
 */
const KNOWN_MISS: Partial<Record<DerivativeName, string>> = { Zw: 'ROTOR/INFLOW' };

describe('R18 on the real Bo 105: quasi-static 80 kt derivatives against AR-280 (harmonic inflow ON)', () => {
  it('prints R18 with the harmonic inflow states on and off (the fitting rule\'s diagnostic line)', () => {
    const on = derivatives(), off = derivatives('inflowOff', withHub({ harmonicInflow: false }));
    const names = [...ROWS, 'Lq', 'Mp', 'Lu', 'Lw', 'Lr', 'Mu', 'Mv', 'Mr', 'Np', 'Nq', 'Nw', 'Yv', 'Yr', 'Zu', 'Zq', 'Xw'] as DerivativeName[];
    const line = (x: Derivatives) => Object.fromEntries(names.map((n) => [n, Number(value(x, n).toFixed(4))]));
    report.R18 = { condition: { ktas: KTAS80, densityAltitudeFt: 3000, massKg: 2200, nu: hub.flapFrequency, inertia: d.main.inertia,
      controlPhaseDeg: (hub.controlPhase ?? 0) / DEG, cgBelowHubM: rig(2200).fm.massProperties.cgOffset.z - d.main.hub.z },
    inflowOn: line(on), inflowOff: line(off),
    envelope: Object.fromEntries(ROWS.map((n) => [n, envelope(n)])),
    ratios: { LqOverLp: value(on, 'Lq') / -value(on, 'Lp'), MpOverMq: value(on, 'Mp') / -value(on, 'Mq') } };
    expect(Object.values(line(on)).every(Number.isFinite)).toBe(true);
  }, 60_000);
  for (const name of ROWS) {
    const [lo, hi] = envelope(name), miss = KNOWN_MISS[name];
    const title = `${name} inside [${lo.toFixed(3)}, ${hi.toFixed(3)}] (DLR ${derivative(AR280_DLR, name)}, AFDD ${derivative(AR280_AFDD, name)})`;
    if (miss) it.fails(`KNOWN MISS (${miss}) — ${title}`, () => {
      const v = value(derivatives(), name);
      expect(v >= lo && v <= hi, `${name} = ${v}`).toBe(true);
    });
    else it(title, () => {
      const v = value(derivatives(), name);
      expect(v, `${name} = ${v}`).toBeGreaterThanOrEqual(lo); expect(v, `${name} = ${v}`).toBeLessThanOrEqual(hi);
    });
  }
  it('rate cross-derivatives: Lq in [+1.5, +4.5] and Mp in [-1.6, -0.3] 1/s, with their signs (P AR-280 Table 6.2.9)', () => {
    const x = derivatives(), lq = value(x, 'Lq'), mp = value(x, 'Mp');
    expect(lq).toBeGreaterThan(1.5); expect(lq).toBeLessThan(4.5);
    expect(mp).toBeGreaterThan(-1.6); expect(mp).toBeLessThan(-0.3);
  });
  it('Mp/|Mq| -0.1 to -0.3 (AFDD, DLR)', () => {
    const x = derivatives(), r = value(x, 'Mp') / -value(x, 'Mq');
    expect(r).toBeGreaterThan(-0.3); expect(r).toBeLessThan(-0.1);
  });
  it.fails('KNOWN MISS (ROTOR/INFLOW) — Lq/|Lp| 0.25-0.50 (AFDD; DLR 0.36): the hub gives almost none of it, the Pitt-Peters crosswind gain most (RC docs section 4)', () => {
    const x = derivatives(), r = value(x, 'Lq') / -value(x, 'Lp');
    expect(r >= 0.25 && r <= 0.5, `Lq/|Lp| = ${r}`).toBe(true);
  });
  it('Lq and Mp with the calibrated control phase and with none agree within 10 % (the phase touches control only)', () => {
    const a = derivatives(), b = derivatives('phase0', withHub({ controlPhase: 0 }));
    report.R18phase = { Lq: [value(a, 'Lq'), value(b, 'Lq')], Mp: [value(a, 'Mp'), value(b, 'Mp')] };
    expect(Math.abs(value(a, 'Lq') / value(b, 'Lq') - 1)).toBeLessThan(0.1);
    expect(Math.abs(value(a, 'Mp') / value(b, 'Mp') - 1)).toBeLessThan(0.1);
  });
  it('angle-of-attack unstable: Mw > 0 at 80 and 120 KIAS (P AR-280; the hingeless hub\'s signature)', () => {
    const at120 = derivatives('120', def, 120 * Math.sqrt(1.225 / ISA3000));
    report.Mw = { at80: value(derivatives(), 'Mw'), at120: value(at120, 'Mw') };
    expect(value(derivatives(), 'Mw')).toBeGreaterThan(0);
    expect(value(at120, 'Mw')).toBeGreaterThan(0);
  }, 30_000);
});

describe('control derivatives at 80 KCAS per % of full travel (P AR-280 Table 6.2.11; the travels are the fit)', () => {
  const at = () => derivatives().rows;
  it('M_lon 0.093 rad/s^2 per % +/-5 % (DLR; AFDD 0.098): the longitudinal travel\'s fit', () => {
    const m = at().M[COLUMN.lon];
    report.control = { Mlon: m, Llat: at().L[COLUMN.lat], Nped: at().N[COLUMN.ped], Zcol: at().Z[COLUMN.col],
      ratioLlatMlon: at().L[COLUMN.lat] / m };
    expect(Math.abs(m / 0.093 - 1)).toBeLessThanOrEqual(0.05);
  });
  it('L_lat 0.185 (DLR; AFDD 0.179), N_ped 0.049 (DLR; AFDD 0.057), Z_col -0.349 m/s^2 (DLR; AFDD -0.388) per %, +/-30 %', () => {
    const r = at();
    expect(Math.abs(r.L[COLUMN.lat] / 0.185 - 1)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(r.N[COLUMN.ped] / 0.049 - 1)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(r.Z[COLUMN.col] / -0.349 - 1)).toBeLessThanOrEqual(0.3);
  });
  it('L_lat / M_lon lands at 1.5-2.5 after the longitudinal fit', () => {
    const r = at(), ratio = r.L[COLUMN.lat] / r.M[COLUMN.lon];
    expect(ratio).toBeGreaterThanOrEqual(1.5); expect(ratio).toBeLessThanOrEqual(2.5);
  });
  it('controlPhase: off-axis moment ratios |M Iyy/(L Ixx)| <= 0.25 (lateral step) and |L Ixx/(M Iyy)| <= 0.3 (longitudinal step); the least-squares best phase on a 1 deg grid to the DLR/AFDD means within 2 deg of the definition\'s', () => {
    const ratios = (phase: number) => {
      const r = rig(2200, { kt: KTAS80, ft: 3000, def: withHub({ controlPhase: phase }) }), b = trimBody(r), rc = r.fm.rotorcraft!;
      const rho = r.env.atmosphere().density;
      const m = (ail: number, ele: number) => { const f = rc.settle(b, v3.zero(), rho, 1500, { ...r.c, aileron: r.c.aileron + ail,
        elevator: r.c.elevator + ele }); return { x: f.moment.x, y: f.moment.y }; };
      const lp = m(0.02, 0), lm = m(-0.02, 0), ep = m(0, 0.02), em = m(0, -0.02);
      return { lateral: (lp.y - lm.y) / (lp.x - lm.x), longitudinal: (ep.x - em.x) / (ep.y - em.y) };
    };
    const I = AR280_INERTIA;
    const target = { lateral: (AR280_DLR.M[8] * I.Iyy / (AR280_DLR.L[8] * I.Ixx) + AR280_AFDD.M[8] * I.Iyy / (AR280_AFDD.L[8] * I.Ixx)) / 2,
      longitudinal: (AR280_DLR.L[7] * I.Ixx / (AR280_DLR.M[7] * I.Iyy) + AR280_AFDD.L[7] * I.Ixx / (AR280_AFDD.M[7] * I.Iyy)) / 2 };
    const grid = Array.from({ length: 21 }, (_, i) => 20 + i).map((deg) => {
      const r = ratios(deg * DEG);
      return { deg, ...r, cost: (r.lateral - target.lateral) ** 2 + (r.longitudinal - target.longitudinal) ** 2 };
    });
    const best = grid.reduce((a, b) => (b.cost < a.cost ? b : a)), chosen = ratios(hub.controlPhase ?? 0);
    report.controlPhase = { target, chosenDeg: (hub.controlPhase ?? 0) / DEG, chosen, bestDeg: best.deg, grid };
    expect(Math.abs(best.deg - (hub.controlPhase ?? 0) / DEG)).toBeLessThanOrEqual(2);
    expect(Math.abs(chosen.lateral)).toBeLessThanOrEqual(0.25); expect(Math.abs(chosen.longitudinal)).toBeLessThanOrEqual(0.3);
  }, 120_000);
});

/**
 * Tune pass 2 (the round-1 / round-2 gates' physics item, W/tune2/bo105 q5_coll): trimmed at 60 KIAS with the assist off
 * and the stick frozen, a -0.05 collective step gave -11 deg of pitch and -17 deg of roll at 5 s (gate1 g11), and the gate
 * asked for L_col / M_col to be checked against the sources. At AR-280's 80 kt both are inside the envelope rule (sim
 * 0.052 / 0.063 rad/s^2 per %, DLR 0.032 / 0.057, AFDD 0.058 / 0.073), and the flight-identified models themselves, the
 * 8-state DLR and AFDD sets of Tables 6.2.8-6.2.11, answer a -5 % step with -20.8 / -25.3 deg of pitch and -22.4 / -27.8
 * deg of roll at 5 s: the real Bo 105 (P) pitches and rolls that far with the stick frozen. The sim's own nonlinear step
 * (at 80 KCAS: -19.2 / -22.8 deg at 5 s) sits inside the band of the two at every time; no physics changed.
 */
describe('the collective coupling at 80 KCAS (tune pass 2; P AR-280 Tables 6.2.8-6.2.11)', () => {
  it('L_col and M_col inside the AR-280 envelope [min x 0.7, max x 1.3] (DLR 0.032 / 0.057, AFDD 0.058 / 0.073 rad/s^2 per %)', () => {
    const r = derivatives().rows, l = r.L[COLUMN.col], m = r.M[COLUMN.col];
    const band = (a: number, b: number): [number, number] => [Math.min(a, b) * 0.7, Math.max(a, b) * 1.3];
    const [ll, lh] = band(AR280_DLR.L[COLUMN.col], AR280_AFDD.L[COLUMN.col]), [ml, mh] = band(AR280_DLR.M[COLUMN.col], AR280_AFDD.M[COLUMN.col]);
    report.collectiveCoupling = { ...(report.collectiveCoupling as object), Lcol: l, Mcol: m, LcolBand: [ll, lh], McolBand: [ml, mh] };
    expect(l).toBeGreaterThanOrEqual(ll); expect(l).toBeLessThanOrEqual(lh);
    expect(m).toBeGreaterThanOrEqual(ml); expect(m).toBeLessThanOrEqual(mh);
  });
  it('a -5 % collective step, stick frozen (2200 kg, 80 KCAS, 3000 ft): the pitch and roll at 1 / 2 / 3 / 5 s inside the band of the DLR and AFDD identified models\' own step (min x 0.7, max x 1.3)', () => {
    const T = [1, 2, 3, 5];
    /** The 8-state model's attitude (theta, phi: states 3 and 7) after a step of `percent` % of collective, deg. */
    const model = (k: typeof AR280_DLR) => {
      const A = linearModel(k), j = COLUMN.col, b = [k.X[j], k.Z[j], k.M[j], 0, k.Y[j], k.L[j], k.N[j], 0].map((x) => x * -5);
      const f = (x: number[]) => A.map((row, i) => row.reduce((acc, aij, c) => acc + aij * x[c], 0) + b[i]);
      let x = [0, 0, 0, 0, 0, 0, 0, 0], t = 0;
      const h = 0.001, out: { pitch: number; roll: number }[] = [];
      for (const end of T) {
        while (t < end - 1e-12) {
          const k1 = f(x), k2 = f(x.map((xi, i) => xi + h / 2 * k1[i])), k3 = f(x.map((xi, i) => xi + h / 2 * k2[i])), k4 = f(x.map((xi, i) => xi + h * k3[i]));
          x = x.map((xi, i) => xi + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])); t += h;
        }
        out.push({ pitch: x[3] / DEG, roll: x[7] / DEG });
      }
      return out;
    };
    const dlr = model(AR280_DLR), afdd = model(AR280_AFDD);
    const r = rig(2200, { kt: KTAS80, ft: 3000 }), p0 = r.fm.state.pitch, q0 = r.fm.state.roll, sim: { pitch: number; roll: number }[] = [];
    r.c.collective = (r.c.collective ?? 0) - 0.05;
    let t = 0;
    for (const end of T) {
      for (; t < end - 1e-9; t += DT) r.fm.step(DT, r.c, r.env);
      sim.push({ pitch: (r.fm.state.pitch - p0) / DEG, roll: (r.fm.state.roll - q0) / DEG });
    }
    report.collectiveCoupling = { ...(report.collectiveCoupling as object), step: { T, sim, dlr, afdd } };
    T.forEach((time, i) => {
      for (const ax of ['pitch', 'roll'] as const) {
        const lo = Math.min(dlr[i][ax], afdd[i][ax]) * 1.3, hi = Math.max(dlr[i][ax], afdd[i][ax]) * 0.7;
        expect(sim[i][ax], `${ax} at ${time} s`).toBeGreaterThanOrEqual(lo); expect(sim[i][ax], `${ax} at ${time} s`).toBeLessThanOrEqual(hi);
      }
    });
  }, 60_000);
});

describe('R19 on the real Bo 105: modes of the 8-state linear model of the R18 derivatives (P AR-280 Table 6.2.13)', () => {
  it('roll mode 1/T 8.49 1/s +/-30 % (tau 0.118 s)', () => {
    const m = linear(derivatives()), roll = Math.max(...m.subsidences);
    report.R19 = { ...m, rollTau: 1 / roll };
    expect(roll).toBeGreaterThan(AR280_MODES.DLR.roll * 0.7); expect(roll).toBeLessThan(AR280_MODES.DLR.roll * 1.3);
  });
  it('Dutch roll 2.5 rad/s +/-30 %, zeta 0.05-0.30', () => {
    const dutch = linear(derivatives()).oscillations.find((o) => o.omega > 1)!;
    expect(dutch.omega).toBeGreaterThan(2.5 * 0.7); expect(dutch.omega).toBeLessThan(2.5 * 1.3);
    expect(dutch.zeta).toBeGreaterThan(0.05); expect(dutch.zeta).toBeLessThan(0.3);
  });
  it('phugoid divergent (DLR zeta -0.15), period 12-30 s, time to double 7-30 s (plan 6.2 AoA instability row)', () => {
    const p = linear(derivatives()).oscillations.find((o) => o.omega < 1)!;
    const period = 2 * Math.PI / (p.omega * Math.sqrt(1 - p.zeta ** 2)), double = Math.LN2 / (-p.zeta * p.omega);
    report.phugoid = { ...p, period, timeToDouble: double };
    expect(p.zeta).toBeLessThan(0);
    expect(period).toBeGreaterThan(12); expect(period).toBeLessThan(30);
    expect(double).toBeGreaterThanOrEqual(7); expect(double).toBeLessThanOrEqual(30);
  });
});

describe('R20 on the real Bo 105: the coupled body-roll / rotor-flap mode (P AGARD LS-178 paper 14: zeta 0.51, 13.7 rad/s)', () => {
  it('matrix pencil of the roll rate after a 0.1 s lateral pulse at 78 KIAS: 13.7 rad/s +/-30 %, zeta 0.3-0.7', () => {
    const kt = 78, base = rig(2200, { kt }), excited = rig(2200, { kt });
    const pulse = 0.05, pulseSteps = Math.round(0.1 / DT), samples: number[] = [];
    const trim = excited.c.aileron;
    for (let k = 0; k < pulseSteps + Math.round(0.6 / DT); k++) {
      excited.c.aileron = trim + (k < pulseSteps ? pulse : 0);
      base.fm.step(DT, base.c, base.env); excited.fm.step(DT, excited.c, excited.env);
      if (k >= pulseSteps) samples.push(excited.fm.state.angularVelocity.x - base.fm.state.angularVelocity.x);
    }
    const result = matrixPencil(samples, DT)!;
    expect(result).not.toBeNull();
    const pole = result.continuousPoles[0], omega = Math.hypot(pole.re, pole.im), zeta = -pole.re / omega;
    report.R20 = { omega, zeta, poles: result.continuousPoles, peakRollRateDegS: Math.max(...samples.map(Math.abs)) / DEG,
      kias: excited.fm.state.ias / KT };
    expect(Math.abs(pole.im)).toBeGreaterThan(0);
    expect(omega).toBeGreaterThan(LS178_ROLL_FLAP.omega * 0.7); expect(omega).toBeLessThan(LS178_ROLL_FLAP.omega * 1.3);
    expect(zeta).toBeGreaterThan(0.3); expect(zeta).toBeLessThan(0.7);
  });
});

/**
 * The hover rows against the FLIGHT-IDENTIFIED Bo 105 hover (P: Kaletka & Gimonet, ERF 1995 VII-7 Table 1, the DLR and
 * CERT 6 DOF columns; tests/rotorcraft/ar280.ts ERF1995_HOVER) with the AR-280 envelope rule [min x 0.7, max x 1.3]. These
 * replace the plan 6.2 ESTIMATE bands (L_lat 0.13-0.24, M_lon 0.065-0.12, Lp -6..-10): re-sourced, not loosened; each row
 * title carries the old band where there was one. Known misses are it.fails rows (docs/bo105-flight-model.md section 5,
 * KNOWN_ISSUES 3 / 17 / 20). The control derivatives are per % of full travel, as at 80 kt.
 */
describe('hover handling, 2200 kg IGE (3 ft skids), SL, against the flight-identified hover (P ERF 1995 VII-7 Table 1, DLR / CERT 6 DOF, x0.7 / x1.3)', () => {
  const hoverRig = () => quasiStaticDerivatives(rig(2200, { kt: 0, height: d.skids.z + 3 * FT }));
  const ige = (() => { let x: Derivatives | undefined; return () => (x ??= hoverRig()); })();
  const hoverValue = (name: Erf1995HoverName): number => {
    const r = ige().rows;
    const at: Record<Erf1995HoverName, number> = { Lp: r.L[COLUMN.p], Lq: r.L[COLUMN.q], Mq: r.M[COLUMN.q], Mu: r.M[COLUMN.u],
      Mp: r.M[COLUMN.p], Mw: r.M[COLUMN.w], Nv: r.N[COLUMN.v], Nr: r.N[COLUMN.r], Zw: r.Z[COLUMN.w], Llat: r.L[COLUMN.lat],
      Mlon: r.M[COLUMN.lon], Nped: r.N[COLUMN.ped], Zcol: r.Z[COLUMN.col] };
    return at[name];
  };
  /**
   * KNOWN HOVER MISSES (reported, not fitted; docs section 5):
   *  - Mq, Mu (ROTOR/INFLOW): the harmonic inflow's moment feedback (L22 / L33) raises Mq and the L31 wake-skew gradient
   *    doubles Mu on the stiff hub; inertia, nu and the control phase are pinned by the 80 kt fit (no per-definition
   *    knob). The excess puts the sim on the fast side of the identified hover phugoid band.
   *  - Mp (ROTOR/INFLOW, at the edge): -0.76 against the -0.774 edge, 1.5 % outside.
   *  - Mw (sign; the stabiliser / fuselage ESTIMATEs): about 0 in the hover against +0.051 / +0.059.
   *  - Nv (hover weathercock; the tail-rotor / fin ESTIMATEs): about 0 against +0.096 / +0.066.
   *  - Nr (KNOWN_ISSUES 20): -0.54 against -0.974 / -1.10; settled-inflow momentum theory gives the tail rotor -0.34 (the
   *    model's tail -0.43 is above it) and no per-definition knob reaches the band without breaking the 80 kt Nr / Nv /
   *    N_ped rows (the flyability pass's sweep). The keyboard pilot gets the damping from the STAB ASSIST's yaw-rate term.
   */
  const HOVER_MISS: Partial<Record<Erf1995HoverName, string>> = { Mq: 'ROTOR/INFLOW', Mu: 'ROTOR/INFLOW', Mp: 'ROTOR/INFLOW, at the edge',
    Mw: 'sign; stabiliser / fuselage ESTIMATEs', Nv: 'hover weathercock; tail rotor / fin ESTIMATEs', Nr: 'hover yaw damping, KNOWN_ISSUES 20' };
  const OLD_BAND: Partial<Record<Erf1995HoverName, string>> = { Lp: 'was ESTIMATE -6..-10 (it.fails KNOWN HOVER-DAMPING GAP)',
    Llat: 'was ESTIMATE 0.13-0.24', Mlon: 'was ESTIMATE 0.065-0.12' };
  const UNIT: Record<Erf1995HoverName, string> = { Lp: '1/s', Lq: '1/s', Mq: '1/s', Mu: '1/(s m)', Mp: '1/s', Mw: '1/(s m)', Nv: '1/(s m)',
    Nr: '1/s', Zw: '1/s', Llat: 'rad/s^2 per %', Mlon: 'rad/s^2 per %', Nped: 'rad/s^2 per %', Zcol: 'm/s^2 per %' };
  it('prints the hover derivatives beside ERF 1995 Table 1', () => {
    const r = ige().rows;
    report.hover = { Lp: r.L[COLUMN.p], Mq: r.M[COLUMN.q], Llat: r.L[COLUMN.lat], Mlon: r.M[COLUMN.lon], rollTau: -1 / r.L[COLUMN.p] };
    report.hoverErf1995 = Object.fromEntries((Object.keys(ERF1995_HOVER) as Erf1995HoverName[]).map((n) => [n,
      { sim: hoverValue(n), band: hoverEnvelope(n), ...ERF1995_HOVER[n] }]));
    expect(Number.isFinite(r.L[COLUMN.p])).toBe(true);
  }, 30_000);
  for (const name of Object.keys(ERF1995_HOVER) as Erf1995HoverName[]) {
    const [lo, hi] = hoverEnvelope(name), miss = HOVER_MISS[name], { DLR, CERT } = ERF1995_HOVER[name];
    const title = `hover ${name} inside [${lo.toFixed(3)}, ${hi.toFixed(3)}] ${UNIT[name]} (ERF 1995 DLR ${DLR}, CERT ${CERT})${OLD_BAND[name] ? `; ${OLD_BAND[name]}` : ''}`;
    const check = () => { const v = hoverValue(name); expect(v >= lo && v <= hi, `${name} = ${v}`).toBe(true); };
    if (miss) it.fails(`KNOWN HOVER MISS (${miss}) — ${title}`, check, 30_000);
    else it(title, check, 30_000);
  }
  /**
   * The hands-off hover (KNOWN_ISSUES 17, docs section 5): the 8-state hover modes with the harmonic inflow on and off,
   * at 2200 kg IGE (3 ft) and at the in-sim hover scenario's 2500 kg, 16 m. The real Bo 105 hover is "highly unstable"
   * (ERF 1995 flight: 45 deg of roll about 14 s after a lateral input, pilot stabilising inputs throughout); its Figure 13
   * puts the 6 DOF phugoid in the right half-plane (ar280.ts ERF1995_HOVER_PHUGOID: sigma +0.05..+0.45, omega_d
   * 0.3..0.8 rad/s, read off a small printed plot). The row asserts that sourced state (it was "zeta < 0" only); the sim
   * sits on the band's fast side (doubling 2.3 s against about 2.8-3.5 s at the plot's marker centres). ADS-33E-PRF
   * Fig 7 places both at Level 3 (sigma > 0.139 rad/s, doubling under 5 s).
   */
  it(`records the hover modes (harmonic inflow on and off) and the unstable hover phugoid inside the identified band: sigma ${ERF1995_HOVER_PHUGOID.sigma.join('..')} rad/s, omega_d ${ERF1995_HOVER_PHUGOID.omegaD.join('..')} rad/s (P ERF 1995 Fig 13, read)`, () => {
    const off = withHub({ harmonicInflow: false });
    const at = (kg: number, height: number, dd: AircraftDefinition = def) => {
      const x = quasiStaticDerivatives(rig(kg, { kt: 0, height, def: dd }));
      const m = linear(x), osc = m.oscillations.find((o) => o.omega < 1.5 && o.zeta < 0) ?? m.oscillations[0];
      return { Mu: x.rows.M[COLUMN.u], Lv: x.rows.L[COLUMN.v], Lp: x.rows.L[COLUMN.p], Mq: x.rows.M[COLUMN.q], Nr: x.rows.N[COLUMN.r],
        hoverOscillation: { ...osc, timeToDouble: osc.zeta < 0 ? Math.LN2 / (-osc.zeta * osc.omega) : Infinity }, modes: m };
    };
    const igeHeight = d.skids.z + 3 * FT, scenarioHeight = d.skids.z + 16;
    const ige2200 = { inflowOn: at(2200, igeHeight), inflowOff: at(2200, igeHeight, off) };
    report.hoverModes = { ige2200, scenario2500at16m: { inflowOn: at(2500, scenarioHeight), inflowOff: at(2500, scenarioHeight, off) } };
    const o = ige2200.inflowOn.hoverOscillation, sigma = -o.zeta * o.omega, omegaD = o.omega * Math.sqrt(1 - o.zeta ** 2);
    report.hoverPhugoid = { sigma, omegaD, timeToDouble: Math.LN2 / sigma, period: 2 * Math.PI / omegaD, band: ERF1995_HOVER_PHUGOID,
      adsLevel3: sigma > 0.139 };
    expect(o.zeta).toBeLessThan(0);
    expect(sigma).toBeGreaterThanOrEqual(ERF1995_HOVER_PHUGOID.sigma[0]); expect(sigma).toBeLessThanOrEqual(ERF1995_HOVER_PHUGOID.sigma[1]);
    expect(omegaD).toBeGreaterThanOrEqual(ERF1995_HOVER_PHUGOID.omegaD[0]); expect(omegaD).toBeLessThanOrEqual(ERF1995_HOVER_PHUGOID.omegaD[1]);
  }, 120_000);
});
