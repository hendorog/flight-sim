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
      const hub = bladeElements(m, s.omega, collective, x.axial, x.horizontal, s.inflow, 1.225, 12, 16, false, 0, { harmonicPitch: h });
      rows.push({ mu, sinDeg: h.sin / DEG, formulaDeg: formula / DEG, cosDeg: h.cos / DEG, bo105RootError: bo105,
        thrustRatio: hub.thrust / legacy.thrust, torqueRatio: hub.torque / legacy.torque, hRatio: hub.inPlane / legacy.inPlane });
      expect(Math.abs(h.sin / formula - 1), `sin ${h.sin / DEG} deg against ${formula / DEG}`).toBeLessThan(tolerance);
      expect(Math.abs(hub.thrust / legacy.thrust - 1)).toBeLessThan(tolerance);
    });
  }
  it('the rotor itself flies the TPP-relative pitch on a hingeless hub and the cancellation on a legacy hub', () => {
    // Held body, collective 0.45, harmonic inflow off; the two definitions differ in bemFromFlap only.
    const rows: Record<string, number>[] = [];
    for (const [mu, lo, hi] of [[0.2, 0.97, 0.995], [0.35, 0.85, 0.95]] as const) {
      const off = settled(fixtureRotorcraft({ hub: { bemFromFlap: false, harmonicInflow: false } }), mu);
      const on = settled(fixtureRotorcraft({ hub: { harmonicInflow: false } }), mu);
      // bemFromFlap false falls back to the free-hinge formula: the settled thrust IS the legacy call on that state.
      const m = off.rotor.def.main, collective = m.minPitch + 0.45 * (m.maxPitch - m.minPitch);
      const legacy = bladeElements(m, off.s.omega, collective, off.axial, off.horizontal, off.s.inflow, 1.225, 12, 16, true);
      expect(off.s.thrust).toBe(legacy.thrust);
      // bemFromFlap on: the stiff hub's real lift moment costs thrust as mu rises (measured 0.982 at 0.2, 0.899 at 0.35).
      const s = on.s, h = tppPitchHarmonic(1, 0, 0, -s.flapForward, s.flapRight, on.inPlane.x, on.inPlane.y);
      rows.push({ mu, thrustOnN: s.thrust, thrustOffN: off.s.thrust, thrustRatio: s.thrust / off.s.thrust,
        shaftTorqueOnNm: s.torque, shaftTorqueOffNm: off.s.torque, sinDeg: h.sin / DEG, cosDeg: h.cos / DEG });
      expect(s.thrust / off.s.thrust).toBeGreaterThan(lo); expect(s.thrust / off.s.thrust).toBeLessThan(hi);
    }
    report.R8stiff = rows;
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
  // damping; the linear-in-ut damping is 1/rev and acts through the cone (about -2 % at mu 0.35, the amended row). AH's
  // H9 (8-15 % at mu 0.5) rests on the same estimate and must be re-derived from the radial-flow stiffness. One
  // assertion, so a model that reaches the band turns this red.
  it.fails('PLAN R23 BAND — on, mu 0.35: the hub moment per unit lateral cyclic changes by 3-9 %', () => {
    expect(r23Lateral).toBeGreaterThan(0.03);
  });
});

describe('the hingeless in-plane force is a vector (final review: no direction switch at zero airspeed)', () => {
  // A hingeless rotor has a real in-plane force in the hover (its tip-path plane tilted against the shaft by cyclic and the
  // hub moment). The scalar H-force along the hub's air velocity pointed it wherever the first 1e-7 m/s of drift happened to
  // point. bladeElements now returns both in-plane components and Rotorcraft turns them back with tppPitchHarmonic's direction.
  it('fixture hover with lateral and longitudinal cyclic: the loads at 1e-7 m/s in +-x / +-y equal those at rest', () => {
    const def = fixtureRotorcraft(), c = controls({ aileron: 0.15, elevator: -0.1 });
    const rotor = new Rotorcraft(def);
    rotor.reset(true);
    const rest = body(0);
    rotor.settle(rest, v3.zero(), 1.225, 1500, c);
    const at = (v: Vec3) => {
      const l = rotor.compute({ ...rest, velocityBody: v }, v3.zero(), 1.225, 1500, c, 0);
      return { force: { ...l.force }, moment: { ...l.moment } };
    };
    const ref = at(v3.zero());
    const inPlane = Math.hypot(ref.force.x, ref.force.y);
    let worst = 0;
    for (const v of [{ x: 1e-7, y: 0, z: 0 }, { x: -1e-7, y: 0, z: 0 }, { x: 0, y: 1e-7, z: 0 }, { x: 0, y: -1e-7, z: 0 }]) {
      const l = at(v);
      worst = Math.max(worst, v3.len(v3.sub(l.force, ref.force)), v3.len(v3.sub(l.moment, ref.moment)) / R);
    }
    report.inPlaneVector = { inPlaneN: inPlane, worstChange: worst };
    // The fixture's hover in-plane force (with the cyclic held off-centre) is about 2 kN; it no longer turns with the drift (the
    // scalar form moved the loads by hundreds of newtons; what is left, 0.1 N, is the airframe's own flow-direction switches).
    expect(inPlane).toBeGreaterThan(100);
    expect(worst).toBeLessThan(1e-3 * inPlane);
  });
});
