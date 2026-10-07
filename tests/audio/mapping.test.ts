import { describe, expect, it } from 'vitest';
import { DEG, KT } from '../../src/core/math';
import { makeMockState } from '../../src/core/mockState';
import { defaultControls } from '../../src/core/types';
import {
  airAbsorptionCutoff,
  brakeSqueal,
  chirpAmplitude,
  crankRpm,
  distanceGain,
  engineLoad,
  fillSynthParams,
  flapMotorRunning,
  makeParamBlock,
  propagationDelay,
  REFERENCE_DISTANCE,
  roughness,
  rolling,
  stallHorn,
  stepGyro,
  surfaceKind,
  tipMach,
  windNoise,
} from '../../src/audio/mapping';
import { P } from '../../src/audio/params';

describe('engine mapping', () => {
  it('starter cranks the engine at cranking speed until it runs', () => {
    expect(crankRpm(0, true, false)).toBe(170);
    expect(crankRpm(900, true, true)).toBe(900);
    expect(crankRpm(0, false, false)).toBe(0);
  });

  it('load rises with manifold pressure and power', () => {
    // The flight model's idle (8.5 inHg, ~3 hp) and static full power (28.5 inHg, 159 hp).
    expect(engineLoad(8.5, 2200)).toBeLessThan(0.05);
    expect(engineLoad(28.5, 159 * 745.7)).toBeGreaterThan(0.9);
    expect(engineLoad(28.5, 159 * 745.7)).toBeLessThan(1.05);
    expect(engineLoad(3, -18 * 745.7)).toBe(0); // windmilling
    expect(engineLoad(20, 60000)).toBeGreaterThan(engineLoad(15, 30000));
  });

  it('lean mixture and a single magneto roughen combustion', () => {
    expect(roughness(1, 3)).toBe(0);
    expect(roughness(1, 1)).toBeGreaterThan(0);
    expect(roughness(0.1, 3)).toBe(1);
  });

  it('tip Mach of the 1.93 m prop at 2700 rpm static is about 0.8', () => {
    expect(tipMach(2700, 0, 340.3)).toBeCloseTo(0.802, 2);
    expect(tipMach(2400, 55, 340.3)).toBeGreaterThan(tipMach(2400, 0, 340.3));
  });
});

describe('airframe mapping', () => {
  it('wind noise grows with IAS squared', () => {
    expect(windNoise(50, 0, 0).level).toBeCloseTo(1);
    expect(windNoise(25, 0, 0).level).toBeCloseTo(0.25);
    expect(windNoise(60, 0, 0).freq).toBeGreaterThan(windNoise(30, 0, 0).freq);
    expect(windNoise(50, 10 * DEG, 0).slip).toBeCloseTo(1);
    expect(windNoise(40, 0, 30 * DEG).flap).toBeCloseTo(1);
    expect(windNoise(0, 0, 30 * DEG).flap).toBe(0);
  });

  it('stall horn needs the warning and airflow, and rises toward the stall', () => {
    expect(stallHorn(false, 15 * DEG, 30)).toBe(0);
    expect(stallHorn(true, 15 * DEG, 0)).toBe(0);
    expect(stallHorn(true, 16 * DEG, 30)).toBeGreaterThan(stallHorn(true, 11 * DEG, 30));
  });

  it('surface kinds and rolling noise', () => {
    expect(surfaceKind('runway')).toBe(0);
    expect(surfaceKind('grass')).toBe(1);
    expect(surfaceKind('dirt')).toBe(2);
    expect(rolling(0, 30)).toBe(0);
    expect(rolling(3, 25)).toBeCloseTo(1);
    expect(rolling(3, 10)).toBeLessThan(rolling(3, 20));
  });

  it('brakes squeal most at walking pace and not when stopped', () => {
    expect(brakeSqueal(1, 0, true)).toBe(0);
    expect(brakeSqueal(1, 2, true)).toBeGreaterThan(brakeSqueal(1, 20, true));
    expect(brakeSqueal(1, 2, false)).toBe(0);
  });

  it('touchdown chirp scales with sink rate', () => {
    expect(chirpAmplitude(0.3)).toBeLessThan(chirpAmplitude(2));
    expect(chirpAmplitude(10)).toBe(1.8);
  });

  it('gyros spin up slowly and run down slower', () => {
    let s = 0;
    for (let i = 0; i < 20; i++) s = stepGyro(s, 2000, 28, 1);
    expect(s).toBeGreaterThan(0.55);
    expect(s).toBeLessThan(0.7);
    let d = 1;
    for (let i = 0; i < 20; i++) d = stepGyro(d, 0, 0, 1);
    expect(d).toBeGreaterThan(0.65);
  });

  it('flap motor runs only while the flaps move', () => {
    expect(flapMotorRunning(0, 0.01, 1 / 60)).toBe(1);
    expect(flapMotorRunning(0.1, 0.1, 1 / 60)).toBe(0);
    expect(flapMotorRunning(0, 0.1, 0)).toBe(0);
  });
});

describe('spatial mapping', () => {
  it('distance attenuation, absorption and delay', () => {
    expect(distanceGain(REFERENCE_DISTANCE)).toBeCloseTo(1);
    expect(distanceGain(2 * REFERENCE_DISTANCE)).toBeCloseTo(0.5);
    expect(distanceGain(0.1)).toBe(1.4);
    expect(airAbsorptionCutoff(10)).toBe(20000);
    expect(airAbsorptionCutoff(2000)).toBeLessThan(3000);
    expect(propagationDelay(340.3)).toBeCloseTo(1);
  });

  it('Doppler from a delay line: approaching at v gives pitch factor 1 / (1 - v/c)', () => {
    // Delay d(t)/c shrinking at rate v/c -> playback rate 1 + v/c (first order), e.g. 50 m/s -> +15%.
    const v = 50;
    const rate = 1 - (propagationDelay(1000 - v) - propagationDelay(1000));
    expect(rate).toBeCloseTo(1 + v / 340.3, 6);
  });
});

describe('parameter block', () => {
  it('fills from a mock cruise state', () => {
    const s = makeMockState({ heightAGL: 900, tas: 110 * KT, rpm: 2400 });
    const c = defaultControls();
    c.throttle = 0.75;
    const out = fillSynthParams(s, c, { surface: 'grass', speedOfSound: 336, turbulence: 0.2, gyroSpin: 1, flapMotor: 0 }, makeParamBlock());
    expect(out[P.rpm]).toBe(2400);
    expect(out[P.firing]).toBe(1);
    expect(out[P.tipMach]).toBeGreaterThan(0.7);
    expect(out[P.windLevel]).toBeGreaterThan(1);
    expect(out[P.rolling]).toBe(0);
    expect(out[P.fan]).toBe(1);
    expect(out.every(Number.isFinite)).toBe(true);
  });

  it('on the ground with the parking brake set: rolling and squeal only when moving', () => {
    const s = makeMockState({ heightAGL: 0 });
    const c = defaultControls();
    c.parkingBrake = true;
    const ctx = { surface: 'runway' as const, speedOfSound: 340, turbulence: 0, gyroSpin: 1, flapMotor: 0 };
    let out = fillSynthParams(s, c, ctx, makeParamBlock());
    expect(out[P.brakeSqueal]).toBe(0);
    s.groundSpeed = 2;
    out = fillSynthParams(s, c, ctx, makeParamBlock());
    expect(out[P.brakeSqueal]).toBeGreaterThan(0.5);
    expect(out[P.rolling]).toBeGreaterThan(0);
  });
});
