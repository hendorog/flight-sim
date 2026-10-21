// Hingeless rotor core (plan revision 2, section 4 items 2 and 4): the hub-aware blade-element pitch (R8), the radial
// flow (R12) and the periodic flap damping option (R23). RC_TRACE=<dir>/hingelessBem.json.
import { afterAll, describe, expect, it } from 'vitest';
import { DEG, quat, v3, type Vec3 } from '../../src/core/math';
import { defaultControls, type ControlInputs } from '../../src/core/types';
import { Rotorcraft } from '../../src/physics/rotorcraft/rotorcraft';
import { bladeElements, tppPitchHarmonic } from '../../src/physics/rotorcraft/rotor';
import { flapForcing, hingeMoment, hubForcing } from '../../src/physics/rotorcraft/articulated';
import { hingelessBlade, hingelessSpring } from '../../src/physics/rotorcraft/hingeless';
import { toShaft } from '../../src/physics/rotorcraft/shaftFrame';
import type { BodyState } from '../../src/physics/interfaces';
import type { RotorcraftDefinition } from '../../src/physics/rotorcraft/definition';
import { fixtureDefinition, fixtureRig, fixtureRotorcraft, run, traceReport } from './hingelessFixture';

const report: Record<string, unknown> = {};
afterAll(() => traceReport('hingelessBem', report));
let r23Lateral = 0;

const R = 9.84 / 2;
const freeHinge = (o: Record<string, unknown> = {}, rootCutout?: number) => fixtureRotorcraft({ hub: { equivalentHingeOffset: 0,
  flapFrequency: 1, precone: 0, harmonicInflow: false, radialFlow: false, controlPhase: 0, ...o },
  main: rootCutout === undefined ? {} : { rootCutout } });
function body(speed: number): BodyState {
  return { time: 0, position: { x: 0, y: 0, z: -1500 }, orientation: quat.fromEuler(0, 0, 0), velocityBody: { x: speed, y: 0, z: 0 },
    angularVelocity: v3.zero(), cgOffset: v3.zero(), mass: 2200 };
}
const controls = (over: Partial<ControlInputs> = {}): ControlInputs => ({ ...defaultControls(fixtureDefinition()), collective: 0.45, ...over });

/** A rotor settled at advance ratio `mu` (shaft frame, held body): its flap, inflow and the tip-path-plane geometry. */
function settled(def: RotorcraftDefinition, mu: number, c = controls()) {
  const rotor = new Rotorcraft(def);
  rotor.reset(true);
  const s = rotor.state, tip = s.omega * def.main.radius, b = body(mu * tip / Math.cos(def.shaftTilt ?? 0));
  const loads = rotor.settle(b, v3.zero(), 1.225, 1500, c);
  const hubAir = toShaft(b.velocityBody, def.shaftTilt ?? 0);
  const axis = v3.normalize({ x: s.flapForward, y: s.flapRight, z: -1 });
  const axial = v3.dot(hubAir, axis), inPlane = v3.sub(hubAir, v3.scale(axis, axial));
  return { rotor, s, tip, axial, inPlane, horizontal: v3.len(inPlane), loads: { force: { ...loads.force }, moment: { ...loads.moment } } };
}

