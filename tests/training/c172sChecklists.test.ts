// Round 7, item 6: the C172S checklist data lives on the aircraft type. Every item carries its control, its
// state predicate (or null: Enter), its key (or null) and its reason; the engine's inferred where/key and the
// RUNNER_LINES `why.*` table are only fallbacks for other types.

import { describe, expect, it } from 'vitest';
import { C172S } from '../../src/training/aircraft/c172s';
import { TrainingBus } from '../../src/training/engine/bus';
import { ChecklistRunner } from '../../src/training/engine/checklists';
import { CONTROL_INFO, INSTRUMENT_INFO, itemKey, itemTarget, predSignals } from '../../src/training/engine/controls';
import { compile } from '../../src/training/engine/predicates';
import { STANDARDS } from '../../src/training/grading/standards';
import { Telemetry } from '../../src/training/telemetry/telemetry';
import { isInputAction } from '../../src/input/bindings';
import type { ChecklistItem, CueRef, EvalContext, Grade, SignalFrame } from '../../src/training/types';

const defs = new Telemetry();
const CORE = new Set(['fuelSel', 'mixture', 'mags', 'fuelPump', 'parkingBrake', 'lightLanding', 'avionics', 'master', 'lightBeacon', 'throttle',
  'engineRunning', 'oilPsi', 'rpm', 'alternator', 'lightNav', 'flapsDeg', 'suctionInHg', 'trim', 'lightStrobe', 'aglFt']);

type MutableCtx = { -readonly [K in keyof EvalContext]: EvalContext[K] } & { frame: SignalFrame };
function makeCtx(frame: SignalFrame): MutableCtx {
  const grades: Record<string, Grade> = {};
  return {
    frame, signalDef: (id) => defs.def(id), vars: {}, aircraft: C172S, fieldElevFt: 394, standards: STANDARDS, authority: 'easa',
    standard: 'training', events: new TrainingBus(), stepMark: 0, stepT: 0, dt: 0.1, simT: 0, pilot: 'student', speechIdle: true,
    exerciseGrade: (id) => grades[id] ?? null,
  };
}

const whyText = (w: CueRef | undefined): string => (w && typeof w === 'object' && 'text' in w ? (Array.isArray(w.text) ? w.text[0] : w.text) : '');
const allItems = (): { list: string; it: ChecklistItem }[] =>
  Object.values(C172S.checklists).flatMap((l) => l.items.map((it) => ({ list: l.id, it })));

