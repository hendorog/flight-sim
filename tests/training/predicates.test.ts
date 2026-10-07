// Predicate language (section 2.4): hysteresis edges, held timers and grace, angle wrap, event scans, no
// short-circuit in all/any, plus value resolution (refs.ts) and the training bus it scans.

import { describe, expect, it } from 'vitest';
import {
  all, any, authority, elapsed, eq, ev, ever, exerciseGrade, fieldElev, ge, gt, held, le, leg, lt, near, never, not, setting, sig, speechIdle,
  std, turned, v, vs, always,
} from '../../src/training/engine/dsl';
import { TrainingBus } from '../../src/training/engine/bus';
import { compile, HELD_DEFAULT_GRACE_S } from '../../src/training/engine/predicates';
import { resolveRef, resolveSig, resolveTol } from '../../src/training/engine/refs';
import { STANDARDS } from '../../src/training/grading/standards';
import { Telemetry } from '../../src/training/telemetry/telemetry';
import type { AircraftTypeDef, EvalContext, Grade, Pred, SignalFrame } from '../../src/training/types';

const AIRCRAFT = {
  id: 'test',
  vspeeds: { Vy: 74, Vs1: 48, Vref: 65 },
  settings: { cruiseRpm: 2300, patternAglFt: 1000 },
} as unknown as AircraftTypeDef;

const defs = new Telemetry();

type MutableCtx = { -readonly [K in keyof EvalContext]: EvalContext[K] } & { frame: SignalFrame; vars: Record<string, number> };

function makeCtx(frame: SignalFrame = {}, over: Partial<MutableCtx> = {}): MutableCtx {
  const bus = new TrainingBus();
  const grades: Record<string, Grade> = {};
  return {
    frame,
    signalDef: (id) => defs.def(id),
    vars: {},
    aircraft: AIRCRAFT,
    fieldElevFt: 394,
    standards: STANDARDS,
    authority: 'easa',
    standard: 'training',
    events: bus,
    stepMark: 0,
    stepT: 0,
    dt: 0.1,
    simT: 0,
    pilot: 'student',
    speechIdle: true,
    exerciseGrade: (id) => grades[id] ?? null,
    ...over,
  };
}

/** Evaluate `p` over a series of values of one signal (one tick each), returning the outputs. */
function series(p: Pred, id: string, xs: (number | boolean | string)[], ctx = makeCtx()): boolean[] {
  const c = compile(p);
  return xs.map((x) => {
    ctx.frame[id] = x;
    return c.eval(ctx);
  });
}

describe('refs', () => {
  const ctx = makeCtx({ altFt: 3512, onGround: true }, { vars: { alt0: 3000 } });

  it('resolves every Ref kind, with offsets', () => {
    expect(resolveRef(42, ctx)).toBe(42);
    expect(resolveRef(v('alt0'), ctx)).toBe(3000);
    expect(resolveRef(v('alt0', 1000), ctx)).toBe(4000);
    expect(resolveRef(vs('Vy'), ctx)).toBe(74);
    expect(resolveRef(vs('Vs1', 5), ctx)).toBe(53);
    expect(resolveRef(setting('cruiseRpm'), ctx)).toBe(2300);
    expect(resolveRef(fieldElev(1000), ctx)).toBe(1394);
    expect(resolveRef(sig('altFt', -12), ctx)).toBe(3500);
  });

  it('gives NaN for unknown names and non-numeric signals', () => {
    expect(resolveRef(v('nope'), ctx)).toBeNaN();
    expect(resolveRef(vs('Vne'), ctx)).toBeNaN();
    expect(resolveRef(sig('t.missing'), ctx)).toBeNaN();
    expect(resolveRef(sig('onGround'), ctx)).toBeNaN();
  });

  it('resolves tolerances by key, scaled key, number and band, for the context standard or an explicit one', () => {
    expect(resolveTol('altitude', ctx)).toEqual({ minus: 200, plus: 200 }); // training
    expect(resolveTol('altitude', ctx, 'test')).toEqual({ minus: 150, plus: 150 }); // EASA test
    expect(resolveTol('altitude', { ...ctx, authority: 'faa' }, 'test')).toEqual({ minus: 100, plus: 100 });
    expect(resolveTol(std('speedClimbApproach'), ctx, 'test')).toEqual({ minus: 5, plus: 15 });
    expect(resolveTol(std('altitude', 0.5), ctx)).toEqual({ minus: 100, plus: 100 });
    expect(resolveTol(60, ctx)).toEqual({ minus: 60, plus: 60 });
    expect(resolveTol(-60, ctx)).toEqual({ minus: 60, plus: 60 });
    expect(resolveTol({ minus: 0, plus: 400 }, ctx)).toEqual({ minus: 0, plus: 400 });
    const bad = resolveTol('nope' as never, ctx);
    expect(bad.minus).toBeNaN();
  });

  it('resolves a var SigRef to its pseudo-signal, which predicates read from the run variables', () => {
    expect(resolveSig('altFt', ctx)).toBe('altFt');
    expect(resolveSig({ var: 'alt0' }, ctx)).toBe('vars.alt0');
    const c = compile(gt({ var: 'alt0' }, 2999));
    expect(c.eval(ctx)).toBe(true);
    ctx.vars.alt0 = 2000;
    expect(c.eval(ctx)).toBe(false);
    ctx.vars.alt0 = 3000;
  });
});

