// Hingeless rotor core (plan revision 2, section 4): the hub, its spring and control phase, and the hingeless decisions.
// Rows R2-R7, R13, R14, R16, R17 on the test-local Bo 105 fixture (hingelessFixture.ts). Numbers print as JSON lines and
// go to RC_TRACE=<dir>/hingelessHub.json.
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, KT, quat, v3 } from '../../src/core/math';
import { defaultControls, type ControlInputs } from '../../src/core/types';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { advanceFlap, estimatedArticulatedGeometry, harmonicFlap, hingeMoment, hubForcing } from '../../src/physics/rotorcraft/articulated';
import { hingelessBlade, hingelessSpring } from '../../src/physics/rotorcraft/hingeless';
import { swashplateCyclic } from '../../src/physics/rotorcraft/swashplate';
import type { BodyState } from '../../src/physics/interfaces';
import type { RotorcraftDefinition } from '../../src/physics/rotorcraft/definition';
import { MD500_DEFINITION } from '../../src/aircraft/md500';
import { DT, FIXTURE_NU, FIXTURE_OFFSET, fixtureDefinition, fixtureRig, fixtureRotorcraft, lockNumber, run, traceReport,
  trimBody } from './hingelessFixture';

const report: Record<string, unknown> = {};
afterAll(() => traceReport('hingelessHub', report));

const R = 9.84 / 2;
const atRest = (): BodyState => ({ time: 0, position: { x: 0, y: 0, z: -1500 }, orientation: quat.fromEuler(0, 0, 0),
  velocityBody: v3.zero(), angularVelocity: v3.zero(), cgOffset: v3.zero(), mass: 2200 });
function controls(over: Partial<ControlInputs> = {}): ControlInputs {
  return { ...defaultControls(fixtureDefinition()), collective: 0.4, ...over };
}
/** Hub geometry and spring the solver uses (the same functions the Rotorcraft constructor calls). */
function hub(def: RotorcraftDefinition) {
  const h = def.hubModel;
  if (h?.kind !== 'hingeless') throw new Error('not hingeless');
  const blade = hingelessBlade(def);
  return { p: { flapOffset: h.equivalentHingeOffset, lagOffset: h.equivalentHingeOffset, blade },
    spring: { stiffness: hingelessSpring(def), precone: h.precone }, omega: def.referenceRpm * Math.PI / 30 };
}

