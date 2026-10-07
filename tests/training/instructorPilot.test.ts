// The instructor-pilot (section 3.9) flying the real SimPhysics in node: holds, bumpless handovers,
// control ownership, recovery from the four section 3.8 seeds, script mechanics (merge, ramps, pulses,
// timeouts, aborts, cues) and the accuracy the spec asks of the turn and stall demos.

import { describe, expect, it, vi } from 'vitest';

// Module 1's predicate engine and areas may still be wave-0 stubs: fall back to copilotFallbacks.ts only then.
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

import { DEG, FT, KT } from '../../src/core/math';
import { cloneControls, defaultWeather, type ControlInputs, type WeatherSettings } from '../../src/core/types';
import { runwayCoords } from '../../src/core/world';
import { SimPhysics } from '../../src/sim/SimPhysics';
import type { StartSpec } from '../../src/sim/starts';
import { C172S } from '../../src/training/aircraft/c172s';
import { DEMOS } from '../../src/training/content/demos';
import { gt, held, near, v } from '../../src/training/engine/dsl';
import { InstructorPilot, TAKEOVER_BLEND_S, chooseRecovery } from '../../src/training/copilot/instructorPilot';
import type { DemoScript } from '../../src/training/types';
import { Rig, calmWeather, freshEnvelope } from './copilotHarness';

const STEP = 1 / 240;
const cruiseAt = (altFt = 4000, kias = 100, hdgDeg = 100): StartSpec => ({ kind: 'air', at: 'trainingArea', altFt, altRef: 'msl', hdgDeg, kias });
const lightWeather = (): WeatherSettings => ({ ...defaultWeather(), windDirectionDeg: 90, windSpeedKt: 7, turbulence: 0.1 });
const f = (r: Rig, k: string): number => r.frame[k] as number;

describe('holds (partial authority while the student flies)', () => {
  it('keeps the throttle closed against the student pushing it open, and releases on null', () => {
    const r = new Rig(cruiseAt());
    const c = r.p.controls;
    r.pilot.setHolds({ throttle: 0 });
    expect(r.pilot.flying).toBe(false);
    const rpm0 = r.s.engine.rpm;
    for (let i = 0; i < 240 * 5; i++) {
      c.throttle = 1; // the student's throttle input, every step
      r.p.step(STEP);
      expect(c.throttle).toBe(0);
    }
    expect(r.s.engine.rpm).toBeLessThan(rpm0 - 300);
    r.pilot.setHolds(null);
    c.throttle = 0.8;
    r.p.step(1);
    expect(c.throttle).toBe(0.8);
  });

  it('holds the flap lever (degrees) and the mixture', () => {
    const r = new Rig(cruiseAt(4000, 80));
    r.pilot.setHolds({ flapsDeg: 20, mixture: 0 });
    r.p.controls.flaps = 0;
    r.p.controls.mixture = 1;
    r.p.step(2);
    expect(r.p.controls.flaps).toBeCloseTo(2 / 3, 12);
    expect(r.p.controls.mixture).toBe(0);
    expect(r.pilot.currentHolds).toEqual({ flapsDeg: 20, mixture: 0 });
  });
});