describe('comparisons and hysteresis', () => {
  it('gt turns on above the value and off only below value - hyst (asiKt hyst 1 kt)', () => {
    expect(defs.def('asiKt')?.hyst).toBe(1);
    expect(series(gt('asiKt', 70), 'asiKt', [70, 70.01, 69.5, 69, 68.99, 69.5, 70, 70.2])).toEqual([false, true, true, true, false, false, false, true]);
  });

  it('ge turns on at the value itself', () => {
    expect(series(ge('asiKt', 70), 'asiKt', [69.99, 70, 69.01, 68.9])).toEqual([false, true, true, false]);
  });

  it('lt and le mirror it: off only above value + hyst', () => {
    expect(series(lt('altFt', 1000), 'altFt', [1000, 999, 1015, 1020, 1020.5, 1005, 999.9])).toEqual([false, true, true, true, false, false, true]);
    expect(series(le('altFt', 1000), 'altFt', [1000.1, 1000, 1019, 1021])).toEqual([false, true, true, false]);
  });

  it('an explicit hyst overrides the signal default; unknown signals have none', () => {
    expect(series(gt('asiKt', 70, 5), 'asiKt', [71, 66, 64.9])).toEqual([true, true, false]);
    expect(series(gt('x.custom', 0), 'x.custom', [1, 0, -0.001])).toEqual([true, true, false]);
  });

  it('compares angle signals on the circle', () => {
    expect(defs.def('hdgDeg')?.kind).toBe('angle');
    // 5 is 15 degrees right of 350.
    expect(series(gt('hdgDeg', 350), 'hdgDeg', [5, 345, 200, 160])).toEqual([true, false, false, true]); // 160 is 170 right
    expect(series(lt('hdgDeg', 10), 'hdgDeg', [355, 9, 11.9, 12.1])).toEqual([true, true, true, false]);
    // A plain number signal does not wrap.
    expect(series(gt('altFt', 350), 'altFt', [5])).toEqual([false]);
  });

  it('a missing, NaN or non-numeric value is false and drops the latch', () => {
    const ctx = makeCtx();
    const c = compile(gt('asiKt', 70));
    expect(c.eval(ctx)).toBe(false);
    ctx.frame.asiKt = 80;
    expect(c.eval(ctx)).toBe(true);
    ctx.frame.asiKt = NaN;
    expect(c.eval(ctx)).toBe(false);
    ctx.frame.asiKt = 69.5; // inside the hysteresis band, but the latch was dropped
    expect(c.eval(ctx)).toBe(false);
    ctx.frame.asiKt = 'fast';
    expect(c.eval(ctx)).toBe(false);
    expect(compile(gt('asiKt', v('t.missing'))).eval(makeCtx({ asiKt: 80 }))).toBe(false);
  });

  it('booleans compare as 0/1', () => {
    expect(series(gt('stallWarn', 0.5), 'stallWarn', [false, true, false])).toEqual([false, true, false]);
  });

  it('eq is exact for numbers, strings and booleans', () => {
    expect(series(eq('fuelSel', 'both'), 'fuelSel', ['left', 'both', 'BOTH'])).toEqual([false, true, false]);
    expect(series(eq('mags', 3), 'mags', [2, 3])).toEqual([false, true]);
    expect(series(eq('onGround', true), 'onGround', [true, 1, false])).toEqual([true, false, false]);
  });
});