describe('R2, R3: the spring in the solver gives the flap frequency it was derived from', () => {
  const rows: Record<string, unknown>[] = [];
  afterAll(() => { report.R2 = rows; });
  for (const [e, nu] of [[0.12 * R, 1.10], [0.152 * R, 1.126], [0, 1.117]] as const) {
    it(`R2 free decay at density 1e-4: e = ${(e / R).toFixed(3)} R, nu ${nu}: nu = sqrt(1 + 2 omega_r / Omega) within 1 %`, () => {
      const def = fixtureRotorcraft({ hub: { equivalentHingeOffset: e, flapFrequency: nu, harmonicInflow: false, radialFlow: false } });
      const rotor = new Rotorcraft(def);
      rotor.reset(true);
      const s = rotor.state, b = atRest(), c = controls(), omega = s.omega;
      s.flapForward = 0; s.flapRight = 0.02;
      let angle = Math.atan2(s.flapRight, -s.flapForward), turned = 0;
      const seconds = 1.5;
      for (let i = 0; i < seconds / DT; i++) {
        rotor.compute(b, v3.zero(), 1e-4, 1500, c, DT);
        const next = Math.atan2(s.flapRight, -s.flapForward);
        turned += Math.atan2(Math.sin(next - angle), Math.cos(next - angle)); angle = next;
      }
      const regressing = Math.abs(turned) / seconds, measured = Math.sqrt(1 + 2 * regressing / omega);
      rows.push({ e: e / R, nu, regressingRadPerS: regressing, measured, spring: hingelessSpring(def) });
      expect(Math.abs(measured / nu - 1), `measured ${measured}`).toBeLessThan(0.01);
    });
  }
  it('R3: Kbeta = (nu^2 - 1 - e Mbeta / Ibeta) Ibeta Omega^2 >= 0; e = 0.12 R, nu 1.10 gives Kbeta about 0 (MBB "12 %, zero spring")', () => {
    const def = fixtureRotorcraft({ hub: { flapFrequency: 1.10 } }), { p, spring, omega } = hub(def);
    const b = p.blade, expected = (1.10 ** 2 - 1 - FIXTURE_OFFSET * b.flapFirst / b.flapInertia) * b.flapInertia * omega ** 2;
    expect(spring.stiffness).toBeGreaterThanOrEqual(0);
    expect(Math.abs(spring.stiffness - Math.max(0, expected))).toBeLessThanOrEqual(1e-9 * Math.abs(expected));
    expect(spring.stiffness).toBeLessThan(0.05 * b.flapInertia * omega ** 2 * 0.21);
    // The fixture (nu 1.11) and a stiffer hub: positive, and below the total flap stiffness (nu^2 - 1) Ibeta Omega^2.
    for (const nu of [FIXTURE_NU, 1.2]) {
      const k = hub(fixtureRotorcraft({ hub: { flapFrequency: nu } }));
      expect(k.spring.stiffness).toBeGreaterThan(0);
      expect(k.spring.stiffness).toBeLessThan((nu * nu - 1) * k.p.blade.flapInertia * k.omega ** 2);
    }
    report.R3 = { nu110: spring.stiffness, limit: 0.05 * b.flapInertia * omega ** 2 * 0.21,
      fixture: hub(fixtureRotorcraft()).spring.stiffness, offsetNu: Math.sqrt(1 + FIXTURE_OFFSET * b.flapFirst / b.flapInertia) };
  });
});

describe('R5, R7: hub moment per unit flap', () => {
  it('R5: the Rotorcraft hub moment per unit first-harmonic flap is (B/2)(nu^2 - 1) Ibeta Omega^2 within 1 %', () => {
    const def = fixtureRotorcraft({ hub: { harmonicInflow: false } }), { p, omega } = hub(def);
    const expected = def.main.blades / 2 * (FIXTURE_NU ** 2 - 1) * p.blade.flapInertia * omega ** 2;
    const rotor = new Rotorcraft(def);
    rotor.reset(true);
    const s = rotor.state, b = atRest(), c = controls({ collective: 0 });
    // No air (density 1e-12): only the hub's spring and offset act; zero-dt queries do not move the flap.
    s.flapForward = 0; s.flapRight = 0.01; s.coning = 0;
    const roll = rotor.compute(b, v3.zero(), 1e-12, 1500, c, 0).moment.x;
    s.flapRight = 0; s.flapForward = -0.01;
    const pitch = rotor.compute(b, v3.zero(), 1e-12, 1500, c, 0).moment.y;
    // The shaft is tilted 3 deg forward: a shaft roll moment reaches the body roll axis times cos(tilt).
    const perRad = roll / 0.01 / Math.cos(def.shaftTilt ?? 0);
    report.R5 = { expected, roll: perRad, pitch: pitch / 0.01 };
    expect(Math.abs(perRad / expected - 1)).toBeLessThan(0.01);
    expect(Math.abs(pitch / 0.01 / expected - 1)).toBeLessThan(0.01);
    expect(hingeMoment(p, def.main.blades, omega, { cone: 0, cosine: 0, sine: 1 }, hub(def).spring).x / expected).toBeCloseTo(1, 9);
  });
  it('R7: (nu^2 - 1) of the Bo 105 fixture over the MD 500E\'s centrifugal offset term is 3.0-4.5 (expected 3.5-4)', () => {
    const md = MD500_DEFINITION.rotorcraft!;
    if (md.hubModel?.kind !== 'articulated') throw new Error('MD 500E hub');
    const g = estimatedArticulatedGeometry(md.main, md.hubModel.flapHingeOffset, md.hubModel.lagHingeOffset);
    const mdTerm = md.hubModel.flapHingeOffset * g.blade.flapFirst / g.blade.flapInertia, ratio = (FIXTURE_NU ** 2 - 1) / mdTerm;
    report.R7 = { bo105: FIXTURE_NU ** 2 - 1, md500: mdTerm, ratio };
    expect(ratio).toBeGreaterThan(3.0); expect(ratio).toBeLessThan(4.5);
  });
});

