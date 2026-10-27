// The hand primer (EngineDef.primer): the Cessna 152 and the Piper PA-38. A cold engine needs it (C152 POH 4-11: "If
// the engine is under primed ... it will not fire at all"), one to three strokes start it at once, over-priming
// floods it until it is cleared with the throttle open and the mixture in idle cut-off (4-11; PA-38 POH 4.13 (c)),
// colder days need more strokes (4-19; PA-38 4.13 (a)), a hot engine needs none (PA-38 4.13 (b)) and is flooded
// by a little, and an unlocked primer makes the idle rich and rough (3-4: "Primer -- IN and LOCKED").
//
// The file also pins that a type WITHOUT the member starts exactly as it did before the primer existed: a
// cold-and-dark start of the Cessna 172S, the Robinson R22 (which spreads the C152's engine and fuel system) and the
// R44 (which primes through its ignition key) traced step by step and reduced to a digest recorded on the tree
// before the primer was added.

import { describe, expect, it } from 'vitest';
import { setEngineControl, type FuelSelector } from '../../src/core/types';
import { Powerplant } from '../../src/physics/propulsion';
import { C172_POWERPLANT } from '../../src/physics/propulsion/c172Powerplant';
import type { PowerplantDef } from '../../src/physics/propulsion/defs';
import type { PistonEngine } from '../../src/physics/propulsion/engine';
import { C152_POWERPLANT } from '../../src/aircraft/c152/powerplant';
import { PA38_POWERPLANT } from '../../src/aircraft/pa38/powerplant';
import R22_DEFINITION from '../../src/aircraft/r22';
import R44_DEFINITION from '../../src/aircraft/r44';
import { DT, makeInput } from './helpers';

const C15 = 288.15;
const MINUS5 = 268.15;
const MINUS15 = 258.15;

/** The two types with the primer, and what their start needs besides it (the PA-38's electric pump ON, POH 4.13). */
const TYPES = [
  { name: 'C152', def: C152_POWERPLANT, selector: 'on' as FuelSelector, pump: false },
  { name: 'PA-38', def: PA38_POWERPLANT, selector: 'left' as FuelSelector, pump: true },
] as const;
type Type = (typeof TYPES)[number];

/**
 * Cold-soaked at `oat` (or warm: just shut down), master on, magnetos BOTH, throttle open about half an inch (0.07),
 * mixture rich; `strokes` of the primer, one a step, and the knob locked again.
 */
function parked(t: Type, oat: number, strokes: number, warm = false) {
  const sys = new Powerplant(t.def);
  sys.reset({ running: false, warm, tanks: sys.tankCapacities, oat });
  const input = makeInput({ controls: {
    masterBattery: true, throttle: 0.07, mixture: 1, magnetos: 3, fuelSelector: t.selector, fuelPump: t.pump, primerStrokes: 0, primerLocked: true,
  } });
  input.atmosphere.temperature = oat;
  sys.step(input);
  input.controls.primerLocked = false;
  for (let k = 1; k <= strokes; k++) {
    input.controls.primerStrokes = k;
    sys.step(input);
  }
  input.controls.primerLocked = true;
  return { sys, input, c: input.controls };
}

/** Crank until the engine has caught (running, above 600 rpm) or `seconds` pass; the time it took, s (NaN: it did not). */
function crank(sys: Powerplant, input: ReturnType<typeof makeInput>, seconds: number): number {
  input.controls.starter = true;
  for (let k = 1; k <= Math.round(seconds / DT); k++) {
    sys.step(input);
    const e = sys.units[0].state;
    if (e.running && e.rpm > 600) {
      input.controls.starter = false;
      return k * DT;
    }
  }
  input.controls.starter = false;
  return NaN;
}

function hold(sys: Powerplant, input: ReturnType<typeof makeInput>, seconds: number): void {
  for (let k = Math.round(seconds / DT); k > 0; k--) sys.step(input);
}

