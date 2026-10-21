// Hingeless rotor core (plan revision 2, section 4): the AR-280 reference and the fixture's 80 kt derivatives and modes
// (R18, R19). The reference module is ar280.ts (AGARD AR-280 Tables 6.2.8-6.2.13, P).
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, v3 } from '../../src/core/math';
import { AR280_AFDD, AR280_DLR, AR280_MODES, COLUMN, derivative, eigenvalues, envelope, linearModel, modes, type DerivativeName } from './ar280';
import { FIXTURE_CONTROL_PHASE, FIXTURE_INERTIA, FIXTURE_NU, fixtureRig, lockNumber, quasiStaticDerivatives, traceReport,
  trimBody } from './hingelessFixture';

const report: Record<string, unknown> = {};
afterAll(() => traceReport('hingelessAr280', report));

describe('AR-280 reference (Tables 6.2.8-6.2.13, P): the derivative sets reproduce their own modes', () => {
  it('eigenvalue helper: a known 3x3 and a damped oscillator', () => {
    const e = eigenvalues([[2, 0, 0], [0, -1, 0], [0, 0, 5]]).map((x) => x.re).sort((a, b) => a - b);
    expect(e[0]).toBeCloseTo(-1, 12); expect(e[1]).toBeCloseTo(2, 12); expect(e[2]).toBeCloseTo(5, 12);
    const o = modes(eigenvalues([[0, 1], [-4, -0.8]])).oscillations[0];
    expect(o.omega).toBeCloseTo(2, 10); expect(o.zeta).toBeCloseTo(0.2, 10);
  });
  for (const [k, ref] of [[AR280_DLR, AR280_MODES.DLR], [AR280_AFDD, AR280_MODES.AFDD]] as const) {
    it(`${k.name}: state-matrix form (Ixz folded in) gives the Table 6.2.13 modes`, () => {
      const m = modes(eigenvalues(linearModel(k)));
      const [phugoid, dutch] = m.oscillations;
      const real = m.subsidences;
      // Roll mode, the two aperiodic pitch modes and the spiral: the four real roots.
      expect(real).toHaveLength(4);
      expect(Math.abs(real[3] / ref.roll - 1), `roll ${real[3]}`).toBeLessThan(0.02);
      expect(Math.abs(real[2] / ref.pitch[0] - 1), `pitch 1 ${real[2]}`).toBeLessThan(0.03);
      expect(Math.abs(real[1] / ref.pitch[1] - 1), `pitch 2 ${real[1]}`).toBeLessThan(0.1);
      expect(Math.abs(real[0] - ref.spiral), `spiral ${real[0]}`).toBeLessThan(0.015);
      expect(Math.abs(dutch.omega / ref.dutchRoll.omega - 1), `Dutch roll ${JSON.stringify(dutch)}`).toBeLessThan(0.03);
      expect(Math.abs(dutch.zeta - ref.dutchRoll.zeta)).toBeLessThan(0.02);
      expect(Math.abs(phugoid.omega / ref.phugoid.omega - 1), `phugoid ${JSON.stringify(phugoid)}`).toBeLessThan(0.05);
      expect(Math.abs(phugoid.zeta - ref.phugoid.zeta)).toBeLessThan(0.05);
    });
  }
  it('read as L/Ixx, N/Izz with the Ixz coupling outside, the DLR roll mode would be 9.8, not 8.49', () => {
    const k = AR280_DLR, Ixx = 1433, Izz = 4099, Ixz = 660, det = Ixx * Izz - Ixz * Ixz;
    const L = k.L.map((x, i) => (Izz * x * Ixx + Ixz * k.N[i] * Izz) / det);
    const N = k.N.map((x, i) => (Ixz * k.L[i] * Ixx + Ixx * x * Izz) / det);
    const real = modes(eigenvalues(linearModel({ ...k, L, N }))).subsidences;
    expect(Math.max(...real)).toBeGreaterThan(9.5);
  });
});

