// Resolution of lesson values: Ref -> number, TolRef -> Tol, SigRef -> SignalId (section 2.4).
//
// Everything resolves at evaluation time against the EvalContext, so a lesson can name a V-speed, a run
// variable captured in flight or a live signal, and the same data works for every aircraft type. Nothing
// here throws on bad data: an unknown var, V-speed, setting or signal resolves to NaN, which every
// predicate treats as false (the linter reports the unknown name before a lesson ever ships).

import type { EvalContext, Ref, SigRef, SignalFrame, SignalId, SignalValue, Standard, Tol, TolKey, TolRef } from '../types';

/**
 * Namespace of the pseudo-signals that read run variables: `{ var: 'alt0' }` as a SigRef resolves to
 * 'vars.alt0'. Run variables are numbers (EvalContext.vars), so a var cannot hold a signal id; a SigRef that
 * names a var therefore means "this variable's value" (compare a captured value, not a live signal).
 */
export const VAR_SIGNAL_PREFIX = 'vars.';

const num = (x: unknown): number => (typeof x === 'number' ? x : NaN);

/** Resolve a Ref in pilot units. Unknown vars / signals give NaN (predicates then evaluate false). */
export function resolveRef(ref: Ref, ctx: EvalContext): number {
  if (typeof ref === 'number') return ref;
  if (ref === null || typeof ref !== 'object') return NaN;
  let base: number;
  if ('var' in ref) base = num(ctx.vars[ref.var]);
  else if ('vspeed' in ref) base = num(ctx.aircraft.vspeeds[ref.vspeed]);
  else if ('setting' in ref) base = num(ctx.aircraft.settings[ref.setting]);
  else if ('field' in ref) base = ref.field === 'elevFt' ? ctx.fieldElevFt : NaN;
  else if ('sig' in ref) base = num(readSignal(ref.sig, ctx));
  else return NaN;
  return base + (ref.add ?? 0);
}

/**
 * Resolve a tolerance: a key in ctx.standards[ctx.authority][standard] (default ctx.standard), a key scaled,
 * a symmetric number or a literal band. An unknown key gives a NaN band (never "within").
 */
export function resolveTol(tol: TolRef, ctx: EvalContext, standard?: Standard): Tol {
  if (typeof tol === 'number') return { minus: Math.abs(tol), plus: Math.abs(tol) };
  if (typeof tol === 'string') return lookupTol(tol, 1, ctx, standard);
  if (tol !== null && typeof tol === 'object') {
    if ('key' in tol) return lookupTol(tol.key, tol.scale, ctx, standard);
    if ('minus' in tol && 'plus' in tol) return { minus: num(tol.minus), plus: num(tol.plus) };
  }
  return { minus: NaN, plus: NaN };
}

function lookupTol(key: TolKey, scale: number, ctx: EvalContext, standard: Standard | undefined): Tol {
  const t = ctx.standards[ctx.authority]?.[standard ?? ctx.standard]?.[key];
  if (!t) return { minus: NaN, plus: NaN };
  return { minus: t.minus * scale, plus: t.plus * scale };
}

/**
 * A SigRef names a signal directly, or a run variable: `{ var: name }` resolves to the pseudo-signal
 * `vars.<name>` (VAR_SIGNAL_PREFIX), which readSignal() reads from ctx.vars.
 */
export function resolveSig(s: SigRef, ctx: EvalContext): SignalId {
  void ctx; // resolution needs no context today; the parameter keeps the contract signature stable
  return sigId(s);
}

/** resolveSig without a context (the predicate compiler resolves ids once, at compile time). */
export function sigId(s: SigRef): SignalId {
  return typeof s === 'string' ? s : `${VAR_SIGNAL_PREFIX}${s.var}`;
}

/** The current value of a SigRef: a frame signal, or a run variable for `{ var }` / 'vars.<name>'. */
export function readSignal(s: SigRef, ctx: EvalContext): SignalValue | undefined {
  return readSignalId(sigId(s), ctx.frame, ctx.vars);
}

/** readSignal for an already resolved id (the predicate compiler caches resolved ids). */
export function readSignalId(id: string, frame: Readonly<SignalFrame>, vars: Readonly<Record<string, number>>): SignalValue | undefined {
  if (id.startsWith(VAR_SIGNAL_PREFIX)) return vars[id.slice(VAR_SIGNAL_PREFIX.length)];
  return frame[id];
}