describe('near (bands)', () => {
  it('is true inside the band and false only once it leaves by more than hyst (altFt hyst 20 ft)', () => {
    const xs = [1100, 1110, 1120, 1121, 1110, 1100, 880, 879.9];
    expect(series(near('altFt', 1000, 100), 'altFt', xs)).toEqual([true, true, true, false, false, true, true, false]);
  });

  it('uses the tolerance of the context standard, asymmetric bands as given', () => {
    const ctx = makeCtx({ asiKt: 70 });
    const c = compile(near('asiKt', vs('Vy'), 'speedClimbApproach')); // training: -5 / +15
    expect(c.eval(ctx)).toBe(true); // 4 below
    ctx.frame.asiKt = 67.9;
    c.reset();
    expect(c.eval(ctx)).toBe(false); // 6.1 below
    ctx.frame.asiKt = 88;
    expect(c.eval(ctx)).toBe(true); // 14 above
    ctx.standard = 'commercial'; // -0 / +5
    c.reset();
    expect(c.eval(ctx)).toBe(false);
  });

  it('wraps angle errors through north', () => {
    expect(series(near('hdgDeg', 355, 10), 'hdgDeg', [3, 5, 6, 345, 344])).toEqual([true, true, true, true, true]);
    expect(series(near('hdgDeg', 355, 10, 0), 'hdgDeg', [5.1, 344.9, 170])).toEqual([false, false, false]);
  });

  it('is false for an unknown tolerance key or a missing target', () => {
    expect(compile(near('altFt', 1000, 'nope' as never)).eval(makeCtx({ altFt: 1000 }))).toBe(false);
    expect(compile(near('altFt', v('none'), 100)).eval(makeCtx({ altFt: 1000 }))).toBe(false);
  });
});

