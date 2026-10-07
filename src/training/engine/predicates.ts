// The predicate compiler (semantics in section 2.4 and the Pred doc comment in types.ts): hysteresis on
// comparisons and bands, held timers with grace, ever latches, event scans, no short-circuit in all/any.
//
// A Pred is plain JSON; compile() turns it once per step into a tree of small stateful nodes. Every node is
// evaluated exactly once per tick (all/any never short-circuit), so a `held` timer nested under an `any`
// keeps counting even while a sibling already decides the result. reset() clears every timer and latch
// (step entry, checkpoint restore).
//
// Values are read through refs.ts: a missing, non-numeric or NaN signal (or target) makes a comparison
// false and drops its hysteresis latch, so a signal that disappears can never leave a predicate stuck true.

import { wrap180 } from '../geo/angles';
import type { CompiledPred, EvalContext, Pred, Ref, SignalId, SignalValue, TolRef, TrainingEventName } from '../types';
import { readSignalId, resolveRef, resolveTol, sigId } from './refs';

/** Default drop-out a `held` timer tolerates without zeroing (section 3.3), s. */
export const HELD_DEFAULT_GRACE_S = 0.25;

interface Node {
  eval(ctx: EvalContext): boolean;
  reset(): void;
}

type Where = Record<string, [number, number] | string | boolean>;

/** Compile a predicate once per step; the closure keeps its own timers and latches. */
export function compile(pred: Pred): CompiledPred {
  const root = build(pred);
  let value = false;
  return {
    eval(ctx: EvalContext): boolean {
      value = root.eval(ctx);
      return value;
    },
    reset(): void {
      root.reset();
      value = false;
    },
    get value(): boolean {
      return value;
    },
  };
}

function build(p: Pred): Node {
  if (p === null || typeof p !== 'object') throw new Error(`compile: not a predicate: ${JSON.stringify(p)}`);
  if ('op' in p) return compareNode(sigId(p.sig), p.op, p.v, p.hyst);
  if ('eq' in p) return eqNode(sigId(p.sig), p.eq);
  if ('near' in p) return nearNode(sigId(p.sig), p.near, p.tol, p.hyst);
  if ('all' in p) return combineNode(p.all.map(build), true);
  if ('any' in p) return combineNode(p.any.map(build), false);
  if ('not' in p) return notNode(build(p.not));
  if ('held' in p) return heldNode(build(p.held), p.s, p.graceS ?? HELD_DEFAULT_GRACE_S);
  if ('ever' in p) return everNode(build(p.ever));
  if ('event' in p) return eventNode(p.event, p.where, p.count ?? 1);
  if ('elapsed' in p) return stateless((ctx) => ctx.stepT >= p.elapsed - 1e-9); // (summed frame times)
  if ('turned' in p) return stateless((ctx) => Math.abs(numeric(ctx.frame['step.turnDeg'])) >= p.turned);
  if ('authority' in p) return stateless((ctx) => ctx.pilot === p.authority);
  if ('speechIdle' in p) return stateless((ctx) => ctx.speechIdle);
  if ('leg' in p) {
    const legs: readonly string[] = Array.isArray(p.leg) ? p.leg : [p.leg];
    return stateless((ctx) => {
      const leg = ctx.frame.circuitLeg;
      return typeof leg === 'string' && legs.includes(leg);
    });
  }
  if ('exerciseGrade' in p) {
    return stateless((ctx) => {
      const g = ctx.exerciseGrade(p.exerciseGrade);
      return g !== null && g >= p.atLeast;
    });
  }
  if ('const' in p) return stateless(() => p.const);
  throw new Error(`compile: unknown predicate ${JSON.stringify(p)}`);
}

/** Numbers as they are; booleans as 0/1 (so `gt('stallWarn', 0)` works); anything else NaN. */
function numeric(x: SignalValue | undefined): number {
  return typeof x === 'number' ? x : typeof x === 'boolean' ? (x ? 1 : 0) : NaN;
}

function stateless(f: (ctx: EvalContext) => boolean): Node {
  return { eval: f, reset() {} };
}

/** Signed error x - target, wrapped to (-180, 180] for angle signals. NaN when either is not a number. */
function error(id: SignalId, x: number, target: number, ctx: EvalContext): number {
  const e = x - target;
  return ctx.signalDef(id)?.kind === 'angle' ? wrap180(e) : e;
}

function hysteresis(id: SignalId, own: number | undefined, ctx: EvalContext): number {
  return own ?? ctx.signalDef(id)?.hyst ?? 0;
}

/**
 * `x > v` becomes true when x > v and false only when x < v - hyst; `>=` turns on at x >= v. `<` and `<=`
 * mirror it (false only when x > v + hyst).
 */
