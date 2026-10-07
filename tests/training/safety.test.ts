// SafetyMonitor (spec 3.8): every envelope rule, the 0.5 s duration (immediate for low-and-slow and g),
// one report per excursion (latched until the condition clears), the low-level and stall-allowed exemptions,
// the flare exemption, recovery selection and the spoken reasons.

import { describe, expect, it } from 'vitest';
import { TrainingBus } from '../../src/training/engine/bus';
import { BREACH_S, SAFETY_REASONS, SafetyMonitor, type SafetyBreach } from '../../src/training/engine/safety';
import { STANDARDS } from '../../src/training/grading/standards';
import type { EvalContext, SafetyEnvelope, SignalFrame } from '../../src/training/types';
import { cruiseSignals, testAircraft } from './fakes/runnerFakes';

const ENV: SafetyEnvelope = testAircraft().envelope;

function ctxFor(frame: SignalFrame): EvalContext & { dt: number; simT: number } {
  return {
    frame, vars: {}, aircraft: testAircraft(), fieldElevFt: 394, standards: STANDARDS, authority: 'easa', standard: 'training',
    events: new TrainingBus(), stepMark: 0, stepT: 0, dt: 0.1, simT: 0, pilot: 'student', speechIdle: true,
    exerciseGrade: () => null, signalDef: () => undefined,
  };
}

/** Feed `frame` for `seconds`; return the breaches reported, with their times. */
function feed(mon: SafetyMonitor, frame: SignalFrame, seconds: number, dt = 0.05, t0 = 0): { t: number; b: SafetyBreach }[] {
  const out: { t: number; b: SafetyBreach }[] = [];
  const ctx = ctxFor(frame);
  ctx.dt = dt;
  const n = Math.round(seconds / dt);
  for (let i = 1; i <= n; i++) {
    ctx.simT = t0 + i * dt;
    const b = mon.update(ctx);
    if (b) out.push({ t: Math.round(ctx.simT * 100) / 100, b });
  }
  return out;
}

const cruise = (s: Partial<SignalFrame> = {}): SignalFrame => ({ ...cruiseSignals(), ...s }) as SignalFrame;