describe('taking and handing back control', () => {
  /** Largest per-step change of the primary controls while `run` steps. */
  function maxJump(p: SimPhysics, steps: number, before?: () => void): number {
    const keys = ['elevator', 'aileron', 'rudder', 'throttle'] as const;
    let prev = keys.map((k) => p.controls[k]);
    let worst = 0;
    for (let i = 0; i < steps; i++) {
      before?.();
      p.step(STEP);
      const now = keys.map((k) => p.controls[k]);
      worst = Math.max(worst, ...now.map((x, j) => Math.abs(x - prev[j])));
      prev = now;
    }
    return worst;
  }

  it('is bumpless both ways: no control moves more than 0.05 in a physics step', () => {
    const r = new Rig(cruiseAt(4000, 100), { weather: calmWeather() });
    const c = r.p.controls;
    // The student is flying with a hand on the yoke: a little roll and back pressure off trim.
    c.aileron = 0.08;
    c.elevator += 0.04;
    r.p.step(0.5);
    const roll0 = r.s.roll;
    expect(Math.abs(roll0)).toBeGreaterThan(1 * DEG);
    r.pilot.holdHere();
    expect(r.pilot.flying).toBe(true);
    expect(maxJump(r.p, 240 * 3)).toBeLessThan(0.05);
    // Wings levelled by the copilot.
    r.fly(12);
    expect(Math.abs(r.s.roll)).toBeLessThan(2 * DEG);
    // Handback: the controls stay exactly where the copilot left them.
    const held = cloneControls(c);
    r.pilot.stop();
    expect(r.pilot.flying).toBe(false);
    expect(maxJump(r.p, 240)).toBeLessThan(0.05);
    expect(c.elevator).toBe(held.elevator);
    expect(c.elevatorTrim).toBe(held.elevatorTrim);
    expect(TAKEOVER_BLEND_S).toBeGreaterThan(0);
  });

  it('owns the flight controls while flying: student input is overwritten every step', () => {
    const r = new Rig(cruiseAt(4000, 100), { weather: calmWeather() });
    r.pilot.holdHere();
    r.fly(3);
    const alt0 = r.s.altitudeMSL;
    const c: ControlInputs = r.p.controls;
    for (let i = 0; i < 240 * 5; i++) {
      c.elevator = -1; // full forward stick, every step
      c.aileron = 1;
      c.throttle = 0;
      r.p.step(STEP);
      expect(c.elevator).toBeGreaterThan(-0.5);
      expect(c.aileron).toBeLessThan(0.5);
    }
    expect(Math.abs(r.s.altitudeMSL - alt0) / FT).toBeLessThan(50);
    expect(Math.abs(r.s.roll)).toBeLessThan(3 * DEG);
  });

  it('holdHere: wings level, present altitude and speed; on the ground, idle and brakes', () => {
    const r = new Rig({ kind: 'attitude', at: 'trainingArea', altFt: 4000, kias: 100, pitchDeg: 0, bankDeg: 25, hdgDeg: 100 }, { weather: lightWeather() });
    const alt0 = r.s.altitudeMSL;
    const ias0 = r.s.ias;
    r.pilot.holdHere();
    r.fly(40);
    expect(Math.abs(r.s.roll)).toBeLessThan(3 * DEG);
    expect(Math.abs(r.s.altitudeMSL - alt0) / FT).toBeLessThan(100);
    expect(Math.abs(r.s.ias - ias0) / KT).toBeLessThan(6);
    expect(r.pilot.mode).toBe('holding');

    const g = new Rig({ kind: 'ground', spot: 'lineup07', engine: 'running' });
    g.p.controls.parkingBrake = false;
    g.pilot.holdHere();
    for (let i = 0; i < 240 * 5; i++) {
      g.p.controls.throttle = 1; // the student pushing the throttle open
      g.p.step(STEP);
      expect(g.p.controls.throttle).toBe(0);
    }
    expect(g.s.groundSpeed).toBeLessThan(0.5);
  }, 30_000);   // about 2 s alone; 5 s was not enough in a loaded full-suite run
});

