// Every demonstration script (content/demos.ts) flown by the copilot with the real flight model from the
// start and weather its lesson uses (section 4.1): it must reach every `until` within its timeout (result
// 'done', never 'timeout' or 'aborted') and stay inside the safety envelope of section 3.8 throughout.

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
import type { StartOptions, StartSpec } from '../../src/sim/starts';
import { C172S } from '../../src/training/aircraft/c172s';
import { DEMOS, DEMO_LINES, DEMO_START_VARS, RECOVERY, demoCueIds } from '../../src/training/content/demos';
import type { DemoScript } from '../../src/training/types';
import { Rig } from './copilotHarness';

// Section 2.8 weather presets (content/weatherPresets.ts builds the real ones; these are their mid values).
const W = (o: Partial<WeatherSettings>): WeatherSettings => ({ ...defaultWeather(), gustKt: 0, ...o });
const CALM = W({ windSpeedKt: 2, turbulence: 0.03, cloudCover: 0.2 });
const SMOOTH = W({ windSpeedKt: 5, turbulence: 0.05 });
const LIGHT = W({ windDirectionDeg: 90, windSpeedKt: 7, turbulence: 0.1, cloudCover: 0.35 });
const XWIND10 = W({ windDirectionDeg: 160, windSpeedKt: 10, gustKt: 14, turbulence: 0.1 });

const air = (altFt: number, kias: number): StartSpec => ({ kind: 'air', at: 'trainingArea', altFt, altRef: 'msl', hdgDeg: 100, kias });
const LINEUP: StartSpec = { kind: 'ground', spot: 'lineup07', engine: 'running' };

interface DemoCase {
  start: StartSpec; weather: WeatherSettings; opts?: StartOptions;
  /** Lesson vars the script reads (the lesson captures them in the step before the demo). */
  vars?: (r: Rig) => Record<string, number>;
  /** Upper-air demos keep the envelope's minimum height; circuit demos fly low by design. */
  upperAir: boolean;
  maxBank?: number; maxStallFrac?: number; maxS: number;
}

const CASES: Record<string, DemoCase> = {
  primaryEffects: { start: air(3500, 100), weather: CALM, upperAir: true, maxS: 200 },
  furtherEffects: { start: air(3500, 100), weather: CALM, upperAir: true, maxS: 300 },
  straightLevel: { start: air(3500, 105), weather: SMOOTH, upperAir: true, maxS: 300 },
  climbLevelOff: { start: air(2500, 105), weather: SMOOTH, opts: { payload: 'forward', fuelFraction: 0.8 }, upperAir: true, maxS: 250,
    vars: (r) => ({ alt0: r.frame.altFt as number, hdg0: r.frame.hdgDeg as number }) },
  glideLevelOff: { start: air(3500, 105), weather: SMOOTH, upperAir: true, maxS: 300 },
  mediumTurn: { start: air(3500, 100), weather: LIGHT, upperAir: true, maxS: 300 },
  slowFlight: { start: air(4000, 90), weather: CALM, upperAir: true, maxS: 400 },
  powerOffStall: { start: air(4500, 90), weather: CALM, opts: { payload: 'forward' }, upperAir: true, maxS: 300, maxBank: 20, maxStallFrac: 0.6 },
  takeoff: { start: LINEUP, weather: LIGHT, upperAir: false, maxS: 160 },
  landing: { start: { kind: 'final', distNm: 3, kias: 75, flapsDeg: 20 }, weather: LIGHT, upperAir: false, maxS: 320 },
  crosswindLanding: { start: { kind: 'final', distNm: 3, kias: 75, flapsDeg: 20 }, weather: XWIND10, upperAir: false, maxS: 320 },
  circuit: { start: LINEUP, weather: LIGHT, upperAir: false, maxS: 900 },
  goAround: { start: { kind: 'final', distNm: 1, kias: 70, flapsDeg: 20 }, weather: LIGHT, upperAir: false, maxS: 320 },
  efato: { start: LINEUP, weather: LIGHT, upperAir: false, maxS: 330 },
  steepTurn: { start: air(4000, 95), weather: SMOOTH, upperAir: true, maxS: 300, maxBank: 65 },
  spiralSetup: { start: air(4000, 95), weather: SMOOTH, upperAir: true, maxS: 30, maxBank: 65 },
  unusualNoseHigh: { start: air(4000, 90), weather: SMOOTH, upperAir: true, maxS: 40 },
  unusualNoseLow: { start: air(4000, 90), weather: SMOOTH, upperAir: true, maxS: 30 },
  instrumentScan: { start: air(4000, 95), weather: SMOOTH, upperAir: true, maxS: 200 },
  pfl: { start: { kind: 'air', at: 'pflHighKey', altFt: 3000, altRef: 'field', hdgDeg: 250, kias: 68 }, weather: LIGHT, upperAir: false, maxS: 900 },
};