describe('SafetyMonitor', () => {
  it('quiet inside the envelope', () => {
    const mon = new SafetyMonitor(ENV);
    expect(feed(mon, cruise(), 10)).toEqual([]);
    expect(mon.anyViolated).toBe(false);
  });

  it('a bank breach must last 0.5 s, is reported once, and again only after it clears', () => {
    const mon = new SafetyMonitor(ENV);
    expect(feed(mon, cruise({ bankDeg: 70 }), 0.45)).toEqual([]);
    const mon2 = new SafetyMonitor(ENV);
    const hits = feed(mon2, cruise({ bankDeg: -70 }), 3);
    expect(hits).toHaveLength(1);
    expect(hits[0].t).toBeGreaterThanOrEqual(BREACH_S);
    expect(hits[0].t).toBeLessThanOrEqual(BREACH_S + 0.05);   // the first frame at or past 0.5 s
    expect(hits[0].b).toMatchObject({ rule: 'bank', recovery: 'noseLow', imminent: false });
    expect(feed(mon2, cruise(), 0.2)).toEqual([]);
    expect(feed(mon2, cruise({ bankDeg: 65 }), 1)).toHaveLength(1);
  });

  it('a short excursion does not accumulate across a clear frame', () => {
    const mon = new SafetyMonitor(ENV);
    expect(feed(mon, cruise({ bankDeg: 70 }), 0.4)).toEqual([]);
    expect(feed(mon, cruise(), 0.05)).toEqual([]);
    expect(feed(mon, cruise({ bankDeg: 70 }), 0.4)).toEqual([]);
  });

  it('g limits and low-and-slow act at once; low-and-slow resolves its Ref (Vs1 + 5 = 53 kt)', () => {
    expect(feed(new SafetyMonitor(ENV), cruise({ gLoad: 3.5 }), 0.05)[0].b.rule).toBe('g');
    expect(feed(new SafetyMonitor(ENV), cruise({ gLoad: -0.2 }), 0.05)[0].b.rule).toBe('g');
    const lowSlow = { aglFt: 250, kias: 52, onGround: false };
    const hit = feed(new SafetyMonitor({ ...ENV, minAglFt: 0 }), cruise(lowSlow), 0.05);
    expect(hit[0].b).toMatchObject({ rule: 'lowAndSlow', recovery: 'low', imminent: true });
    expect(feed(new SafetyMonitor({ ...ENV, minAglFt: 0 }), cruise({ ...lowSlow, kias: 54 }), 1)).toEqual([]);
  });

  it('the flare and the ground are not low-and-slow, a stall or a minimum-height breach', () => {
    const mon = new SafetyMonitor(ENV);
    mon.configure(ENV, true);
    expect(feed(mon, cruise({ aglFt: 15, kias: 45, stallFrac: 0.3, vsFpm: -200 }), 2)).toEqual([]);
    expect(feed(mon, cruise({ onGround: true, aglFt: 0, kias: 40, gsKt: 40, rwyAcrossM: 2 }), 2)).toEqual([]);
  });

  it('minimum height applies outside lowLevel phases only', () => {
    const mon = new SafetyMonitor(ENV);
    expect(feed(mon, cruise({ aglFt: 900 }), 1)[0].b).toMatchObject({ rule: 'minHeight', recovery: 'low' });
    mon.configure(ENV, true);
    mon.reset();
    expect(feed(mon, cruise({ aglFt: 900 }), 1)).toEqual([]);
  });

  it('sink rate below 200 ft and a runway excursion above 15 kt', () => {
    const low = new SafetyMonitor({ ...ENV, minAglFt: 0 });
    expect(feed(low, cruise({ aglFt: 150, vsFpm: -1200, kias: 70 }), 1)[0].b).toMatchObject({ rule: 'sink', recovery: 'low', imminent: true });
    const ground = new SafetyMonitor(ENV);
    expect(feed(ground, cruise({ onGround: true, onRunway: true, aglFt: 0, gsKt: 30, rwyAcrossM: -5 }), 1)).toEqual([]);
    const hit = feed(ground, cruise({ onGround: true, onRunway: false, aglFt: 0, gsKt: 30, rwyAcrossM: -14 }), 1, 0.05, 1);
    expect(hit[0].b).toMatchObject({ rule: 'runwayExcursion', recovery: 'ground' });
    expect(feed(new SafetyMonitor(ENV), cruise({ onGround: true, aglFt: 0, gsKt: 10, rwyAcrossM: -40 }), 1)).toEqual([]);
  });

  it('a fast taxi away from the runway is a taxi-speed breach, not a runway excursion', () => {
    const hit = feed(new SafetyMonitor(ENV), cruise({ onGround: true, onRunway: false, aglFt: 0, gsKt: 20, rwyAcrossM: -120 }), 1);
    expect(hit).toHaveLength(1);
    expect(hit[0].b).toMatchObject({ rule: 'taxiSpeed', recovery: 'ground', reason: SAFETY_REASONS.taxiSpeed });
  });

  it('near the ground a bank breach with the nose up recovers with power (low), not the nose-low idle', () => {
    const hit = feed(new SafetyMonitor({ ...ENV, minAglFt: 0 }), cruise({ aglFt: 400, bankDeg: 65, pitchDeg: 8, kias: 75 }), 1);
    expect(hit[0].b).toMatchObject({ rule: 'bank', recovery: 'low' });
  });

  it('stalls are a breach unless the envelope allows them and the aircraft is above 2,000 ft AGL', () => {
    const stall = cruise({ stallFrac: 0.4, kias: 45, pitchDeg: 12 });
    expect(feed(new SafetyMonitor(ENV), stall, 1)[0].b).toMatchObject({ rule: 'stall', recovery: 'slow' });
    const allowed = { ...ENV, stallAllowed: true };
    expect(feed(new SafetyMonitor(allowed), stall, 1)).toEqual([]);
    expect(feed(new SafetyMonitor({ ...allowed, minAglFt: 0 }), { ...stall, aglFt: 1800 }, 1)[0].b.rule).toBe('stall');
  });

  it('pitch and speed limits pick the matching recovery', () => {
    expect(feed(new SafetyMonitor(ENV), cruise({ pitchDeg: 30, kias: 60 }), 1)[0].b).toMatchObject({ rule: 'pitchUp', recovery: 'slow' });
    expect(feed(new SafetyMonitor(ENV), cruise({ pitchDeg: -30 }), 1)[0].b).toMatchObject({ rule: 'pitchDown', recovery: 'noseLow' });
    expect(feed(new SafetyMonitor(ENV), cruise({ kias: 145 }), 1)[0].b).toMatchObject({ rule: 'speed', recovery: 'noseLow' });
  });

  it('lesson envelope overrides apply (steep turns: 65°)', () => {
    const mon = new SafetyMonitor(ENV);
    mon.configure({ ...ENV, maxBankDeg: 65 }, false);
    expect(feed(mon, cruise({ bankDeg: 62 }), 2)).toEqual([]);
    expect(mon.envelope.maxBankDeg).toBe(65);
  });

  it('reset() clears latches and timers', () => {
    const mon = new SafetyMonitor(ENV);
    expect(feed(mon, cruise({ bankDeg: 70 }), 1)).toHaveLength(1);
    mon.reset();
    expect(feed(mon, cruise({ bankDeg: 70 }), 1)).toHaveLength(1);
  });

  it('every reason is one short sentence (at most 20 words)', () => {
    for (const r of Object.values(SAFETY_REASONS)) expect(r.split(/\s+/).length).toBeLessThanOrEqual(20);
  });
});