describe('held', () => {
  const run = (p: Pred, pattern: boolean[], dt = 0.1, ctx = makeCtx({ 't.flag': false }, { dt })): boolean[] => {
    const c = compile(p);
    return pattern.map((f) => {
      ctx.frame['t.flag'] = f;
      return c.eval(ctx);
    });
  };
  const T = true;
  const F = false;

  it('is true after s continuous sim seconds', () => {
    const out = run(held(eq('t.flag', true), 1), Array(12).fill(T));
    // Timed from the first tick seen true: 1.0 s after it is the 11th tick.
    expect(out.indexOf(true)).toBe(10);
  });

  it('pauses (does not zero) its timer through a drop-out of at most graceS', () => {
    expect(HELD_DEFAULT_GRACE_S).toBe(0.25);
    // 0.4 s timed, 0.2 s false (paused), then 0.6 s more: 1.0 s on the last tick.
    const out = run(held(eq('t.flag', true), 1), [T, T, T, T, T, F, F, T, T, T, T, T, T, T]);
    expect(out.slice(0, 13).some(Boolean)).toBe(false);
    expect(out[13]).toBe(true);
  });

  it('zeroes its timer after a longer drop-out', () => {
    const out = run(held(eq('t.flag', true), 1), [T, T, T, T, T, T, T, T, F, F, F, T, T, T, T]);
    expect(out.some(Boolean)).toBe(false);
  });

  it('stays true through a short drop-out once reached, and drops after a long one', () => {
    const out = run(held(eq('t.flag', true), 0.3), [T, T, T, T, F, F, T, F, F, F]);
    expect(out).toEqual([F, F, F, T, T, T, T, T, T, F]);
  });

  it('honours an explicit grace', () => {
    expect(run(held(eq('t.flag', true), 0.3, 0), [T, T, T, T, F, T]).slice(3)).toEqual([T, F, F]);
    // A 0.5 s drop-out inside a 1 s grace: 0.3 s before it, then 0.2 s more.
    const long = run(held(eq('t.flag', true), 0.5, 1), [T, T, T, T, F, F, F, F, F, T, T, T]);
    expect(long.slice(-3)).toEqual([F, F, T]);
  });

  it('counts sim time only: paused ticks (dt 0) change nothing', () => {
    const ctx = makeCtx({ 't.flag': true }, { dt: 0 });
    const c = compile(held(eq('t.flag', true), 1));
    for (let i = 0; i < 100; i++) expect(c.eval(ctx)).toBe(false);
    ctx.dt = 0.5;
    c.eval(ctx);
    expect(c.eval(ctx)).toBe(true);
    // A pause with the condition false does not count as a drop-out either.
    ctx.frame['t.flag'] = false;
    ctx.dt = 0;
    for (let i = 0; i < 100; i++) expect(c.eval(ctx)).toBe(true);
  });

  it('held(p, 0) is p with the drop-out grace; held(p, 0, 0) is exactly p', () => {
    expect(run(held(eq('t.flag', true), 0), [F, T, F, F, F, F], 0.1)).toEqual([F, T, T, T, F, F]);
    expect(run(held(eq('t.flag', true), 0, 0), [F, T, F, T], 0.1)).toEqual([F, T, F, T]);
  });

  it('reset() clears the timer', () => {
    const ctx = makeCtx({ 't.flag': true }, { dt: 0.6 });
    const c = compile(held(eq('t.flag', true), 1));
    c.eval(ctx);
    c.eval(ctx);
    c.reset();
    expect(c.eval(ctx)).toBe(false);
    expect(c.eval(ctx)).toBe(false);
    expect(c.eval(ctx)).toBe(true);
  });
});

describe('ever, not, all, any', () => {
  it('ever latches until reset', () => {
    const ctx = makeCtx({ 't.x': 0 });
    const c = compile(ever(gt('t.x', 5)));
    expect(c.eval(ctx)).toBe(false);
    ctx.frame['t.x'] = 6;
    expect(c.eval(ctx)).toBe(true);
    ctx.frame['t.x'] = 0;
    expect(c.eval(ctx)).toBe(true);
    expect(c.value).toBe(true);
    c.reset();
    expect(c.value).toBe(false);
    expect(c.eval(ctx)).toBe(false);
  });

  it('all / any / not combine', () => {
    const ctx = makeCtx({ 't.a': 1, 't.b': 0 });
    expect(compile(all(gt('t.a', 0), gt('t.b', 0))).eval(ctx)).toBe(false);
    expect(compile(any(gt('t.a', 0), gt('t.b', 0))).eval(ctx)).toBe(true);
    expect(compile(not(gt('t.b', 0))).eval(ctx)).toBe(true);
    expect(compile(all()).eval(ctx)).toBe(true);
    expect(compile(any()).eval(ctx)).toBe(false);
  });

  it('any does not short-circuit: a nested held timer keeps counting while a sibling decides', () => {
    const ctx = makeCtx({ 't.flag': true, 't.x': 1 }, { dt: 0.1 });
    const c = compile(any(eq('t.flag', true), held(gt('t.x', 0), 1)));
    for (let i = 0; i < 10; i++) expect(c.eval(ctx)).toBe(true);
    ctx.frame['t.flag'] = false;
    // The held branch has been accumulating all along: already 1.1 s.
    expect(c.eval(ctx)).toBe(true);
  });

  it('all does not short-circuit either', () => {
    const ctx = makeCtx({ 't.gate': false, 't.x': 1 }, { dt: 0.1 });
    const c = compile(all(eq('t.gate', true), held(gt('t.x', 0), 1)));
    for (let i = 0; i < 10; i++) expect(c.eval(ctx)).toBe(false);
    ctx.frame['t.gate'] = true;
    expect(c.eval(ctx)).toBe(true);
  });
});

