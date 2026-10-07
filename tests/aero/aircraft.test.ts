// Whole-aircraft checks of the C172 blade-element model. Nothing here is fitted: every number emerges
// from the geometry and section data. Reference values: C172S POH, Roskam "Airplane Flight Dynamics"
// appendix B (Cessna 172, cruise), and classical estimates (DATCOM) where noted.

import { beforeAll, describe, expect, it } from 'vitest';
import { C172 } from '../../src/core/c172';
import { DEG, KT } from '../../src/core/math';
import { AeroModel } from '../../src/physics/aero';
import { atmosphereAt, casFromTas } from '../../src/physics/atmosphere';
import type { Slipstream } from '../../src/physics/interfaces';
import { coefficients, makeInput, trimmed, type Condition } from './helpers';

const S = C172.wing.area;
const W = C172.mass.maxTakeoff * 9.80665;
const SL = atmosphereAt(0);

/** Report of the headline numbers, printed once at the end of the run. */
const report: Record<string, string> = {};
const note = (k: string, v: number, digits = 3) => (report[k] = v.toFixed(digits));

let model: AeroModel;
beforeAll(() => {
  model = new AeroModel(undefined, { quasiSteady: true });
});

/** Trimmed maximum lift coefficient with the elevator inside its travel, at 1 deg steps. */
function trimmedClmax(flaps: number): { CL: number; alpha: number } {
  let best = { CL: 0, alpha: 0 };
  for (let a = 4; a <= 22; a += 0.5) {
    const t = trimmed(model, { V: 28, alphaDeg: a, altitude: 0, surfaces: { flaps } });
    if (t && t.CL > best.CL) best = { CL: t.CL, alpha: a };
  }
  return best;
}

/** Calibrated airspeed at which the trimmed aircraft at max weight flies at a given CL (sea level). */
const kcasFor = (CL: number) => casFromTas(Math.sqrt((2 * W) / (SL.density * S * CL)), SL) / KT;