/** Steady (settled) rotor response to a cyclic step about the hover trim, body held: flap harmonics and moments. */
function hoverStep(o: Parameters<typeof fixtureRig>[0], aileron: number, elevator: number) {
  const r = fixtureRig({ kt: 0, ...o }), b = trimBody(r), rc = r.fm.rotorcraft!, a = r.env.atmosphere();
  const at = (sign: number) => {
    const f = rc.settle(b, v3.zero(), a.density, 1500, { ...r.c, aileron: r.c.aileron + sign * aileron, elevator: r.c.elevator + sign * elevator });
    return { cosine: -rc.state.flapForward, sine: rc.state.flapRight, mx: f.moment.x, my: f.moment.y };
  };
  const p = at(1), m = at(-1);
  return { cosine: p.cosine - m.cosine, sine: p.sine - m.sine, mx: p.mx - m.mx, my: p.my - m.my, rig: r };
}

describe('R4, R6, R13: hover flap phase, TPP stiffness and the control phase', () => {
  it('R4: hover flap phase lag behind lateral cyclic, harmonic inflow OFF, no control phase: 60-73 deg (D: tan = (gamma/8)/(nu^2 - 1))', () => {
    const step = hoverStep({ hub: { harmonicInflow: false, controlPhase: 0 } }, 0.05, 0);
    // Right cyclic is a pitch maximum at psi = 0 in flapForcing's azimuth (pitchCos = rotation x right): the lag is the
    // flap maximum's azimuth past it, in the rotation sense.
    const lag = Math.atan2(step.sine, step.cosine) / DEG, gamma = lockNumber();
    const expected = Math.atan2(gamma / 8, FIXTURE_NU ** 2 - 1) / DEG;
    report.R4 = { lagDeg: lag, gamma, expectedDeg: expected };
    expect(lag).toBeGreaterThan(60); expect(lag).toBeLessThan(73);
  });
  it('R6: lateral TPP stiffness, thrust term included, 3.2 kN m/deg +/-30 % (P DLR-Kunze L_beta1s x Ixx / D)', () => {
    const step = hoverStep({ hub: { controlPhase: 0 } }, 0.05, 0);
    const perDeg = step.mx / (step.sine / DEG) / 1000;
    report.R6 = { kNmPerDeg: perDeg };
    expect(perDeg).toBeGreaterThan(3.2 * 0.7); expect(perDeg).toBeLessThan(3.2 * 1.3);
  });
  it('R13: the control phase turns the steady hover hub moment by the phase (rotation sense), +/-0.5 deg', () => {
    const rows: Record<string, number>[] = [];
    for (const inflow of [false, true]) for (const phase of [15, 30]) {
      const base = hoverStep({ hub: { harmonicInflow: inflow, controlPhase: 0 } }, 0.05, 0);
      const turned = hoverStep({ hub: { harmonicInflow: inflow, controlPhase: phase * DEG } }, 0.05, 0);
      // Shaft x/y moments: a CCW rotor (rotation +1) turns the moment vector CCW from above, i.e. from +y towards +x.
      const angle = (m: { mx: number; my: number }) => Math.atan2(m.mx, m.my);
      const rotation = base.rig.def.rotorcraft!.rotation;
      const d = Math.atan2(Math.sin(angle(turned) - angle(base)), Math.cos(angle(turned) - angle(base))) / DEG * rotation;
      rows.push({ inflow: Number(inflow), phase, turnedDeg: d, ratio: Math.hypot(turned.mx, turned.my) / Math.hypot(base.mx, base.my) });
      expect(Math.abs(d - phase), `turned ${d}`).toBeLessThan(0.5);
    }
    report.R13 = rows;
  });
  it('swashplateCyclic is the identity without a control phase and a pure rotation with one', () => {
    const def = fixtureRotorcraft({ hub: { controlPhase: 0 } }), c = { elevator: 0.3, aileron: -0.2 };
    const a = swashplateCyclic(def, c), b = swashplateCyclic(fixtureRotorcraft({ hub: { controlPhase: 20 * DEG } }), c);
    expect(Math.hypot(b.aft, b.right)).toBeCloseTo(Math.hypot(a.aft, a.right), 12);
    expect(Math.atan2(b.right, b.aft) - Math.atan2(a.right, a.aft)).toBeCloseTo(20 * DEG, 12);
  });
});