describe('event predicates and the training bus', () => {
  it('count events since the step mark, filtering where fields (ranges inclusive, strings and booleans exact)', () => {
    const ctx = makeCtx();
    const bus = ctx.events as TrainingBus;
    bus.emit('touchdown', { wheel: 'nose', sinkFpm: 100 }, 1); // before the mark
    ctx.stepMark = bus.mark();
    const nose = compile(ev('touchdown', { wheel: 'nose' }));
    const hard = compile(ev('touchdown', { sinkFpm: [300, 600] }));
    const twoMains = compile(ev('touchdown', { wheel: 'left' }, 2));
    const any1 = compile(ev('touchdown'));
    const check = (): boolean[] => [nose.eval(ctx), hard.eval(ctx), twoMains.eval(ctx), any1.eval(ctx)];
    expect(check()).toEqual([false, false, false, false]);
    bus.emit('touchdown', { wheel: 'left', sinkFpm: 600 }, 2);
    expect(check()).toEqual([false, true, false, true]);
    bus.emit('touchdown', { wheel: 'left', sinkFpm: 600.5 }, 3);
    bus.emit('liftoff', { kias: 55, rwyAlongM: 400 }, 3);
    expect(check()).toEqual([false, true, true, true]);
    bus.emit('touchdown', { wheel: 'nose', sinkFpm: 0 }, 4);
    expect(check()).toEqual([true, true, true, true]);
  });

  it('matches booleans and treats a missing field as no match', () => {
    const ctx = makeCtx();
    const bus = ctx.events as TrainingBus;
    const ok = compile(ev('checklist.item', { ok: true }));
    const missing = compile(ev('checklist.item', { nope: 't.x' }));
    bus.emit('checklist.item', { checklist: 'runup', item: 'mags', ok: false }, 0);
    expect(ok.eval(ctx)).toBe(false);
    bus.emit('checklist.item', { checklist: 'runup', item: 'mags', ok: true }, 0);
    expect(ok.eval(ctx)).toBe(true);
    expect(missing.eval(ctx)).toBe(false);
  });

  it('restarts the count when the step mark moves (and on reset)', () => {
    const ctx = makeCtx();
    const bus = ctx.events as TrainingBus;
    const c = compile(ev('liftoff'));
    bus.emit('liftoff', { kias: 55, rwyAlongM: 400 }, 0);
    expect(c.eval(ctx)).toBe(true);
    ctx.stepMark = bus.mark();
    expect(c.eval(ctx)).toBe(false);
    bus.emit('liftoff', { kias: 56, rwyAlongM: 410 }, 1);
    expect(c.eval(ctx)).toBe(true);
    c.reset();
    expect(c.eval(ctx)).toBe(true);
  });

  it('bus: seq increases across trim and clear; since() returns records from a mark; handlers run synchronously', () => {
    const bus = new TrainingBus();
    const seen: string[] = [];
    const off = bus.on('*', (r) => seen.push(`${r.seq}:${r.type}`));
    const offLift = bus.on('liftoff', (r) => seen.push(`lift@${r.simT}`));
    expect(bus.mark()).toBe(0);
    bus.emit('stopped', {}, 1);
    const m = bus.mark();
    bus.emit('liftoff', { kias: 55, rwyAlongM: 400 }, 2);
    bus.emit('stallWarnOff', {}, 3);
    expect(bus.since(m).map((r) => r.type)).toEqual(['liftoff', 'stallWarnOff']);
    expect(bus.since(0)).toHaveLength(3);
    bus.trim(m);
    expect(bus.size).toBe(2);
    expect(bus.since(0).map((r) => r.seq)).toEqual([1, 2]);
    bus.clear();
    expect(bus.since(0)).toEqual([]);
    expect(bus.mark()).toBe(3);
    expect(bus.emit('stopped', {}, 4).seq).toBe(3);
    off();
    offLift();
    bus.emit('liftoff', { kias: 55, rwyAlongM: 400 }, 5);
    expect(seen).toEqual(['0:stopped', 'lift@2', '1:liftoff', '2:stallWarnOff', '3:stopped']);
  });

  it('bus: a handler may unsubscribe or emit during dispatch', () => {
    const bus = new TrainingBus();
    const order: string[] = [];
    const off = bus.on('liftoff', () => {
      order.push('first');
      off();
      bus.emit('stopped', {}, 0);
    });
    bus.on('liftoff', () => order.push('second'));
    bus.on('stopped', () => order.push('stopped'));
    bus.emit('liftoff', { kias: 1, rwyAlongM: 1 }, 0);
    bus.emit('liftoff', { kias: 1, rwyAlongM: 1 }, 0);
    expect(order).toEqual(['first', 'stopped', 'second', 'second']);
  });
});