describe('longitudinal', () => {
  it('lift-curve slope ~4.6-5.5 per rad (Roskam 4.6; DATCOM wing-body-tail estimate 5.2)', () => {
    const a = coefficients(model, { V: 55, alphaDeg: 0 });
    const b = coefficients(model, { V: 55, alphaDeg: 6 });
    const slope = (b.CL - a.CL) / (6 * DEG);
    note('CL_alpha (1/rad)', slope);
    expect(slope).toBeGreaterThan(4.5);
    expect(slope).toBeLessThan(5.6);
  });

  it('is statically stable with the CG at the reference point', () => {
    const a = coefficients(model, { V: 55, alphaDeg: 0 });
    const b = coefficients(model, { V: 55, alphaDeg: 6 });
    const cma = (b.Cm - a.Cm) / (6 * DEG);
    const cla = (b.CL - a.CL) / (6 * DEG);
    note('Cm_alpha (1/rad)', cma);
    note('static margin (MAC)', -cma / cla);
    expect(cma).toBeLessThan(-0.6);
    expect(-cma / cla).toBeGreaterThan(0.1);
    expect(-cma / cla).toBeLessThan(0.4);
    // Moving the CG aft by 0.3 MAC must reduce the margin by ~0.3 MAC (moments are about the actual CG).
    const cg = { x: -0.3 * C172.wing.meanChord, y: 0, z: 0 };
    const a2 = coefficients(model, { V: 55, alphaDeg: 0, cgOffset: cg });
    const b2 = coefficients(model, { V: 55, alphaDeg: 6, cgOffset: cg });
    const sm2 = -(b2.Cm - a2.Cm) / (b2.CL - a2.CL);
    expect(sm2).toBeCloseTo(-cma / cla - 0.3, 1);
  });

  it('trims in cruise with a small elevator deflection and has the pitch damping of a conventional tail', () => {
    const cruise = trimmed(model, { V: 110 * KT, alphaDeg: 1.5, altitude: 0 });
    expect(cruise).not.toBeNull();
    note('cruise trim elevator at alpha 1.5 (deg)', cruise!.elevator / DEG, 1);
    expect(Math.abs(cruise!.elevator)).toBeLessThan(5 * DEG);
    const V = 55;
    const q = 0.1;
    const base = coefficients(model, { V, alphaDeg: 2 });
    const pitching = coefficients(model, { V, alphaDeg: 2, q });
    const cmq = (pitching.Cm - base.Cm) / ((q * C172.wing.meanChord) / (2 * V));
    note('Cm_q', cmq, 1);
    expect(cmq).toBeLessThan(-8);
    expect(cmq).toBeGreaterThan(-25);
    const elev = coefficients(model, { V, alphaDeg: 2, surfaces: { elevator: 5 * DEG } });
    const cmde = (elev.Cm - base.Cm) / (5 * DEG);
    note('Cm_de (1/rad)', cmde);
    expect(cmde).toBeLessThan(-1.0);
    expect(cmde).toBeGreaterThan(-2.2);
  });

  // At the reference CG the clean stall is reached with the elevator almost at its stop, so the trimmed
  // clean value is elevator-limited; the untrimmed value shows the wing-body capability.
  it('CLmax clean ~1.45-1.6 and full flap ~1.85-2.1 (POH stall speeds 53 / 48 KCAS at max weight imply 1.54 / 1.88)', () => {
    const clean = trimmedClmax(0);
    const full = trimmedClmax(30 * DEG);
    note('CLmax clean (trimmed)', clean.CL);
    note('CLmax flaps 30 (trimmed)', full.CL);
    note('stall KCAS clean (max weight, SL)', kcasFor(clean.CL), 1);
    note('stall KCAS flaps 30 (max weight, SL)', kcasFor(full.CL), 1);
    // At the reference (forward-limit) CG full up elevator ends the clean stall just short of the wing's
    // own maximum: tests/fdm/stall.test.ts flies it.
    expect(clean.CL).toBeGreaterThan(1.35);
    expect(clean.CL).toBeLessThan(1.65);
    // With full flap the slotted flap's nose-down moment (its load centred near mid-chord, NACA TR 664) also
    // makes the trimmed value elevator-limited at this CG: ~1.78 (49.4 KCAS, +3 % on the POH).
    expect(full.CL).toBeGreaterThan(1.75);
    expect(full.CL).toBeLessThan(2.15);
    let untrimmed = 0;
    for (let a = 10; a <= 24; a += 0.5) untrimmed = Math.max(untrimmed, coefficients(model, { V: 28, alphaDeg: a }).CL);
    note('CLmax clean (elevator neutral)', untrimmed);
    expect(untrimmed).toBeGreaterThan(1.5);
    expect(untrimmed).toBeLessThan(1.8);
  });

  // CD0 is set by the whole-aircraft POH validation (tests/fdm/performance.test.ts: maximum speed, 75 %
  // cruise at 8000 ft, Vy climb and glide all agree on ~0.035 with the real powerplant).
  it('drag polar: CD0 0.033-0.037 and Oswald e 0.75-0.84 (trimmed, 107 KTAS)', () => {
    const cl: number[] = [];
    const cd: number[] = [];
    for (let a = -1; a <= 8; a += 1) {
      const t = trimmed(model, { V: 55, alphaDeg: a, altitude: 0 })!;
      cl.push(t.CL * t.CL);
      cd.push(t.CD);
    }
    const n = cl.length;
    const mx = cl.reduce((s, x) => s + x, 0) / n;
    const my = cd.reduce((s, x) => s + x, 0) / n;
    const k = cl.reduce((s, x, i) => s + (x - mx) * (cd[i] - my), 0) / cl.reduce((s, x) => s + (x - mx) ** 2, 0);
    const cd0 = my - k * mx;
    const e = 1 / (Math.PI * ((C172.wing.span * C172.wing.span) / S) * k);
    note('CD0', cd0, 4);
    note('Oswald e', e);
    expect(cd0).toBeGreaterThan(0.033);
    expect(cd0).toBeLessThan(0.037);
    expect(e).toBeGreaterThan(0.74);
    expect(e).toBeLessThan(0.84);
  });

  it('best glide: L/D ~9-10 near 65-70 KIAS power-off', () => {
    // Power-off includes the idling propeller, which belongs to the propulsion model. Allowance: a
    // windmilling fixed-pitch propeller has C_D ~ 0.08 on its disc area (Hoerner, Fluid-Dynamic Drag
    // 13-3), i.e. an equivalent flat-plate area of ~0.23 m^2.
    const propArea = 0.08 * Math.PI * (C172.prop.diameter / 2) ** 2;
    let best = { ld: 0, kias: 0, ldAero: 0, kiasAero: 0 };
    for (let a = 2; a <= 12; a += 0.5) {
      const t = trimmed(model, { V: 36, alphaDeg: a, altitude: 0 })!;
      const kias = kcasFor(t.CL);
      const ld = t.CL / (t.CD + propArea / S);
      const ldAero = t.CL / t.CD;
      if (ld > best.ld) best = { ...best, ld, kias };
      if (ldAero > best.ldAero) best = { ...best, ldAero, kiasAero: kias };
    }
    note('best L/D power-off (with idle-prop allowance)', best.ld, 2);
    note('best glide KIAS', best.kias, 1);
    note('best L/D airframe only', best.ldAero, 2);
    note('best L/D airframe only, KIAS', best.kiasAero, 1);
    expect(best.ld).toBeGreaterThan(9);
    expect(best.ld).toBeLessThan(10.5);
    expect(best.kias).toBeGreaterThan(62);
    expect(best.kias).toBeLessThan(74);
  });

  it('stalls at the root first (washout)', () => {
    let firstStalled: { span: number; alpha: number } | null = null;
    for (let a = 10; a <= 24 && !firstStalled; a += 0.25) {
      coefficients(model, { V: 28, alphaDeg: a, surfaces: { elevator: -15 * DEG } });
      const stalled = model.diagnostics.filter((d) => d.surface === 'wing' && d.stalled);
      if (stalled.length) {
        firstStalled = { span: Math.min(...stalled.map((d) => Math.abs(d.position.y))), alpha: a };
        const tips = model.diagnostics.filter((d) => d.surface === 'wing' && Math.abs(d.position.y) > 4);
        expect(tips.every((d) => !d.stalled)).toBe(true);
      }
    }
    expect(firstStalled).not.toBeNull();
    note('first stall: span of strip (m)', firstStalled!.span, 2);
    note('first stall: body alpha (deg)', firstStalled!.alpha, 2);
    expect(firstStalled!.span).toBeLessThan(2);
  });

  it('sounds the stall warning 5-10 kt above the stall, clean and with full flap', () => {
    for (const flaps of [0, 30 * DEG]) {
      const stall = trimmedClmax(flaps);
      let warnCL = 0;
      for (let a = 4; a <= stall.alpha; a += 0.25) {
        const t = trimmed(model, { V: 28, alphaDeg: a, altitude: 0, surfaces: { flaps } });
        if (t && t.out.stallWarning) {
          warnCL = t.CL;
          break;
        }
      }
      expect(warnCL).toBeGreaterThan(0);
      const margin = kcasFor(warnCL) - kcasFor(stall.CL);
      note(`stall warning margin flaps ${Math.round(flaps / DEG)} (kt)`, margin, 1);
      expect(margin).toBeGreaterThan(5);
      expect(margin).toBeLessThan(10);
    }
  });

  it('shows ground effect: more lift, less drag and a nose-down change near the runway', () => {
    const free = coefficients(model, { V: 30, alphaDeg: 5, heightAGL: 100 });
    const ground = coefficients(model, { V: 30, alphaDeg: 5, heightAGL: 1.25 });
    note('ground effect CL ratio (h = 1.25 m)', ground.CL / free.CL);
    note('ground effect CD ratio (h = 1.25 m)', ground.CD / free.CD);
    expect(ground.CL / free.CL).toBeGreaterThan(1.04);
    expect(ground.CL / free.CL).toBeLessThan(1.2);
    expect(ground.CD).toBeLessThan(free.CD);
    expect(ground.Cm).toBeLessThan(free.Cm);
  });
});

