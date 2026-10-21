// Hingeless rotor core (plan revision 2, section 4): rate convergence (R15), the coupled roll/flap mode identified by
// the matrix pencil (R20, src/physics/identification/matrixPencil.ts, read-only) and the control-gyro coupling wiring
// (R21). RC_TRACE=<dir>/hingelessCoupling.json.
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, KT, v3, type Vec3 } from '../../src/core/math';
import type { ControlInputs } from '../../src/core/types';
import { matrixPencil } from '../../src/physics/identification/matrixPencil';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { advanceFlap, flapSystem, hubForcing } from '../../src/physics/rotorcraft/articulated';
import { hingelessBlade, hingelessSpring } from '../../src/physics/rotorcraft/hingeless';
import { cyclicAngles, type RotorcraftDefinition } from '../../src/physics/rotorcraft/definition';
import type { ControlGyroDef, FlapSystem, GyroBladeMoments } from '../../src/physics/rotorcraft/controlGyro';
import { LS178_ROLL_FLAP } from './ar280';
import { DT, fixtureRig, fixtureRotorcraft, run, traceReport, trimBody } from './hingelessFixture';

const report: Record<string, unknown> = {};
afterAll(() => traceReport('hingelessCoupling', report));

describe('R15: rate convergence', () => {
  it('fixture hover roll rate 0.5 s after a 0.2 lateral step is the same at 240, 480 and 960 Hz within 2 %', () => {
    const rates = [240, 480, 960].map((hz) => {
      const r = fixtureRig({ kt: 0, physicsRate: hz });
      r.c.aileron += 0.2;
      run(r, 0.5, undefined, 1 / hz);
      return r.fm.state.angularVelocity.x / DEG;
    });
    report.R15 = { hz: [240, 480, 960], rollRateDegS: rates };
    expect(Math.abs(rates[0] / rates[2] - 1)).toBeLessThan(0.02);
    expect(Math.abs(rates[1] / rates[2] - 1)).toBeLessThan(0.02);
  });
});

describe('R20: the coupled body-roll / rotor-flap mode (P AGARD LS-178 paper 14: zeta 0.51, 13.7 rad/s at 40 m/s)', () => {
  it('matrix pencil of the roll rate after a 0.1 s lateral pulse at 78 KIAS: 13.7 rad/s +/-30 %, zeta 0.3-0.7', () => {
    // Two identically trimmed aircraft remove the trim drift; only one gets the pulse (the R22 experiment's method,
    // matrixPencil.test.ts). Samples every step from the pulse's end for 0.6 s: the fast mode's free response.
    const kt = 78, base = fixtureRig({ kt }), excited = fixtureRig({ kt });
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
    report.R20 = { omega, zeta, poles: result.continuousPoles, retainedEnergy: result.retainedEnergy,
      recurrenceError: result.recurrenceError, peakRollRateDegS: Math.max(...samples.map(Math.abs)) / DEG, kias: excited.fm.state.ias / KT };
    expect(Math.abs(pole.im)).toBeGreaterThan(0);
    expect(omega).toBeGreaterThan(LS178_ROLL_FLAP.omega * 0.7); expect(omega).toBeLessThan(LS178_ROLL_FLAP.omega * 1.3);
    expect(zeta).toBeGreaterThan(0.3); expect(zeta).toBeLessThan(0.7);
  });
});

// ------------------------------------------------------------------------------------------------ R21 gyro wiring
/** e^(A t) of a real 2x2 matrix (row-major), closed form. */
function expm2(a: readonly number[], t: number): number[] {
  const tr = (a[0] + a[3]) / 2, det = a[0] * a[3] - a[1] * a[2], disc = tr * tr - det;
  const e = Math.exp(tr * t), s = Math.sqrt(Math.abs(disc));
  const [c, k] = disc > 0 ? [Math.cosh(s * t), s > 0 ? Math.sinh(s * t) / s : t] : [Math.cos(s * t), s > 0 ? Math.sin(s * t) / s : t];
  return [e * (c + k * (a[0] - tr)), e * k * a[1], e * k * a[2], e * (c + k * (a[3] - tr))];
}
/** A test-local control gyro with zero coupling and zero cyclic: it steps the flap system's own 2x2 exactly. */
class ZeroCouplingGyro {
  readonly h: Vec3 = v3.zero();
  calls = 0;
  constructor(readonly def: RotorcraftDefinition) {}
  config() { return this.def.controlGyro!.configs.amcs; }
  reset(): void {}
  seed(): void {}
  cyclic(c: ControlInputs) { return cyclicAngles(this.def, c); }
  advanceCoupled(dt: number, _c: ControlInputs, _rate: Vec3, sys: FlapSystem, flap: { cosine: number; sine: number },
    _blade?: GyroBladeMoments): { cosine: number; sine: number } {
    this.calls++;
    // x(t + dt) = e^(A dt) x + A^-1 (e^(A dt) - I) f   (theta = theta0: no gyro coupling)
    const E = expm2(sys.a, dt), a = sys.a, det = a[0] * a[3] - a[1] * a[2];
    const m = [E[0] - 1, E[1], E[2], E[3] - 1];
    const y = [m[0] * sys.f[0] + m[1] * sys.f[1], m[2] * sys.f[0] + m[3] * sys.f[1]];
    const z = [(a[3] * y[0] - a[1] * y[1]) / det, (-a[2] * y[0] + a[0] * y[1]) / det];
    return { cosine: E[0] * flap.cosine + E[1] * flap.sine + z[0], sine: E[2] * flap.cosine + E[3] * flap.sine + z[1] };
  }
}