describe('C172S checklist data (item 6 linter)', () => {
  it('every item has control, state, key and why, all valid', () => {
    const items = allItems();
    expect(items.length).toBeGreaterThan(60);
    for (const { list, it } of items) {
      const at = `${list}.${it.id}`;
      expect(it.control, `${at}: control`).not.toBeUndefined();
      expect(it.state, `${at}: state`).not.toBeUndefined();
      expect(it.key, `${at}: key`).not.toBeUndefined();
      expect(it.why, `${at}: why`).toBeDefined();
      // control: a known control or instrument, or null.
      if (it.control !== null) expect(it.control! in CONTROL_INFO || it.control! in INSTRUMENT_INFO, `${at}: control ${it.control}`).toBe(true);
      expect(itemTarget(it), `${at}: the engine points where the data says`).toBe(it.control);
      // state: compiles over core signals, and `check` (silent mode, grader, tests) is the same predicate.
      if (it.state) {
        expect(() => compile(it.state!), at).not.toThrow();
        for (const s of predSignals(it.state)) expect(CORE.has(s), `${at}: ${s}`).toBe(true);
        expect(it.check, `${at}: check`).toEqual(it.state);
      } else {
        expect(it.check, `${at}: an Enter item has no check`).toBeUndefined();
      }
      // key: an input action, a literal label, a raise/lower pair of actions, or null.
      const k = it.key;
      if (typeof k === 'string') expect(isInputAction(k) || /^[A-Z0-9][A-Za-z0-9+ /]*$/.test(k), `${at}: key ${k}`).toBe(true);
      else if (k) {
        expect(isInputAction(k.raise) && isInputAction(k.lower), `${at}: key pair`).toBe(true);
        expect(it.state, `${at}: a key pair needs a band`).toBeTruthy();
      }
      // why: an inline line of 15 words or fewer.
      const w = whyText(it.why);
      expect(w.length, `${at}: why text`).toBeGreaterThan(0);
      expect(w.split(/\s+/).length, `${at}: "${w}"`).toBeLessThanOrEqual(15);
    }
  });

  it('the shutdown list has its own reasons, not the start-up ones', () => {
    const start = C172S.checklists.beforeStart.items;
    const shut = C172S.checklists.shutdown.items;
    for (const s of shut) {
      const twin = start.find((b) => b.id === s.id);
      if (twin) expect(whyText(s.why), `shutdown.${s.id}`).not.toBe(whyText(twin.why));
    }
    expect(whyText(shut.find((i) => i.id === 'avionicsOff')!.why)).toMatch(/before the engine stops/);
  });

  it('a shutdown reason is said even after the start-up item with the same id was explained', () => {
    const explained = new Set<string>();
    const guided = { explained, why: (it: ChecklistItem) => it.why ?? null };
    const said = (listId: 'beforeStart' | 'shutdown', frame: SignalFrame): string[] => {
      const list = C172S.checklists[listId];
      const one = { ...list, items: list.items.filter((i) => i.id === 'avionicsOff') };
      const r = new ChecklistRunner(one, 'challengeResponse', new TrainingBus(), guided);
      return r.update(makeCtx(frame)).map((c) => (typeof c === 'object' && 'text' in c ? String(c.text) : String(c)));
    };
    expect(said('beforeStart', { avionics: true })).toContain(whyText(C172S.checklists.beforeStart.items.find((i) => i.id === 'avionicsOff')!.why));
    expect(said('shutdown', { avionics: true })).toContain(whyText(C172S.checklists.shutdown.items.find((i) => i.id === 'avionicsOff')!.why));
  });

  it('the prime is done only when the pump has been on for 2 s and is off again, before the start', () => {
    const prime = C172S.checklists.beforeStart.items.find((i) => i.id === 'fuelPumpPrime')!;
    const run = (seq: [boolean, number][], engineRunning = false): boolean => {
      const p = compile(prime.state!);
      const ctx = makeCtx({ fuelPump: false, engineRunning });
      let out = false;
      for (const [pump, s] of seq) {
        for (let t = 0; t < s; t += 0.1) {
          ctx.frame.fuelPump = pump;
          ctx.simT += 0.1;
          out = p.eval(ctx);
        }
      }
      return out;
    };
    expect(run([[false, 3]])).toBe(false);                 // never on
    expect(run([[true, 3]])).toBe(false);                  // still on
    expect(run([[true, 1], [false, 1]])).toBe(false);      // a flick: no prime
    expect(run([[true, 3], [false, 1]])).toBe(true);       // primed, then off
    expect(run([[true, 3], [false, 1]], true)).toBe(false); // not a before-start state
  });

  it('the throttle is open about a quarter inch (0.02-0.08), and its key follows the side of the band', () => {
    const t = C172S.checklists.beforeStart.items.find((i) => i.id === 'throttleOpen')!;
    const p = compile(t.state!);
    const at = (throttle: number) => p.eval(makeCtx({ throttle }));
    expect([0, 0.015, 0.05, 0.075, 0.09, 0.2].map(at)).toEqual([false, false, true, true, false, false]);
    expect(itemKey(t, 'throttle', { throttle: 0 })?.label).toBe('F3');
    expect(itemKey(t, 'throttle', { throttle: 0.2 })?.label).toBe('F2');
    const rpm = C172S.checklists.afterStart.items.find((i) => i.id === 'rpm')!;
    expect(itemKey(rpm, 'throttle', { rpm: 1840 })?.label).toBe('F2');
    expect(itemKey(rpm, 'throttle', { rpm: 600 })?.label).toBe('F3');
  });
});