describe('lateral-directional (Roskam C172: CYb -0.31, Clb -0.089, Cnb 0.065, Clp -0.47, Cnr -0.099, Clda 0.18-0.23, Cndr -0.066)', () => {
  const V = 55;
  const b = C172.wing.span;
  const base = () => coefficients(model, { V, alphaDeg: 2 });
  const deriv = (c: Omit<Condition, 'V'>, h: number) => {
    const x = coefficients(model, { V, alphaDeg: 2, ...c });
    const o = base();
    return { CY: (x.CY - o.CY) / h, Cl: (x.Cl - o.Cl) / h, Cn: (x.Cn - o.Cn) / h };
  };

  it('is symmetric in symmetric flight', () => {
    const o = base();
    expect(Math.abs(o.Cl)).toBeLessThan(1e-6);
    expect(Math.abs(o.Cn)).toBeLessThan(1e-6);
    expect(Math.abs(o.CY)).toBeLessThan(1e-6);
  });

  it('sideslip: side force, dihedral effect and weathercock stability', () => {
    const d = deriv({ betaDeg: 2 }, 2 * DEG);
    note('CY_beta', d.CY);
    note('Cl_beta', d.Cl, 4);
    note('Cn_beta', d.Cn, 4);
    expect(d.CY).toBeLessThan(-0.2);
    expect(d.CY).toBeGreaterThan(-0.6);
    // Geometric dihedral (~-0.035), the high wing's fuselage cross-flow over the boxy cabin (~-0.03, DATCOM's
    // wing-body term 1.2 sqrt(A) (z_w/b)(2D/b) gives -0.036), the fin and the struts: ~-0.078 (Roskam's C172
    // cruise set -0.089).
    expect(d.Cl).toBeLessThan(-0.075);
    expect(d.Cl).toBeGreaterThan(-0.15);
    expect(d.Cn).toBeGreaterThan(0.03);
    expect(d.Cn).toBeLessThan(0.15);
  });

  it('rates: roll damping, yaw damping and the cross terms', () => {
    const p = deriv({ p: 0.1 }, (0.1 * b) / (2 * V));
    const r = deriv({ r: 0.1 }, (0.1 * b) / (2 * V));
    note('Cl_p', p.Cl);
    note('Cn_p', p.Cn, 4);
    note('Cl_r', r.Cl, 4);
    note('Cn_r', r.Cn, 4);
    expect(p.Cl).toBeLessThan(-0.35);
    expect(p.Cl).toBeGreaterThan(-0.7);
    expect(p.Cn).toBeLessThan(0); // rolling right yaws the nose left
    expect(r.Cl).toBeGreaterThan(0); // yawing right rolls right
    expect(r.Cn).toBeLessThan(-0.06);
    expect(r.Cn).toBeGreaterThan(-0.2);
    // Spiral stability: Cl_beta Cn_r / (Cn_beta Cl_r) > 1 is a convergent spiral; a C172 is mildly stable
    // (Roskam's cruise derivatives give ~1.8).
    const beta = deriv({ betaDeg: 2 }, 2 * DEG);
    const spiral = (beta.Cl * r.Cn) / (beta.Cn * r.Cl);
    note('spiral criterion Cl_beta Cn_r / (Cn_beta Cl_r)', spiral);
    expect(spiral).toBeGreaterThan(1.3);
  });

  it('controls: aileron roll power with adverse yaw, rudder yaw power', () => {
    const da = deriv({ surfaces: { aileronLeft: 5 * DEG, aileronRight: -5 * DEG } }, 5 * DEG);
    const dr = deriv({ surfaces: { rudder: 5 * DEG } }, 5 * DEG);
    note('Cl_da', da.Cl);
    note('Cn_da (alpha 2)', da.Cn, 4);
    note('Cn_dr', dr.Cn, 4);
    expect(da.Cl).toBeGreaterThan(0.15);
    expect(da.Cl).toBeLessThan(0.45);
    expect(dr.Cn).toBeLessThan(-0.04);
    expect(dr.Cn).toBeGreaterThan(-0.12);
    expect(dr.CY).toBeGreaterThan(0);
    // Adverse yaw grows with lift: at slow flight a right-roll aileron input yaws the nose left. (This is only
    // the deflection's own share, from the drag and lift differences of the two ailerons; the larger part in
    // flight comes from the roll rate, Cn_p.)
    const slow = coefficients(model, { V: 30, alphaDeg: 10 });
    const slowAil = coefficients(model, { V: 30, alphaDeg: 10, surfaces: { aileronLeft: 10 * DEG, aileronRight: -10 * DEG } });
    note('Cn per 10 deg aileron at alpha 10', slowAil.Cn - slow.Cn, 4);
    expect(slowAil.Cn - slow.Cn).toBeLessThan(-0.0002);
  });

  it('autorotates between the stall and ~30 deg (wing-alone autorotation band) and is damped outside it', () => {
    // Rotation about the velocity vector, as in a spin; wind-axis rolling moment per unit pb/2V,
    // after the separation state has settled (time-marched model, not quasi-steady).
    const rollDamping = (alphaDeg: number) => {
      const a = alphaDeg * DEG;
      const w = 0.4;
      const m = new AeroModel();
      const settle = (p: number, r: number) => {
        for (let k = 0; k < 600; k++) m.compute(makeInput({ V: 28, alphaDeg, p, r, dt: 0.0025 }));
        const c = coefficients(m, { V: 28, alphaDeg, p, r });
        return c.Cl * Math.cos(a) + c.Cn * Math.sin(a);
      };
      const still = settle(0, 0);
      return (settle(w * Math.cos(a), w * Math.sin(a)) - still) / ((w * b) / 56);
    };
    const pre = rollDamping(8);
    const band = rollDamping(25);
    const deep = rollDamping(45);
    note('spin-axis roll damping at alpha 8', pre);
    note('spin-axis roll damping at alpha 25', band);
    note('spin-axis roll damping at alpha 45', deep);
    expect(pre).toBeLessThan(-0.3);
    expect(band).toBeGreaterThan(0.05);
    expect(deep).toBeLessThan(0);
  });
});