describe('context predicates', () => {
  it('elapsed, turned, authority, speechIdle, leg, exerciseGrade, const', () => {
    const grades: Record<string, Grade> = { climb: 2 };
    const ctx = makeCtx({ 'step.turnDeg': -200, circuitLeg: 'downwind' }, { stepT: 30, exerciseGrade: (id) => grades[id] ?? null });
    const t = (p: Pred): boolean => compile(p).eval(ctx);
    expect([t(elapsed(30)), t(elapsed(30.1))]).toEqual([true, false]);
    expect([t(turned(180)), t(turned(270))]).toEqual([true, false]);
    expect([t(authority('student')), t(authority('instructor'))]).toEqual([true, false]);
    expect(t(speechIdle())).toBe(true);
    expect([t(leg('downwind')), t(leg('base', 'final')), t(leg('base', 'downwind'))]).toEqual([true, false, true]);
    expect([t(exerciseGrade('climb', 2)), t(exerciseGrade('climb', 3)), t(exerciseGrade('other', 1))]).toEqual([true, false, false]);
    expect([t(always()), t(never())]).toEqual([true, false]);
    ctx.speechIdle = false;
    ctx.pilot = 'instructor';
    expect([t(speechIdle()), t(authority('instructor'))]).toEqual([false, true]);
  });

  it('rejects malformed predicates at compile time', () => {
    expect(() => compile({ bogus: 1 } as unknown as Pred)).toThrow(/unknown predicate/);
    expect(() => compile(all(gt('t.a', 1), { nope: true } as unknown as Pred))).toThrow();
    expect(() => compile(null as unknown as Pred)).toThrow();
  });
});

describe('a lesson-shaped goal', () => {
  it('section 2.12 climb goal: held(near(altFt, tgt, 60), 10) with a level-off overshoot', () => {
    const ctx = makeCtx({ altFt: 3000 }, { vars: { tgt: 4000 }, dt: 0.5 });
    const goal = compile(held(near('altFt', v('tgt'), 60), 10));
    const trace: [number, number][] = [];
    let alt = 3000;
    for (let t = 0; t < 200; t += 0.5) {
      // Climb at 500 fpm, overshoot to 4070 then settle at 4010.
      alt = t < 120 ? 3000 + (500 / 60) * t : t < 130 ? 4000 + 7 * (t - 120) : 4010;
      ctx.frame.altFt = alt;
      if (goal.eval(ctx)) trace.push([t, alt]);
    }
    // First inside 4000 - 60 at t = 113 (3941.7 ft); the overshoot to 4070 stays within the band plus the
    // altimeter's 20 ft hysteresis, so the goal holds 10 s later and stays true.
    expect(trace[0][0]).toBeCloseTo(123, 5);
    expect(trace.length).toBe(200 / 0.5 - 123 / 0.5);
  });
});
