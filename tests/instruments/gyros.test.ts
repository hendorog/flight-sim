import { describe, expect, it } from 'vitest';
import { DEG, type Vec3 } from '../../src/core/math';
import { vacuumSuction } from '../../src/instruments/dynamics/gyro';
import { AttitudeIndicator, HeadingIndicator, TurnCoordinator } from '../../src/instruments/dynamics/gyroInstruments';

const LEVEL: Vec3 = { x: 0, y: 0, z: -1 };

describe('vacuum pump', () => {
  it('is in the green at run-up rpm and low at idle, zero stopped', () => {
    expect(vacuumSuction(1800)).toBeCloseTo(5.0, 5);
    expect(vacuumSuction(600)).toBeGreaterThan(3.3);
    expect(vacuumSuction(600)).toBeLessThan(4.5);
    expect(vacuumSuction(0)).toBe(0);
  });
});

describe('AttitudeIndicator', () => {
  it('follows the aircraft when spun up', () => {
    const ai = new AttitudeIndicator(true);
    for (let i = 0; i < 50; i++) ai.step(0.02, 20 * DEG, 5 * DEG, { x: Math.sin(5 * DEG), y: 0, z: -1 }, 5);
    expect(ai.roll).toBeCloseTo(20 * DEG, 2);
    expect(ai.pitch).toBeCloseTo(5 * DEG, 2);
  });

  it('starts toppled, spins up with vacuum and erects over a few minutes', () => {
    const ai = new AttitudeIndicator(false);
    ai.step(0.02, 0, 0, LEVEL, 0);
    expect(Math.abs(ai.roll)).toBeGreaterThan(10 * DEG);
    for (let t = 0; t < 60; t += 0.1) ai.step(0.1, 0, 0, LEVEL, 5);
    expect(ai.rotor.spin).toBeGreaterThan(0.85);
    for (let t = 0; t < 240; t += 0.1) ai.step(0.1, 0, 0, LEVEL, 5);
    expect(Math.abs(ai.roll)).toBeLessThan(0.5 * DEG);
    expect(Math.abs(ai.pitch)).toBeLessThan(0.5 * DEG);
  });

  it('fails when the vacuum is lost: the card stops following the aircraft', () => {
    const ai = new AttitudeIndicator(true);
    for (let t = 0; t < 400; t += 0.1) ai.step(0.1, 0, 0, LEVEL, 0);
    expect(ai.rotor.spin).toBeLessThan(0.15);
    const before = ai.roll;
    for (let t = 0; t < 5; t += 0.1) ai.step(0.1, 30 * DEG, 0, LEVEL, 0);
    expect(ai.roll).toBeCloseTo(before, 3);
  });

  it('erects toward the apparent vertical in a long coordinated turn (turn error)', () => {
    const ai = new AttitudeIndicator(true);
    // Coordinated 30 deg bank: the specific force is along body z.
    for (let t = 0; t < 60; t += 0.05) ai.step(0.05, 30 * DEG, 0, { x: 0, y: 0, z: -1.155 }, 5);
    const err = 30 * DEG - ai.roll;
    expect(err).toBeGreaterThan(4 * DEG);
    expect(err).toBeLessThan(7 * DEG);
  });
});

describe('HeadingIndicator', () => {
  it('follows turns and drifts about 3 degrees in 15 minutes', () => {
    const hi = new HeadingIndicator(true);
    hi.step(0.1, 70 * DEG, 5);
    hi.step(0.1, 160 * DEG, 5);
    expect(hi.heading / DEG).toBeCloseTo(160, 1);
    for (let t = 0; t < 900; t += 0.5) hi.step(0.5, 160 * DEG, 5);
    expect(hi.heading / DEG - 160).toBeGreaterThan(2.5);
    expect(hi.heading / DEG - 160).toBeLessThan(3.5);
    hi.align(160 * DEG);
    expect(hi.heading / DEG).toBeCloseTo(160, 6);
  });

  it('stops following the aircraft once the rotor has run down', () => {
    const hi = new HeadingIndicator(true);
    hi.step(0.1, 0, 0);
    for (let t = 0; t < 600; t += 0.5) hi.step(0.5, 0, 0);
    const before = hi.heading;
    hi.step(0.1, 90 * DEG, 0);
    expect(Math.abs(hi.heading - before)).toBeLessThan(1 * DEG);
  });
});

describe('TurnCoordinator', () => {
  it('shows standard rate for a 3 deg/s yaw rate, leads with roll rate, flags when unpowered', () => {
    const tc = new TurnCoordinator(true);
    for (let t = 0; t < 3; t += 0.02) tc.step(0.02, 0, 3 * DEG, 0, true);
    expect(tc.rate).toBeCloseTo(1, 2);
    expect(tc.flag).toBe(false);
    const rolling = new TurnCoordinator(true);
    for (let t = 0; t < 3; t += 0.02) rolling.step(0.02, 5 * DEG, 0, 0, true);
    expect(rolling.rate).toBeGreaterThan(0.9);
    tc.step(0.02, 0, 0, 0, false);
    expect(tc.flag).toBe(true);
  });

  it('ball settles on the physics slip indication', () => {
    const tc = new TurnCoordinator(true);
    for (let t = 0; t < 3; t += 0.02) tc.step(0.02, 0, 0, 0.4, true);
    expect(tc.ball).toBeCloseTo(0.4, 3);
  });
});
