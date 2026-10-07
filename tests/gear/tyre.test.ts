// Unit tests of the tyre / wheel model in isolation, with prescribed contact kinematics.

import { describe, expect, test } from 'vitest';
import { DEG } from '../../src/core/math';
import { C172_GEAR, SURFACES } from '../../src/physics/gear';
import { WheelDynamics, type WheelContact } from '../../src/physics/gear/tyre';

const MAIN = C172_GEAR.wheels[1].tyre;
const LOAD = 3775;
const DT = 1 / 240;

function contact(speed: number, slipAngle: number, extra: Partial<WheelContact> = {}): WheelContact {
  return { va: speed, vb: speed * Math.tan(slipAngle), load: LOAD, surface: SURFACES.runway, brakeTorque: 0, steerCommand: 0, ...extra };
}

/** Run a wheel at constant kinematics, starting from free rolling. */
function steady(c: WheelContact, seconds = 2): { fa: number; fb: number; skid: number; wheel: WheelDynamics } {
  const wheel = new WheelDynamics(MAIN, null);
  wheel.spin = c.va / MAIN.radius;
  for (let t = 0; t < seconds; t += DT) wheel.advance(c, DT);
  return { ...wheel.force(c, { fa: 0, fb: 0, skid: 0 }), wheel };
}

describe('tyre', () => {
  test('linear cornering stiffness at small slip angles', () => {
    const f = steady(contact(20, 1 * DEG));
    const cAlpha = -f.fb / (LOAD * Math.tan(1 * DEG));
    // Brush model: dF/dalpha = C (1 - theta + theta^2 / 3) with theta = C tan(alpha) / (3 mu).
    const theta = (MAIN.corneringStiffness * Math.tan(DEG)) / (3 * SURFACES.runway.muPeak);
    console.log(`[tyre] cornering stiffness per unit load at 1 deg: ${cAlpha.toFixed(3)} /rad (brush theory ${(MAIN.corneringStiffness * (1 - theta + (theta * theta) / 3)).toFixed(3)})`);
    expect(cAlpha).toBeCloseTo(MAIN.corneringStiffness * (1 - theta + (theta * theta) / 3), 1);
    expect(f.skid).toBe(0);
  });

  test('side force saturates at the friction limit and the tyre reports sliding', () => {
    const f = steady(contact(20, 20 * DEG));
    const mu = Math.hypot(f.fa, f.fb) / LOAD;
    console.log(`[tyre] 20 deg slip: mu_eff=${mu.toFixed(3)} skid=${f.skid.toFixed(2)}`);
    expect(mu).toBeLessThanOrEqual(SURFACES.runway.muPeak + 1e-9);
    expect(mu).toBeGreaterThanOrEqual(SURFACES.runway.muSlide - 1e-9);
    expect(f.skid).toBeGreaterThan(0.9);
  });

  test('combined slip: a locked wheel loses its cornering force (friction circle)', () => {
    const rolling = steady(contact(20, 3 * DEG));
    const locked = steady(contact(20, 3 * DEG, { brakeTorque: 5000 }));
    const total = Math.hypot(locked.fa, locked.fb) / LOAD;
    console.log(`[tyre] 3 deg slip: rolling Fy=${rolling.fb.toFixed(0)} N, locked Fy=${locked.fb.toFixed(0)} N Fx=${locked.fa.toFixed(0)} N (|F|/N=${total.toFixed(3)})`);
    expect(locked.wheel.spin).toBe(0);
    expect(Math.abs(locked.fb)).toBeLessThan(0.3 * Math.abs(rolling.fb));
    expect(total).toBeLessThanOrEqual(SURFACES.runway.muPeak + 1e-9);
    // A locked wheel slides against its direction of travel.
    expect(locked.fa).toBeLessThan(0);
  });

  test('lateral force builds up over one relaxation length of travel', () => {
    const speed = 10;
    const c = contact(speed, 2 * DEG);
    const final = steady(c).fb;
    const wheel = new WheelDynamics(MAIN, null);
    wheel.spin = speed / MAIN.radius;
    const h = 1e-4;
    let t = 0;
    while (wheel.force(c).fb > 0.632 * final) {
      wheel.advance(c, h);
      t += h;
    }
    console.log(`[tyre] 63 % rise after ${(t * speed).toFixed(3)} m of travel (relaxation length ${MAIN.relaxationLat} m)`);
    expect(t * speed).toBeGreaterThan(0.7 * MAIN.relaxationLat);
    expect(t * speed).toBeLessThan(1.3 * MAIN.relaxationLat);
  });

  test('at a standstill the tread is a spring: no creep, no relaxation', () => {
    const wheel = new WheelDynamics(MAIN, null);
    const push = { va: 0, vb: 0.002, load: LOAD, surface: SURFACES.runway, brakeTorque: 0, steerCommand: 0 };
    for (let t = 0; t < 0.5; t += DT) wheel.advance(push, DT); // 1 mm of sideways displacement
    const still = { ...push, vb: 0 };
    const f0 = wheel.force(still).fb;
    for (let t = 0; t < 30; t += DT) wheel.advance(still, DT);
    const f1 = wheel.force(still).fb;
    const stiffness = -f0 / 0.001;
    console.log(`[tyre] lateral tread stiffness at rest ${(stiffness / 1000).toFixed(0)} kN/m, force change over 30 s ${(f1 - f0).toExponential(2)} N`);
    expect(stiffness).toBeCloseTo((MAIN.corneringStiffness * LOAD) / MAIN.relaxationLat, -3);
    expect(f1).toBe(f0);
  });

  test('friction depends on the surface', () => {
    const runway = steady(contact(20, 20 * DEG));
    const grass = steady(contact(20, 20 * DEG, { surface: SURFACES.grass }));
    const snow = steady(contact(20, 20 * DEG, { surface: SURFACES.snow }));
    const mu = (f: { fa: number; fb: number }) => Math.hypot(f.fa, f.fb) / LOAD;
    console.log(`[tyre] sliding mu: runway ${mu(runway).toFixed(2)}, grass ${mu(grass).toFixed(2)}, snow ${mu(snow).toFixed(2)}`);
    expect(mu(grass)).toBeLessThan(0.6 * mu(runway));
    expect(mu(snow)).toBeLessThan(mu(grass));
    // Rolling resistance on grass decelerates a free-rolling wheel harder than on the runway.
    const rollR = steady(contact(10, 0)).fa;
    const rollG = steady(contact(10, 0, { surface: SURFACES.grass })).fa;
    console.log(`[tyre] rolling resistance: runway ${(-rollR / LOAD).toFixed(3)}, grass ${(-rollG / LOAD).toFixed(3)}`);
    expect(-rollR / LOAD).toBeCloseTo(SURFACES.runway.rollingResistance, 2);
    expect(-rollG / LOAD).toBeCloseTo(SURFACES.grass.rollingResistance, 2);
  });
});
