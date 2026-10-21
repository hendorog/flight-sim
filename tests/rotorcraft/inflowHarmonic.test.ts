// First-harmonic (Pitt-Peters) inflow (plan revision 2, section 4 item 3; NASA TM-102219 eqs 13b, 14, 18, P): R9-R11
// and the sign check that the inflow gradient opposes the lift moment. RC_TRACE=<dir>/inflowHarmonic.json.
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, v3 } from '../../src/core/math';
import { swashplateCyclic } from '../../src/physics/rotorcraft/swashplate';
import { advanceHarmonicInflow, HARMONIC_APPARENT_MASS, harmonicInflowGains, harmonicInflowTarget } from '../../src/physics/rotorcraft/inflowHarmonic';
import { fixtureRig, traceReport, trimBody } from './hingelessFixture';

const report: Record<string, unknown> = {};
afterAll(() => traceReport('inflowHarmonic', report));

const omega = 44.45, radius = 4.92, density = 1.225, tip = omega * radius;
/** Momentum-consistent uniform inflow for a thrust coefficient at advance ratio mu (no free-stream flow through the disc). */
function momentum(ct: number, mu: number): number {
  let v = Math.sqrt(ct / 2);
  for (let i = 0; i < 200; i++) v = 0.5 * v + 0.5 * ct / (2 * Math.hypot(mu, v));
  return v;
}

describe('Pitt-Peters gains (TM-102219 eq 13b)', () => {
  it('hover: both harmonic gains are 1/v0 (eq 15) and there is no thrust coupling', () => {
    const g = harmonicInflowGains(0, 0.05, 0.05);
    expect(g.crosswind).toBeCloseTo(1 / 0.05, 9); expect(g.downwind).toBeCloseTo(1 / 0.05, 9); expect(g.thrust).toBe(0);
    expect(g.massFlow).toBeCloseTo(0.1, 12);
  });
  it('edgewise (chi 90 deg): crosswind 4/vm, downwind 0, thrust 15 pi/(64 vT)', () => {
    const g = harmonicInflowGains(0.3, 1e-9, 0);
    expect(g.skew).toBeCloseTo(Math.PI / 2, 6);
    expect(g.crosswind).toBeCloseTo(4 / 0.3, 6); expect(g.downwind).toBeCloseTo(0, 6);
    expect(g.thrust).toBeCloseTo(15 * Math.PI / (64 * 0.3), 6);
  });
});

describe('R9: steady forward flight, zero hub moment', () => {
  it('mu 0.2: the downwind gradient over the momentum v0 is (15 pi/32) tan(chi/2) within 5 %; more downwash at the REAR of the disc', () => {
    const ct = 0.005, mu = 0.2, v0 = momentum(ct, mu);
    const t = harmonicInflowTarget({ omega, radius, density, inPlane: { x: mu * tip, y: 0 }, through: v0 * tip, induced: v0 * tip,
      thrust: ct * density * Math.PI * radius ** 2 * tip * tip, moment: { x: 0, y: 0 } });
    const chi = Math.atan2(mu, v0), expected = 15 * Math.PI / 32 * Math.tan(chi / 2);
    // The state is in the solver's azimuth (psi = 0 FORWARD): the extra downwash at the point r e is (r/R) g . e with
    // g = (cos, -sin). Front of the disc e = (1, 0), rear e = (-1, 0).
    const front = t.cos, rear = -t.cos, ratio = (rear / tip) / v0;
    report.R9 = { mu, v0, chiDeg: chi / DEG, ratio, expected, frontMs: front, rearMs: rear, lateralMs: t.sin };
    expect(Math.abs(ratio / expected - 1)).toBeLessThan(0.05);
    expect(rear).toBeGreaterThan(front);
    expect(Math.abs(t.sin)).toBeLessThan(1e-12);
  });
  it('the gradient follows the wind: flying sideways to the right puts it across the disc (more downwash on the LEFT)', () => {
    const ct = 0.005, mu = 0.2, v0 = momentum(ct, mu);
    const t = harmonicInflowTarget({ omega, radius, density, inPlane: { x: 0, y: mu * tip }, through: v0 * tip, induced: v0 * tip,
      thrust: ct * density * Math.PI * radius ** 2 * tip * tip, moment: { x: 0, y: 0 } });
    // Left point e = (0, -1): extra downwash (r/R)(g . e) = -g.y = sin.
    expect(t.sin).toBeGreaterThan(0); expect(Math.abs(t.cos)).toBeLessThan(1e-9);
  });
  it('the fixture at 80 KCAS, 3000 ft, trimmed: induced velocity larger at the rear than at the front, in body axes', () => {
    const r = fixtureRig({ kt: 80 * Math.sqrt(1.225 / 1.1209), ft: 3000 });
    const h = r.fm.state.rotorcraft!.harmonicInflow!, tilt = r.def.rotorcraft!.shaftTilt ?? 0;
    // Body-axis front and rear tips of the disc (shaft tilt is small; the gradient is in the shaft plane).
    const front = h.cos, rear = -h.cos;
    report.R9fixture = { cosMs: h.cos, sinMs: h.sin, frontTipMs: front, rearTipMs: rear, shaftTiltDeg: tilt / DEG };
    expect(rear).toBeGreaterThan(front);
  });
});

