// The mechanisms the new types need, each proven on a test-bed piece (testbed.ts) or on synthetic input: two jets,
// nacelle bodies, the T-tail junction, the stabilator, the low wing, winglets, spanwise sections and bands, scaled
// drag items, stall sensors, the wing-wake options, and the cost of a second jet. Every assertion is a physical
// fact with its source: a symmetry, a conservation law, momentum theory or a handbook relation.

import { describe, expect, it } from 'vitest';
import { C172 } from '../../src/core/c172';
import { DEG, v3, type Vec3 } from '../../src/core/math';
import { AeroModel, type AircraftAeroDefinition } from '../../src/physics/aero';
import { blendSections } from '../../src/physics/aero/airfoil';
import { bodyAxisZ, Fuselage, type FlowSampler, type LoadAccumulator } from '../../src/physics/aero/bodies';
import { c172WingPlanform } from '../../src/physics/aero/c172Aero';
import { NACA_0012, NACA_2412 } from '../../src/physics/aero/sections';
import { buildStrips, type Planform } from '../../src/physics/aero/strips';
import type { AeroInput } from '../../src/physics/interfaces';
import { coefficients, makeInput, type Condition } from './helpers';
import {
  baseDefinition,
  jetAt,
  lowWingAeroDefinition,
  stabilatorAeroDefinition,
  stallSensorStrip,
  tTailAeroDefinition,
  TWIN_PROP_RADIUS,
  twinAeroDefinition,
  twinHub,
  twinNacelle,
  twinSlipstreams,
  wingletWingPlanform,
  type JetOptions,
} from './testbed';

const RHO = makeInput({ V: 1 }).atmosphere.density;
const dyn = (V: number) => 0.5 * RHO * V * V;

/** Lift of one strip from its diagnostics (normal to its local flow), N. */
const stripLift = (d: { cl: number; dynamicPressure: number; area: number }) => d.cl * d.dynamicPressure * d.area;
const surfaceSum = (m: AeroModel, surface: string, f: (d: AeroModel['diagnostics'][number]) => number) =>
  m.diagnostics.filter((d) => d.surface === surface).reduce((s, d) => s + f(d), 0);

/** An input with one slipstream per propeller. */
function twinInput(c: Condition, jets: AeroInput['slipstreams']): AeroInput {
  const input = makeInput(c);
  input.slipstreams = jets;
  return input;
}

// ---------------------------------------------------------------------------------------------- two jets