describe('propeller slipstream (clockwise from the cockpit)', () => {
  const slip = (vi: number): Slipstream => ({ origin: { ...C172.prop.hub }, radius: 0.75, inducedVelocity: vi, swirlRate: 1.2 * vi });

  it('yaws the nose left with power and raises rudder and elevator authority', () => {
    const cond = { V: 30, alphaDeg: 8 };
    const off = coefficients(model, { ...cond, slipstream: slip(0) });
    const on = coefficients(model, { ...cond, slipstream: slip(8) });
    note('Cn from slipstream swirl (vi 8 m/s at 58 kt)', on.Cn, 4);
    // The swirl reaches the fin undiminished by any blanket recovery factor: the wing's reaction to it is its own
    // shed vorticity, which the wake coupling carries to the tail (aero/slipstream.ts).
    expect(on.Cn).toBeLessThan(-0.0045);
    expect(Math.abs(off.Cn)).toBeLessThan(1e-6);
    const rudder = (vi: number) =>
      coefficients(model, { ...cond, slipstream: slip(vi), surfaces: { rudder: -10 * DEG } }).Cn - coefficients(model, { ...cond, slipstream: slip(vi) }).Cn;
    const elevator = (vi: number) =>
      coefficients(model, { ...cond, slipstream: slip(vi), surfaces: { elevator: -10 * DEG } }).Cm - coefficients(model, { ...cond, slipstream: slip(vi) }).Cm;
    note('rudder power ratio, power on/off', rudder(8) / rudder(0), 2);
    note('elevator power ratio, power on/off', elevator(8) / elevator(0), 2);
    expect(rudder(8)).toBeGreaterThan(1.3 * rudder(0));
    expect(elevator(8)).toBeGreaterThan(1.2 * elevator(0));
    expect(on.CL).toBeGreaterThan(off.CL);
  });
});

