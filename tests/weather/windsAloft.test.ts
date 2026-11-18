// Winds aloft (physics/weather/windsAloft.ts), their coupling to the boundary layer (windField.ts), the temperature
// profile of the manual levels (physics/atmosphere.ts) and the static stability (stability.ts). Each test logs its
// measured numbers.

import { describe, expect, test } from 'vitest';
import { DEG, FT, KT, type Vec3 } from '../../src/core/math';
import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import { AIRPORT } from '../../src/core/world';
import { ALOFT_ALT_MIN_FT } from '../../src/core/weatherFields';
import { atmosphereAt, isaTemperature, geopotentialAltitude } from '../../src/physics/atmosphere';
import { createEnvironment, type TerrainProvider } from '../../src/physics/environment';
import { gradientWindFactor, windSpeedFactor, windVeer, WindField } from '../../src/physics/weather';
import { bruntVaisala2 } from '../../src/physics/weather/stability';
import {
  AloftProfile,
  PROFILE_BASE_M,
  baroclinicShear,
  shearShape,
  temperatureProfileOf,
  windAloftAt,
  windFromDeg,
  windKt,
  type WindNE,
} from '../../src/physics/weather/windsAloft';

const report = (label: string, values: Record<string, number | string>) =>
  console.log(`[aloft] ${label}: ${Object.entries(values).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toPrecision(4) : v}`).join('  ')}`);

const flat = (elevation: number): TerrainProvider => ({ height: () => elevation, normal: () => ({ x: 0, y: 0, z: -1 }), surface: () => 'grass' });
const still = (o: Partial<WeatherSettings> = {}): WeatherSettings => ({ ...defaultWeather(), gustKt: 0, turbulence: 0, timeOfDay: 0, mountainWaves: 0, ...o });
const v = (): WindNE => ({ north: 0, east: 0 });
const LEVELS_FT = [0, 3000, 6000, 9000, 12000, 18000, 24000, 30000, 34000, 39000];

function table(w: WeatherSettings): string {
  return LEVELS_FT.map((ft) => {
    const f = windAloftAt(w, ft * FT, v());
    return `${ft}:${Math.round(windFromDeg(f)).toString().padStart(3, '0')}/${windKt(f).toFixed(1)}`;
  }).join(' ');
}

describe('derived profile', () => {
  test('shear shape: 0 to the base, monotonic to the jet, maximum at the jet, 0.35 residual in the stratosphere', () => {
    expect(shearShape(PROFILE_BASE_M)).toBe(0);
    let prev = 0;
    for (let z = PROFILE_BASE_M + 10; z <= 10_500; z += 10) {
      const p = shearShape(z);
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
    expect(shearShape(10_600)).toBeLessThan(shearShape(10_500));
    expect(shearShape(10_400)).toBeLessThan(shearShape(10_500));
    expect(shearShape(22_000) / shearShape(10_500)).toBeCloseTo(0.35, 9);
    // C1: the slope is continuous across the pieces (finite differences either side of each joint).
    for (const z of [PROFILE_BASE_M + 300, 9000, 12_000]) {
      const below = (shearShape(z) - shearShape(z - 0.01)) / 0.01;
      const above = (shearShape(z + 0.01) - shearShape(z)) / 0.01;
      expect(Math.abs(above - below)).toBeLessThan(1e-4);
    }
  });

  test('thermal-wind shear: 1.1e-3 1/s in July, 2.9e-3 1/s in January', () => {
    const july = baroclinicShear(196);
    const jan = baroclinicShear(15);
    report('baroclinic shear', { day196: july, day15: jan, kt_per_1000ft_196: (july * 1000 * FT) / KT, kt_per_1000ft_15: (jan * 1000 * FT) / KT });
    expect(july).toBeCloseTo(1.09e-3, 4);
    expect(jan).toBeCloseTo(2.92e-3, 4);
  });

  test('a 15 kt westerly strengthens monotonically to the jet, which is the maximum', () => {
    const w = still({ windDirectionDeg: 270, windSpeedKt: 15 });
    let prev = 0;
    let max = 0;
    let zMax = 0;
    for (let z = 1000; z <= 20_000; z += 50) {
      const s = windKt(windAloftAt(w, z, v()));
      if (z <= 10_500) expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
      if (s > max) [max, zMax] = [s, z];
    }
    report('15 kt westerly', { jetKt: max, jetAltM: zMax });
    console.log(`[aloft] table 15 kt westerly day ${w.dayOfYear}: ${table(w)}`);
    expect(zMax).toBe(10_500);
  });

  test('winds aloft exist over a calm surface (owner decision D1): westerlies, stronger in winter', () => {
    const summer = still({ windSpeedKt: 0, dayOfYear: 196 });
    const winter = still({ windSpeedKt: 0, dayOfYear: 15 });
    const s9 = windAloftAt(summer, 9000, v());
    const w9 = windAloftAt(winter, 9000, v());
    report('calm 9000 m', { summerFrom: windFromDeg(s9), summerKt: windKt(s9), winterFrom: windFromDeg(w9), winterKt: windKt(w9) });
    console.log(`[aloft] table calm day 196: ${table(summer)}`);
    console.log(`[aloft] table calm day 15: ${table(winter)}`);
    console.log(`[aloft] table default weather day 172: ${table(defaultWeather())}`);
    console.log(`[aloft] table default weather day 15: ${table({ ...defaultWeather(), dayOfYear: 15 })}`);
    expect(windFromDeg(s9)).toBeCloseTo(270, 6);
    expect(windKt(s9)).toBeGreaterThan(5);
    expect(windKt(w9)).toBeGreaterThan(2 * windKt(s9));
    // Below the base: calm.
    expect(windKt(windAloftAt(summer, PROFILE_BASE_M, v()))).toBe(0);
  });

  test('windsAloft: [] gives the gradient wind at every height', () => {
    const w = still({ windDirectionDeg: 200, windSpeedKt: 10, windsAloft: [] });
    const g = windAloftAt(w, 0, v());
    for (const z of [500, 3000, 9000, 15_000]) {
      const f = windAloftAt(w, z, v());
      expect(f.north).toBe(g.north);
      expect(f.east).toBe(g.east);
    }
    expect(windKt(g)).toBeCloseTo(10 * gradientWindFactor, 9);
    expect(windFromDeg(g)).toBeCloseTo(225, 9);
  });

  test('a malformed table reads as derived', () => {
    const derived = windAloftAt(still({ windSpeedKt: 8 }), 6000, v());
    const bad = windAloftAt(still({ windSpeedKt: 8, windsAloft: [{ altFt: 9000, dirDeg: 0, kt: 999 }] }), 6000, v());
    expect(bad).toEqual(derived);
  });
});

describe('manual levels', () => {
  test('each level is reproduced exactly; the profile is interpolated in (u, v) between them', () => {
    const levels = [
      { altFt: 6000, dirDeg: 240, kt: 25 },
      { altFt: 12000, dirDeg: 270, kt: 40 },
      { altFt: 24000, dirDeg: 300, kt: 70 },
    ];
    const w = still({ windSpeedKt: 6, windsAloft: levels });
    for (const l of levels) {
      const f = windAloftAt(w, l.altFt * FT, v());
      expect(windFromDeg(f)).toBeCloseTo(l.dirDeg, 9);
      expect(windKt(f)).toBeCloseTo(l.kt, 9);
    }
    // Above the top level the difference from the derived profile stays constant.
    const p = new AloftProfile().update(w);
    const d1 = p.freeWind(9000, v());
    const r1 = p.derivedWind(9000, v());
    const d2 = p.freeWind(14_000, v());
    const r2 = p.derivedWind(14_000, v());
    expect(d1.north - r1.north).toBeCloseTo(d2.north - r2.north, 9);
    expect(d1.east - r1.east).toBeCloseTo(d2.east - r2.east, 9);
    // At the shear base the difference is 0.
    const b = p.freeWind(PROFILE_BASE_M + 1e-6, v());
    const rb = p.derivedWind(PROFILE_BASE_M + 1e-6, v());
    expect(Math.hypot(b.north - rb.north, b.east - rb.east)).toBeLessThan(1e-6);
  });

  test('opposite directions are interpolated through a low speed, not swung around', () => {
    const w = still({ windSpeedKt: 0, windsAloft: [{ altFt: 10000, dirDeg: 270, kt: 40 }, { altFt: 20000, dirDeg: 90, kt: 40 }] });
    const mid = windAloftAt(w, 15000 * FT, v());
    report('opposite levels', { midKt: windKt(mid), midFrom: windFromDeg(mid) });
    expect(windKt(mid)).toBeLessThan(2);
  });

  test('a table with a level below ALOFT_ALT_MIN_FT reads as derived; a level at ALOFT_ALT_MIN_FT is used (wind and temperature)', () => {
    // The profile ignores levels at or below the shear base + 100 m; the table check rejects every such altitude.
    expect(ALOFT_ALT_MIN_FT * FT).toBeGreaterThan(PROFILE_BASE_M + 100);
    expect((ALOFT_ALT_MIN_FT - 100) * FT).toBeLessThanOrEqual(PROFILE_BASE_M + 100);
    const derived = windAloftAt(still({ windSpeedKt: 8 }), 3000, v());
    const low = windAloftAt(still({ windSpeedKt: 8, windsAloft: [{ altFt: 2000, dirDeg: 0, kt: 50, tempC: 30 }] }), 3000, v());
    expect(low.north).toBe(derived.north);
    expect(low.east).toBe(derived.east);
    expect(temperatureProfileOf(still({ windsAloft: [{ altFt: 2000, dirDeg: 0, kt: 50, tempC: 30 }] }))).toBeUndefined();
    const atMin = still({ windSpeedKt: 8, windsAloft: [{ altFt: ALOFT_ALT_MIN_FT, dirDeg: 0, kt: 50, tempC: 30 }] });
    const f = windAloftAt(atMin, ALOFT_ALT_MIN_FT * FT, v());
    expect(windKt(f)).toBeCloseTo(50, 9);
    expect(temperatureProfileOf(atMin)).toBeDefined();
  });
});

describe('boundary layer under the winds aloft', () => {
  test('the 10 m wind at every field elevation equals the setting', () => {
    for (const elev of [66, 120, 212, 366]) {
      const weather = still({ windDirectionDeg: 310, windSpeedKt: 14, mountainWaves: 1 });
      const field = new WindField(weather, () => elev);
      const m = field.breakdown({ x: 0, y: 0, z: -(elev + 10) }, 0).mean;
      const f = { north: m.x, east: m.y };
      expect(windKt(f)).toBeCloseTo(14, 9);
      expect(windFromDeg(f)).toBeCloseTo(310, 9);
    }
  });

  test('the wind at a given MSL altitude no longer weakens over high ground (synthetic 2000 m ridge)', () => {
    const ridge = 2000;
    const weather = still({ windDirectionDeg: 270, windSpeedKt: 12, dayOfYear: 15 });
    const plain = new WindField(weather, () => 200);
    const high = new WindField(weather, () => ridge);
    const p: Vec3 = { x: 0, y: 0, z: -3000 };
    const overPlain = plain.breakdown(p, 0).mean;
    const overRidge = high.breakdown(p, 0).mean;
    const free = windAloftAt(weather, 3000, v());
    const low: Vec3 = { x: 0, y: 0, z: -(ridge + 100) };
    const ridge100 = high.breakdown(low, 0).mean;
    const plainAtRidge100 = plain.breakdown(low, 0).mean;
    const legacy = 12 * windSpeedFactor(100);
    report('3000 m MSL', {
      plainKt: Math.hypot(overPlain.x, overPlain.y) / KT,
      ridgeKt: Math.hypot(overRidge.x, overRidge.y) / KT,
      freeKt: windKt(free),
      ridge100mAglKt: Math.hypot(ridge100.x, ridge100.y) / KT,
      plainSameAltKt: Math.hypot(plainAtRidge100.x, plainAtRidge100.y) / KT,
      legacy100mKt: legacy,
    });
    expect(Math.hypot(overPlain.x - free.north, overPlain.y - free.east)).toBeLessThan(0.05);
    expect(Math.hypot(overRidge.x, overRidge.y) / Math.hypot(free.north, free.east)).toBeGreaterThan(0.97);
    expect(Math.hypot(ridge100.x, ridge100.y) / KT).toBeGreaterThan(legacy * 1.3);
  });

  test('windsAloft: [] reproduces the boundary layer without winds aloft exactly', () => {
    const terrain = flat(AIRPORT.elevation);
    const a = createEnvironment({ weather: still({ windSpeedKt: 12, turbulence: 0.4, windsAloft: [] }), terrain, seed: 3 });
    for (const agl of [5, 50, 500, 3000, 9000]) {
      const m = a.windField.breakdown({ x: 0, y: 0, z: -(AIRPORT.elevation + agl) }, 1).mean;
      // The arithmetic of windField.ts before the winds aloft existed.
      const from = 100 * DEG + windVeer(agl);
      const U = 12 * KT * windSpeedFactor(agl);
      expect(m.x).toBe(U * -Math.cos(from));
      expect(m.y).toBe(U * -Math.sin(from));
    }
  });
});

describe('temperature at the levels', () => {
  test('the atmosphere takes each level temperature; pressure is continuous; no temperatures is the uniform path', () => {
    const w = still({ isaDeviation: 5, windsAloft: [{ altFt: 10000, dirDeg: 270, kt: 30, tempC: -15 }, { altFt: 30000, dirDeg: 270, kt: 60, tempC: -50 }] });
    const env = createEnvironment({ weather: w, terrain: flat(AIRPORT.elevation) });
    const t10 = env.atmosphere(10000 * FT).temperature - 273.15;
    const t30 = env.atmosphere(30000 * FT).temperature - 273.15;
    const field = env.atmosphere(AIRPORT.elevation).temperature;
    const uniform = atmosphereAt(AIRPORT.elevation, { isaDeviation: 5, seaLevelPressure: 101325 });
    let maxJump = 0;
    for (let z = 0; z < 20_000; z += 5) maxJump = Math.max(maxJump, Math.abs(env.atmosphere(z + 0.01).pressure - env.atmosphere(z).pressure));
    report('temperature profile', { t10000ft: t10, t30000ft: t30, fieldK: field, pressureStep1cm: maxJump });
    expect(t10).toBeCloseTo(-15, 6);
    expect(t30).toBeCloseTo(-50, 6);
    expect(field).toBeCloseTo(uniform.temperature, 9);
    expect(env.atmosphere(AIRPORT.elevation).pressure).toBeCloseTo(uniform.pressure, 6);
    expect(maxJump).toBeLessThan(0.2);
    // ISA temperatures at the levels reproduce the uniform deviation.
    const isaW = still({ isaDeviation: 0, windsAloft: [{ altFt: 20000, dirDeg: 0, kt: 10, tempC: isaTemperature(geopotentialAltitude(20000 * FT)) - 273.15 }] });
    const isaEnv = createEnvironment({ weather: isaW, terrain: flat(AIRPORT.elevation) });
    for (const z of [0, 3000, 8000, 12_000, 25_000]) {
      const a = isaEnv.atmosphere(z);
      const b = atmosphereAt(z);
      expect(a.temperature).toBeCloseTo(b.temperature, 6);
      expect(a.pressure / b.pressure).toBeCloseTo(1, 9);
    }
    expect(temperatureProfileOf(still({ windsAloft: [{ altFt: 9000, dirDeg: 0, kt: 10 }] }))).toBeUndefined();
  });

  test('stability: ISA N = 0.0112 1/s at 5 km and 0.0210 1/s above the tropopause', () => {
    const cond = { isaDeviation: 0, seaLevelPressure: 101325 };
    const n5 = Math.sqrt(bruntVaisala2(5000, cond));
    const n12 = Math.sqrt(bruntVaisala2(12_000, cond));
    report('N', { at5km: n5, at12km: n12 });
    expect(n5).toBeCloseTo(0.0112, 4);
    expect(n12).toBeCloseTo(0.0210, 4);
  });
});
