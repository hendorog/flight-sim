import { describe, expect, it } from 'vitest';
import { makeMockState } from '../../src/core/mockState';
import { DEG, FT } from '../../src/core/math';
import { defaultControls, defaultWeather } from '../../src/core/types';
import { AIRPORT, runwayThreshold } from '../../src/core/world';
import { batteryCurrentAmps, evaluateAnnunciators, Tachometer } from '../../src/instruments/dynamics/engineSystems';
import { InstrumentSet } from '../../src/instruments/dynamics/instrumentSet';
import { ils07, type IlsSignal } from '../../src/instruments/dynamics/navigation';

describe('Tachometer', () => {
  it('records one hour per hour at 2400 rpm', () => {
    const tach = new Tachometer(100);
    for (let t = 0; t < 3600; t += 1) tach.step(1, 2400);
    expect(tach.hours).toBeCloseTo(101, 2);
  });
});

describe('annunciators and ammeter', () => {
  it('uses the C172S thresholds and needs bus power', () => {
    const out = { lowFuelLeft: false, lowFuelRight: false, oilPress: false, lowVolts: false, vacuum: false };
    evaluateAnnunciators({ busVolts: 24, fuelLeftGal: 4, fuelRightGal: 20, oilPressurePsi: 10, suctionInHg: 2 }, out);
    expect(out).toEqual({ lowFuelLeft: true, lowFuelRight: false, oilPress: true, lowVolts: true, vacuum: true });
    evaluateAnnunciators({ busVolts: 0, fuelLeftGal: 0, fuelRightGal: 0, oilPressurePsi: 0, suctionInHg: 0 }, out);
    expect(Object.values(out).some(Boolean)).toBe(false);
  });

  it('shows discharge when the loads exceed alternator output', () => {
    const c = defaultControls();
    c.lights.landing = true;
    expect(batteryCurrentAmps(c, 0, true)).toBeLessThan(-10);
    expect(batteryCurrentAmps(c, 40, true)).toBeGreaterThan(0);
    c.masterBattery = false;
    expect(batteryCurrentAmps(c, 0, false)).toBe(0);
  });
});

describe('ILS 07', () => {
  const sig: IlsSignal = { locValid: false, gsValid: false, loc: 0, gs: 0 };
  const thr = runwayThreshold(0);
  const hdg = AIRPORT.runway.heading;

  it('is centred on the extended centreline on a 3 degree path', () => {
    const d = 5000;
    const pos = { x: thr.x - Math.cos(hdg) * d, y: thr.y - Math.sin(hdg) * d, z: -(AIRPORT.elevation + Math.tan(3 * DEG) * (d + 300)) };
    ils07(pos, sig);
    expect(sig.locValid && sig.gsValid).toBe(true);
    expect(Math.abs(sig.loc)).toBeLessThan(0.01);
    expect(Math.abs(sig.gs)).toBeLessThan(0.01);
  });

  it('deflects toward the centreline and the glide path', () => {
    const d = 5000;
    // 200 m right of the centreline (right when facing 07) and 50 m low.
    const right = { x: -Math.sin(hdg), y: Math.cos(hdg) };
    const pos = {
      x: thr.x - Math.cos(hdg) * d + right.x * 200,
      y: thr.y - Math.sin(hdg) * d + right.y * 200,
      z: -(AIRPORT.elevation + Math.tan(3 * DEG) * (d + 300) - 50),
    };
    ils07(pos, sig);
    expect(sig.loc).toBeLessThan(-0.5);
    expect(sig.gs).toBeGreaterThan(0.5);
  });

  it('has no signal behind the antenna', () => {
    ils07({ x: 3000 * Math.cos(hdg), y: 3000 * Math.sin(hdg), z: -500 }, sig);
    expect(sig.locValid).toBe(false);
  });
});

describe('InstrumentSet', () => {
  it('produces consistent readings from a cruise state', () => {
    const set = new InstrumentSet();
    const s = makeMockState({ heightAGL: 3000 * FT, rpm: 2400 });
    const c = defaultControls();
    const w = defaultWeather();
    for (let t = 0; t < 20; t += 0.02) set.step(0.02, s, c, w);
    const r = set.readings;
    expect(r.airspeedKt).toBeCloseTo(s.ias / 0.514444, 0);
    expect(r.altitudeFt).toBeCloseTo(s.altitudeMSL / FT, -1);
    expect(Math.abs(r.verticalSpeedFpm)).toBeLessThan(1);
    expect(r.rpm).toBeCloseTo(2400, 0);
    expect(r.busPowered).toBe(true);
    expect(r.fuelLeftGal).toBeCloseTo(s.fuel.left / 2.7216, 1);
  });

  it('electric gauges fall to their stops when the bus dies', () => {
    const set = new InstrumentSet();
    const s = makeMockState();
    const c = defaultControls();
    const w = defaultWeather();
    for (let t = 0; t < 20; t += 0.02) set.step(0.02, s, c, w);
    s.electrical.busVoltage = 0;
    for (let t = 0; t < 10; t += 0.02) set.step(0.02, s, c, w);
    expect(set.readings.fuelLeftGal).toBeLessThan(0.1);
    expect(set.readings.oilPressurePsi).toBeLessThan(0.1);
    expect(set.readings.turnFlag).toBe(true);
    expect(set.readings.avionicsPowered).toBe(false);
  });
});