describe('dynamics and robustness', () => {
  it('shows dynamic-stall hysteresis in a pitch oscillation', () => {
    const m = new AeroModel();
    const dt = 1 / 400;
    const up: number[] = [];
    const down: number[] = [];
    for (let i = 0; i < 1200; i++) {
      const t = i * dt;
      const a = 16 + 6 * Math.sin(2 * Math.PI * t);
      const q = 6 * DEG * 2 * Math.PI * Math.cos(2 * Math.PI * t);
      const input = makeInput({ V: 30, alphaDeg: a, q, dt });
      const out = m.compute(input);
      if (i >= 800 && Math.abs(a - 18) < 0.3) (q > 0 ? up : down).push(out.lift / (0.5 * input.atmosphere.density * 900 * S));
    }
    const cu = up.reduce((s, x) => s + x, 0) / up.length;
    const cd = down.reduce((s, x) => s + x, 0) / down.length;
    note('dynamic stall CL at 18 deg up/down', cu - cd);
    expect(cu).toBeGreaterThan(cd + 0.2);
  });

  it('downwash reaches the tail with the convective lag', () => {
    const m = new AeroModel();
    for (let i = 0; i < 200; i++) m.compute(makeInput({ V: 50, alphaDeg: 2, dt: 0.0025 }));
    // Step in angle of attack: the tail first sees the old (smaller) downwash, so the pitching moment
    // right after the step is more nose-down than once the new downwash has arrived.
    const first = coefficients(m, { V: 50, alphaDeg: 6, dt: 0.0025 }).Cm;
    for (let i = 0; i < 400; i++) m.compute(makeInput({ V: 50, alphaDeg: 6, dt: 0.0025 }));
    const settled = coefficients(m, { V: 50, alphaDeg: 6 }).Cm;
    expect(first).toBeLessThan(settled - 0.01);
  });

  it('stays finite in extreme attitudes and recovers from invalid input', () => {
    const m = new AeroModel();
    const cases: Condition[] = [
      { V: 30, alphaDeg: 45, p: 1.5, r: 2.5 },
      { V: 20, alphaDeg: 170 },
      { V: 20, alphaDeg: -179, betaDeg: 60 },
      { V: 25, alphaDeg: 90, betaDeg: 30 },
      { V: 0, alphaDeg: 0 },
      { V: 40, alphaDeg: 5, heightAGL: 1.25 },
    ];
    for (const c of cases) {
      for (let k = 0; k < 40; k++) {
        const out = m.compute(makeInput({ ...c, dt: 0.0025 }));
        for (const v of [out.force.x, out.force.y, out.force.z, out.moment.x, out.moment.y, out.moment.z]) expect(Number.isFinite(v)).toBe(true);
      }
    }
    const still = new AeroModel().compute(makeInput({ V: 0, dt: 0.0025 }));
    expect(Math.hypot(still.force.x, still.force.y, still.force.z)).toBeLessThan(1e-6);
    const bad = makeInput({ V: 50, alphaDeg: 2 });
    bad.body.velocityBody = { x: NaN, y: 0, z: 0 };
    m.compute(bad);
    let out = m.compute(makeInput({ V: 50, alphaDeg: 2, dt: 0.0025 }));
    for (let k = 0; k < 20; k++) out = m.compute(makeInput({ V: 50, alphaDeg: 2, dt: 0.0025 }));
    expect(Number.isFinite(out.lift)).toBe(true);
    expect(out.lift).toBeGreaterThan(3000);
  });

  it('runs in a few tens of microseconds per call', () => {
    const m = new AeroModel();
    const n = 4000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) m.compute(makeInput({ V: 55, alphaDeg: 2 + Math.sin(i * 0.01), q: 0.05, dt: i % 4 === 0 ? 0.0025 : 0 }));
    const us = ((performance.now() - t0) / n) * 1000;
    note('compute cost (us/call, incl. test input construction)', us, 1);
    expect(us).toBeLessThan(150);
  });

  it('prints the headline numbers', () => {
    const lines = Object.entries(report).map(([k, v]) => `  ${k.padEnd(52)} ${v}`);
    const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
    stdout.write(`\nC172 aerodynamic model summary\n${lines.join('\n')}\n`);
    expect(lines.length).toBeGreaterThan(10);
  });
});

