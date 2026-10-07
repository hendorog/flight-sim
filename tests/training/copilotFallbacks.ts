// Fallbacks for module 1's predicate engine and areas, used by module 4's tests only while module 1's
// implementations are still the wave-0 stubs (each test file's vi.mock checks with isStub and keeps the real
// module when it works). Kept free of src imports other than types and math so a vi.mock factory can load it
// without re-entering the mocked modules.

import { DEG } from '../../src/core/math';
import type { CompiledPred, EvalContext, Pred, Ref, SignalId, Tol, TolRef } from '../../src/training/types';

// A faithful subset of section 2.4's semantics: hysteresis on comparisons and bands, held with grace,
// ever latches, all/any without short-circuit, angle wrap. Events, legs and turned evaluate false.

const wrap180 = (d: number): number => ((((d + 180) % 360) + 360) % 360) - 180;

export function miniResolveRef(r: Ref, ctx: EvalContext): number {
  if (typeof r === 'number') return r;
  const add = r.add ?? 0;
  if ('var' in r) return (ctx.vars[r.var] ?? NaN) + add;
  if ('vspeed' in r) return ctx.aircraft.vspeeds[r.vspeed] + add;
  if ('setting' in r) return ctx.aircraft.settings[r.setting] + add;
  if ('field' in r) return ctx.fieldElevFt + add;
  const v = ctx.frame[r.sig as string];
  return (typeof v === 'number' ? v : NaN) + add;
}

function miniTol(t: TolRef, ctx: EvalContext): Tol {
  if (typeof t === 'number') return { minus: t, plus: t };
  if (typeof t === 'string') return ctx.standards[ctx.authority][ctx.standard][t];
  if ('key' in t) {
    const b = ctx.standards[ctx.authority][ctx.standard][t.key];
    return { minus: b.minus * t.scale, plus: b.plus * t.scale };
  }
  return t;
}

export function miniCompile(pred: Pred): CompiledPred {
  const kids: CompiledPred[] = [];
  let value = false;
  let timer = 0;
  let grace = 0;
  const num = (ctx: EvalContext, id: string): number => {
    const v = ctx.frame[id];
    return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : NaN;
  };
  const diff = (ctx: EvalContext, id: string, target: number): number => {
    const x = num(ctx, id);
    return ctx.signalDef(id as SignalId)?.kind === 'angle' ? wrap180(x - target) : x - target;
  };
  let evalFn: (ctx: EvalContext) => boolean;
  if ('op' in pred) {
    evalFn = (ctx) => {
      const id = pred.sig as string;
      const x = num(ctx, id);
      const t = miniResolveRef(pred.v, ctx);
      if (!Number.isFinite(x) || !Number.isFinite(t)) return false;
      const e = diff(ctx, id, t);
      const hy = pred.hyst ?? ctx.signalDef(id as SignalId)?.hyst ?? 0;
      const up = pred.op === '>' || pred.op === '>=';
      const strict = pred.op === '>' || pred.op === '<';
      const on = up ? (strict ? e > 0 : e >= 0) : strict ? e < 0 : e <= 0;
      if (on) return true;
      return value && (up ? e >= -hy : e <= hy);
    };
  } else if ('eq' in pred) {
    evalFn = (ctx) => ctx.frame[pred.sig as string] === pred.eq;
  } else if ('near' in pred) {
    evalFn = (ctx) => {
      const id = pred.sig as string;
      const t = miniResolveRef(pred.near, ctx);
      const e = diff(ctx, id, t);
      if (!Number.isFinite(e)) return false;
      const tol = miniTol(pred.tol, ctx);
      const hy = value ? (pred.hyst ?? ctx.signalDef(id as SignalId)?.hyst ?? 0) : 0;
      return e >= -tol.minus - hy && e <= tol.plus + hy;
    };
  } else if ('all' in pred || 'any' in pred) {
    const list = 'all' in pred ? pred.all : pred.any;
    for (const p of list) kids.push(miniCompile(p));
    const isAll = 'all' in pred;
    evalFn = (ctx) => {
      const vals = kids.map((k) => k.eval(ctx));
      return isAll ? vals.every(Boolean) : vals.some(Boolean);
    };
  } else if ('not' in pred) {
    kids.push(miniCompile(pred.not));
    evalFn = (ctx) => !kids[0].eval(ctx);
  } else if ('held' in pred) {
    kids.push(miniCompile(pred.held));
    const g = pred.graceS ?? 0.25;
    evalFn = (ctx) => {
      if (kids[0].eval(ctx)) {
        timer += ctx.dt;
        grace = 0;
      } else if ((grace += ctx.dt) > g) timer = 0;
      return timer >= pred.s;
    };
  } else if ('ever' in pred) {
    kids.push(miniCompile(pred.ever));
    evalFn = (ctx) => kids[0].eval(ctx) || value;
  } else if ('const' in pred) {
    evalFn = () => pred.const;
  } else if ('elapsed' in pred) {
    evalFn = (ctx) => ctx.stepT >= pred.elapsed;
  } else if ('authority' in pred) {
    evalFn = (ctx) => ctx.pilot === pred.authority;
  } else if ('speechIdle' in pred) {
    evalFn = (ctx) => ctx.speechIdle;
  } else {
    // event, turned, leg, exerciseGrade: not used by the copilot's scripts; unknown -> false.
    evalFn = () => false;
  }
  return {
    eval(ctx) {
      value = evalFn(ctx);
      return value;
    },
    reset() {
      value = false;
      timer = grace = 0;
      for (const k of kids) k.reset();
    },
    get value() {
      return value;
    },
  };
}

/** True when calling `f` throws the wave-0 "not implemented" stub error. */
export function isStub(f: () => unknown): boolean {
  try {
    f();
    return false;
  } catch (e) {
    return String(e).includes('not implemented');
  }
}

/** Fallback areas (spec 2.8) used only while module 1's AREAS is still the wave-0 placeholder. */
export const FALLBACK_AREAS = {
  trainingArea: { id: 'trainingArea', name: 'Training area', north: 4000, east: -8000, radiusNm: 3 },
  fieldOverhead: { id: 'fieldOverhead', name: 'Overhead the field', north: 0, east: 0, radiusNm: 1 },
  // Deadside (right of 07) abeam the upwind end: along +900 m, across +900 m from the runway centre.
  pflHighKey: { id: 'pflHighKey', name: 'High key', north: 900 * Math.cos(70 * DEG) - 900 * Math.sin(70 * DEG), east: 900 * Math.sin(70 * DEG) + 900 * Math.cos(70 * DEG), radiusNm: 1 },
} as const;

