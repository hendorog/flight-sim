import { describe, expect, it } from 'vitest';
import { DEG, wrapPi, wrapTwoPi } from '../../src/core/math';
import { AIRCRAFT_IDS, defaultControls, defaultWeather } from '../../src/core/types';
import { makeMockState } from '../../src/core/mockState';
import { COMPASS_DEVIATION, compassCorrectionCard, compassDeviation, MagneticCompass, type CompassInput } from '../../src/instruments/dynamics/magneticCompass';
import { InstrumentSet } from '../../src/instruments/dynamics/instrumentSet';

const input = (heading = 0): CompassInput => ({ aircraft: 'c172s', heading: heading * DEG, roll: 0, pitch: 0,
  specificForce: { x: 0, y: 0, z: -1 }, angularVelocity: { x: 0, y: 0, z: 0 } });
const error = (c: MagneticCompass, s: CompassInput): number => wrapPi(c.reading.heading - s.heading) / DEG;
function run(c: MagneticCompass, s: CompassInput, seconds: number, dt = 1 / 120): void {
  for (let i = 0; i < Math.round(seconds / dt); i++) c.step(dt, s);
}
function turn(start: number, direction = 1, latitudeDeg = 46.5): { peak: number; compass: MagneticCompass; state: CompassInput } {
  const s = input(start), c = new MagneticCompass({ deviation: false, latitudeDeg }); c.reset(s);
  let peak = 0;
  for (let i = 0; i < 360; i++) {
    const t = (i + 1) / 120;
    s.roll = direction * 18 * DEG * Math.min(t, 1);
    s.angularVelocity = { x: t <= 1 ? direction * 18 * DEG : 0,
      y: direction * 3 * DEG * Math.sin(s.roll), z: direction * 3 * DEG * Math.cos(s.roll) };
    s.heading = wrapTwoPi((start + direction * 3 * t) * DEG); s.specificForce.z = -1 / Math.cos(s.roll);
    c.step(1 / 120, s);
    if (Math.abs(error(c, s)) > Math.abs(peak)) peak = error(c, s);
  }
  return { peak, compass: c, state: s };
}