describe('R10: hover time constant to an imposed hub moment', () => {
  it('apparent mass 16/(45 pi): tau = 16/(45 pi) / (v0 Omega) within 5 %, steady gradient M / (rho pi R^3 v0)', () => {
    const v0 = 0.05, moment = { x: 2000, y: 0 }, dt = 1e-4;
    const input = { omega, radius, density, inPlane: { x: 0, y: 0 }, through: v0 * tip, induced: v0 * tip, thrust: 0, moment };
    const steady = harmonicInflowTarget(input);
    let s = { cos: 0, sin: 0 }, t = 0;
    while (Math.abs(s.sin) < (1 - Math.exp(-1)) * Math.abs(steady.sin)) { s = advanceHarmonicInflow(s, dt, input); t += dt; }
    const expected = HARMONIC_APPARENT_MASS / (v0 * omega);
    // Roll moment right (+x) means more lift on the LEFT: the left point e = (0, -1) gets more downwash, sin > 0.
    const gradient = moment.x / (density * Math.PI * radius ** 3 * v0 * tip);
    report.R10 = { tauS: t, expectedS: expected, steadySinMs: steady.sin, expectedSinMs: gradient };
    expect(Math.abs(t / expected - 1)).toBeLessThan(0.05);
    expect(steady.sin / gradient).toBeCloseTo(1, 9);
  });
});

/** Settled steady hover response to a +/- lateral cyclic step, body held: shaft-frame moment differences. */
function hoverStep(inflow: boolean) {
  const r = fixtureRig({ kt: 0, hub: { harmonicInflow: inflow, controlPhase: 0 } }), b = trimBody(r), rc = r.fm.rotorcraft!;
  const rho = r.env.atmosphere().density;
  const at = (sign: number) => rc.settle(b, v3.zero(), rho, 1500, { ...r.c, aileron: r.c.aileron + sign * 0.05 }).moment;
  const p = { ...at(1) }, m = { ...at(-1) };
  return { mx: p.x - m.x, my: p.y - m.y };
}

describe('the inflow gradient opposes the lift moment (sign check)', () => {
  it('hover hub moment per unit lateral cyclic is smaller with harmonic inflow ON than OFF', () => {
    const off = hoverStep(false), on = hoverStep(true);
    const ratio = Math.hypot(on.mx, on.my) / Math.hypot(off.mx, off.my);
    // D: the steady aerodynamic moment of a hingeless rotor is the hub moment (nu^2 - 1)/(gamma/8) of the cyclic's
    // pitch moment, about 0.34 here; the gradient a sigma / (16 v0) x 0.34 opposes it 70 deg behind the cyclic: on-axis
    // about -13 %, magnitude about -6 %, and the response turns about 9 deg against the rotation.
    report.signCheck = { offRoll: off.mx, offPitch: off.my, onRoll: on.mx, onPitch: on.my, magnitudeRatio: ratio, onAxisRatio: on.mx / off.mx };
    expect(on.mx).toBeLessThan(off.mx);
    expect(ratio).toBeLessThan(1);
  });
});