describe('the hand primer of the C152 and the PA-38', () => {
  for (const t of TYPES) {
    describe(t.name, () => {
      it('cold at 15 C: unprimed it is slow to catch, one stroke helps, two or three start it at once and it keeps running', () => {
        const unprimed = parked(t, C15, 0);
        const slow = crank(unprimed.sys, unprimed.input, 30);
        // "Under primed ... it will not fire at all" (C152 4-11): it catches only once the carburettor's own fuel has
        // built up a film on the cold induction, long after a normal start.
        expect(slow).toBeGreaterThan(7);
        const one = parked(t, C15, 1);
        expect(crank(one.sys, one.input, 30)).toBeLessThan(slow);
        for (const n of [2, 3]) {
          const p = parked(t, C15, n);
          expect(crank(p.sys, p.input, 10)).toBeLessThan(1.5);
          hold(p.sys, p.input, 30);
          expect(p.sys.units[0].state.running).toBe(true);
          expect(p.sys.units[0].state.rpm).toBeGreaterThan(800);
        }
      });

      it('colder needs more strokes: at -5 C three or four, at -15 C five or more', () => {
        const at = (oat: number, n: number): number => {
          const p = parked(t, oat, n);
          return crank(p.sys, p.input, 30);
        };
        // Two strokes at -5 C: slow, as an unprimed start at 15 C; four: at once (C152 4-11: "up to 3 strokes" near
        // freezing; PA-38 4.13: two to four at +40 F, more when colder).
        expect(at(MINUS5, 2)).toBeGreaterThan(5);
        expect(at(MINUS5, 4)).toBeLessThan(2);
        // -15 C without preheat: the cold-weather two to four and three more (C152 4-19).
        expect(at(MINUS15, 3)).toBeGreaterThan(10);
        expect(at(MINUS15, 7)).toBeLessThan(2);
      });

      it('over-primed it floods; throttle full and idle cut-off, cranked, clears it, and it then starts unprimed', () => {
        const p = parked(t, C15, 10);
        // The normal start, cranked 15 s: flooded, it does not catch.
        expect(crank(p.sys, p.input, 15)).toBeNaN();
        const engine = p.sys.units[0].engine as PistonEngine;
        expect(engine.plugWet).toBeGreaterThanOrEqual(1);
        // The flooded start (C152 4-11; PA-38 4.13 (c)): mixture idle cut-off, throttle full open, crank.
        p.c.mixture = 0;
        p.c.throttle = 1;
        p.c.starter = true;
        hold(p.sys, p.input, 8);
        p.c.starter = false;
        expect(engine.plugWet).toBeLessThan(1);
        hold(p.sys, p.input, 2);
        // "Repeat the starting procedure without any additional priming."
        p.c.mixture = 1;
        p.c.throttle = 0.07;
        expect(crank(p.sys, p.input, 10)).toBeLessThan(5);
        hold(p.sys, p.input, 20);
        expect(p.sys.units[0].state.running).toBe(true);
      });

      it('hot (just shut down) it starts unprimed at once, and two strokes flood it', () => {
        const hot = parked(t, C15, 0, true);
        expect(crank(hot.sys, hot.input, 10)).toBeLessThan(1);
        const primed = parked(t, C15, 2, true);
        expect(crank(primed.sys, primed.input, 10)).toBeNaN();
      });

      it('the strokes draw their fuel from the tanks', () => {
        const before = new Powerplant(t.def);
        before.reset({ running: false, tanks: before.tankCapacities, oat: C15 });
        const total = (sys: Powerplant): number => Array.from(sys.tankQuantities).reduce((a, b) => a + b, 0);
        const p = parked(t, C15, 3);
        hold(p.sys, p.input, 5);
        expect(total(before) - total(p.sys)).toBeCloseTo(3 * t.def.engines[0].engine.primer!.stroke, 6);
      });

      it('left unlocked it makes the idle rich and rough; locked, the engine is as it was', () => {
        const sys = new Powerplant(t.def);
        sys.reset({ running: true, tanks: sys.tankCapacities });
        const input = makeInput({ controls: {
          masterBattery: true, throttle: 0, mixture: 1, magnetos: 3, fuelSelector: t.selector, primerStrokes: 0, primerLocked: true,
        } });
        hold(sys, input, 20);
        const locked = { rpm: sys.units[0].state.rpm, roughness: sys.units[0].state.roughness ?? 0 };
        input.controls.primerLocked = false;
        hold(sys, input, 20);
        const e = sys.units[0].state;
        expect(e.running).toBe(true);
        expect(e.rpm).toBeLessThan(locked.rpm - 60);
        expect(e.roughness ?? 0).toBeGreaterThan(0.5);
        expect(locked.roughness).toBe(0);
        // At cruise power the manifold vacuum is low and the leak small beside the carburettor's flow: barely felt.
        input.controls.throttle = 0.6;
        hold(sys, input, 20);
        expect(sys.units[0].state.roughness ?? 0).toBeLessThan(0.1);
        input.controls.primerLocked = true;
        input.controls.throttle = 0;
        hold(sys, input, 20);
        expect(sys.units[0].state.rpm).toBeCloseTo(locked.rpm, 0);
        expect(sys.units[0].state.roughness).toBe(0);
      });
    });
  }

  it('a resumed stroke count injects nothing again; a lower count is taken as it is; strokes after a reset all count', () => {
    const t = TYPES[0];
    const stroke = t.def.engines[0].engine.primer!.stroke;
    const sys = new Powerplant(t.def);
    sys.reset({ running: false, tanks: sys.tankCapacities, oat: C15 });
    // Resumed with 12 strokes made and their puddle: the count is not injected a second time.
    sys.restorePrimers([{ ...sys.capture()[0], primer: { film: 0, ports: 0.002, plugWet: 0 } }], 12);
    const input = makeInput({ controls: { masterBattery: true, throttle: 0.07, mixture: 1, magnetos: 3, fuelSelector: 'on', primerStrokes: 12 } });
    sys.step(input);
    expect(sys.fuel.primerPorts(0)).toBeCloseTo(0.002, 12);
    input.controls.primerStrokes = 0;
    sys.step(input);
    input.controls.primerStrokes = 1;
    sys.step(input);
    expect(sys.fuel.primerPorts(0)).toBeCloseTo(0.002 + stroke, 9);
    // A reset: the count starts at none, so two strokes made before the first step are both injected.
    sys.reset({ running: false, tanks: sys.tankCapacities, oat: C15 });
    input.controls.primerStrokes = 2;
    sys.step(input);
    expect(sys.fuel.primerPorts(0)).toBeCloseTo(2 * stroke, 9);
  });

  it('the R22, which spreads the C152 engine, has no primer', () => {
    expect(R22_DEFINITION.powerplant.engines[0].engine.primer).toBeUndefined();
    expect(C152_POWERPLANT.engines[0].engine.primer).toBeDefined();
    expect(PA38_POWERPLANT.engines[0].engine.primer).toBeDefined();
  });
});