describe('recovery (section 3.8 seeds)', () => {
  /** Out of danger: wings within 10, not descending fast, speed between Vs1 + 10 and Vno. */
  const safe = (r: Rig): boolean =>
    Math.abs(f(r, 'bankDeg')) < 10 && f(r, 'vsFpm') > -500 && f(r, 'kias') > C172S.vspeeds.Vs1 + 10 && f(r, 'kias') < C172S.vspeeds.Vno;

  const seeds: [string, StartSpec, string, ((r: Rig) => void)?][] = [
    ['60 degree nose-low spiral at 120 kt', { kind: 'attitude', at: 'trainingArea', altFt: 4500, kias: 120, pitchDeg: -15, bankDeg: 60, hdgDeg: 100 }, 'noseLow',
      (r) => { r.p.controls.throttle = 0.7; }],
    ['25 degrees nose-up at 55 kt', { kind: 'attitude', at: 'trainingArea', altFt: 4500, kias: 55, pitchDeg: 25, bankDeg: 0, hdgDeg: 100 }, 'slow'],
    // Stalled with the left wing down: idle, yoke hard back with left aileron from a slow left turn.
    ['wing drop at the stall', { kind: 'attitude', at: 'trainingArea', altFt: 4500, kias: 55, pitchDeg: 10, bankDeg: -30, hdgDeg: 100 }, 'slow',
      (r) => {
        const c = r.p.controls;
        c.throttle = 0;
        r.flyUntil(() => r.s.stallFraction > 0.3, 15, () => {
          c.elevator = 1;
          c.aileron = -0.3;
        });
        expect(r.s.stallFraction).toBeGreaterThan(0.3);
        expect(r.s.roll).toBeLessThan(-10 * DEG);
      }],
    ['low and slow on final', { kind: 'final', distNm: 1.2, kias: 55, flapsDeg: 30, heightOffsetFt: -60 }, 'low'],
  ];

  it.each(seeds)('%s: out of danger within 10 s, stable and done within 35 s', (_name, start, kind, prep) => {
    const r = new Rig(start, { weather: lightWeather() });
    prep?.(r);
    r.env = freshEnvelope();
    const alt0Ft = r.s.altitudeMSL / FT;
    r.pilot.recover();
    let safeAt = Infinity;
    let stableAt = Infinity;
    let minG = 9;
    let maxG = -9;
    r.fly(35, (t) => {
      minG = Math.min(minG, f(r, 'gLoad'));
      maxG = Math.max(maxG, f(r, 'gLoad'));
      if (safeAt === Infinity && safe(r)) safeAt = t;
      if (stableAt === Infinity && r.pilot.stable) stableAt = t;
      return r.pilot.demoResult !== null;
    });
    expect(r.pilot.recovery).toBe(kind);
    expect(r.env.crashed).toBe(false);
    expect(safeAt, 'out of danger').toBeLessThan(10);
    expect(stableAt, 'stable').toBeLessThan(35);
    expect(r.pilot.demoResult).toBe('done');
    // Inside the structural and envelope g limits throughout.
    expect(maxG).toBeLessThan(3.3);
    expect(minG).toBeGreaterThan(0);
    // Still flying the hold afterwards, wings level.
    expect(r.pilot.flying).toBe(true);
    r.fly(5);
    expect(Math.abs(r.s.roll)).toBeLessThan(5 * DEG);
    if (kind !== 'low') expect(alt0Ft - r.env.minAltFt, 'height lost').toBeLessThan(400);
  }, 60000);

  it('the sink-rate save on short final: full power at once, no dive, climbing away (wave-3 playtest)', () => {
    // The runner asks for 'low' on a sink breach. The recovery used to leave the throttle closed (its full
    // power lasted only a segment that ended on its first step) and the Vy airspeed mode then dived at idle.
    const r = new Rig({ kind: 'final', distNm: 0.9, kias: 70, flapsDeg: 30, heightOffsetFt: -60 }, { weather: lightWeather() });
    const c = r.p.controls;
    r.flyUntil(() => f(r, 'vsFpm') < -1000, 20, () => {
      c.throttle = 0;
      c.elevator = -0.25;
    });
    expect(f(r, 'vsFpm')).toBeLessThan(-1000);
    expect(f(r, 'aglFt')).toBeLessThan(300);
    r.env = freshEnvelope();
    const pitch0 = f(r, 'pitchDeg');
    r.pilot.recover('low');
    let minPitch = 90;
    r.fly(3, () => {
      minPitch = Math.min(minPitch, f(r, 'pitchDeg'));
      return false;
    });
    expect(c.throttle).toBe(1);
    r.fly(30, () => {
      minPitch = Math.min(minPitch, f(r, 'pitchDeg'));
      return false;
    });
    expect(r.env.crashed).toBe(false);
    expect(r.pilot.recovery).toBe('low');
    expect(f(r, 'vsFpm')).toBeGreaterThan(0);
    expect(f(r, 'aglFt')).toBeGreaterThan(300);
    // The nose comes up from the push; it is never lowered further to chase Vy.
    expect(minPitch).toBeGreaterThan(pitch0 - 3.5);   // the takeover cross-fade and the aircraft's inertia
  }, 60000);

  it('on the ground: idle, brakes and the centreline to a stop', () => {
    const r = new Rig({ kind: 'ground', spot: 'lineup07', engine: 'running' }, { weather: lightWeather() });
    r.p.setAutoflight(true, true); // the student's take-off roll (autoflight standing in for the student)
    r.flyUntil(() => r.s.ias / KT > 40, 30);
    r.p.setAutoflight(false);
    r.pilot.recover();
    r.fly(30, () => r.pilot.demoResult !== null);
    expect(r.pilot.recovery).toBe('ground');
    expect(r.pilot.demoResult).toBe('done');
    expect(r.s.groundSpeed).toBeLessThan(0.5);
    expect(Math.abs(runwayCoords(r.s.position.x, r.s.position.y).across)).toBeLessThan(5);
    expect(r.env.crashed).toBe(false);
  });

  it('chooses the variant from the state', () => {
    const p = new SimPhysics({ weather: calmWeather() });
    p.reset('cruise');
    const s = p.state;
    expect(chooseRecovery(s, C172S)).toBe('hold');
    expect(chooseRecovery({ ...s, pitch: -15 * DEG }, C172S)).toBe('noseLow');
    expect(chooseRecovery({ ...s, ias: 135 * KT }, C172S)).toBe('noseLow');
    expect(chooseRecovery({ ...s, ias: 45 * KT }, C172S)).toBe('slow');
    expect(chooseRecovery({ ...s, stallFraction: 0.3, pitch: -20 * DEG }, C172S)).toBe('slow');
    expect(chooseRecovery({ ...s, pitch: 25 * DEG, ias: 60 * KT }, C172S)).toBe('slow');
    expect(chooseRecovery({ ...s, altitudeAGL: 300 * FT }, C172S)).toBe('low');
    p.reset('runway');
    expect(chooseRecovery(p.state, C172S)).toBe('ground');
  });

  it('without an EvalContext falls back to the plain hold instead of failing', () => {
    const p = new SimPhysics({ weather: calmWeather() });
    p.reset('cruise');
    const pilot = new InstructorPilot(C172S);
    p.copilot = pilot;
    pilot.recover('noseLow');
    p.step(1);
    expect(pilot.flying).toBe(true);
    expect(pilot.warnings.join()).toMatch(/no EvalContext/);
    p.step(20);
    expect(Math.abs(p.state.roll)).toBeLessThan(3 * DEG);
  });
});