describe('R14: delta-3 folds exactly into the flap stiffness', () => {
  const rows: Record<string, number>[] = [];
  afterAll(() => { report.R14 = rows; });
  for (const d3 of [20, 37.5]) it(`delta-3 ${d3} deg: hover delta-nu^2 = (gamma/8) tan(delta3) within 10 % (e -> 0)`, () => {
    const def = fixtureRotorcraft({ hub: { equivalentHingeOffset: 1e-3, flapFrequency: 1.0, delta3: d3 * DEG } });
    const { p, omega } = hub(def), m = def.main, rho = 1.225;
    const f = hubForcing(m, p, omega, rho, 0.1, 0, 0, v3.zero(), 10, v3.zero(), 1, { tanDelta3: Math.tan(d3 * DEG) });
    const measured = f.stiffness / (p.blade.flapInertia * omega ** 2);
    const gamma = rho * m.liftSlope * m.chord * m.radius ** 4 / p.blade.flapInertia, expected = gamma / 8 * Math.tan(d3 * DEG);
    expect(Math.abs(measured / expected - 1)).toBeLessThan(0.1);
    // Emergent: the steady hover lag with delta-3 follows tan = C Omega / (delta + Ka) through the whole Rotorcraft.
    const step = hoverStep({ hub: { equivalentHingeOffset: FIXTURE_OFFSET, harmonicInflow: false, delta3: d3 * DEG, controlPhase: 0 } }, 0.05, 0);
    const lag = Math.atan2(step.sine, step.cosine);
    const r0 = step.rig, rc = r0.fm.rotorcraft!, def0 = r0.def.rotorcraft!, h0 = hub(def0), main = def0.main;
    const collective = main.minPitch + (r0.c.collective ?? 0) * (main.maxPitch - main.minPitch);
    const g = hubForcing(main, h0.p, h0.omega, r0.env.atmosphere().density, collective, 0, 0, v3.zero(), rc.state.inflow, v3.zero(), 1,
      { tanDelta3: Math.tan(d3 * DEG) });
    const delta = h0.p.flapOffset * h0.p.blade.flapFirst * h0.omega ** 2 + h0.spring.stiffness + g.stiffness;
    const predicted = Math.atan2(g.damping * h0.omega, delta);
    rows.push({ delta3: d3, measured, expected, lagDeg: lag / DEG, predictedLagDeg: predicted / DEG });
    expect(Math.abs(lag - predicted) / DEG).toBeLessThan(1);
  });
});