describe('tail flow field', () => {
  it('puts the tailplane in the wing wake with full flap (lower dynamic pressure), not in clean cruise', () => {
    const m = new AeroModel(undefined, { quasiSteady: true });
    coefficients(m, { V: 40, alphaDeg: 2 });
    const clean = Array.from(m.tailWakeFactor.slice(0, 9)).map((f) => f * f);
    coefficients(m, { V: 40, alphaDeg: 0, surfaces: { flaps: 30 * DEG } });
    const flap = Array.from(m.tailWakeFactor.slice(0, 9)).map((f) => f * f);
    // The wing wake alone: the flapped over the clean ratio (the fuselage boundary layer is in both).
    const wake = flap.map((q, k) => q / clean[k]);
    note('tailplane q ratio clean (min)', Math.min(...clean));
    note('tailplane q ratio flaps 30 / clean, alpha 0 (min)', Math.min(...wake));
    // Clean: only the fuselage boundary layer, on the strips beside the tail cone (~0.78 q there).
    const outboard = clean.filter((_, k) => Math.abs(m.diagnostics[m.diagnostics.length - 14 + k].position.y) > 0.6);
    expect(Math.min(...outboard)).toBeGreaterThan(0.97);
    expect(Math.min(...clean)).toBeGreaterThan(0.7);
    expect(Math.min(...wake)).toBeLessThan(0.9);
    expect(Math.min(...wake)).toBeGreaterThan(0.6);
  });

  it('keeps the tailplane roots in the fuselage boundary layer: tail efficiency 0.9-0.97', () => {
    const m = new AeroModel(undefined, { quasiSteady: true });
    coefficients(m, { V: 40, alphaDeg: 2 });
    let qa = 0, a = 0;
    m.diagnostics.forEach((d, k) => {
      if (d.surface !== 'hTail') return;
      const f = m.tailWakeFactor[k - (m.diagnostics.length - m.tailWakeFactor.length)];
      qa += d.area * f * f;
      a += d.area;
    });
    note('tail efficiency (area-weighted q ratio), clean', qa / a);
    expect(qa / a).toBeGreaterThan(0.9);
    expect(qa / a).toBeLessThan(0.97);
  });

  it('keeps the wing-to-tail influence continuous as the wake direction changes (no rebuild jumps)', () => {
    const m = new AeroModel();
    let prev = NaN, maxJump = 0;
    for (let a = 0; a <= 8; a += 0.02) {
      const c = coefficients(m, { V: 50, alphaDeg: a, dt: 0.02 });
      if (Number.isFinite(prev)) maxJump = Math.max(maxJump, Math.abs(c.Cm - prev));
      prev = c.Cm;
    }
    // Cm_alpha ~ -1.5/rad gives ~5e-4 per 0.02 deg step; a matrix rebuild used to add a jump of that size.
    note('largest Cm step over 0.02 deg of alpha', maxJump, 5);
    expect(maxJump).toBeLessThan(1.2e-3);
  });

  it('turns the propeller jet down with the wing: the tail sees more downwash inside the jet', () => {
    const slip = { origin: { ...C172.prop.hub }, radius: 0.85, inducedVelocity: 8, swirlRate: 0 };
    const m = new AeroModel(undefined, { quasiSteady: true });
    const tailAlpha = (alphaDeg: number, slipstream: Slipstream | null) => {
      coefficients(m, { V: 30, alphaDeg, slipstream });
      return m.tailplaneAlpha();
    };
    const off = (tailAlpha(8, null) - tailAlpha(2, null)) / (6 * DEG);
    const on = (tailAlpha(8, slip) - tailAlpha(2, slip)) / (6 * DEG);
    note('tail d(alpha_t)/d(alpha) power off / on', off);
    note('tail d(alpha_t)/d(alpha) power on', on);
    // 1 - d(eps)/d(alpha): ~0.69 power off; the jet carries the wing's extra downwash inside it.
    expect(off).toBeGreaterThan(0.6);
    expect(off).toBeLessThan(0.75);
    expect(on).toBeLessThan(off);
  });
});