describe('script mechanics', () => {
  it('merges ap fields across segments, speaks each cue once at segment start, and ends done', () => {
    const r = new Rig(cruiseAt(4000, 100));
    const script: DemoScript = {
      id: 'test.merge',
      segments: [
        { kind: 'ap', say: 'one', ap: { lateral: 'heading', hdgDeg: v('demo.hdgDeg', 30), vertical: 'altitude', altFt: v('demo.altFt', 200) }, until: near('hdgDeg', v('demo.hdgDeg', 30), 3), timeoutS: 60 },
        // ap: {} keeps the heading and the altitude target.
        { kind: 'ap', say: 'two', ap: {}, until: held(near('altFt', v('demo.altFt', 200), 30), 3), timeoutS: 90 },
      ],
    };
    const hdg0 = f(r, 'hdgDeg');
    const { result } = r.runDemo(script, 150);
    expect(result).toBe('done');
    expect(r.said).toEqual(['one', 'two']);
    expect(Math.abs(f(r, 'hdgDeg') - (hdg0 + 30))).toBeLessThan(3);
    expect(r.pilot.mode).toBe('holding');
    expect(r.pilot.warnings).toEqual([]);
  });

  it('ramps levers and carries an unfinished lever ramp into the next segment', () => {
    const r = new Rig(cruiseAt(4000, 75));
    const script: DemoScript = {
      id: 'test.ramp',
      segments: [
        { kind: 'ap', ap: {}, set: { flapsDeg: { to: 20, overS: 4 }, throttle: 0.4 }, until: held({ const: true }, 1), timeoutS: 5 },
        { kind: 'ap', ap: {}, until: held({ const: true }, 5), timeoutS: 10 },
      ],
    };
    r.pilot.run(script, () => r.ctx);
    r.fly(1.5);
    expect(r.p.controls.flaps).toBeGreaterThan(0.1);
    expect(r.p.controls.flaps).toBeLessThan(0.5);
    r.fly(4);
    expect(r.p.controls.flaps).toBeCloseTo(2 / 3, 9);
  });

  it('pulses a control and puts it back', () => {
    const r = new Rig(cruiseAt(4000, 100), { weather: calmWeather() });
    r.pilot.holdHere();
    r.fly(2);
    const base = r.p.controls.aileron;
    const script: DemoScript = { id: 'test.pulse', segments: [{ kind: 'pulse', control: 'aileron', amount: 0.2, holdS: 1.5 }, { kind: 'pause', s: 1 }] };
    r.pilot.run(script, () => r.ctx);
    r.fly(1);
    expect(r.p.controls.aileron).toBeCloseTo(base + 0.2, 9);
    expect(r.s.roll).toBeGreaterThan(3 * DEG);
    r.fly(1);
    expect(r.p.controls.aileron).toBeCloseTo(base, 9);
  });

  it('ends "timeout" when an until never comes, and keeps flying', () => {
    const r = new Rig(cruiseAt());
    const script: DemoScript = { id: 'test.timeout', segments: [{ kind: 'ap', ap: {}, until: { const: false }, timeoutS: 3 }] };
    const { result, seconds } = r.runDemo(script, 10);
    expect(result).toBe('timeout');
    expect(seconds).toBeGreaterThanOrEqual(3);
    expect(seconds).toBeLessThan(3.2);
    expect(r.pilot.flying).toBe(true);
  });

  it('abortWhen switches to the recovery and reports "aborted"', () => {
    const r = new Rig(cruiseAt(4500, 100));
    const dive: DemoScript = {
      id: 'test.dive',
      segments: [{ kind: 'ap', ap: { vertical: 'pitch', pitchDeg: -12 }, set: { throttle: 1 }, until: { const: false }, timeoutS: 120 }],
      abortWhen: gt('kias', 125),
    };
    const { result } = r.runDemo(dive, 60);
    expect(result).toBe('aborted');
    expect(r.pilot.mode).toBe('recovery');
    expect(r.pilot.recovery).toBe('noseLow');
    r.flyUntil(() => r.pilot.stable, 40);
    expect(r.pilot.stable).toBe(true);
    // A recovery after an abort does not overwrite the demo's outcome.
    expect(r.pilot.demoResult).toBe('aborted');
    expect(r.env.maxKias).toBeLessThan(140);
  });

  it('stop() during a demo reports "aborted" and releases the controls', () => {
    const r = new Rig(cruiseAt());
    r.pilot.run(DEMOS.mediumTurn, () => r.ctx);
    r.fly(5);
    r.pilot.stop();
    expect(r.pilot.flying).toBe(false);
    expect(r.pilot.demoResult).toBe('aborted');
    r.p.controls.elevator = 0.3;
    r.p.step(0.1);
    expect(r.p.controls.elevator).toBe(0.3);
  });

  it('falls back to the present value (with a warning) for a ref it cannot resolve', () => {
    const r = new Rig(cruiseAt(4000, 100));
    const alt0 = r.s.altitudeMSL;
    const script: DemoScript = { id: 'test.badref', segments: [{ kind: 'ap', ap: { vertical: 'altitude', altFt: v('noSuchVar') }, until: held({ const: true }, 5), timeoutS: 10 }] };
    expect(r.runDemo(script, 10).result).toBe('done');
    expect(r.pilot.warnings.join()).toMatch(/noSuchVar/);
    expect(Math.abs(r.s.altitudeMSL - alt0) / FT).toBeLessThan(40);
  });

  it('evaluates held() once per context tick (60 Hz) with the context dt, not per physics step', () => {
    const r = new Rig(cruiseAt());
    const script: DemoScript = { id: 'test.held', segments: [{ kind: 'ap', ap: {}, until: held({ const: true }, 4), timeoutS: 30 }] };
    const { seconds } = r.runDemo(script, 30);
    expect(seconds).toBeGreaterThan(3.9);
    expect(seconds).toBeLessThan(4.2);
  });
});