describe('R16: zero-dt purity, settle, trims, and a stopped rotor', () => {
  it('repeat dt = 0 queries are identical and advance no slow state (flap, cone, inflow, harmonic inflow, poses, mast moment)', () => {
    const r = fixtureRig({ kt: 60 }), rc = r.fm.rotorcraft!, b = trimBody(r), rho = r.env.atmosphere().density;
    run(r, 0.5);
    // thrust/tailThrust/torque are every query's outputs (legacy behaviour on every type); the slow states are not.
    const slow = () => { const { thrust, tailThrust, torque, stalledFraction, vortexRing, ...rest } = rc.state;
      void thrust; void tailThrust; void torque; void stalledFraction; void vortexRing; return JSON.stringify(rest); };
    const before = slow();
    const one = JSON.stringify(rc.compute(b, v3.zero(), rho, 1500, r.c, 0)), two = JSON.stringify(rc.compute(b, v3.zero(), rho, 1500, r.c, 0));
    expect(two).toBe(one); expect(slow()).toBe(before);
  });
  it('trims at 0/40/80/120/145 KIAS (SL ISA) converge with a residual below 1e-4 and hold 5 s within bounds', () => {
    const rows: Record<string, number>[] = [];
    for (const kt of [0, 40, 80, 120, 145]) {
      const r = fixtureRig({ kt }), t = r.fm.lastTrim!, s = r.fm.state;
      const start = { pitch: s.pitch, roll: s.roll };
      run(r, 5);
      rows.push({ kt, residual: t.residual, pitchDeg: start.pitch / DEG, rollDeg: start.roll / DEG, collective: r.c.collective ?? 0,
        driftPitchDeg: (s.pitch - start.pitch) / DEG, driftRollDeg: (s.roll - start.roll) / DEG, kias: s.ias / KT,
        mastMomentNm: s.rotorcraft!.mastMoment! });
      expect(t.converged).toBe(true); expect(t.residual).toBeLessThan(1e-4);
      expect(s.crashed).toBe(false);
      expect(Math.abs(s.pitch - start.pitch) / DEG).toBeLessThan(3); expect(Math.abs(s.roll - start.roll) / DEG).toBeLessThan(3);
    }
    // Hands-off: the hover drifts slowly (its unstable hover modes, 0.35 deg of pitch in 5 s); 40-145 KIAS hold within 0.05 deg.
    report.R16trims = rows;
  }, 60_000);
  it('after a shutdown to Omega = 0 the hub moment is below 50 N m within 5 s; a save resumed at Omega = 0 applies none', () => {
    const def = fixtureRotorcraft(), rotor = new Rotorcraft(def), b = atRest(), c = controls({ collective: 0 });
    rotor.reset(true);
    const s = rotor.state, omega0 = s.omega, rho = 1.225;
    // Spool down over 30 s with the collective down, then 5 s stopped.
    let atStop = Infinity, worst = 0;
    for (let i = 0; i < 35 / DT; i++) {
      s.omega = Math.max(0, omega0 * (1 - i * DT / 30));
      rotor.compute(b, v3.zero(), rho, 1500, c, DT);
      if (s.omega === 0) { atStop = Math.min(atStop, i * DT); if (i * DT - atStop <= 5) worst = Math.max(worst, s.mastMoment!); }
    }
    expect(s.mastMoment!).toBeLessThan(50);
    // A stale harmonic in a save at Omega = 0: the first (zero-dt) query and the first step apply no hub moment.
    const resumed = new Rotorcraft(def);
    resumed.reset(false);
    resumed.state.flapRight = 0.5 * DEG; resumed.state.flapForward = -0.3 * DEG;
    const query = resumed.compute(b, v3.zero(), rho, 1500, c, 0);
    const still = new Rotorcraft(def);
    still.reset(false);
    const reference = still.compute(b, v3.zero(), rho, 1500, c, 0);
    resumed.compute(b, v3.zero(), rho, 1500, c, DT);
    report.R16stop = { mastMomentAtStopNm: s.mastMoment, worstWithin5sNm: worst, resumedQueryRollNm: query.moment.x - reference.moment.x,
      resumedStepMastMomentNm: resumed.state.mastMoment };
    expect(Math.abs(query.moment.x - reference.moment.x)).toBeLessThan(1e-9);
    expect(Math.abs(query.moment.y - reference.moment.y)).toBeLessThan(1e-9);
    expect(resumed.state.mastMoment!).toBeLessThan(1e-9);
  });
  it('a stopped spring hub with Kbeta = 0 and no delta-3 holds the precone and no harmonics (no cone jump at Omega = 0)', () => {
    // R2's (0.152 R, 1.126) and (0, 1.117) hubs sit near Kbeta 0: the static spring solution has no stiffness to divide by.
    const def = fixtureRotorcraft(), p = { flapOffset: 0.6, lagOffset: 0.6, blade: hingelessBlade(def) };
    const precone = 2.5 * DEG, forcing = { cone: 0, cosine: 0, sine: 0, damping: 0 };
    const previous = { cone: 0.03, cosine: 0.01, sine: -0.02 };
    for (const spring of [{ stiffness: 0, precone }, { stiffness: 0, precone, aerodynamic: 0 }]) {
      expect(harmonicFlap(p, 0, forcing, 1, spring)).toEqual({ cone: precone, cosine: 0, sine: 0 });
      expect(advanceFlap(p, 0, forcing, previous, 1, DT, 0, spring)).toEqual({ cone: precone, cosine: 0, sine: 0 });
    }
    // With a spring the stopped cone is the spring's static solution, the precone with no air load.
    expect(harmonicFlap(p, 0, forcing, 1, { stiffness: 9196, precone }).cone).toBeCloseTo(precone, 15);
  });
  it('reset creates the hingeless blocks (blades, harmonic inflow, mast moment) and none on a legacy type', () => {
    const rotor = new Rotorcraft(fixtureRotorcraft());
    rotor.reset(true);
    expect(rotor.state.articulated!.blades).toHaveLength(4);
    expect(rotor.state.harmonicInflow).toEqual({ cos: 0, sin: 0 });
    expect(rotor.state.mastMoment).toBe(0);
    const off = new Rotorcraft(fixtureRotorcraft({ hub: { harmonicInflow: false } }));
    off.reset(true);
    expect(off.state.harmonicInflow).toBeUndefined();
    const md = new Rotorcraft(MD500_DEFINITION.rotorcraft!);
    md.reset(true);
    expect(md.state.harmonicInflow).toBeUndefined(); expect(md.state.mastMoment).toBeUndefined();
  });
});