// ------------------------------------------------------------------------------------------------ the fixture at 80 kt
/** AR-280 flight condition (p 36): 80 kt at a density altitude of about 3000 ft; 80 KCAS there is 83.6 KTAS. */
const ISA3000 = 1.12094, KTAS = 80 * Math.sqrt(1.225 / ISA3000);
type Derivatives = ReturnType<typeof quasiStaticDerivatives>;
const cache = new Map<string, Derivatives>();
function derivatives(o: { harmonicInflow?: boolean; controlPhase?: number } = {}): Derivatives {
  const key = JSON.stringify(o);
  if (!cache.has(key)) cache.set(key, quasiStaticDerivatives(fixtureRig({ kt: KTAS, ft: 3000, hub: o })));
  return cache.get(key)!;
}
const value = (d: Derivatives, name: DerivativeName) => d.rows[name[0] as 'X'][COLUMN[name[1] as 'u']];
const ROWS: DerivativeName[] = ['Lp', 'Mq', 'Nr', 'Mw', 'Zw', 'Lv', 'Nv', 'Xu', 'Lq', 'Mp'];
/**
 * KNOWN MISSES of the hub set (e 0.12 R, nu 1.11, polar 900 kg m^2, controlPhase 30 deg) under the fitting rule (inflow
 * on, nu and gamma in their bands; only controlPhase and inertia may move, and neither moves these). Reported, not
 * fitted (docs/rotor-hingeless-model.md has the decomposition and the (nu, inertia) grid). One assertion each, as
 * it.fails, so a later model or BO's real airframe that closes one turns it red:
 *  - FIXTURE AIRFRAME: the fixture's stabiliser/fin/fuselage ESTIMATES set these (rotor alone: Mw +0.063, inside the
 *    envelope; Nv +0.099 without the fins, inside); BO's airframe decides them.
 *  - ROTOR/INFLOW: the rotor and the Pitt-Peters gains set these (Zw 2 % short of 0.7 x DLR; Lq/|Lp| 0.24 against 0.25;
 *    Lv -0.134 with no fins). Zw is STRUCTURAL: uniform momentum with blade elements gives D Zw = -(rho pi R^2 Omega R / m)
 *    (a sigma / 4) / (1 + a sigma / (8 mu)) = -0.70 here (DLR's -1.00 would need a lift slope of about 9.6), a climb-rate
 *    settling time of about 1.46 s against DLR's 1.0 s. No airframe data closes it (docs section 10).
 */
const KNOWN_MISS: Partial<Record<DerivativeName, string>> = { Mw: 'FIXTURE AIRFRAME', Nv: 'FIXTURE AIRFRAME', Lv: 'ROTOR/AIRFRAME',
  Zw: 'ROTOR/INFLOW' };

