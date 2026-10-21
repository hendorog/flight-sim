// Bo 105 CB-4 (BO, plan revision 2 section 6.2): the 80 kt stability and control derivatives, modes and the coupled
// roll/flap mode of the REAL definition against AGARD AR-280 (Tables 6.2.8-6.2.13, P; tests/rotorcraft/ar280.ts) and
// LS-178 (P), under the section 4 fitting rule (harmonic inflow ON, nu 1.10-1.12, polar inertia 850-950 kg m^2; the knobs
// are controlPhase and the inertia; known misses are reported as it.fails, never fitted). Control derivatives are per %
// of FULL travel (an assumption, docs/bo105-flight-model.md). The hover handling rows are ESTIMATE (no Bo 105 hover
// derivatives were found); owner judgement overrides. BO105_TRACE=<dir> writes bo105Derivatives.json.
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, FT, KT, v3 } from '../../src/core/math';
import type { AircraftDefinition } from '../../src/aircraft/types';
import type { HingelessHub } from '../../src/physics/rotorcraft/definition';
import { matrixPencil } from '../../src/physics/identification/matrixPencil';
import { AR280_AFDD, AR280_DLR, AR280_MODES, COLUMN, LS178_ROLL_FLAP, derivative, eigenvalues, envelope, linearModel, modes,
  type DerivativeName } from './ar280';
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

describe('hover handling, 2200 kg IGE (3 ft skids), SL (ESTIMATE bands, plan 6.2: hingeless control power and damping "constant throughout the flight speed range", P BK117-ERF7; owner judgement overrides)', () => {
  const hoverRig = () => quasiStaticDerivatives(rig(2200, { kt: 0, height: d.skids.z + 3 * FT }));
  const ige = (() => { let x: Derivatives | undefined; return () => (x ??= hoverRig()); })();
  it('L_lat 0.13-0.24 rad/s^2 per % and M_lon 0.065-0.12 per %', () => {
    const r = ige().rows;
    report.hover = { Lp: r.L[COLUMN.p], Mq: r.M[COLUMN.q], Llat: r.L[COLUMN.lat], Mlon: r.M[COLUMN.lon], rollTau: -1 / r.L[COLUMN.p] };
    expect(r.L[COLUMN.lat]).toBeGreaterThanOrEqual(0.13); expect(r.L[COLUMN.lat]).toBeLessThanOrEqual(0.24);
    expect(r.M[COLUMN.lon]).toBeGreaterThanOrEqual(0.065); expect(r.M[COLUMN.lon]).toBeLessThanOrEqual(0.12);
  }, 30_000);
  /**
   * KNOWN HOVER-DAMPING GAP (ESTIMATE band): with the harmonic inflow ON the hover roll damping is about 25 % above the
   * band's edge (RC docs section 8: in the hover the inflow gradient raises the hub's share of Lp by about 1/1.51 of the
   * Lock number, as the quasi-steady theory predicts; at 80 kt it does not). No Bo 105 hover derivatives were found, so the
   * band itself is an ESTIMATE; the 80 kt Lp and roll mode sit inside their AR-280 bands. One assertion, as it.fails.
   */
  it.fails('KNOWN HOVER-DAMPING GAP — Lp -6 to -10 1/s, i.e. a roll time constant 0.1-0.2 s (-1/Lp)', () => {
    const lp = ige().rows.L[COLUMN.p];
    expect(lp >= -10 && lp <= -6, `Lp ${lp}, tau ${-1 / lp} s`).toBe(true);
  }, 30_000);
});
