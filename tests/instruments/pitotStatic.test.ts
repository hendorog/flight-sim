import { describe, expect, it } from 'vitest';
import { FT, FPM, INHG, KT } from '../../src/core/math';
import { AirspeedIndicator, Altimeter, pressureAltitudeFt, VerticalSpeedIndicator } from '../../src/instruments/dynamics/pitotStatic';

/** ISA static pressure at a geometric altitude (troposphere). */
const isaPressure = (hM: number): number => 101325 * Math.pow(1 - 2.25577e-5 * hM, 5.25588);

const run = (steps: number, dt: number, fn: (t: number) => void): void => {
  for (let i = 0; i < steps; i++) fn((i + 1) * dt);
};

describe('AirspeedIndicator', () => {
  it('is dead below ~20 kt and reads IAS above 35 kt', () => {
    const asi = new AirspeedIndicator();
    run(100, 0.05, () => asi.step(0.05, 15 * KT));
    expect(asi.knots).toBeLessThan(0.5);
    run(100, 0.05, () => asi.step(0.05, 25 * KT));
    expect(asi.knots).toBeGreaterThan(3);
    expect(asi.knots).toBeLessThan(15);
    run(100, 0.05, () => asi.step(0.05, 90 * KT));
    expect(asi.knots).toBeCloseTo(90, 3);
  });

  it('lags a step change briefly', () => {
    const asi = new AirspeedIndicator();
    run(100, 0.05, () => asi.step(0.05, 80 * KT));
    asi.step(0.05, 100 * KT);
    expect(asi.knots).toBeGreaterThan(80);
    expect(asi.knots).toBeLessThan(95);
  });
});

describe('Altimeter', () => {
  it('reads pressure altitude at 29.92 and field elevation at QNH', () => {
    const alt = new Altimeter();
    alt.step(0.02, isaPressure(1000));
    expect(alt.feet).toBeCloseTo(1000 / FT, -1);
    expect(alt.settingInHg).toBeCloseTo(29.92, 2);
  });

  it('moves about 27-30 ft per hPa of Kollsman setting', () => {
    const p = isaPressure(120);
    const a = pressureAltitudeFt(p, 1013.25);
    const b = pressureAltitudeFt(p, 1023.25);
    expect(b - a).toBeGreaterThan(270);
    expect(b - a).toBeLessThan(300);
  });

  it('one inHg is roughly a thousand feet', () => {
    const p = isaPressure(0);
    const d = pressureAltitudeFt(p, (30.92 * INHG) / 100) - pressureAltitudeFt(p, (29.92 * INHG) / 100);
    expect(d).toBeGreaterThan(900);
    expect(d).toBeLessThan(1000);
  });
});

describe('VerticalSpeedIndicator', () => {
  it('reads a steady climb correctly and lags a step with a ~6 s time constant', () => {
    const vsi = new VerticalSpeedIndicator(6);
    const dt = 0.02;
    let h = 500;
    run(200, dt, () => vsi.step(dt, isaPressure(h)));
    expect(Math.abs(vsi.fpm)).toBeLessThan(1);
    const climb = 1000 * FPM;
    run(300, dt, () => {
      h += climb * dt;
      vsi.step(dt, isaPressure(h));
    }); // 6 s
    expect(vsi.fpm).toBeGreaterThan(560);
    expect(vsi.fpm).toBeLessThan(700);
    run(3000, dt, () => {
      h += climb * dt;
      vsi.step(dt, isaPressure(h));
    });
    // Pressure altitude equals geometric altitude only at ISA; ~2% scale error near sea level is expected.
    expect(vsi.fpm).toBeGreaterThan(980);
    expect(vsi.fpm).toBeLessThan(1030);
  });
});