function compareNode(id: SignalId, op: '<' | '<=' | '>' | '>=', v: Ref, ownHyst: number | undefined): Node {
  let on = false;
  return {
    eval(ctx) {
      const e = error(id, numeric(readSignalId(id, ctx.frame, ctx.vars)), resolveRef(v, ctx), ctx);
      if (Number.isNaN(e)) return (on = false);
      const h = hysteresis(id, ownHyst, ctx);
      if (op === '>' || op === '>=') {
        if (on) on = !(e < -h);
        else on = op === '>' ? e > 0 : e >= 0;
      } else if (on) on = !(e > h);
      else on = op === '<' ? e < 0 : e <= 0;
      return on;
    },
    reset() {
      on = false;
    },
  };
}

function eqNode(id: SignalId, want: number | string | boolean): Node {
  return stateless((ctx) => readSignalId(id, ctx.frame, ctx.vars) === want);
}

/**
 * Angle-aware band: true when -tol.minus <= e <= tol.plus; once true, false only when e leaves the band by
 * more than hyst. The tolerance resolves every tick against ctx.standard (the exercise being evaluated).
 */
function nearNode(id: SignalId, target: Ref, tol: TolRef, ownHyst: number | undefined): Node {
  let on = false;
  return {
    eval(ctx) {
      const e = error(id, numeric(readSignalId(id, ctx.frame, ctx.vars)), resolveRef(target, ctx), ctx);
      const t = resolveTol(tol, ctx);
      if (Number.isNaN(e) || Number.isNaN(t.minus) || Number.isNaN(t.plus)) return (on = false);
      const h = on ? hysteresis(id, ownHyst, ctx) : 0;
      on = e >= -t.minus - h && e <= t.plus + h;
      return on;
    },
    reset() {
      on = false;
    },
  };
}

/** all / any: every child is evaluated every tick (no short-circuit) so nested timers stay correct. */
function combineNode(children: Node[], isAll: boolean): Node {
  return {
    eval(ctx) {
      let r = isAll;
      for (const c of children) {
        const v = c.eval(ctx);
        r = isAll ? r && v : r || v;
      }
      return r;
    },
    reset() {
      for (const c of children) c.reset();
    },
  };
}

function notNode(child: Node): Node {
  return {
    eval: (ctx) => !child.eval(ctx),
    reset: () => child.reset(),
  };
}

/**
 * True once the child has been true for `s` continuous sim seconds, measured from the first tick it was seen
 * true (that tick adds no time: the condition may have become true at any moment of the frame before it).
 * A drop-out of at most `graceS` pauses the timer instead of zeroing it, and the value stays true through
 * such a drop-out once the time is reached; a longer drop-out zeroes the timer. Paused sim time (dt 0)
 * changes nothing. A 1e-9 s allowance absorbs the rounding of summed frame times (10 x 0.1 < 1).
 */
function heldNode(child: Node, s: number, graceS: number): Node {
  let timer = 0;
  let dropout = 0;
  let wasTrue = false;
  /** The child has been true since the timer was last zeroed (so a reached 0 s timer means something). */
  let started = false;
  const reached = (): boolean => timer >= s - 1e-9;
  return {
    eval(ctx) {
      const v = child.eval(ctx);
      const dt = ctx.dt > 0 ? ctx.dt : 0;
      if (v) {
        if (wasTrue) timer += dt;
        wasTrue = true;
        started = true;
        dropout = 0;
        return reached();
      }
      wasTrue = false;
      dropout += dt;
      if (dropout > graceS) {
        timer = 0;
        started = false;
        return false;
      }
      // Within the grace: the timer is paused; a time already reached still counts.
      return started && reached();
    },
    reset() {
      child.reset();
      timer = 0;
      dropout = 0;
      wasTrue = false;
      started = false;
    },
  };
}

/** Latched since the last reset (step entry). The child keeps being evaluated so its own state stays live. */
function everNode(child: Node): Node {
  let latched = false;
  return {
    eval(ctx) {
      if (child.eval(ctx)) latched = true;
      return latched;
    },
    reset() {
      child.reset();
      latched = false;
    },
  };
}

/**
 * Counts matching events on the bus since the step mark; true at `count`. The scan is incremental (only new
 * records are examined each tick) and restarts whenever the step mark changes.
 */
function eventNode(type: TrainingEventName, where: Where | undefined, count: number): Node {
  let mark = NaN;
  let next = 0;
  let n = 0;
  const entries = where ? Object.entries(where) : [];
  const matches = (data: unknown): boolean => {
    if (entries.length === 0) return true;
    if (data === null || typeof data !== 'object') return false;
    const d = data as Record<string, unknown>;
    for (const [k, want] of entries) {
      const got = d[k];
      if (Array.isArray(want)) {
        if (typeof got !== 'number' || !(got >= want[0] && got <= want[1])) return false;
      } else if (got !== want) return false;
    }
    return true;
  };
  return {
    eval(ctx) {
      if (ctx.stepMark !== mark) {
        mark = ctx.stepMark;
        next = mark;
        n = 0;
      }
      for (const r of ctx.events.since(next)) {
        next = r.seq + 1;
        if (r.type === type && matches(r.data)) n++;
      }
      return n >= count;
    },
    reset() {
      mark = NaN;
      next = 0;
      n = 0;
    },
  };
}