describe('R17: low g keeps the hub moment', () => {
  it('roll acceleration to a 0.2 (10 % travel) lateral step during a 0.2 g pushover at 100 KIAS is at least 80 % of the 1 g value', () => {
    /** Initial roll acceleration of the step: excited minus baseline over the first 0.1 s (deg/s^2). */
    const response = (pushover: boolean) => {
      const pair = [fixtureRig({ kt: 100 }), fixtureRig({ kt: 100 })];
      const collective0 = pair[0].c.collective ?? 0;
      let g = 1, waited = 0;
      // Push over: the collective lowered at 0.5 of its travel per second until the load factor reaches 0.2 g; then the step.
      if (pushover) {
        while (waited < 3 && (g = pair[0].fm.state.gLoad) > 0.2) {
          for (const r of pair) { r.c.collective = Math.max(0, (r.c.collective ?? 0) - 0.5 * DT); r.fm.step(DT, r.c, r.env); }
          waited += DT;
        }
      }
      const startP = pair.map((r) => r.fm.state.angularVelocity.x);
      pair[1].c.aileron += 0.2;
      for (let i = 0; i < 0.1 / DT; i++) for (const r of pair) r.fm.step(DT, r.c, r.env);
      const dp = (pair[1].fm.state.angularVelocity.x - startP[1]) - (pair[0].fm.state.angularVelocity.x - startP[0]);
      return { accel: dp / 0.1 / DEG, g: pair[0].fm.state.gLoad, at: g, waited, collective0 };
    };
    const one = response(false), low = response(true);
    report.R17 = { oneG: one, lowG: low, ratio: low.accel / one.accel };
    expect(low.at).toBeLessThan(0.3); expect(low.at).toBeGreaterThan(0.1);
    expect(low.accel / one.accel).toBeGreaterThan(0.8);
  }, 30_000);
});