describe('R18: the fixture\'s quasi-static 80 kt derivatives against AR-280 (harmonic inflow ON, the binding configuration)', () => {
  it('prints R18 with the harmonic inflow states on and off (the fitting rule\'s diagnostic line)', () => {
    const on = derivatives(), off = derivatives({ harmonicInflow: false });
    const line = (d: Derivatives) => Object.fromEntries([...ROWS, 'Lu', 'Lw', 'Lr', 'Mu', 'Mv', 'Mr', 'Np', 'Nq', 'Nw', 'Yv', 'Yr', 'Zu', 'Zq', 'Xw']
      .map((n) => [n, Number(value(d, n as DerivativeName).toFixed(4))]));
    report.R18 = { condition: { ktas: KTAS, densityAltitudeFt: 3000, massKg: 2200, nu: FIXTURE_NU, inertia: FIXTURE_INERTIA,
      lockNumberSL: lockNumber(), controlPhaseDeg: FIXTURE_CONTROL_PHASE / DEG }, inflowOn: line(on), inflowOff: line(off),
      envelope: Object.fromEntries(ROWS.filter((n) => !['Lq', 'Mp'].includes(n)).map((n) => [n, envelope(n)])),
      ratios: { LqOverLp: value(on, 'Lq') / -value(on, 'Lp'), MpOverMq: value(on, 'Mp') / -value(on, 'Mq') } };
    console.info(`R18 inflow ON  ${JSON.stringify(line(on))}`);
    console.info(`R18 inflow OFF ${JSON.stringify(line(off))}`);
    expect(Object.values(line(on)).every(Number.isFinite)).toBe(true);
  });
  for (const name of ROWS.filter((n) => !['Lq', 'Mp'].includes(n))) {
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
  it('Mw > 0: angle-of-attack unstable (P AR-280; the hingeless hub\'s signature)', () => {
    expect(value(derivatives(), 'Mw')).toBeGreaterThan(0);
  });
  it('rate cross-derivatives: Lq in [+1.5, +4.5] and Mp in [-1.6, -0.3] 1/s, with their signs', () => {
    const d = derivatives(), lq = value(d, 'Lq'), mp = value(d, 'Mp');
    expect(lq).toBeGreaterThan(1.5); expect(lq).toBeLessThan(4.5);
    expect(mp).toBeGreaterThan(-1.6); expect(mp).toBeLessThan(-0.3);
  });
  it('Mp/|Mq| -0.1 to -0.3 (AFDD, DLR)', () => {
    const d = derivatives(), mp = value(d, 'Mp') / -value(d, 'Mq');
    expect(mp).toBeGreaterThan(-0.3); expect(mp).toBeLessThan(-0.1);
  });
  it.fails('KNOWN MISS (ROTOR/INFLOW) — Lq/|Lp| 0.25-0.50 (AFDD; DLR 0.36)', () => {
    const d = derivatives(), lq = value(d, 'Lq') / -value(d, 'Lp');
    expect(lq >= 0.25 && lq <= 0.5, `Lq/|Lp| = ${lq}`).toBe(true);
  });
  it('the hub moment and the inflow, not the airframe, set the cross-derivatives: Lq rises from about 0.8 to 2.6 with the harmonic inflow', () => {
    const on = derivatives(), off = derivatives({ harmonicInflow: false });
    expect(value(on, 'Lq')).toBeGreaterThan(2 * value(off, 'Lq'));
    expect(Math.abs(value(on, 'Lp') / value(off, 'Lp') - 1)).toBeLessThan(0.05);
  });
  it('Lq and Mp with the calibrated control phase and with none agree within 10 % (the phase touches control only)', () => {
    const a = derivatives(), b = derivatives({ controlPhase: 0 });
    report.R18phase = { Lq: [value(a, 'Lq'), value(b, 'Lq')], Mp: [value(a, 'Mp'), value(b, 'Mp')] };
    expect(Math.abs(value(a, 'Lq') / value(b, 'Lq') - 1)).toBeLessThan(0.1);
    expect(Math.abs(value(a, 'Mp') / value(b, 'Mp') - 1)).toBeLessThan(0.1);
  });
  it('the calibrated control phase: off-axis moment ratios inside BO\'s bands and the least-squares optimum within 2 deg', () => {
    const ratios = (phase: number) => {
      const r = fixtureRig({ kt: KTAS, ft: 3000, hub: { controlPhase: phase } }), b = trimBody(r), rc = r.fm.rotorcraft!;
      const rho = r.env.atmosphere().density;
      const m = (ail: number, ele: number) => { const f = rc.settle(b, v3.zero(), rho, 1500, { ...r.c, aileron: r.c.aileron + ail,
        elevator: r.c.elevator + ele }); return { x: f.moment.x, y: f.moment.y }; };
      const lp = m(0.02, 0), lm = m(-0.02, 0), ep = m(0, 0.02), em = m(0, -0.02);
      return { lateral: (lp.y - lm.y) / (lp.x - lm.x), longitudinal: (ep.x - em.x) / (ep.y - em.y) };
    };
    // AR-280 Table 6.2.11 (P): M_lat Iyy / (L_lat Ixx) and L_lon Ixx / (M_lon Iyy), DLR and AFDD, and their means.
    const I = { Ixx: 1433, Iyy: 4973 };
    const target = { lateral: (AR280_DLR.M[8] * I.Iyy / (AR280_DLR.L[8] * I.Ixx) + AR280_AFDD.M[8] * I.Iyy / (AR280_AFDD.L[8] * I.Ixx)) / 2,
      longitudinal: (AR280_DLR.L[7] * I.Ixx / (AR280_DLR.M[7] * I.Iyy) + AR280_AFDD.L[7] * I.Ixx / (AR280_AFDD.M[7] * I.Iyy)) / 2 };
    const grid = Array.from({ length: 21 }, (_, i) => 20 + i).map((deg) => {
      const r = ratios(deg * DEG);
      return { deg, ...r, cost: (r.lateral - target.lateral) ** 2 + (r.longitudinal - target.longitudinal) ** 2 };
    });
    const best = grid.reduce((a, b) => (b.cost < a.cost ? b : a)), chosen = ratios(FIXTURE_CONTROL_PHASE);
    report.controlPhase = { target, chosenDeg: FIXTURE_CONTROL_PHASE / DEG, chosen, bestDeg: best.deg, grid };
    expect(Math.abs(best.deg - FIXTURE_CONTROL_PHASE / DEG)).toBeLessThanOrEqual(2);
    expect(Math.abs(chosen.lateral)).toBeLessThan(0.25); expect(Math.abs(chosen.longitudinal)).toBeLessThan(0.3);
  }, 60_000);
});

describe('R18 reporting: what sets the misses (informational, docs/rotor-hingeless-model.md)', () => {
  it('component decomposition of Mw, Lv, Nv and the (nu, inertia) grid of the rotor rows', () => {
    const at = (o: Parameters<typeof fixtureRig>[0]) => quasiStaticDerivatives(fixtureRig({ kt: KTAS, ft: 3000, ...o }));
    const stab = (o: Parameters<typeof fixtureRig>[0]) => ({ ...o, airframe: { ...o?.airframe } });
    const base = derivatives();
    const fixture = fixtureRig({ kt: KTAS, ft: 3000 }).def.rotorcraft!;
    const noStab = at(stab({ airframe: { stabilizer: { ...fixture.stabilizer, area: 0 } } }));
    const noFins = at({ airframe: { fins: [] } });
    const rotorOnly = at({ airframe: { stabilizer: { ...fixture.stabilizer, area: 0 }, fins: [], fuselageMoment: { pitch: 0, yaw: 0 } } });
    const pick = (d: Derivatives) => ({ Mw: value(d, 'Mw'), Lv: value(d, 'Lv'), Nv: value(d, 'Nv'), Mu: value(d, 'Mu') });
    const grid: Record<string, number>[] = [];
    for (const inertia of [850, 900, 950]) for (const nu of [1.10, 1.11, 1.12]) {
      const d = at({ inertia, hub: { flapFrequency: nu } });
      const x = modes(eigenvalues(linearModel({ u0: d.u0, w0: d.w0, theta0: d.theta0, ...d.rows })));
      const phugoid = x.oscillations.find((o) => o.omega < 1)!;
      grid.push({ inertia, nu, gammaSL: lockNumber(inertia), Lp: value(d, 'Lp'), Mq: value(d, 'Mq'), Lq: value(d, 'Lq'), Mp: value(d, 'Mp'),
        LqOverLp: value(d, 'Lq') / -value(d, 'Lp'), Mw: value(d, 'Mw'), roll: Math.max(...x.subsidences), phugoidZeta: phugoid.zeta });
    }
    report.decomposition = { fixture: pick(base), noStabiliser: pick(noStab), noFins: pick(noFins), rotorAndTailRotorOnly: pick(rotorOnly) };
    report.grid = grid;
    expect(value(rotorOnly, 'Mw')).toBeGreaterThan(0);
  }, 60_000);
});

describe('R19: the fixture\'s modes (8-state linear model of the R18 derivatives) against AR-280 Table 6.2.13', () => {
  const m = () => {
    const d = derivatives();
    return modes(eigenvalues(linearModel({ u0: d.u0, w0: d.w0, theta0: d.theta0, ...d.rows })));
  };
  it('roll mode 1/T 8.49 1/s +/-30 %', () => {
    const x = m(), roll = Math.max(...x.subsidences);
    report.R19 = x;
    expect(roll).toBeGreaterThan(AR280_MODES.DLR.roll * 0.7); expect(roll).toBeLessThan(AR280_MODES.DLR.roll * 1.3);
  });
  it('Dutch roll 2.5 rad/s +/-30 %, zeta 0.05-0.30', () => {
    const dutch = m().oscillations.find((o) => o.omega > 1)!;
    expect(dutch.omega).toBeGreaterThan(2.5 * 0.7); expect(dutch.omega).toBeLessThan(2.5 * 1.3);
    expect(dutch.zeta).toBeGreaterThan(0.05); expect(dutch.zeta).toBeLessThan(0.3);
  });
  it('phugoid period 12-30 s', () => {
    const phugoid = m().oscillations.find((o) => o.omega < 1)!, period = 2 * Math.PI / (phugoid.omega * Math.sqrt(1 - phugoid.zeta ** 2));
    expect(period).toBeGreaterThan(12); expect(period).toBeLessThan(30);
  });
  it.fails('KNOWN MISS (FIXTURE AIRFRAME: Mw) — phugoid unstable (DLR zeta -0.15)', () => {
    const phugoid = m().oscillations.find((o) => o.omega < 1)!;
    expect(phugoid.zeta < 0, `phugoid zeta ${phugoid.zeta}`).toBe(true);
  });
});
