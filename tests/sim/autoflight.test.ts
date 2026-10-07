// The pilot's autopilot (A key): KAP 140-style HDG + ALT, the throttle left to the pilot; and the scripted
// take-off holding the centreline through lift-off.

import { describe, expect, it } from 'vitest';
import { DEG, FT, KT } from '../../src/core/math';
import { defaultWeather } from '../../src/core/types';
import { runwayCoords } from '../../src/core/world';
import { parseParams } from '../../src/sim/params';
import { SimPhysics } from '../../src/sim/SimPhysics';

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

function cruise(): SimPhysics {
  const p = new SimPhysics({ weather: defaultWeather() });
  p.autoflightOnReset = false;
  p.reset('cruise');
  return p;
}

describe('pilot autopilot (A key)', () => {
  it('engages synchronised to the present heading and flies the heading bug when it is moved', () => {
    const p = cruise();
    const s = p.state;
    const c = p.controls;
    p.autoflight.dgOffset = 0;
    p.setAutoflight(true);
    expect(p.autoflight.phase).toBe('hold');
    expect(Math.abs(wrap(c.headingBugDeg * DEG - s.heading))).toBeLessThan(0.6 * DEG);
    const h0 = s.heading;
    p.step(5);
    expect(Math.abs(wrap(s.heading - h0))).toBeLessThan(2 * DEG);
    c.headingBugDeg = (((h0 / DEG + 60) % 360) + 360) % 360;
    p.step(60);
    expect(Math.abs(wrap(s.heading - (h0 + 60 * DEG)))).toBeLessThan(3 * DEG);
  }, 60000);

  it('follows the bug on the DG card, not true heading, when the card is off', () => {
    const p = cruise();
    const s = p.state;
    const c = p.controls;
    p.autoflight.dgOffset = 10 * DEG; // card reads 10 degrees more than true
    p.setAutoflight(true);
    const h0 = s.heading;
    expect(Math.abs(wrap(c.headingBugDeg * DEG - (h0 + 10 * DEG)))).toBeLessThan(0.6 * DEG);
    p.step(20);
    expect(Math.abs(wrap(s.heading - h0))).toBeLessThan(2 * DEG);
  }, 60000);

  it('leaves the throttle to the pilot and holds an adjustable altitude', () => {
    const p = cruise();
    const s = p.state;
    const c = p.controls;
    p.setAutoflight(true);
    const alt0 = p.autoflight.targetAltitude;
    expect(Math.abs(alt0 - s.altitudeMSL)).toBeLessThan(5 * FT + 0.01);
    c.throttle = 0.5;
    p.step(10);
    expect(c.throttle).toBe(0.5);
    expect(Math.abs(s.altitudeMSL - alt0)).toBeLessThan(60 * FT);
    c.throttle = 0.9;
    const target = p.autoflight.adjustAltitude(300 * FT);
    expect(target).toBeCloseTo(alt0 + 300 * FT, 3);
    p.step(90);
    expect(Math.abs(s.altitudeMSL - target)).toBeLessThan(40 * FT);
    expect(s.ias / KT).toBeGreaterThan(60);
  }, 60000);
});

describe('autoflight take-off', () => {
  it('holds the runway centreline through lift-off in the default crosswind', () => {
    const p = new SimPhysics({ weather: defaultWeather() });
    p.autoflightOnReset = true;
    p.reset('runway');
    const s = p.state;
    let worst = 0;
    for (let t = 0; t < 40; t += 0.5) {
      p.step(0.5);
      worst = Math.max(worst, Math.abs(runwayCoords(s.position.x, s.position.y).across));
    }
    expect(s.crashed).toBe(false);
    expect(s.onGround).toBe(false);
    expect(worst).toBeLessThan(8);
  }, 60000);
});

describe('URL parameters', () => {
  it('cirrus= sets the cirrus cover (clamped)', () => {
    expect(parseParams('?cirrus=0.4').weather.cirrusCover).toBeCloseTo(0.4);
    expect(parseParams('?cirrus=3').weather.cirrusCover).toBe(1);
    expect(parseParams('?cover=0.2').weather.cirrusCover).toBeUndefined();
  });
  it('scale= is optional (per-quality default) and clamped; assist=0 turns the keyboard assists off', () => {
    expect(parseParams('').renderScale).toBeNull();
    expect(parseParams('?scale=0.2').renderScale).toBe(0.5);
    expect(parseParams('?scale=0.8').renderScale).toBeCloseTo(0.8);
    expect(parseParams('').assists).toBe(true);
    expect(parseParams('?assist=0').assists).toBe(false);
  });
});