describe('two jets (twin test-bed: wing propellers at y = -/+1.9 m, nacelles)', () => {
  const def = twinAeroDefinition();
  const model = new AeroModel(def, { quasiSteady: true });
  const V = 40;
  const cruise: JetOptions = { V, vi: 8 };
  const qSb = dyn(V) * def.referenceArea * def.referenceSpan;

  it('a symmetric (counter-rotating) pair gives no rolling moment, yawing moment or side force (mirror symmetry)', () => {
    for (const alphaDeg of [2, 8]) {
      const out = model.compute(twinInput({ V, alphaDeg }, twinSlipstreams(def, 'counter', cruise, cruise)));
      expect(Math.abs(out.moment.x / qSb)).toBeLessThan(1e-7);
      expect(Math.abs(out.moment.z / qSb)).toBeLessThan(1e-7);
      expect(Math.abs(out.force.y / out.lift)).toBeLessThan(1e-7);
      // The airframe's inflow at the two discs is each other's mirror image.
      const [l, r] = out.propellerInflows!;
      expect(l.x).toBeCloseTo(r.x, 12);
      expect(l.y).toBeCloseTo(-r.y, 12);
      expect(l.z).toBeCloseTo(r.z, 12);
    }
  });

  it('mirrored failures give mirrored moments, and the live side rolls the aircraft away from itself', () => {
    const leftDead = model.compute(twinInput({ V, alphaDeg: 4 }, twinSlipstreams(def, 'counter', null, cruise)));
    const a = { ...leftDead.moment, fy: leftDead.force.y, lift: leftDead.lift, drag: leftDead.drag };
    const rightDead = model.compute(twinInput({ V, alphaDeg: 4 }, twinSlipstreams(def, 'counter', cruise, null)));
    const scale = a.lift * def.referenceSpan;
    expect(Math.abs(a.x + rightDead.moment.x) / scale).toBeLessThan(1e-6);
    expect(Math.abs(a.z + rightDead.moment.z) / scale).toBeLessThan(1e-6);
    expect(Math.abs(a.y - rightDead.moment.y) / scale).toBeLessThan(1e-6);
    expect(Math.abs(a.fy + rightDead.force.y) / a.lift).toBeLessThan(1e-6);
    expect(Math.abs(a.lift - rightDead.lift) / a.lift).toBeLessThan(1e-6);
    // The blown (right) wing lifts more: left roll. Its higher drag yaws the nose right (aerodynamic loads only).
    expect(a.x / scale).toBeLessThan(-0.01);
    expect(a.z).toBeGreaterThan(0);
  });

  it('a counter-rotating pair has no net swirl effect at the tail; a co-rotating pair rolls the tailplane', () => {
    const tail = (kind: 'co' | 'counter') => {
      model.compute(twinInput({ V, alphaDeg: 4 }, twinSlipstreams(def, kind, cruise, cruise)));
      const lift = surfaceSum(model, 'hTail', stripLift);
      return {
        lift,
        roll: surfaceSum(model, 'hTail', (d) => -stripLift(d) * d.position.y),
        fin: surfaceSum(model, 'vTail', stripLift),
      };
    };
    const co = tail('co'), counter = tail('counter');
    // The swirl's angle change on the tailplane halves inside the jets is antisymmetric for the counter pair.
    expect(Math.abs(counter.roll)).toBeLessThan(1e-4 * Math.abs(co.roll));
    expect(Math.abs(counter.fin)).toBeLessThan(1e-3);
    // Both jets of a co-rotating pair twist the tail the same way: a tail rolling moment of the order of
    // (swirl angle x tail lift slope x q x tail area x moment arm) ~ 1e2 N m at 8 m/s induced velocity.
    // Order of the estimate above with a swirl angle of 0.6 vi / V ~ 7 deg at the jet's edge, falling to 0 on its
    // axis, over the part of each tailplane half inside a jet (measured 145 N m at vi 8 m/s).
    expect(Math.abs(co.roll)).toBeGreaterThan(50);
    expect(Math.abs(co.roll)).toBeLessThan(300);
    expect(Math.abs(co.fin)).toBeGreaterThan(1);
  });

  it('a windmilling (negative-thrust) jet takes dynamic pressure and lift from the wing strips behind it (momentum theory)', () => {
    const run = (right: JetOptions | null) => {
      model.compute(twinInput({ V, alphaDeg: 4 }, twinSlipstreams(def, 'counter', null, right)));
      return model.diagnostics.slice(0, def.wing.length).map((d) => ({ y: d.position.y, q: d.dynamicPressure, lift: stripLift(d) }));
    };
    const clean = run(null);
    const vi = -3;
    const windmill = run({ V, vi });
    const hub = def.propellers![1].hub.y, R = TWIN_PROP_RADIUS;
    let inside = 0;
    for (let k = 0; k < clean.length; k++) {
      const y = clean[k].y;
      const strip = def.wing[k];
      const outer = Math.max(Math.abs(strip.a.y), Math.abs(strip.b.y)), inner = Math.min(Math.abs(strip.a.y), Math.abs(strip.b.y));
      if (y > 0 && inner >= hub - R && outer <= hub + R) {
        inside++;
        // Actuator disc: the axial velocity falls from V + vi at the disc to V + 2 vi far behind it; the wing
        // (1.1 m, about 1.2 R, behind the disc) lies between the two.
        const ratio = windmill[k].q / clean[k].q;
        expect(ratio).toBeLessThan(((V + vi) / V) ** 2);
        expect(ratio).toBeGreaterThan(((V + 2 * vi) / V) ** 2 - 0.01);
        expect(windmill[k].lift).toBeLessThan(clean[k].lift);
      } else if (y < 0 || inner > hub + R + 0.2) {
        // The other wing and the strips outboard of the jet keep their dynamic pressure.
        expect(Math.abs(windmill[k].q / clean[k].q - 1)).toBeLessThan(0.003);
      }
    }
    expect(inside).toBeGreaterThanOrEqual(4);
  });

  it('the test-bed jet of a windmilling propeller swirls against its rotation (the air drives it: the torque is reversed)', () => {
    const station = def.propellers![1];
    expect(jetAt(station, { V, vi: 8 }, 1).swirlRate).toBeGreaterThan(0);
    expect(jetAt(station, { V, vi: -3 }, 1).swirlRate).toBeLessThan(0);
    expect(jetAt(station, { V, vi: -3 }, -1).swirlRate).toBeGreaterThan(0);
    // And its tube expands (momentum theory), where a driving propeller's contracts.
    expect(jetAt(station, { V, vi: -3 }).radius).toBeGreaterThan(station.radius);
    expect(jetAt(station, { V, vi: 8 }).radius).toBeLessThan(station.radius);
  });

  it('blown lift: the wing gains 0.4-0.8 of the immersed strips\' lift times (q_jet / q - 1) (finite-jet correction, Koning; Smelt & Davies)', () => {
    // V 30 m/s, no swirl. q_jet at the wing (1.1 m behind the disc) from the jet's developing momentum-theory
    // increment. A jet about one chord deep does not give the wing the lift of an unbounded stream of its speed;
    // the share falls with alpha as the faster axial flow dilutes the cross-flow (propeller downwash).
    const V30 = 30, R = TWIN_PROP_RADIUS, d = 1.1, hub = def.propellers![1].hub.y;
    for (const alphaDeg of [2, 8]) {
      model.compute(twinInput({ V: V30, alphaDeg }, [null, null]));
      const before = model.diagnostics.slice(0, def.wing.length).map(stripLift);
      for (const vi of [5, 10, 15]) {
        const j: JetOptions = { V: V30, vi, swirl: 0 };
        model.compute(twinInput({ V: V30, alphaDeg }, twinSlipstreams(def, 'counter', j, j)));
        let immersed = 0, gain = 0;
        model.diagnostics.slice(0, def.wing.length).forEach((dg, k) => {
          if (Math.abs(Math.abs(def.wing[k].mid.y) - hub) < R - 0.02) immersed += before[k];
          gain += stripLift(dg) - before[k];
        });
        const qRatio = (V30 + vi * (1 + d / Math.hypot(d, R))) ** 2 / V30 ** 2;
        const share = gain / (immersed * (qRatio - 1));
        expect(share, `alpha ${alphaDeg} vi ${vi}`).toBeGreaterThan(0.4);
        expect(share, `alpha ${alphaDeg} vi ${vi}`).toBeLessThan(0.8);
      }
    }
  });

  it('wingBlowing scales the axial velocity increment on the wing strips, of either sign, and not on the tail', () => {
    const blown = twinAeroDefinition({ wingBlowing: 0.7 });
    const m07 = new AeroModel(blown, { quasiSteady: true });
    for (const vi of [8, -3]) {
      const jets = (d: AircraftAeroDefinition) => twinSlipstreams(d, 'counter', null, { V, vi });
      model.compute(twinInput({ V, alphaDeg: 4 }, [null, null]));
      const clean = model.diagnostics.map((d) => d.dynamicPressure);
      model.compute(twinInput({ V, alphaDeg: 4 }, jets(def)));
      const full = model.diagnostics.map((d) => d.dynamicPressure);
      m07.compute(twinInput({ V, alphaDeg: 4 }, jets(blown)));
      const part = m07.diagnostics.map((d) => d.dynamicPressure);
      const hub = def.propellers![1].hub.y;
      for (let k = 0; k < def.wing.length; k++) {
        const y = model.diagnostics[k].position.y;
        if (Math.abs(y - hub) > 0.5) continue;
        const increment = (q: number) => Math.sqrt(q) - Math.sqrt(clean[k]);
        expect(increment(part[k]) / increment(full[k])).toBeCloseTo(0.7, 1);
      }
      // Tail strips in the jet: the same jet (only the wing's changed downwash reaches them).
      for (let k = def.wing.length; k < full.length; k++) {
        if (model.diagnostics[k].surface !== 'hTail' || model.diagnostics[k].position.y < 0.9) continue;
        expect(Math.abs(part[k] / full[k] - 1)).toBeLessThan(0.02);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------- nacelles

describe('nacelle bodies', () => {
  const hub = twinHub();
  const nacelle = twinNacelle(hub);

  /** Uniform air flow at angle of attack alpha (air relative to the body, body axes). */
  const uniform = (U: number, alpha: number): FlowSampler => ({
    sample(_p: Vec3, out) {
      out.x = -U * Math.cos(alpha);
      out.y = 0;
      out.z = -U * Math.sin(alpha);
    },
  });
  class Sum implements LoadAccumulator {
    f = { x: 0, y: 0, z: 0 };
    m = { x: 0, y: 0, z: 0 };
    addForce(p: Vec3, fx: number, fy: number, fz: number): void {
      this.f.x += fx; this.f.y += fy; this.f.z += fz;
      const m = v3.cross(p, { x: fx, y: fy, z: fz });
      this.m.x += m.x; this.m.y += m.y; this.m.z += m.z;
    }
    addMoment(): void {}
  }

  it('carries the slender-body normal force of its potential-flow forebody on its own axis (Munk; Hopkins; Allen & Perkins)', () => {
    const body = new Fuselage(nacelle);
    const U = 50, alpha = 3 * DEG;
    const loads = new Sum();
    body.addLoads(RHO, uniform(U, alpha), new Float64Array(3 * body.points.length), 0, loads);
    const st = nacelle.stations;
    // Slender-body theory: the potential normal force is rho U^2 alpha k times the apparent-mass area of the section
    // where potential flow ends (pi b^2 for cross-flow along the section's height, b the half-width; Lamb sec. 72).
    // Hopkins (NACA RM A51C14): potential flow ends 0.378 l + 0.527 x1 behind the nose, x1 where the body narrows
    // fastest; the station there is interpolated. Then the cross-flow drag of the plan area (Allen & Perkins, TR 1048).
    const length = st[0].x - st[st.length - 1].x;
    let x1 = 0, steepest = Infinity;
    for (let k = 0; k + 1 < st.length; k++) {
      const slope = ((st[k + 1].width * st[k + 1].height - st[k].width * st[k].height) / (st[k].x - st[k + 1].x));
      if (slope < steepest) { steepest = slope; x1 = st[0].x - 0.5 * (st[k].x + st[k + 1].x); }
    }
    const x0 = 0.378 * length + 0.527 * x1;
    // The model's potential flow ends at the last segment whose centre lies ahead of x0.
    let end = 0;
    for (let k = 0; k + 1 < st.length; k++) if (st[0].x - 0.5 * (st[k].x + st[k + 1].x) < x0) end = k + 1;
    const massArea = (Math.PI / 4) * st[end].width ** 2;
    let plan = 0;
    for (let k = 0; k + 1 < st.length; k++) plan += 0.5 * (st[k].width + st[k + 1].width) * (st[k].x - st[k + 1].x);
    const q = dyn(U);
    const expected = 2 * nacelle.apparentMass * q * massArea * Math.sin(alpha) * Math.cos(alpha) + q * nacelle.crossflowDrag * plan * Math.sin(alpha) ** 2;
    expect(-loads.f.z / expected).toBeGreaterThan(0.9);
    expect(-loads.f.z / expected).toBeLessThan(1.1);
    // The load acts on the nacelle's axis: rolling moment / normal force = the axis's y.
    expect(loads.m.x / loads.f.z).toBeCloseTo(hub.y, 6);
    expect(Math.abs(loads.f.y)).toBeLessThan(1e-9);
  });

  it('adds its blockage to the inflow at its own propeller and turns the wing strips across it into body bands', () => {
    const withNacelles = new AeroModel(twinAeroDefinition(), { quasiSteady: true });
    const without = twinAeroDefinition();
    delete without.nacelles;
    const bare = new AeroModel(without, { quasiSteady: true });
    const a = withNacelles.compute(makeInput({ V: 40, alphaDeg: 2 })).propellerInflows!;
    const b = bare.compute(makeInput({ V: 40, alphaDeg: 2 })).propellerInflows!;
    // A body behind the disc slows the air reaching it (Rankine body: + x is against the flow).
    expect(a[1].x).toBeGreaterThan(b[1].x);
    expect(withNacelles.propellerInflows[0]).toBe(withNacelles.propellerInflow);
    expect(withNacelles.propellerInflows.length).toBe(2);
    // The band's strips have no profile drag (it is the nacelle's) and follow a neighbour's separation.
    const wing = withNacelles.definition.wing;
    const band = wing.map((s, k) => ({ s, k })).filter(({ s }) => s.bodySection && s.span > 1);
    expect(band.length).toBe(4);
    for (const { s } of band) {
      expect(Math.abs(Math.abs(0.5 * (s.a.y + s.b.y)) - 1.9)).toBeLessThan(0.3);
      expect(s.separationFrom).toBeDefined();
      expect(wing[s.separationFrom!].bodySection).toBe(false);
      expect(wing[s.separationFrom!].side).toBe(s.side);
    }
    withNacelles.compute(makeInput({ V: 40, alphaDeg: 22 }));
    for (const { s, k } of band) {
      const d = withNacelles.diagnostics[k];
      expect(d.cd).toBe(0);
      expect(d.separation).toBe(withNacelles.diagnostics[s.separationFrom!].separation);
    }
  });
});

// ---------------------------------------------------------------------------------------------- tails

describe('T-tail junction', () => {
  const V = 45;
  const finLift = (m: AeroModel, betaDeg: number) => {
    m.compute(makeInput({ V, alphaDeg: 4, betaDeg, surfaces: { elevator: -5 * DEG } }));
    return { fin: surfaceSum(m, 'vTail', stripLift), tailplane: surfaceSum(m, 'hTail', stripLift) };
  };

  it('closes at the fin tip: the tailplane halves meet there, and a lifting tailplane loads no fin without sideslip', () => {
    const def = tTailAeroDefinition();
    const tailplane = def.tail.filter((s) => s.surface === 'hTail');
    const fin = def.tail.filter((s) => s.surface === 'vTail');
    const finTip = fin.reduce((top, s) => (Math.min(s.a.z, s.b.z) < Math.min(top.a.z, top.b.z) ? s : top));
    const tipPoint = finTip.a.z < finTip.b.z ? finTip.a : finTip.b;
    // The root ends of the two root strips and the fin tip's end are one point (Kirchhoff: their legs cancel).
    const roots = tailplane.filter((s) => Math.abs(s.a.y) < 1e-12 || Math.abs(s.b.y) < 1e-12);
    expect(roots.length).toBe(2);
    for (const s of roots) {
      const p = Math.abs(s.a.y) < 1e-12 ? s.a : s.b;
      expect(v3.len(v3.sub(p, tipPoint))).toBeLessThan(1e-12);
    }
    const m = new AeroModel(def, { quasiSteady: true });
    const level = finLift(m, 0);
    expect(Math.abs(level.tailplane)).toBeGreaterThan(300);
    expect(Math.abs(level.fin)).toBeLessThan(1e-6 * Math.abs(level.tailplane));
  });

  it('the tailplane end-plates the fin: fin lift slope up by 15-45 % (DATCOM 5.3.1.1 with Helmbold)', () => {
    const withTp = new AeroModel(tTailAeroDefinition(), { quasiSteady: true });
    const finOnly = new AeroModel(tTailAeroDefinition({ tailplane: false }), { quasiSteady: true });
    const slope = (m: AeroModel) => (finLift(m, 4).fin - finLift(m, 0).fin) / 4;
    const ratio = slope(withTp) / slope(finOnly);
    // DATCOM fig. 5.3.1.1-24: a tailplane on the fin's tip raises its effective aspect ratio by a factor of about
    // 1.4-1.6; through Helmbold's low-aspect-ratio slope 2 pi A / (2 + sqrt(A^2 + 4)) at the fin's A of 1.5-2.5
    // that is 1.2-1.4 in lift slope.
    expect(ratio).toBeGreaterThan(1.15);
    expect(ratio).toBeLessThan(1.45);
  });
});

describe('stabilator (all-moving tailplane: a rotation of the strip)', () => {
  const V = 45;
  const noWake = { wake: { widthScale: 0 } };
  const tailplaneLift = (m: AeroModel) => surfaceSum(m, 'hTail', stripLift);
  const tailplaneDrag = (m: AeroModel) => surfaceSum(m, 'hTail', (d) => d.cd * d.dynamicPressure * d.area);

  it('gives the lift per degree of the hand-rotated surface within 5 % at three points, one beyond the stall, with no flap drag', () => {
    const fixed = new AeroModel({ ...stabilatorAeroDefinition({ allMoving: false }), ...noWake }, { quasiSteady: true });
    const moving = new AeroModel({ ...stabilatorAeroDefinition(), ...noWake }, { quasiSteady: true });
    // Attached, attached at a large deflection, and deep beyond the stall (every strip separated on both).
    // Near the stall break the comparison is ill-conditioned: rotating the strips by hand also moves their
    // control points and chordwise trailing legs (by 3/4 chord x sin delta), which shifts the strip whose flow
    // separates first; the per-degree figure, a small difference of two large lifts, then scatters by 10-50 %.
    const points = [
      { deltaDeg: 4, alphaDeg: 6, stalled: false },
      { deltaDeg: -8, alphaDeg: 6, stalled: false },
      { deltaDeg: 12, alphaDeg: 24, stalled: true },
    ];
    for (const p of points) {
      const hand = new AeroModel({ ...stabilatorAeroDefinition({ incidence: p.deltaDeg * DEG, allMoving: false }), ...noWake }, { quasiSteady: true });
      const input = makeInput({ V, alphaDeg: p.alphaDeg });
      const l0 = (fixed.compute(input), tailplaneLift(fixed));
      const lh = (hand.compute(input), tailplaneLift(hand));
      const dh = tailplaneDrag(hand);
      moving.compute(makeInput({ V, alphaDeg: p.alphaDeg, surfaces: { elevator: p.deltaDeg * DEG } }));
      const lm = tailplaneLift(moving), dm = tailplaneDrag(moving);
      expect(Math.abs((lm - l0) / (lh - l0) - 1)).toBeLessThan(0.05);
      // Lift and drag resolved about the local wind, no flap drag increment: the hand-rotated surface's drag.
      expect(Math.abs(dm / dh - 1)).toBeLessThan(0.05);
      const strips = moving.diagnostics.filter((d) => d.surface === 'hTail' && d.side !== 0);
      expect(strips.every((d) => d.stalled)).toBe(p.stalled);
      if (!p.stalled) expect(strips.some((d) => d.stalled)).toBe(false);
      // tailplaneAlpha() still reports the fixed reference chord's angle: the deflection is not in it.
      const fixedAlpha = (fixed.compute(makeInput({ V, alphaDeg: p.alphaDeg })), fixed.tailplaneAlpha());
      moving.compute(makeInput({ V, alphaDeg: p.alphaDeg, surfaces: { elevator: p.deltaDeg * DEG } }));
      expect(Math.abs(moving.tailplaneAlpha() - fixedAlpha)).toBeLessThan(Math.abs(p.deltaDeg * DEG) * 0.25);
    }
  });

  it('turns as one piece, its centre through the tail cone included; the anti-servo tab is an ordinary plain flap', () => {
    const def = stabilatorAeroDefinition({ tabGearing: 0.5 });
    const tailplane = def.tail.filter((s) => s.surface === 'hTail');
    for (const s of tailplane) {
      const moving = s.controls.filter((c) => c.flap.kind === 'allMoving');
      expect(moving.length).toBe(1);
      expect(moving[0].coverage).toBe(1);
    }
    const m = new AeroModel({ ...def, ...noWake }, { quasiSteady: true });
    const lift = (trim: number) => (m.compute(makeInput({ V, alphaDeg: 2, surfaces: { elevatorTrim: trim } })), tailplaneLift(m));
    // Trim alone deflects the tab: trailing edge down (+) raises the tailplane's lift.
    expect(lift(5 * DEG)).toBeGreaterThan(lift(0));
  });
});

// ---------------------------------------------------------------------------------------------- wings

describe('low wing (centre carry-over through the fuselage)', () => {
  it('runs the carry-over wing through the wing wake and the jet path in time-stepping mode, symmetric with no swirl', () => {
    const def = lowWingAeroDefinition();
    const m = new AeroModel(def);
    const station = def.propellers![0];
    let out = m.compute(makeInput({ V: 30, alphaDeg: 8, dt: 0.0025 }));
    for (let k = 0; k < 60; k++) {
      const input = makeInput({ V: 30, alphaDeg: 8, dt: k % 4 === 0 ? 0.0025 : 0 });
      input.slipstream = jetAt(station, { V: 30, vi: 10, swirl: 0 });
      out = m.compute(input);
    }
    for (const v of [out.force.x, out.force.y, out.force.z, out.moment.x, out.moment.y, out.moment.z]) expect(Number.isFinite(v)).toBe(true);
    expect(Math.abs(out.moment.x / (out.lift * def.referenceSpan))).toBeLessThan(1e-6);
    expect(Math.abs(out.moment.z / (out.lift * def.referenceSpan))).toBeLessThan(1e-6);
    // The carry-over strip carries the mean of its neighbours' circulation (lift continuous through the body).
    const centre = def.wing.findIndex((s) => s.carryover);
    const g = m.diagnostics.map((d) => d.circulation);
    expect(g[centre]).toBeCloseTo(0.5 * (g[centre - 1] + g[centre + 1]), 9);
  });

  it('a low wing loses dihedral effect against a high wing by the DATCOM wing-body increment', () => {
    const V = 50;
    const clBeta = (wingZ: number) => {
      const m = new AeroModel(lowWingAeroDefinition({ wingZ, dihedral: 0 }), { quasiSteady: true });
      return (coefficients(m, { V, alphaDeg: 3, betaDeg: 4 }).Cl - coefficients(m, { V, alphaDeg: 3, betaDeg: 0 }).Cl) / 4;
    };
    const low = 0.45, high = -0.6;
    const measured = clBeta(low) - clBeta(high);
    // DATCOM 5.2.2.1: dCl_beta = 1.2 sqrt(A) / 57.3 (z_w / b) (2 d / b) per deg, z_w the wing root's height below
    // the body axis (+ = low wing, destabilising), d the body's mean depth at the wing.
    const def = baseDefinition();
    const xw = C172.wing.quarterChord.x;
    const axisZ = bodyAxisZ(def.fuselage, xw);
    const st = def.fuselage.stations;
    const k = st.findIndex((s) => s.x < xw);
    const d = Math.sqrt(st[k].width * st[k].height);
    const b = def.referenceSpan, A = (b * b) / def.referenceArea;
    const datcom = ((1.2 * Math.sqrt(A)) / 57.3) * ((low - axisZ - (high - axisZ)) / b) * ((2 * d) / b);
    expect(measured).toBeGreaterThan(0);
    expect(measured / datcom).toBeGreaterThan(0.7);
    expect(measured / datcom).toBeLessThan(1.3);
  });
});

describe('winglets (extra stations of the wing planform, one lifting line)', () => {
  const V = 50;
  const h = 0.8;

  /**
   * Induced drag of a wing's circulation in a discrete Trefftz plane: a trailing vortex at every strip end, the
   * normalwash at every strip's midpoint (Katz & Plotkin sec. 8.3; independent of where the model resolves its forces).
   */
  function trefftz(def: AircraftAeroDefinition, m: AeroModel): { Di: number; L: number } {
    const strips = def.wing, n = strips.length;
    const g = m.diagnostics.slice(0, n).map((d) => d.circulation);
    let Di = 0, L = 0;
    for (let j = 0; j < n; j++) {
      const s = strips[j];
      const py = 0.5 * (s.a.y + s.b.y), pz = 0.5 * (s.a.z + s.b.z);
      let wy = 0, wz = 0;
      for (let i = 0; i < n; i++) {
        for (const [p, G] of [[strips[i].b, g[i]], [strips[i].a, -g[i]]] as const) {
          const dy = py - p.y, dz = pz - p.z, r2 = dy * dy + dz * dz;
          if (r2 < 1e-10) continue;
          wy += (-G * dz) / (2 * Math.PI * r2);
          wz += (G * dy) / (2 * Math.PI * r2);
        }
      }
      const wn = (wy * s.n.y + wz * s.n.z) / Math.hypot(s.n.y, s.n.z);
      Di += 0.5 * RHO * g[j] * wn * Math.hypot(s.b.y - s.a.y, s.b.z - s.a.z);
      L += RHO * V * g[j] * (s.b.y - s.a.y);
    }
    return { Di, L };
  }

  /**
   * The wing's induced drag factor Di / L^2 two ways, for the same circulation: the model's own force, and the
   * Trefftz plane. The model's force is found as the control-point tilt L (alpha_geometric - alpha) of the same
   * strips with Strip.forceAtBound removed (their circulation is the same: only assemble reads the flag) plus the
   * change of the whole aircraft's drag the flag makes. Also the directional stability Cn_beta (per deg).
   */
  function wingRun(p: Planform, atBound = true) {
    const make = (flag: boolean) => {
      const def = twinAeroDefinition({ nacelles: false, hubGrid: false });
      def.wing = buildStrips(p);
      if (!flag) for (const st of def.wing) delete st.forceAtBound;
      def.stallWarning = { strip: stallSensorStrip(def.wing), margin: 7.8 * DEG };
      return { def, m: new AeroModel(def, { quasiSteady: true }) };
    };
    const at = make(atBound), cp = make(false);
    const drag = (x: typeof at) => x.m.compute(makeInput({ V, alphaDeg: 4 })).drag;
    const dFlag = drag(at) - drag(cp);
    let lift = 0, tilt = 0;
    for (let i = 0; i < cp.def.wing.length; i++) {
      const d = cp.m.diagnostics[i];
      lift += stripLift(d) * Math.abs(cp.def.wing[i].s.y);
      tilt += stripLift(d) * (d.geometricAlpha - d.alpha);
    }
    at.m.compute(makeInput({ V, alphaDeg: 4 }));
    const t = trefftz(at.def, at.m);
    const plus = coefficients(at.m, { V, alphaDeg: 4, betaDeg: 4 }), minus = coefficients(at.m, { V, alphaDeg: 4, betaDeg: -4 });
    return { model: (tilt + dFlag) / (lift * lift), controlPoint: tilt / (lift * lift), trefftz: t.Di / (t.L * t.L), cnBeta: (plus.Cn - minus.Cn) / 8 };
  }
  // The plain wing on the same footing (general incidence: its strips also carry their force at the bound vortex).
  const base = wingRun({ ...c172WingPlanform(), generalIncidence: true });
  const winglet = wingRun(wingletWingPlanform(h, 90 * DEG));
  const planar = wingRun(wingletWingPlanform(h, 0));

  it('carry their force at the bound vortex: the induced drag of the model equals the Trefftz-plane drag of its circulation within 3 %', () => {
    for (const r of [base, winglet, planar, wingRun(wingletWingPlanform(h, 80 * DEG)), wingRun(wingletWingPlanform(0.55, 90 * DEG))]) {
      expect(Math.abs(r.model / r.trefftz - 1)).toBeLessThan(0.03);
    }
    // At the control point the same winglet circulation gave 0.80 of the plain wing's factor where the Trefftz
    // plane has 0.88: 55 % too large a saving (review-Bm-aero finding 1).
    const old = wingRun(wingletWingPlanform(h, 90 * DEG), false), oldBase = wingRun({ ...c172WingPlanform(), generalIncidence: true }, false);
    expect(winglet.trefftz / base.trefftz - old.controlPoint / oldBase.controlPoint).toBeGreaterThan(0.05);
    // On a planar wing the control point's tilt overstates the induced drag of the same circulation by about a
    // quarter (the 3/4-chord point sees more of the trailing sheet than the bound vortex does). The Cessna 172S keeps
    // that force (none of its strips carries forceAtBound; its records were made with it): request B-Bm-fix-aero-01.
    expect(oldBase.controlPoint / base.trefftz).toBeGreaterThan(1.15);
    expect(oldBase.controlPoint / base.trefftz).toBeLessThan(1.35);
    const c172 = baseDefinition();
    expect([...c172.wing, ...c172.tail].some((st) => st.forceAtBound !== undefined)).toBe(false);
  });

  it('save about half of what a planar span extension of the same length saves (end-plate theory; Prandtl: Di ~ 1 / b^2)', () => {
    const b = C172.wing.span;
    // The planar extension at the same span loading: Di / L^2 = 1 / (q pi e b^2).
    expect(planar.model / base.model).toBeGreaterThan(((b / (b + 2 * h)) ** 2) * 0.97);
    expect(planar.model / base.model).toBeLessThan(((b / (b + 2 * h)) ** 2) * 1.04);
    // A vertical winglet of height h: e ~ 1 + 1.9 h / b (Hoerner, Fluid-Dynamic Drag 7-6), about half the planar
    // extension's gain (Kroo, Annu. Rev. Fluid Mech. 33, 2001). Measured 13 % against 24 %.
    const share = (1 - winglet.model / base.model) / (1 - planar.model / base.model);
    expect(share).toBeGreaterThan(0.45);
    expect(share).toBeLessThan(0.65);
    expect(1 / (winglet.model / base.model)).toBeGreaterThan(1 + 1.9 * (h / b) * 0.7);
    expect(1 / (winglet.model / base.model)).toBeLessThan(1 + 1.9 * (h / b) * 1.3);
  });

  it('cost directional stability on a straight wing: the lift of the windward winglet, tilted forward by the tip vortex, pulls its tip forward', () => {
    // Winglets standing at the reference point's x add almost no side-force moment (+9 N m/deg on this test-bed);
    // the yaw comes from their Kutta-Joukowski thrust, which rises on the windward winglet (-43 N m/deg). On a
    // swept transport the winglets sit far aft and the side force wins (Whitcomb, NASA TN D-8260: Cn_beta about
    // unchanged); here the loss is 21 % of the test-bed's (C172) Cn_beta. The DA42's fin is checked against its own
    // directional data in Stage D.
    expect(base.cnBeta).toBeGreaterThan(0);
    expect(winglet.cnBeta / base.cnBeta).toBeGreaterThan(0.7);
    expect(winglet.cnBeta / base.cnBeta).toBeLessThan(0.9);
    // A planar extension of the same length leaves it within 5 %.
    expect(Math.abs(planar.cnBeta / base.cnBeta - 1)).toBeLessThan(0.05);
  });

  it('general incidence turns a winglet strip about its own span axis (toe-in) and leaves a flat panel as before', () => {
    const toe = 3 * DEG;
    const p = wingletWingPlanform(0.8, 90 * DEG, toe);
    const strips = buildStrips(p);
    const plain = buildStrips({ ...p, generalIncidence: false });
    const right = strips.filter((s) => s.side === 1);
    const winglet = right[right.length - 1];
    // Leading edge (-t) inboard on the right winglet: t.y = sin(toe).
    expect(winglet.t.y).toBeCloseTo(Math.sin(toe), 12);
    // On the wing's own (flat) panels the two rules agree.
    const flat = right.findIndex((s) => Math.abs(s.s.z) < 1e-9);
    expect(flat).toBeGreaterThanOrEqual(0);
    const k = strips.indexOf(right[flat]);
    expect(strips[k].t.x).toBeCloseTo(plain[k].t.x, 12);
    expect(strips[k].t.z).toBeCloseTo(plain[k].t.z, 12);
  });
});

describe('spanwise sections and bands', () => {
  it('blendSections is linear in every field', () => {
    const mid = blendSections(NACA_2412, NACA_0012, 0.25);
    for (const key of ['liftSlope', 'alpha0', 'cm0', 'cdMin', 'stallPos', 'stallNeg', 's1', 's2', 'reRef'] as const) {
      expect(mid[key]).toBeCloseTo(NACA_2412[key] + 0.25 * (NACA_0012[key] - NACA_2412[key]), 12);
    }
    expect(blendSections(NACA_2412, NACA_0012, 0)).toBe(NACA_2412);
    expect(blendSections(NACA_2412, NACA_0012, 1)).toBe(NACA_0012);
  });

  it('a wing lofted from one section to another blends by station, and a section band replaces it locally', () => {
    const base = c172WingPlanform();
    const strutStation = { ...base.stations[base.stations.length - 1], span: 2.5, section: NACA_2412 };
    const lofted: Planform = {
      ...base,
      stations: [...base.stations.slice(0, -1).filter((s) => s.span < 2.5), { ...strutStation }, { ...base.stations[base.stations.length - 1], section: NACA_0012 }],
      // A stall strip on the second strip from the root.
      sectionBands: [{ from: base.edges[1], to: base.edges[2], section: { ...NACA_2412, stallPos: 14 * DEG } }],
    };
    const right = buildStrips(lofted).filter((s) => s.side === 1);
    const tip = right[right.length - 1];
    expect(tip.section.alpha0).toBeLessThan(0);
    expect(tip.section.alpha0).toBeGreaterThan(NACA_2412.alpha0);
    // Thickness/camber fall outboard monotonically beyond the strut station.
    const outboard = right.filter((s) => s.span > 2.5);
    for (let k = 1; k < outboard.length; k++) expect(outboard[k].section.alpha0).toBeGreaterThanOrEqual(outboard[k - 1].section.alpha0);
    const banded = right.filter((s) => s.section.stallPos === 14 * DEG);
    expect(banded.length).toBe(1);
    expect(banded[0].span).toBeCloseTo(0.5 * (base.edges[1] + base.edges[2]), 12);
  });
});

// ---------------------------------------------------------------------------------------------- options

describe('scaled drag items, stall sensors, wake options', () => {
  it('a scaled drag item presents retractedFraction + (1 - retractedFraction) x value of its area (q x CdA)', () => {
    const def = baseDefinition();
    const area = 0.12, stowed = 0.25;
    def.dragItems = [...def.dragItems, { name: 'test leg', position: { x: -0.5, y: 1.3, z: 1.4 }, area: { x: area, y: 0.02, z: 0.02 }, scale: { kind: 'gear', leg: 1 }, retractedFraction: stowed }];
    const m = new AeroModel(def, { quasiSteady: true });
    const V = 50;
    const at = (value: number | null) => {
      const input = makeInput({ V, alphaDeg: 0 });
      if (value !== null) input.dragScales = { gear: [1, value, 1], cowlFlaps: [] };
      return m.compute(input).drag;
    };
    const down = at(1), up = at(0), absent = at(null);
    expect(absent).toBe(down);
    // Below the wing the item sees close to the free stream (upwash and body blockage change q by a few per cent).
    const expected = (1 - stowed) * area * dyn(V);
    expect((down - up) / expected).toBeGreaterThan(0.95);
    expect((down - up) / expected).toBeLessThan(1.05);
    expect(at(0.5)).toBeCloseTo(0.5 * (up + down), 6);
  });

  it('the first stall sensor whose flap range matches is used; an invalid strip index is refused', () => {
    const def = baseDefinition();
    const k = stallSensorStrip(def.wing);
    def.stallWarning = [
      { strip: k, margin: 1, flaps: [0, 5 * DEG] },
      { strip: k, margin: 0, flaps: [5 * DEG, 40 * DEG] },
    ];
    const m = new AeroModel(def, { quasiSteady: true });
    expect(m.compute(makeInput({ V: 40, alphaDeg: 2 })).stallWarning).toBe(true);
    expect(m.compute(makeInput({ V: 40, alphaDeg: 2, surfaces: { flaps: 20 * DEG } })).stallWarning).toBe(false);
    expect(() => new AeroModel({ ...def, stallWarning: [{ strip: def.wing.length, margin: 0.1 }] })).toThrow();
  });

  it('wake.maxLoss caps the dynamic-pressure loss of a T-tail in the stalled wing wake; 0 removes the wake', () => {
    // At 20 deg the separated wing's wake passes over the T-tail (it passes above the C172's low tailplane).
    const condition = makeInput({ V: 35, alphaDeg: 20 });
    const tailQ = (wake?: AircraftAeroDefinition['wake']) => {
      const m = new AeroModel({ ...tTailAeroDefinition(), wake }, { quasiSteady: true });
      m.compute(condition);
      return m.diagnostics.filter((d) => d.surface === 'hTail').map((d) => d.dynamicPressure);
    };
    const none = tailQ({ widthScale: 0 });
    expect(tailQ({ maxLoss: 0 })).toEqual(none);
    const full = tailQ();
    const capped = tailQ({ maxLoss: 0.2 });
    expect(Math.min(...full.map((q, i) => q / none[i]))).toBeLessThan(0.8);
    for (let i = 0; i < none.length; i++) expect(capped[i] / none[i]).toBeGreaterThan(0.8 - 0.03);
  });
});

// ---------------------------------------------------------------------------------------------- cost

describe('cost of a second jet', () => {
  it('a two-jet call costs at most 1.9 x the one-jet (C172S) call (same run, min of 5)', { timeout: 60_000 }, () => {
    const single = new AeroModel();
    const twinDef = twinAeroDefinition();
    const twin = new AeroModel(twinDef);
    const nose = createJet(single.definition.propellers![0]);
    const n = 600;
    const run = (m: AeroModel, twinJets: boolean) => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        const input = makeInput({ V: 55, alphaDeg: 2 + Math.sin(i * 0.01), q: 0.05, dt: i % 4 === 0 ? 0.0025 : 0 });
        if (twinJets) input.slipstreams = twinSlipstreams(twinDef, 'counter', { V: 55, vi: 6 }, { V: 55, vi: 6 });
        else input.slipstream = nose;
        m.compute(input);
      }
      return ((performance.now() - t0) / n) * 1000;
    };
    run(single, false);
    run(twin, true);
    let one = Infinity, two = Infinity;
    for (let r = 0; r < 5; r++) {
      one = Math.min(one, run(single, false));
      two = Math.min(two, run(twin, true));
    }
    (globalThis as { process?: { stdout: { write(s: string): void } } }).process?.stdout.write(
      `[aero cost] one jet ${one.toFixed(1)} us, two jets ${two.toFixed(1)} us, ratio ${(two / one).toFixed(2)}\n`,
    );
    expect(two / one).toBeLessThanOrEqual(1.9);
  });
});

function createJet(station: { hub: Vec3; radius: number }) {
  return jetAt(station, { V: 55, vi: 6 });
}