describe('demo accuracy (section 6.3)', () => {
  it('30 and 45 degree turns hold altitude within 50 ft', () => {
    const medium = new Rig(cruiseAt(3500, 100), { weather: lightWeather() });
    const alt0 = f(medium, 'altFt');
    expect(medium.runDemo(DEMOS.mediumTurn, 200).result).toBe('done');
    expect(medium.env.maxAbsBank).toBeGreaterThan(28);
    expect(Math.max(medium.env.maxAltFt - alt0, alt0 - medium.env.minAltFt)).toBeLessThan(50);

    const steep = new Rig(cruiseAt(4000, 95), { weather: { ...defaultWeather(), windSpeedKt: 5, turbulence: 0.05 } });
    const alt1 = f(steep, 'altFt');
    expect(steep.runDemo(DEMOS.steepTurn, 200).result).toBe('done');
    expect(steep.env.maxAbsBank).toBeGreaterThan(43);
    expect(Math.max(steep.env.maxAltFt - alt1, alt1 - steep.env.minAltFt)).toBeLessThan(50);
  }, 60000);

  it('the stall demo recovers with less than 200 ft lost from the break, at the forward payload', () => {
    const r = new Rig(cruiseAt(4500, 90), { startOptions: { payload: 'forward' } });
    r.pilot.run(DEMOS.powerOffStall, () => r.ctx);
    let breakAlt = NaN;
    let minAfter = Infinity;
    r.fly(200, () => {
      if (Number.isNaN(breakAlt) && r.pilot.segmentIndex >= 1) breakAlt = f(r, 'altFt');
      if (!Number.isNaN(breakAlt)) minAfter = Math.min(minAfter, f(r, 'altFt'));
      return r.pilot.demoResult !== null;
    });
    expect(r.pilot.demoResult).toBe('done');
    expect(r.env.maxStallFrac).toBeGreaterThan(0.1); // it did stall
    expect(breakAlt - minAfter).toBeLessThan(200);
    expect(r.env.maxAbsBank).toBeLessThan(20);
  }, 60000);
});