describe('demo catalogue', () => {
  it('has a flight test for every demo, and only for demos', () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(DEMOS).sort());
    for (const [id, d] of Object.entries(DEMOS)) expect(d.id).toBe(id);
  });

  it('gives every until segment a positive timeout and every timed segment a positive duration', () => {
    const all: DemoScript[] = [...Object.values(DEMOS), ...Object.values(RECOVERY)];
    for (const d of all) {
      expect(d.segments.length, d.id).toBeGreaterThan(0);
      for (const s of d.segments) {
        if (s.kind === 'ap' || s.kind === 'autoflight') expect(s.timeoutS, d.id).toBeGreaterThan(0);
        if (s.kind === 'raw') expect(s.forS).toBeGreaterThan(0);
        if (s.kind === 'pulse') expect(s.holdS).toBeGreaterThan(0);
        if (s.kind === 'pause') expect(s.s).toBeGreaterThan(0);
      }
      expect(JSON.parse(JSON.stringify(d)), `${d.id} is plain data`).toEqual(d);
    }
  });

  it('has a default line of at most 20 words for every cue the scripts speak', () => {
    for (const id of demoCueIds()) {
      const l = DEMO_LINES[id];
      expect(l, id).toBeDefined();
      for (const t of Array.isArray(l.text) ? l.text : [l.text]) expect(t.split(/\s+/).filter(Boolean).length, `${id}: ${t}`).toBeLessThanOrEqual(20);
    }
    expect(DEMO_START_VARS).toContain('demo.altFt');
  });
});

describe('every demo flies to "done" inside the envelope', () => {
  it.each(Object.keys(CASES))('%s', (id) => {
    const k = CASES[id];
    const r = new Rig(k.start, { weather: k.weather, startOptions: k.opts });
    if (k.vars) r.vars = k.vars(r);
    const { result, seconds } = r.runDemo(DEMOS[id], k.maxS);
    const e = r.env;
    expect(result, `${id} after ${seconds.toFixed(0)} s`).toBe('done');
    expect(r.pilot.warnings, id).toEqual([]);
    expect(e.crashed, id).toBe(false);
    const env = C172S.envelope;
    expect(e.maxAbsBank, `${id} bank`).toBeLessThanOrEqual(k.maxBank ?? env.maxBankDeg);
    expect(e.maxPitch, `${id} pitch up`).toBeLessThanOrEqual(env.maxPitchUpDeg);
    expect(e.minPitch, `${id} pitch down`).toBeGreaterThanOrEqual(env.maxPitchDownDeg);
    expect(e.maxKias, `${id} speed`).toBeLessThanOrEqual(env.maxKias);
    expect(e.maxG, `${id} g`).toBeLessThan(env.maxG);
    expect(e.minG, `${id} negative g`).toBeGreaterThan(env.minG);
    expect(e.maxStallFrac, `${id} stall`).toBeLessThanOrEqual(k.maxStallFrac ?? 0.1);
    if (k.upperAir) expect(e.minAglFt, `${id} height`).toBeGreaterThanOrEqual(env.minAglFt);
    // The copilot still has control at the end, flying what the last segment set up.
    expect(r.pilot.flying).toBe(true);
  }, 120000);
});

describe('the patter matches the aircraft', () => {
  // Wave-3 playtest: "Flap thirty" was said but the flaps stayed at 20 to touchdown, because the lever was
  // set by a segment that ended on its first step. A lever setting now happens when its segment starts.
  it.each(['landing', 'crosswindLanding'])('%s: lands with flap 30 after saying so', (id) => {
    const k = CASES[id];
    const r = new Rig(k.start, { weather: k.weather });
    r.pilot.run(DEMOS[id], () => r.ctx);
    let flapsAt50 = NaN;
    r.flyUntil(() => r.pilot.demoResult !== null, k.maxS, () => {
      if (Number.isNaN(flapsAt50) && (r.frame.hafFt as number) < 50) flapsAt50 = r.frame.flapsDeg as number;
    });
    expect(r.pilot.demoResult).toBe('done');
    expect(flapsAt50).toBeGreaterThan(29);
  }, 120000);
});
