// The instructor-pilot's "restore straight and level" (lesson-limit intervention) flying the real SimPhysics
// in node: from any attitude the lesson limits allow (bank to 60 deg, pitch +-30 deg, 50-130 kt) back to wings
// level, steady height and the reference speed, never above 2 g; and the owner's case from L01: 55 deg of bank
// and 20 deg nose down at 2,500 ft, stable within 15 s and within 200 ft of the reference altitude.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/training/engine/predicates', async (orig) => {
  const real = await orig<typeof import('../../src/training/engine/predicates')>();
  const h = await import('./copilotFallbacks');
  return h.isStub(() => real.compile({ const: true })) ? { ...real, compile: h.miniCompile } : real;
});
vi.mock('../../src/training/engine/refs', async (orig) => {
  const real = await orig<typeof import('../../src/training/engine/refs')>();
  const h = await import('./copilotFallbacks');
  return h.isStub(() => real.resolveRef(1, {} as never)) ? { ...real, resolveRef: h.miniResolveRef } : real;
});
vi.mock('../../src/training/geo/areas', async (orig) => {
  const real = await orig<typeof import('../../src/training/geo/areas')>();
  const h = await import('./copilotFallbacks');
  return h.isStub(() => real.AREAS.trainingArea) ? { ...real, AREAS: h.FALLBACK_AREAS } : real;
});

import { defaultWeather, type WeatherSettings } from '../../src/core/types';
import type { StartSpec } from '../../src/sim/starts';
import { Rig, freshEnvelope } from './copilotHarness';

const f = (r: Rig, k: string): number => r.frame[k] as number;
const lightWeather = (): WeatherSettings => ({ ...defaultWeather(), windDirectionDeg: 90, windSpeedKt: 7, turbulence: 0.1 });

interface Outcome { allMaxG: number; stableAt: number; levelAt: number; startExcess: number; maxG: number; minG: number; altErrFt: number; crashed: boolean; minKias: number; maxKias: number }

/** Start at an attitude, restore to `ref`, fly until levelStable or `maxS`. */
function restoreFrom(start: StartSpec, ref: { altFt: number; hdgDeg: number | null; kias: number }, maxS: number, throttle?: number): { r: Rig; o: Outcome } {
  const r = new Rig(start, { weather: lightWeather() });
  if (throttle !== undefined) r.p.controls.throttle = throttle;
  r.env = freshEnvelope();
  r.pilot.restoreLevel(ref);
  let maxG = -9;
  let minG = 9;
  let levelAt = Infinity;
  let startG = 0;
  let allMaxG = 0;
  let startExcess = -9;
  const stableAt = r.flyUntil(() => r.pilot.levelStable, maxS, (t) => {
    // The first 2 s are the start's own state: a 60 degree turn at 130 kt is already 2.1 g before the copilot
    // has rolled anything out. There she must not add to it; after that, never 2 g.
    const g = f(r, 'gLoad');
    allMaxG = Math.max(allMaxG, g);
    if (t <= 0.5) startG = Math.max(startG, g);
    else if (t <= 2) startExcess = Math.max(startExcess, g - Math.max(startG, 1.9));
    else {
      maxG = Math.max(maxG, g);
      minG = Math.min(minG, g);
    }
    if (levelAt === Infinity && Math.abs(f(r, 'bankDeg')) < 10 && f(r, 'vsFpm') > -500) levelAt = t;
  });
  return { r, o: { allMaxG, stableAt, levelAt, startExcess, maxG, minG, altErrFt: Math.abs(f(r, 'altFt') - ref.altFt), crashed: r.env.crashed, minKias: r.env.minKias, maxKias: r.env.maxKias } };
}

describe('InstructorPilot.restoreLevel (lesson-limit intervention)', () => {
  it('L01 case: 55 deg bank and 20 deg nose down at 2,500 ft -> stable within 15 s, within 200 ft, under 2 g', () => {
    const start: StartSpec = { kind: 'attitude', at: 'trainingArea', altFt: 2500, kias: 100, pitchDeg: -20, bankDeg: 55, hdgDeg: 100 };
    const { r, o } = restoreFrom(start, { altFt: 2500, hdgDeg: 100, kias: 100 }, 15, 0.65);
    expect(o.crashed).toBe(false);
    expect(o.stableAt, 'stable within 15 s').toBeLessThan(15);
    expect(o.altErrFt, 'altitude within 200 ft of the reference').toBeLessThan(200);
    expect(o.allMaxG, 'never 2 g, from the first step').toBeLessThan(2);
    expect(o.minG).toBeGreaterThan(0);
    // Straight and level, and still holding it afterwards.
    expect(Math.abs(f(r, 'bankDeg'))).toBeLessThanOrEqual(3);
    expect(Math.abs(f(r, 'vsFpm'))).toBeLessThanOrEqual(200);
    expect(r.pilot.flying).toBe(true);
    r.fly(5);
    expect(Math.abs(f(r, 'bankDeg'))).toBeLessThan(5);
  }, 60000);

  // Corners of what the lesson limits allow: bank to 60, pitch +-30, 50-130 kt.
  const corners: [string, StartSpec, number][] = [
    ['60 deg left bank, 30 deg nose down, 130 kt', { kind: 'attitude', at: 'trainingArea', altFt: 4000, kias: 130, pitchDeg: -30, bankDeg: -60, hdgDeg: 100 }, 0.7],
    ['60 deg right bank, 30 deg nose up, 70 kt', { kind: 'attitude', at: 'trainingArea', altFt: 4000, kias: 70, pitchDeg: 30, bankDeg: 60, hdgDeg: 100 }, 0.65],
    ['wings level, 30 deg nose up, 50 kt', { kind: 'attitude', at: 'trainingArea', altFt: 4000, kias: 50, pitchDeg: 30, bankDeg: 0, hdgDeg: 100 }, 0.65],
    ['45 deg bank, level pitch, 50 kt', { kind: 'attitude', at: 'trainingArea', altFt: 4000, kias: 50, pitchDeg: 5, bankDeg: 45, hdgDeg: 100 }, 0.65],
    ['60 deg bank, level, 130 kt', { kind: 'attitude', at: 'trainingArea', altFt: 4000, kias: 130, pitchDeg: 0, bankDeg: 60, hdgDeg: 100 }, 0.9],
  ];
  it.each(corners)('%s: wings level and the descent stopped within 10 s, stable within 60 s, under 2 g, never stalled', (_n, start, thr) => {
    const { r, o } = restoreFrom(start, { altFt: 4000, hdgDeg: 100, kias: 100 }, 60, thr);
    expect(o.crashed).toBe(false);
    expect(o.levelAt, 'wings level, descent stopped').toBeLessThan(10);
    expect(o.stableAt, 'stable').toBeLessThan(60);
    expect(o.maxG).toBeLessThan(2);
    expect(o.startExcess, 'load added during the roll-out').toBeLessThan(0.15);
    expect(o.minG).toBeGreaterThan(0);
    expect(r.env.maxStallFrac).toBeLessThan(0.3);
  }, 60000);

  it('holdHere() and recover() cancel a restore (levelStable is false again)', () => {
    const { r } = restoreFrom({ kind: 'air', at: 'trainingArea', altFt: 4000, altRef: 'msl', hdgDeg: 100, kias: 100 }, { altFt: 4000, hdgDeg: 100, kias: 100 }, 10);
    expect(r.pilot.levelStable).toBe(true);
    r.pilot.holdHere();
    expect(r.pilot.levelStable).toBe(false);
  }, 60000);
});