describe('installation and high angle of attack (data checks)', () => {
  it('the cowling slows the inflow through the propeller disc by 2-3 % (slender-body blockage)', () => {
    // Near zero lift the wing's own induced velocity at the disc is small; what is left is the body's blockage.
    const m = new AeroModel(undefined, { quasiSteady: true });
    let best = { cl: Infinity, inflow: 0 };
    for (let a = -4; a <= 2; a += 0.25) {
      const c = coefficients(m, { V: 50, alphaDeg: a });
      if (Math.abs(c.CL) < Math.abs(best.cl)) best = { cl: c.CL, inflow: m.propellerInflow.x / 50 };
    }
    note('cowl blockage at the disc (fraction of V)', best.inflow, 4);
    expect(best.inflow).toBeGreaterThan(0.015);
    expect(best.inflow).toBeLessThan(0.035);
  });

  it('spin-range yawing moment under rotation matches the NASA rotary-balance data for a C172-like model', () => {
    // NASA CR-3097 (Bihrle & Hultberg 1979), high-wing model B: NACA 2412, root/tip incidence +1.5/-1.5 deg, aspect
    // ratio 7.4, dihedral 1.7 deg, all controls neutral, moments about 0.25 MAC. Fig. A1(c), alpha 40 deg: Cn about
    // 0, -0.001, -0.002, -0.005, -0.008, -0.012 at Omega b / 2V = 0.1 ... 0.6 (read off the plot). Rotation about the
    // velocity vector, time-marched until the separation state has settled.
    const V = 38, a = 40 * DEG, b = C172.wing.span;
    const data: [number, number][] = [[0.1, 0], [0.2, -0.001], [0.3, -0.002], [0.4, -0.005], [0.5, -0.008], [0.6, -0.012]];
    for (const [w, cn] of data) {
      const omega = (w * 2 * V) / b;
      const m = new AeroModel();
      const input = (dt: number) => makeInput({ V, alphaDeg: 40, p: omega * Math.cos(a), r: omega * Math.sin(a), dt });
      for (let k = 0; k < 400; k++) m.compute(input(0.0025));
      const inp = input(0);
      const out = m.compute(inp);
      const got = out.moment.z / (0.5 * inp.atmosphere.density * V * V * S * b);
      note(`spin-range Cn at alpha 40, Omega b/2V ${w}`, got);
      expect(Math.abs(got - cn)).toBeLessThan(0.008);
    }
  });
});
