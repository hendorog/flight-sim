// Time acceleration (SimPhysics.advance with a CPU budget and the coarse airborne rate), the local clock,
// the cruise scenario's terrain clearance and the A-key heading hold.

import { describe, expect, it } from 'vitest';
import { DEG, FT, KT, wrapPi } from '../../src/core/math';
import { defaultWeather } from '../../src/core/types';
import { advanceTimeOfDay } from '../../src/sim/clock';
import { buildScenario } from '../../src/sim/scenarios';
import { COARSE_RATE, SimPhysics } from '../../src/sim/SimPhysics';
import { worldTerrain } from '../../src/sim/worldEnvironment';

function sim(id: 'cruise' | 'downwind' | 'runway', autoflight = true, weather = defaultWeather()): SimPhysics {
  const p = new SimPhysics({ weather });
  p.autoflightOnReset = autoflight;
  p.reset(id);
  return p;
}

describe('time acceleration', () => {
  it.each([
    [8, 0.5],
    [16, 0.25],
  ])('%dx airborne runs at a coarse rate and matches full-rate flight', (scale, fraction) => {
    const w = defaultWeather();
    w.turbulence = 0.5;
    const a = sim('downwind', true, w);
    const b = sim('downwind', true, { ...w });
    // `scale` x at 60 fps for 150 simulated seconds, against exact full-rate steps.
    let steps = 0;
    const frames = Math.round((150 * 60) / scale);
    for (let i = 0; i < frames; i++) steps += a.advance(scale / 60, scale);
    b.step(a.time);
    const full = a.time / a.stepSize;
    expect(steps).toBeLessThan((fraction + 0.05) * full);
    expect(steps).toBeGreaterThan((fraction - 0.05) * full);
    const sa = a.state;
    const sb = b.state;
    expect(Math.abs(sa.altitudeMSL - sb.altitudeMSL)).toBeLessThan(2);
    expect(Math.abs(sa.ias - sb.ias) / KT).toBeLessThan(1);
    expect(Math.abs(wrapPi(sa.heading - sb.heading)) / DEG).toBeLessThan(1);
    expect(Math.abs(sa.engine.rpm - sb.engine.rpm)).toBeLessThan(15);
    expect(Math.hypot(sa.position.x - sb.position.x, sa.position.y - sb.position.y)).toBeLessThan(20);
    expect(COARSE_RATE).toBe(120);
  }, 60000);

  it('keeps the full rate on the ground and near it', () => {
    const p = sim('runway', false);
    const n = p.advance(16 / 60, 16);
    // 16/60 s at 240 Hz is 64 steps (63 with the rounding of the accumulated step sizes).
    expect(n).toBeGreaterThanOrEqual(63);
    expect(n).toBeLessThanOrEqual(64);
  }, 60000);

  it('a CPU budget drops simulated time instead of stalling, and lastAdvance reports what ran', () => {
    const p = sim('cruise');
    const t0 = p.time;
    const n = p.advance(1.6, 16, 0);
    // A zero budget still runs one step per frame.
    expect(n).toBe(1);
    expect(p.budgetLimited).toBe(true);
    expect(p.lastAdvance).toBeGreaterThan(0);
    expect(p.lastAdvance).toBeLessThan(4 / COARSE_RATE);
    expect(p.time - t0).toBeCloseTo(p.lastAdvance, 9);
    // Unlimited: all of it (up to the per-frame cap).
    const n2 = p.advance(1.6, 16);
    expect(p.budgetLimited).toBe(false);
    expect(n2).toBeGreaterThan(90); // 1.6 s at 60 Hz (16x, airborne)
    expect(p.lastAdvance).toBeGreaterThan(1.55);
  }, 60000);

  it('at 1x lastAdvance equals the frame time exactly (interpolated state)', () => {
    const p = sim('cruise');
    // (The first frame after a reset starts the interpolation, which begins one step behind.)
    p.advance(1 / 144, 1, 8);
    for (let i = 0; i < 10; i++) {
      p.advance(1 / 144, 1, 8);
      expect(p.lastAdvance).toBeCloseTo(1 / 144, 9);
    }
  }, 60000);
});

describe('local clock', () => {
  it('advances with simulated time and rolls the date at midnight', () => {
    const w = defaultWeather();
    w.timeOfDay = 23.5;
    w.dayOfYear = 365;
    advanceTimeOfDay(w, 3600);
    expect(w.timeOfDay).toBeCloseTo(0.5, 9);
    expect(w.dayOfYear).toBe(1);
    advanceTimeOfDay(w, 0);
    advanceTimeOfDay(w, -5);
    expect(w.timeOfDay).toBeCloseTo(0.5, 9);
  });
});

describe('cruise scenario', () => {
  it('has at least 2000 ft of terrain clearance within 5 NM of its track for 15 minutes', () => {
    const sc = buildScenario('cruise', sim('cruise', false).env);
    if (sc.autoflight.kind !== 'hold') throw new Error('cruise plan is not a hold');
    const { heading, altitude } = sc.autoflight;
    const n0 = sc.ic.position.x;
    const e0 = sc.ic.position.y;
    let highest = -Infinity;
    // 15 minutes at ~115 kt TAS is ~53 km.
    for (let d = 0; d <= 55000; d += 250) {
      for (let l = -9260; l <= 9260; l += 250) {
        const n = n0 + Math.cos(heading) * d - Math.sin(heading) * l;
        const e = e0 + Math.sin(heading) * d + Math.cos(heading) * l;
        highest = Math.max(highest, worldTerrain.height(n, e));
      }
    }
    expect(altitude - highest).toBeGreaterThan(2000 * FT);
    // Below the default cloud base.
    expect(altitude).toBeLessThan(defaultWeather().cloudBaseM - 100);
  });

  it('flies its own plan (ap=1) for 10 minutes without hitting anything', () => {
    const p = sim('cruise');
    for (let t = 0; t < 600; t += 5) {
      p.step(5);
      expect(p.state.crashed).toBe(false);
    }
    expect(Math.abs(p.state.altitudeMSL - 4500 * FT)).toBeLessThan(30);
    expect(p.state.altitudeAGL).toBeGreaterThan(500);
  }, 120000);
});

describe('A key (engage here)', () => {
  it('holds the current heading in a crosswind instead of yawing onto the track', () => {
    const w = defaultWeather();
    w.windDirectionDeg = 340;
    w.windSpeedKt = 20;
    w.gustKt = 0;
    w.turbulence = 0;
    const p = sim('downwind', true, w);
    p.step(60);
    const s = p.state;
    const drift = Math.abs(wrapPi(s.heading - s.track)) / DEG;
    expect(drift).toBeGreaterThan(5);
    const hdg0 = s.heading;
    const alt0 = s.altitudeMSL;
    p.setAutoflight(true);
    expect(p.autoflight.phase).toBe('hold');
    let maxDev = 0;
    let sum = 0;
    let k = 0;
    for (let t = 0; t < 40; t += 0.5) {
      p.step(0.5);
      maxDev = Math.max(maxDev, Math.abs(wrapPi(s.heading - hdg0)) / DEG);
      sum += wrapPi(s.heading - hdg0) / DEG;
      k++;
    }
    // Before: the target was the track, so it yawed ~18 deg onto it and the track then drifted away.
    // Now it stays on the heading it had, apart from the wind field's thermal/terrain gusts.
    expect(maxDev).toBeLessThan(5);
    expect(Math.abs(sum / k)).toBeLessThan(1);
    expect(Math.abs(s.altitudeMSL - alt0)).toBeLessThan(20);
  }, 60000);
});