/** FNV-1a over the bytes of a list of doubles. */
function digest(values: readonly number[]): string {
  const bytes = new Uint8Array(new Float64Array(values).buffer);
  let h = 0x811c9dc5;
  for (let k = 0; k < bytes.length; k++) {
    h ^= bytes[k];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Cold and dark at `oat` K (or warm, just shut down): master on, magnetos BOTH, throttle cracked, mixture rich;
 * crank 6 s (the R44 with its ignition-key PRIME for the first 2 s), then 4 s with the starter released. Every
 * step's rpm, fuel flow, EGT, CHT and running flag go into the digest.
 */
function startTrace(def: PowerplantDef, oat: number, warm: boolean, keyPrime = false): { digest: string; running: boolean; rpm: number } {
  const sys = new Powerplant(def);
  sys.reset({ running: false, warm, tanks: sys.tankCapacities, oat });
  const input = makeInput({ controls: { masterBattery: true, throttle: 0.07, mixture: 1, magnetos: 3 } });
  input.atmosphere.temperature = oat;
  const values: number[] = [];
  const steps = Math.round(10 / DT);
  for (let k = 0; k < steps; k++) {
    setEngineControl(input.controls, 0, 'starter', k * DT < 6);
    if (keyPrime) input.controls.fuelPrime = k * DT < 2;
    sys.step(input);
    const e = sys.units[0].state;
    values.push(e.rpm, e.fuelFlow, e.egt, e.cht, e.running ? 1 : 0);
  }
  const e = sys.units[0].state;
  return { digest: digest(values), running: e.running, rpm: e.rpm };
}

describe('a type without a hand primer starts exactly as before', () => {
  it('Cessna 172S, R22 and R44: cold-and-dark and warm start traces are unchanged', () => {
    const traces = {
      c172Cold: startTrace(C172_POWERPLANT, 288.15, false),
      c172Freezing: startTrace(C172_POWERPLANT, 268.15, false),
      c172Warm: startTrace(C172_POWERPLANT, 288.15, true),
      r22Cold: startTrace(R22_DEFINITION.powerplant, 288.15, false),
      r22Freezing: startTrace(R22_DEFINITION.powerplant, 268.15, false),
      r22Warm: startTrace(R22_DEFINITION.powerplant, 288.15, true),
      r44Cold: startTrace(R44_DEFINITION.powerplant, 288.15, false, true),
    };
    const digests = Object.fromEntries(Object.entries(traces).map(([k, t]) => [k, t.digest]));
    expect(digests).toEqual(RECORDED);
    // And the traces are of engines that started.
    // And the fixed-wing bench traces are of engines that started (the R44 on this bench, without its rotor drive and
    // automatic pump logic exercised, does not: its trace pins the key PRIME path all the same).
    for (const [k, t] of Object.entries(traces)) if (k !== 'r44Cold') expect(t.running).toBe(true);
  });
});

/** Recorded on feat/poh-fixes a8d52dd, before the primer. */
const RECORDED: Record<string, string> = {
  c172Cold: '0118fa65', c172Freezing: '2e355f66', c172Warm: '1a201ae5',
  r22Cold: 'c07be81e', r22Freezing: '5ee5e0fb', r22Warm: '0e87644c',
  r44Cold: '9fe883cb',
};
