import { describe, expect, it } from 'vitest';
import { KT } from '../../src/core/math';
import {
  atmosphereAt,
  casFromTas,
  easFromTas,
  pressureAltitude,
  sutherlandViscosity,
  tasFromCas,
} from '../../src/physics/atmosphere';

// Reference values: U.S. Standard Atmosphere 1976 (identical to ISA below 32 km), geometric altitudes.
const TABLE = [
  { h: 0, T: 288.15, p: 101325, rho: 1.225, a: 340.29 },
  { h: 1000, T: 281.65, p: 89876, rho: 1.1117, a: 336.43 },
  { h: 5000, T: 255.68, p: 54048, rho: 0.73643, a: 320.55 },
  { h: 11000, T: 216.77, p: 22700, rho: 0.36480, a: 295.15 },
  { h: 15000, T: 216.65, p: 12111, rho: 0.19476, a: 295.07 },
  { h: 20000, T: 216.65, p: 5529.3, rho: 0.088910, a: 295.07 },
];

describe('ISA atmosphere', () => {
  it.each(TABLE)('matches the standard table at $h m', (row) => {
    const s = atmosphereAt(row.h);
    expect(s.temperature).toBeCloseTo(row.T, 1);
    expect(s.pressure / row.p).toBeCloseTo(1, 3);
    expect(s.density / row.rho).toBeCloseTo(1, 3);
    expect(s.speedOfSound).toBeCloseTo(row.a, 1);
  });

  it('uses Sutherland viscosity (1.789e-5 Pa s at sea level)', () => {
    expect(atmosphereAt(0).viscosity).toBeCloseTo(1.7894e-5, 8);
    expect(sutherlandViscosity(216.65)).toBeCloseTo(1.4216e-5, 8);
  });

  it('applies an ISA deviation hydrostatically', () => {
    const hot = atmosphereAt(0, { isaDeviation: 15, seaLevelPressure: 101325 });
    expect(hot.temperature).toBeCloseTo(303.15, 6);
    expect(hot.pressure).toBeCloseTo(101325, 6);
    expect(hot.density).toBeCloseTo(101325 / (287.05287 * 303.15), 6);
    // Warm air column: pressure falls more slowly, so a given pressure level is higher.
    const hot3k = atmosphereAt(3000, { isaDeviation: 15, seaLevelPressure: 101325 });
    expect(hot3k.pressure).toBeGreaterThan(atmosphereAt(3000).pressure);
    expect(pressureAltitude(hot3k.pressure)).toBeLessThan(3000);
  });

  it('applies the QNH offset (~8.3 m per hPa near sea level)', () => {
    const high = atmosphereAt(0, { isaDeviation: 0, seaLevelPressure: 103000 });
    expect(high.pressure).toBeCloseTo(103000, 6);
    const ft = pressureAltitude(high.pressure);
    expect(ft).toBeCloseTo(-(1030 - 1013.25) * 8.3, -1);
  });

  it('inverts pressure altitude', () => {
    for (const h of [0, 2500, 8000, 12000, 18000]) {
      expect(pressureAltitude(atmosphereAt(h).pressure)).toBeCloseTo(h * (6356766 / (6356766 + h)), 0);
    }
  });
});

describe('pitot-static', () => {
  it('CAS equals TAS at standard sea level', () => {
    const sl = atmosphereAt(0);
    expect(casFromTas(60, sl)).toBeCloseTo(60, 6);
  });

  it('CAS is below TAS at altitude and round-trips', () => {
    const atm = atmosphereAt(3000);
    const cas = casFromTas(110 * KT, atm);
    expect(cas).toBeLessThan(110 * KT);
    // ~2 % per 1000 ft rule of thumb: 3000 m ~ 9800 ft -> TAS ~ 16 % above CAS
    expect(110 * KT / cas).toBeGreaterThan(1.13);
    expect(110 * KT / cas).toBeLessThan(1.18);
    expect(tasFromCas(cas, atm)).toBeCloseTo(110 * KT, 6);
    // Compressibility correction is tiny at light-aircraft speeds: CAS ~ EAS.
    expect(cas).toBeCloseTo(easFromTas(110 * KT, atm), 0);
  });
});