describe('the inflow gradient opposes the lift moment at 80 KCAS too (wind axes)', () => {
  it('a right lateral cyclic step: more downwash on the LEFT (the lifted side) and a smaller on-axis roll moment than with the inflow off', () => {
    const ktas = 80 * Math.sqrt(1.225 / 1.12094);
    const step = (inflow: boolean) => {
      const r = fixtureRig({ kt: ktas, ft: 3000, hub: { harmonicInflow: inflow, controlPhase: 0 } }), b = trimBody(r), rc = r.fm.rotorcraft!;
      const rho = r.env.atmosphere().density;
      const at = (sign: number) => { const f = rc.settle(b, v3.zero(), rho, 1500, { ...r.c, aileron: r.c.aileron + sign * 0.02 });
        return { mx: f.moment.x, my: f.moment.y, sin: rc.state.harmonicInflow?.sin ?? 0 }; };
      const p = at(1), m = at(-1);
      return { mx: p.mx - m.mx, my: p.my - m.my, sin: p.sin - m.sin };
    };
    const off = step(false), on = step(true);
    report.signCheck80 = { off, on, onAxisRatio: on.mx / off.mx, magnitudeRatio: Math.hypot(on.mx, on.my) / Math.hypot(off.mx, off.my) };
    expect(on.sin).toBeGreaterThan(0);
    expect(on.mx).toBeLessThan(off.mx);
  });
});

describe('R11: transverse-flow roll', () => {
  it('lateral cyclic trim 0-40 KIAS: the harmonic inflow adds a LEFT excursion of 0.5-3.0 deg peaking at 10-30 KIAS', () => {
    // The swashplate's lateral cyclic (blade degrees, after the control phase): the trim with the harmonic inflow minus
    // the trim without it isolates the transverse-flow effect from the tail rotor and attitude terms.
    const rows: { kt: number; onDeg: number; offDeg: number; extraLeftDeg: number }[] = [];
    for (let kt = 0; kt <= 40; kt += 5) {
      const on = fixtureRig({ kt }), off = fixtureRig({ kt, hub: { harmonicInflow: false } });
      const lateral = (r: typeof on) => swashplateCyclic(r.def.rotorcraft!, r.c).right / DEG;
      rows.push({ kt, onDeg: lateral(on), offDeg: lateral(off), extraLeftDeg: lateral(off) - lateral(on) });
      expect(on.fm.lastTrim!.converged && off.fm.lastTrim!.converged).toBe(true);
    }
    const peak = rows.reduce((a, b) => (b.extraLeftDeg > a.extraLeftDeg ? b : a));
    report.R11 = { rows, peakKt: peak.kt, peakDeg: peak.extraLeftDeg };
    // The plan's physical content, not the grid argmax (measured 1.66 deg at 30 KIAS, 1.54 at 40: the argmax sits on the
    // band's upper edge, so a small airframe or tail-rotor change could move it to 35 KIAS for a non-rotor reason): an
    // extra left excursion of 0.5-3.0 deg somewhere in 10-30 KIAS, never more than 3.0 deg, falling off by 40 KIAS.
    const band = rows.filter((r) => r.kt >= 10 && r.kt <= 30), inBand = Math.max(...band.map((r) => r.extraLeftDeg));
    const at40 = rows.find((r) => r.kt === 40)!.extraLeftDeg;
    expect(inBand).toBeGreaterThan(0.5); expect(peak.extraLeftDeg).toBeLessThan(3.0);
    expect(at40).toBeLessThan(inBand);
  }, 60_000);
});