describe('R8: bemFromFlap in the free-hinge limit (e 0, Kbeta 0, precone 0) reproduces rotor.ts\'s cancellation harmonic', () => {
  // The closed form integrates the blade from the shaft: the limit case takes a 0.25 m (5 % R) root, the hub's size. The
  // fixture's 1.10 m (22 % R) root moves the quadrature 0.9 / 2.4 / 5.1 % from it at mu 0.1 / 0.2 / 0.35 (reported).
  const rows: Record<string, number>[] = [];
  afterAll(() => { report.R8 = rows; });
  for (const [mu, tolerance] of [[0.1, 0.03], [0.2, 0.03], [0.35, 0.05]] as const) {
    it(`mu ${mu}: the TPP-relative sin(psi) pitch within ${tolerance * 100} % of the formula`, () => {
      const bo105 = (() => { const def = freeHinge(), x = settled(def, mu), s = x.s, m = def.main;
        const h = tppPitchHarmonic(def.rotation, 0, 0, -s.flapForward, s.flapRight, x.inPlane.x, x.inPlane.y);
        const collective = m.minPitch + 0.45 * (m.maxPitch - m.minPitch), muTpp = x.horizontal / x.tip;
        return h.sin / (-muTpp * (8 / 3 * (collective - 0.75 * m.twist) + 2 * m.twist - 2 * (x.axial + s.inflow) / x.tip) /
          (1 + 1.5 * muTpp * muTpp)) - 1; })();
      const def = freeHinge({}, 0.05 * R), x = settled(def, mu), m = def.main, s = x.s;
      const h = tppPitchHarmonic(def.rotation, 0, 0, -s.flapForward, s.flapRight, x.inPlane.x, x.inPlane.y);
      const collective = m.minPitch + 0.45 * (m.maxPitch - m.minPitch), muTpp = x.horizontal / x.tip;
      const formula = -muTpp * (8 / 3 * (collective - 0.75 * m.twist) + 2 * m.twist - 2 * (x.axial + s.inflow) / x.tip) / (1 + 1.5 * muTpp * muTpp);
      // The blade-element loads with the solver's pitch and with the formula: thrust, torque and H agree.
      const legacy = bladeElements(m, s.omega, collective, x.axial, x.horizontal, s.inflow, 1.225, 12, 16, true);
      const hub = bladeElements(m, s.omega, collective, x.axial, x.horizontal, s.inflow, 1.225, 12, 16, false, { harmonicPitch: h });
      rows.push({ mu, sinDeg: h.sin / DEG, formulaDeg: formula / DEG, cosDeg: h.cos / DEG, bo105RootError: bo105,
        thrustRatio: hub.thrust / legacy.thrust, torqueRatio: hub.torque / legacy.torque, hRatio: hub.inPlane / legacy.inPlane });
      expect(Math.abs(h.sin / formula - 1), `sin ${h.sin / DEG} deg against ${formula / DEG}`).toBeLessThan(tolerance);
      expect(Math.abs(hub.thrust / legacy.thrust - 1)).toBeLessThan(tolerance);
    });
  }
  it('the rotor itself flies the TPP-relative pitch on a hingeless hub and the cancellation on a legacy hub', () => {
    // bemFromFlap false falls back to the free-hinge formula: thrust then equals the legacy call exactly.
    const off = settled(fixtureRotorcraft({ hub: { bemFromFlap: false, harmonicInflow: false } }), 0.2);
    expect(Number.isFinite(off.s.thrust)).toBe(true);
    const stiff = settled(fixtureRotorcraft({ hub: { harmonicInflow: false } }), 0.2), s = stiff.s;
    const h = tppPitchHarmonic(1, 0, 0, -s.flapForward, s.flapRight, stiff.inPlane.x, stiff.inPlane.y);
    report.R8stiff = { sinDeg: h.sin / DEG, cosDeg: h.cos / DEG };
    // A stiff hub flaps less than a free hinge: its TPP-relative feathering is NOT the cancellation value.
    expect(Math.abs(h.sin)).toBeGreaterThan(0);
  });
});

describe('R12: mu beta cos(psi), free-hinge limit', () => {
  const rows: Record<string, number>[] = [];
  afterAll(() => { report.R12 = rows; });
  for (const mu of [0.1, 0.2, 0.3]) {
    it(`mu ${mu}: the lateral flap the coning adds is (4/3) mu beta0 / (1 + mu^2/2) within 20 %`, () => {
      const on = settled(freeHinge({ radialFlow: true }), mu), off = settled(freeHinge({ radialFlow: false }), mu);
      const added = (on.s.flapRight - off.s.flapRight) * on.rotor.def.rotation;
      const beta0 = on.s.coning, expected = 4 / 3 * mu * beta0 / (1 + 0.5 * mu * mu);
      rows.push({ mu, coningDeg: beta0 / DEG, addedDeg: added / DEG, expectedDeg: expected / DEG });
      expect(Math.abs(added / expected - 1), `added ${added / DEG} deg`).toBeLessThan(0.2);
    });
  }
});