describe('R21: the control-gyro coupling wiring', () => {
  it('a zero-coupling test gyro reproduces advanceFlap\'s harmonics through the Rotorcraft to 1e-12 (compute and settle)', () => {
    const base = fixtureRotorcraft({ hub: { harmonicInflow: false } });
    // The gyro type must not have a control phase (consistency); its cyclic is the stick law (zero coupling).
    const gyroDef = { default: 'amcs', configs: { amcs: { nominalRpmFraction: 1 }, ics: { nominalRpmFraction: 1 } } } as unknown as ControlGyroDef;
    const withGyro: RotorcraftDefinition = { ...base, controlGyro: gyroDef, hubModel: { ...base.hubModel!, controlPhase: undefined } as RotorcraftDefinition['hubModel'] };
    const plain: RotorcraftDefinition = { ...base, hubModel: { ...base.hubModel!, controlPhase: undefined } as RotorcraftDefinition['hubModel'] };
    const r = fixtureRig({ kt: 60 }), b = trimBody(r), rho = r.env.atmosphere().density, c = { ...r.c, aileron: r.c.aileron + 0.1 };
    const a = new Rotorcraft(plain), g = new Rotorcraft(withGyro), gyro = new ZeroCouplingGyro(withGyro);
    (g as unknown as { gyro: ZeroCouplingGyro }).gyro = gyro;
    a.reset(true); g.reset(true);
    let worst = 0;
    const compare = () => {
      for (const k of ['flapForward', 'flapRight', 'coning'] as const)
        worst = Math.max(worst, Math.abs(a.state[k] - g.state[k]) / Math.max(Math.abs(a.state[k]), 1e-6));
    };
    a.settle(b, v3.zero(), rho, 1500, c); g.settle(b, v3.zero(), rho, 1500, c); compare();
    const settleCalls = gyro.calls;
    b.angularVelocity = { x: 0.2, y: -0.1, z: 0.05 };
    for (let i = 0; i < 240; i++) { a.compute(b, v3.zero(), rho, 1500, c, DT); g.compute(b, v3.zero(), rho, 1500, c, DT); compare(); }
    report.R21 = { worstRelative: worst, settleCalls, computeCalls: gyro.calls - settleCalls };
    expect(settleCalls).toBe(160); expect(gyro.calls - settleCalls).toBe(240);
    expect(worst).toBeLessThan(1e-12);
  });
  it('flapSystem is the same exact 2x2 step as advanceFlap (unit), carries b = P^-1 dM/dtheta and the hub map', () => {
    const def = fixtureRotorcraft(), blade = hingelessBlade(def), p = { flapOffset: 0.59, lagOffset: 0.59, blade };
    const spring = { stiffness: hingelessSpring(def), precone: 2.5 * DEG };
    const air = { x: 40, y: 3, z: 1 }, rate = { x: 0.1, y: 0.2, z: 0.3 }, theta: [number, number] = [0.02, -0.03];
    const f = hubForcing(def.main, p, 44.45, 1.2, 0.14, theta[0], theta[1], air, 6, rate, 1, { jacobian: true });
    const springNow = { ...spring, aerodynamic: f.stiffness };
    const sys = flapSystem(p, 44.45, f, 1, rate.z, theta, 4, springNow)!;
    const previous = { cone: 0.04, cosine: 0.01, sine: -0.02 };
    const step = advanceFlap(p, 44.45, f, previous, 1, DT, rate.z, springNow);
    const gyro = new ZeroCouplingGyro(def).advanceCoupled(DT, {} as ControlInputs, v3.zero(), sys, previous);
    expect(Math.abs(gyro.cosine - step.cosine)).toBeLessThan(1e-12 * Math.abs(step.cosine));
    expect(Math.abs(gyro.sine - step.sine)).toBeLessThan(1e-12 * Math.abs(step.sine));
    // b: a cyclic change moves the forcing exactly by J dtheta (the forcing is linear in cyclic).
    const d = 1e-3, g2 = hubForcing(def.main, p, 44.45, 1.2, 0.14, theta[0] + d, theta[1], air, 6, rate, 1, { jacobian: true });
    const sys2 = flapSystem(p, 44.45, g2, 1, rate.z, [theta[0] + d, theta[1]], 4, springNow)!;
    expect((sys2.f[0] - sys.f[0]) / d).toBeCloseTo(sys.b[0], 6); expect((sys2.f[1] - sys.f[1]) / d).toBeCloseTo(sys.b[2], 6);
    // hub: [Mx, My] = hub . [cosine, sine] = hingeMoment.
    const k = 2 * (0.59 * blade.flapFirst * 44.45 ** 2 + spring.stiffness);
    expect(sys.hub).toEqual([0, k, k, 0]);
    // A stopped rotor has no reduction: null (the caller keeps the static spring solution).
    expect(flapSystem(p, 0, f, 1, 0, theta, 4, springNow)).toBeNull();
  });
});