describe('wet compass magnetic field and float dynamics', () => {
  it.each([1, -1])('lags away from north and leads away from south in turn direction %s, about latitude degrees', direction => {
    const north = turn(0, direction).peak * direction, south = turn(180, direction).peak * direction;
    expect(north).toBeLessThan(-31.5); expect(north).toBeGreaterThan(-61.5);
    expect(south).toBeGreaterThan(31.5); expect(south).toBeLessThan(61.5);
  });
  it('weakens toward the equator and reverses in the southern hemisphere', () => {
    expect(Math.abs(turn(0, 1, 0).peak)).toBeLessThan(3);
    expect(Math.abs(turn(0, 1, 20).peak)).toBeLessThan(Math.abs(turn(0).peak));
    expect(turn(0, 1, -46.5).peak).toBeGreaterThan(30);
    expect(turn(180, 1, -46.5).peak).toBeLessThan(-30);
  });
  it.each([90, 270])('ANDS on %s degrees, with a measurable 0.15g acceleration', heading => {
    for (const sign of [-1, 1]) {
      const s = input(heading), c = new MagneticCompass({ deviation: false }); c.reset(s);
      s.specificForce.x = sign * 0.15; run(c, s, 5);
      const northward = error(c, s) * (heading === 90 ? -1 : 1) * sign;
      expect(northward).toBeGreaterThan(12); expect(northward).toBeLessThan(25);
    }
  });
  it.each([0, 180])('has no acceleration error along %s degrees', heading => {
    const s = input(heading), c = new MagneticCompass({ deviation: false }); c.reset(s);
    s.specificForce.x = 0.15; run(c, s, 5); expect(Math.abs(error(c, s))).toBeLessThan(0.01);
  });
  it('does not confuse a steady pitched/banked attitude with acceleration after the float levels', () => {
    const s = input(80), c = new MagneticCompass({ deviation: false }); c.reset(s);
    s.pitch = 8 * DEG; s.roll = 7 * DEG;
    s.specificForce = { x: Math.sin(s.pitch), y: -Math.sin(s.roll) * Math.cos(s.pitch), z: -Math.cos(s.roll) * Math.cos(s.pitch) };
    run(c, s, 20); expect(Math.abs(error(c, s))).toBeLessThan(0.1);
  });
  it('overshoots then damps out when acceleration is removed', () => {
    const s = input(90), c = new MagneticCompass({ deviation: false }); c.reset(s);
    s.specificForce.x = 0.15; run(c, s, 5); expect(error(c, s)).toBeLessThan(-12);
    s.specificForce.x = 0; let overshoot = 0;
    for (let i = 0; i < 1200; i++) { c.step(1 / 120, s); overshoot = Math.max(overshoot, error(c, s)); }
    expect(overshoot).toBeGreaterThan(2); expect(Math.abs(error(c, s))).toBeLessThan(0.1);
  });
  it('limits combined tilt to an 18 degree cone, contacts the stop, and recovers', () => {
    const s = input(40), c = new MagneticCompass({ deviation: false }); c.reset(s);
    s.specificForce = { x: 1, y: 1, z: -0.5 };
    for (let i = 0; i < 1200; i++) {
      c.step(1 / 120, s);
      expect(Math.hypot(c.reading.roll, c.reading.pitch)).toBeLessThanOrEqual(MagneticCompass.TILT_LIMIT + 1e-12);
    }
    expect(c.reading.atStop).toBe(true);
    s.specificForce = { x: 0, y: 0, z: -1 }; run(c, s, 20);
    expect(c.reading.atStop).toBe(false); expect(Math.abs(error(c, s))).toBeLessThan(0.1);
  });
  it('responds deterministically to real gust loads/rates and becomes still after turbulence', () => {
    const a = new MagneticCompass(), b = new MagneticCompass(), s = input(70); a.reset(s); b.reset(s);
    let excursion = 0;
    for (let i = 0; i < 1200; i++) {
      const t = i / 120;
      s.specificForce = { x: 0.08 * Math.sin(t * 3), y: 0.10 * Math.sin(t * 4), z: -1 + 0.1 * Math.cos(t * 5) };
      s.angularVelocity.x = 0.06 * Math.cos(t * 4); s.roll = 0.015 * Math.sin(t * 4);
      a.step(1 / 120, s); b.step(1 / 120, s); excursion = Math.max(excursion, Math.abs(error(a, s)));
    }
    expect(a.reading).toEqual(b.reading); expect(excursion).toBeGreaterThan(3);
    Object.assign(s, input(70)); run(a, s, 20);
    expect(error(a, s)).toBeCloseTo(compassDeviation(s.heading, s.aircraft) / DEG, 2);
  });
  it('uses positive-east variation, wraps north, freezes at dt=0 and resets without a stale swing', () => {
    const s = input(5), c = new MagneticCompass({ variationDeg: 12, deviation: false }); c.reset(s);
    expect(c.reading.heading / DEG).toBeCloseTo(353);
    const prior = { ...c.reading }; s.heading = 45 * DEG; c.step(0, s); expect(c.reading).toEqual(prior);
    c.reset(s); expect(c.reading.heading / DEG).toBeCloseTo(33);
  });
  it('settling is stable across common render steps, including a long frame', () => {
    const results = [1 / 30, 1 / 60, 1 / 120, 0.5].map(dt => {
      const s = input(90), c = new MagneticCompass({ deviation: false }); c.reset(s);
      s.specificForce.x = 0.15; run(c, s, 3, dt); return c.reading.heading;
    });
    results.forEach(h => expect(h).toBeCloseTo(results[0], 10));
  });
});

describe('per-aircraft deviation cards and shared indications', () => {
  it.each(AIRCRAFT_IDS)('%s settles to its own deviation and every FOR/STEER entry has the right sign', aircraft => {
    expect(COMPASS_DEVIATION[aircraft]).toBeDefined();
    for (const entry of compassCorrectionCard(aircraft)) {
      const s = { ...input(entry.for), aircraft }, c = new MagneticCompass(); c.reset(s); run(c, s, 10);
      expect(error(c, s)).toBeCloseTo(compassDeviation(s.heading, aircraft) / DEG, 4);
      expect(Math.abs(wrapPi(c.reading.heading - entry.steer * DEG)) / DEG).toBeLessThanOrEqual(0.501);
      expect(Math.abs(error(c, s))).toBeLessThan(4);
    }
  });
  it('publishes one compass state and aligns the DG to its actual indication without snapping back', () => {
    const set = new InstrumentSet(), s = makeMockState(), controls = defaultControls(), weather = defaultWeather();
    s.heading = 90 * DEG; s.specificForce.x = 0.15; set.reset(s);
    for (let i = 0; i < 600; i++) set.step(1 / 120, s, controls, weather);
    expect(set.readings.compass).toBe(set.compass.reading);
    controls.dgAlign = true; set.step(1 / 120, s, controls, weather);
    const aligned = set.readings.compass.heading;
    expect(set.readings.headingDeg).toBeCloseTo(aligned / DEG, 8);
    controls.dgAlign = false; set.step(1 / 120, s, controls, weather);
    expect(set.readings.headingDeg).toBeCloseTo(aligned / DEG, 3);
    expect(Math.abs(wrapPi(aligned - s.heading)) / DEG).toBeGreaterThan(10);
  });
});