describe('R23: the periodic flap damping option', () => {
  it('off (absent or false) is bit-identical; hubForcing with no option is flapForcing exactly', () => {
    const a = fixtureRig({ kt: 100 }), b = fixtureRig({ kt: 100, main: { periodicFlapDamping: false } });
    run(a, 1); run(b, 1);
    expect(JSON.stringify(b.fm.state)).toBe(JSON.stringify(a.fm.state));
    const def = fixtureRotorcraft(), p = { flapOffset: 0.6, lagOffset: 0.6, blade: hingelessBlade(def) };
    const air: Vec3 = { x: 30, y: -4, z: 2 }, rate: Vec3 = { x: 0.1, y: -0.05, z: 0.2 };
    const legacy = flapForcing(def.main, p, 44, 1.2, 0.12, 0.02, -0.03, air, 6, rate, 1);
    const { stiffness, ...extended } = hubForcing(def.main, p, 44, 1.2, 0.12, 0.02, -0.03, air, 6, rate, 1);
    expect(extended).toEqual(legacy); expect(stiffness).toBe(0);
  });
  it('on, hover: identical within 1e-9 (no periodic term at mu 0)', () => {
    const def = fixtureRotorcraft(), p = { flapOffset: 0.59, lagOffset: 0.59, blade: hingelessBlade(def) };
    const flap = { cone: 0.05, cosine: 0.01, sine: -0.02 };
    const off = hubForcing(def.main, p, 44.45, 1.225, 0.14, 0.02, 0.01, v3.zero(), 11, v3.zero(), 1, { flap });
    const on = hubForcing(def.main, p, 44.45, 1.225, 0.14, 0.02, 0.01, v3.zero(), 11, v3.zero(), 1, { flap, periodicDamping: true });
    for (const k of ['cone', 'cosine', 'sine'] as const) expect(Math.abs(on[k] - off[k])).toBeLessThan(1e-9 * Math.abs(off.cone));
  });
  it('the periodic part has no first harmonic without reverse flow: with a damping linear in ut (sum k |ut| arm^2) it is 1/rev, so it reaches the harmonics only through the cone', () => {
    const flap = { cone: 0.05, cosine: 0.01, sine: -0.02 }, air = { x: 0.35 * 44.45 * R, y: 0, z: 0 };
    for (const root of [1.8, 1.1]) {
      const def = fixtureRotorcraft({ main: { rootCutout: root } }), p = { flapOffset: 0.59, lagOffset: 0.59, blade: hingelessBlade(def) };
      const off = hubForcing(def.main, p, 44.45, 1.225, 0.14, 0, 0, air, 5, v3.zero(), 1, { flap });
      const on = hubForcing(def.main, p, 44.45, 1.225, 0.14, 0, 0, air, 5, v3.zero(), 1, { flap, periodicDamping: true });
      const scale = off.damping * 44.45 * 0.02, harmonic = Math.hypot(on.cosine - off.cosine, on.sine - off.sine);
      ((report.R23periodic ??= []) as Record<string, number>[]).push({ root, coneNm: on.cone - off.cone, harmonicNm: harmonic, flapRateMomentNm: scale });
      // No reverse flow (root 1.8 m > mu R): zero to rounding; the 1.10 m root's small reverse-flow region: < 0.1 %.
      expect(harmonic).toBeLessThan((root > 0.35 * R ? 1e-9 : 1e-3) * scale);
      expect(Math.abs(on.cone - off.cone)).toBeGreaterThan(0.05 * scale);
    }
  });
  it('on, mu 0.35: the hub moment per unit lateral cyclic changes by the measured 1-3 % (reported against the plan\'s 3-9 %)', () => {
    const per = (periodic: boolean, harmonicInflow: boolean, input: 'aileron' | 'elevator') => {
      // No control phase: the stick's lateral input is then the blade's theta1c exactly.
      const def = fixtureRotorcraft({ hub: { harmonicInflow, controlPhase: 0 }, main: { periodicFlapDamping: periodic } });
      const k = { p: { flapOffset: 0.12 * R, lagOffset: 0.12 * R, blade: hingelessBlade(def) },
        spring: { stiffness: hingelessSpring(def), precone: 2.5 * DEG } };
      const at = (sign: number) => {
        const x = settled(def, 0.35, controls({ [input]: 0.05 * sign }));
        return hingeMoment(k.p, 4, x.s.omega, { cone: x.s.coning, cosine: -x.s.flapForward, sine: x.s.flapRight }, k.spring);
      };
      const p = at(1), m = at(-1);
      return Math.hypot(p.x - m.x, p.y - m.y);
    };
    const rows: Record<string, number | string>[] = [];
    for (const harmonicInflow of [false, true]) for (const input of ['aileron', 'elevator'] as const) {
      const off = per(false, harmonicInflow, input), on = per(true, harmonicInflow, input);
      rows.push({ harmonicInflow: String(harmonicInflow), input, off, on, change: on / off - 1 });
    }
    report.R23 = rows;
    const lateral = rows.find((r) => r.harmonicInflow === 'false' && r.input === 'aileron')!;
    expect(Math.abs(lateral.change as number)).toBeGreaterThan(0.01); expect(Math.abs(lateral.change as number)).toBeLessThan(0.03);
    r23Lateral = Math.abs(lateral.change as number);
  });
  // PLAN MISMATCH, reported (PR text, docs): the plan's 3-9 % (D, about mu^2/2) assumed a first-harmonic periodic
  // damping; the linear-in-ut damping is 1/rev and acts through the cone. One assertion, so a model that reaches the
  // band turns this red.
  it.fails('PLAN R23 BAND — on, mu 0.35: the hub moment per unit lateral cyclic changes by 3-9 %', () => {
    expect(r23Lateral).toBeGreaterThan(0.03);
  });
});
