// Writing the levers and switches that exist once per engine (ControlInputs.engines), for the engine(s) the
// pilot has selected. Pure logic, no DOM.
//
// A scalar of ControlInputs (throttle, mixture, magnetos, ...) is the lever of ALL engines; an engine whose
// lever has left it carries its own value (core/types.ts: engineControl, setEngineControl, clearEngineControl,
// the only way these are read and written here). The rules:
//
//   'all' selected, a switch or selector      the scalar is written and every engine follows it again
//   'all' selected, a lever key held           the scalar and every lever that has left it move by the same
//                                              amount, each to its own stop, so a secured engine's lever does
//                                              not jump; a lever that comes within LEVER_REJOIN of the scalar
//                                              rejoins it
//   one engine selected                        that engine's lever alone: its own value while another engine
//                                              still follows the scalar; the scalar itself once it is the only
//                                              engine that does (the other one carries its own value), so the
//                                              writers that mean "all engines" (autothrottle, autoflight) keep
//                                              moving the engine the pilot is flying on
//
// With one engine all of this is the scalar.

import { clamp } from '../core/math';
import { PROP_FEATHER_GATE, clearEngineControl, engineControl, setEngineControl, type ControlInputs, type EngineControlKey } from '../core/types';

/** Which engine(s) a key acts on: all of them, or the engine with this index (0 = left). */
export type EngineTarget = 'all' | number;

/** The continuous per-engine levers. */
export type EngineLever = 'throttle' | 'mixture' | 'propeller';

/** Two levers closer than this are one again (the override of the engine is dropped). */
export const LEVER_REJOIN = 0.05;
/**
 * Where a held mixture key stops in the air on a twin with both engines selected: just above idle cut-off, so
 * one key cannot shut both engines down (the cut-off of every engine type is below this).
 */
export const MIXTURE_GUARD = 0.05;
/**
 * Below these a lever has shut its engine down or feathered its propeller. Such a lever never rejoins one that
 * is above (nor the other way round), however close: being next to idle cut-off is not being in it.
 */
const SECURED_BELOW: Record<EngineLever, number> = { throttle: 0, mixture: MIXTURE_GUARD, propeller: PROP_FEATHER_GATE };

/** A lever at `v` and the scalar are one lever again. */
function rejoins(k: EngineLever, v: number, scalar: number): boolean {
  return Math.abs(v - scalar) <= LEVER_REJOIN && v < SECURED_BELOW[k] === scalar < SECURED_BELOW[k];
}

/** The position of a control as the target sees it: the scalar for 'all', else that engine's own. */
export function readEngineControl<K extends EngineControlKey>(c: Readonly<ControlInputs>, target: EngineTarget, k: K): ControlInputs[K] {
  return target === 'all' ? c[k] : engineControl(c, target, k);
}

/** An engine other than `engine` still follows the scalar of `k` (so the scalar cannot be moved for `engine` alone). */
export function scalarShared(c: Readonly<ControlInputs>, engine: number, k: EngineControlKey): boolean {
  const scalar = c[k];
  for (let i = 0; i < c.engines.length; i++) if (i !== engine && engineControl(c, i, k) === scalar) return true;
  return false;
}

/** Set a switch, selector or lever position for the engine(s) of `target`. */
export function writeEngineControl<K extends EngineControlKey>(c: ControlInputs, target: EngineTarget, k: K, v: ControlInputs[K]): void {
  if (target === 'all' || !scalarShared(c, target, k)) {
    (c as Pick<ControlInputs, K>)[k] = v;
    clearEngineControl(c, k, target === 'all' ? undefined : target);
  } else if (v === c[k]) clearEngineControl(c, k, target);
  else setEngineControl(c, target, k, v);
}

/**
 * One lever moved by `inc`, to the stops `floor` and 1. A lever that is already below the floor (a mixture in
 * idle cut-off behind the airborne guard, a feathered propeller lever behind its gate) is not lifted by a key
 * that moves it down; `lift`: a key that moves it up starts from the floor (the propeller lever leaving feather).
 */
export function stepLever(v: number, inc: number, floor: number, lift: boolean): number {
  if (inc < 0) return Math.max(v + inc, Math.min(v, floor));
  if (inc > 0) return Math.min((lift && v < floor ? floor : v) + inc, 1);
  return v;
}

/**
 * 'all' selected: move the levers of `k` that have left the scalar by `inc`, as the scalar is about to move
 * (call this BEFORE writing the scalar, with the value it will have, `scalarAfter`). Each stops at its own
 * stop; one that ends within LEVER_REJOIN of the scalar rejoins it. A lever below `floor` (a secured engine's
 * mixture in idle cut-off behind the airborne guard, its feathered propeller lever behind the gate) is left
 * where it is: bringing it back takes that engine selected.
 */
export function moveSplitLevers(c: ControlInputs, k: EngineLever, inc: number, floor: number, scalarAfter: number): void {
  const scalar = c[k];
  for (let i = 0; i < c.engines.length; i++) {
    const v = engineControl(c, i, k);
    if (v === scalar) {
      // Follows the scalar (an own value equal to it is dropped: it must move with it).
      clearEngineControl(c, k, i);
      continue;
    }
    if (v < floor) continue;
    const moved = stepLever(v, inc, floor, false);
    if (rejoins(k, moved, scalarAfter)) clearEngineControl(c, k, i);
    else setEngineControl(c, i, k, moved);
  }
}

/** The levers of `k` that have come within LEVER_REJOIN of the scalar rejoin it (when a lever key is let go). */
export function rejoinLevers(c: ControlInputs, k: EngineLever): void {
  const scalar = c[k];
  for (let i = 0; i < c.engines.length; i++) {
    if (rejoins(k, engineControl(c, i, k), scalar)) clearEngineControl(c, k, i);
  }
}

/** One step of a three-position control (closed, half, open): the next position in a direction. */
export function stepThird(v: number, direction: 1 | -1): number {
  return clamp(Math.round(v * 2) + direction, 0, 2) / 2;
}
