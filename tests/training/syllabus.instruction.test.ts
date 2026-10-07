// Content: the ab-initio instruction (owner playtest of L01: no feedback while the lesson was in progress, the
// rudder never detected, and no take-over when the limits were exceeded). These tests pin the content side:
//   1. every task the student flies in stage 1 (L01-L08) talks: a start line, 2-4 milestones, a success line and
//      a nudge (assessed tasks, where she has said she will stay quiet, close with a neutral "Thank you" only);
//   2. every flying task in stage 1 has lesson limits, each with its line, and the bands the owner asked for;
//   3. every line is at most 20 words and renders through the phraseology module; every predicate compiles;
//   4. L01's "yawed" check accepts yaw evidence directly (sideslip or yaw rate with rudder) as well as the ball;
//   5. the skill test and the solo stay silent (the builders only talk when a lesson asks them to);
//   6. stage-1 coach presets are tuned to speak sooner, and the linter catches broken feedback and limits.

import { describe, expect, it } from 'vitest';
import { C172S } from '../../src/training/aircraft/c172s';
import { getAircraftType, SCHOOL_AIRCRAFT } from '../../src/training/aircraft/registry';
import { AB_INITIO_TUNING, bindPreset } from '../../src/training/content/coachPresets';
import { DEMO_START_VARS, DEMOS } from '../../src/training/content/demos';
import { LINES } from '../../src/training/content/lines';
import { lessonById, SYLLABUS } from '../../src/training/content/syllabus/index';
import { countWords, MAX_LINE_WORDS, validateLesson, type LintContext } from '../../src/training/content/validate';
import { TrainingBus } from '../../src/training/engine/bus';
import { compile } from '../../src/training/engine/predicates';
import { resolveRef } from '../../src/training/engine/refs';
import { STANDARDS } from '../../src/training/grading/standards';
import { render } from '../../src/training/speech/phraseology';
import { Telemetry } from '../../src/training/telemetry/telemetry';
import type { CoachRule, CueRef, EvalContext, InlineCue, Lesson, SignalId, SignalValue, TaskStep } from '../../src/training/types';

const ctx: LintContext = { signals: new Telemetry().defs(), lines: LINES, demos: DEMOS, aircraft: SCHOOL_AIRCRAFT.map((id) => getAircraftType(id)), demoVars: DEMO_START_VARS };
const STAGE1_IDS = ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08'];
const lesson = (id: string): Lesson => lessonById(id)!;
const tasks = (l: Lesson): { phase: string; t: TaskStep }[] =>
  l.flow.flatMap((p) => p.steps.filter((s): s is TaskStep => s.kind === 'task').map((t) => ({ phase: p.id, t })));
/** Assessed phases: the instructor has said she will stay quiet. */
const assessed = (l: Lesson, phase: string): boolean => l.flow.find((p) => p.id === phase)?.coachLevel === 'silent';
const cueLines = (c: CueRef): InlineCue => (typeof c === 'string' ? LINES[c] : 'id' in c ? LINES[c.id] : c);
const texts = (c: CueRef): string[] => [cueLines(c).text].flat();

/** Every cue a task's feedback and limits can speak. */
function spoken(t: TaskStep): CueRef[] {
  const f = t.feedback;
  return [
    ...(f?.start ? [f.start] : []), ...(f?.milestones ?? []).map((m) => m.cue), ...(f?.success ? [f.success] : []),
    ...(f?.nudge ? [f.nudge.cue] : []), ...(t.limits ?? []).map((l) => l.cue),
  ];
}

describe('stage 1 talks the student through every task', () => {
  for (const id of STAGE1_IDS) {
    it(`${id}: start, 2-4 milestones, success and nudge on every task outside the assessment`, () => {
      const l = lesson(id);
      const list = tasks(l);
      expect(list.length).toBeGreaterThan(0);
      for (const { phase, t } of list) {
        const where = `${id} ${phase}/${t.id}`;
        expect(t.feedback, where).toBeDefined();
        if (assessed(l, phase)) {
          expect(t.feedback!.success, `${where}: assessed tasks close with a neutral line`).toBeDefined();
          expect(t.feedback!.start ?? t.feedback!.milestones ?? t.feedback!.nudge, `${where}: no commentary in an assessment`).toBeUndefined();
          continue;
        }
        expect(t.feedback!.start, where).toBeDefined();
        expect(t.feedback!.success, where).toBeDefined();
        expect(t.feedback!.nudge, where).toBeDefined();
        const n = t.feedback!.milestones?.length ?? 0;
        expect(n, `${where}: milestones`).toBeGreaterThanOrEqual(id === 'L02' ? 1 : 2);
        expect(n, `${where}: milestones`).toBeLessThanOrEqual(4);
      }
    });
  }

  it('starts every exercise by saying what to do ("Go ahead" or "Eyes on")', () => {
    for (const id of STAGE1_IDS) {
      for (const { t } of tasks(lesson(id))) {
        if (!t.feedback?.start) continue;
        for (const x of texts(t.feedback.start)) expect(x, `${id}/${t.id}`).toMatch(/^(Go ahead|Eyes on|Your aircraft)/);
      }
    }
  });
});

describe('stage 1 limits', () => {
  /** Every task flown in the air: L02 is on the ground (no limit intervention there: see the module report). */
  const AIR = STAGE1_IDS.filter((id) => id !== 'L02');
  for (const id of AIR) {
    it(`${id}: every task has limits, each with a line`, () => {
      for (const { phase, t } of tasks(lesson(id))) {
        expect(t.limits?.length ?? 0, `${id} ${phase}/${t.id}`).toBeGreaterThan(0);
        for (const lim of t.limits!) {
          expect(lim.min !== undefined || lim.max !== undefined, `${t.id}.${lim.id}`).toBe(true);
          expect(texts(lim.cue).length).toBeGreaterThan(0);
        }
      }
    });
  }

  const bound = (t: TaskStep, id: string): { min?: unknown; max?: unknown } | undefined => t.limits?.find((l) => l.id === id);

  it('L01: bank 45, pitch +20/-15, speed 60-125 KIAS on every task (55 in the full-power climb from 68 KIAS)', () => {
    for (const { t } of tasks(lesson('L01'))) {
      expect(bound(t, 'bankRight')?.max, t.id).toBe(45);
      expect(bound(t, 'bankLeft')?.min, t.id).toBe(-45);
      expect(bound(t, 'pitchUp')?.max, t.id).toBe(20);
      expect(bound(t, 'pitchDown')?.min, t.id).toBe(-15);
      expect(bound(t, 'slow')?.min, t.id).toBe(t.id === 'powerYaw' ? 55 : 60);
      expect(bound(t, 'fast')?.max, t.id).toBe(125);
    }
  });

  it('L03: bank 30 and altitude +-400 ft on every task', () => {
    for (const { t } of tasks(lesson('L03'))) {
      expect(bound(t, 'bankRight')?.max, t.id).toBe(30);
      expect(bound(t, 'low')?.min, t.id).toMatchObject({ add: -400 });
      expect(bound(t, 'high')?.max, t.id).toMatchObject({ add: 400 });
    }
  });

  it('L04: a speed band on every climb and descent', () => {
    for (const { t } of tasks(lesson('L04'))) {
      expect(bound(t, 'slow'), t.id).toBeDefined();
      expect(bound(t, 'fast'), t.id).toBeDefined();
    }
  });

  it('L05: turns are limited to 15 degrees beyond the target bank', () => {
    const l = lesson('L05');
    for (const { t } of tasks(l)) {
      const target = Math.max(...t.card.targets.filter((x) => x.sig === 'aiBankDeg').map((x) => Math.abs(x.value as number)), 0);
      if (target > 0) expect(bound(t, 'bankRight')?.max, t.id).toBe(target + 15);
    }
  });

  it('never limits the speed below the stall in the stalling lesson', () => {
    for (const { t } of tasks(lesson('L07'))) if (t.id.endsWith('Stall')) expect(bound(t, 'slow'), t.id).toBeUndefined();
  });
});

describe('the lines are an instructor\'s', () => {
  const all = SYLLABUS.flatMap((l) => tasks(l).flatMap(({ t }) => spoken(t).map((c) => ({ where: `${l.id}/${t.id}`, c }))));

  it('finds the instruction', () => expect(all.length).toBeGreaterThan(400));

  it('keeps every line to 20 words', () => {
    for (const { where, c } of all) for (const x of texts(c)) expect(countWords(x), `${where}: "${x}"`).toBeLessThanOrEqual(MAX_LINE_WORDS);
  });

  it('renders every line with nothing left over', () => {
    const lookup = (): number => 1234;
    for (const { where, c } of all) {
      for (const x of texts(c)) {
        const r = render(x, { lookup });
        expect(r.caption, where).not.toMatch(/[{}]/);
        expect(r.speak.length, where).toBeGreaterThan(0);
      }
    }
  });

  it('never says "I have control" in a limit line (the runner says it first)', () => {
    for (const l of SYLLABUS) for (const { t } of tasks(l)) for (const lim of t.limits ?? []) for (const x of texts(lim.cue)) expect(x).not.toMatch(/I have control/i);
  });
});

describe('the predicates and values compile and resolve', () => {
  const evalCtx = (frame: Record<string, SignalValue> = {}, vars: Record<string, number> = {}): EvalContext => {
    const tel = new Telemetry();
    Object.assign(tel.frame, frame);
    return {
      frame: tel.frame, signalDef: (id: SignalId) => tel.def(id), vars, aircraft: C172S, fieldElevFt: 394, standards: STANDARDS,
      authority: 'easa', standard: 'training', events: new TrainingBus(), stepMark: 0, stepT: 1, dt: 0.5, simT: 1, pilot: 'student',
      speechIdle: true, exerciseGrade: () => null,
    };
  };

  it('compiles every milestone and resolves every limit bound', () => {
    for (const l of SYLLABUS) {
      const vars = Object.fromEntries(l.flow.flatMap((p) => p.steps).flatMap((s) => (s.kind === 'capture' ? Object.keys(s.vars) : [])).map((k) => [k, 3500]));
      const c = evalCtx({}, vars);
      for (const { t } of tasks(l)) {
        for (const m of t.feedback?.milestones ?? []) expect(() => compile(m.when).eval(c), `${l.id}/${t.id}.${m.id}`).not.toThrow();
        for (const lim of t.limits ?? []) {
          for (const r of [lim.min, lim.max]) if (r !== undefined) expect(Number.isFinite(resolveRef(r, c)), `${l.id}/${t.id}.${lim.id}`).toBe(true);
        }
      }
    }
  });

  describe('L01 detects the rudder from the yaw itself, not only the ball', () => {
    const yawTask = tasks(lesson('L01')).find(({ t }) => t.id === 'yaw')!.t;
    const yawed = yawTask.criteria.find((c) => c.id === 'yawed')!.pred!;
    /** Run the check for `s` seconds on a steady frame. */
    const run = (frame: Record<string, SignalValue>, s: number): boolean => {
      const p = compile(yawed);
      const c = evalCtx({ ball: 0, driftDeg: 0, turnRate: 0, rudder: 0, ...frame });
      let out = false;
      for (let t = 0; t < s; t += 0.5) out = p.eval(c);
      return out;
    };
    it('the ball half way out', () => expect(run({ ball: 0.55 }, 0.5)).toBe(true));
    it('a sideslip beyond 4 degrees held 1 s, with the ball barely moving', () => expect(run({ ball: 0.2, driftDeg: -5 }, 1.5)).toBe(true));
    it('a yaw rate beyond 3 deg/s with the rudder in, held 1 s', () => expect(run({ ball: 0.2, turnRate: -1.3, rudder: -0.5 }, 1.5)).toBe(true));
    it('not a turn on aileron alone', () => expect(run({ ball: 0.05, turnRate: 1.2, rudder: 0 }, 3)).toBe(false));
    it('not a moment\'s flicker', () => expect(run({ driftDeg: 5 }, 0.5)).toBe(false));
    it('the goal uses the same evidence', () => expect(JSON.stringify(yawTask.goal)).toContain(JSON.stringify(yawed)));
  });
});

describe('only the lessons that ask for it talk', () => {
  it('the skill test, the pre-solo check and the solo have no running commentary and no limits', () => {
    for (const id of ['L13', 'L14', 'L21']) {
      for (const { t } of tasks(lesson(id))) {
        expect(t.feedback, `${id}/${t.id}`).toBeUndefined();
        expect(t.limits, `${id}/${t.id}`).toBeUndefined();
      }
    }
  });

  it('L09-L20 dual lessons talk too, more lightly', () => {
    for (const id of ['L09', 'L10', 'L11', 'L12', 'L15', 'L16', 'L17', 'L18', 'L19', 'L20']) {
      const talking = tasks(lesson(id)).filter(({ t }) => t.feedback?.start || t.feedback?.milestones?.length);
      expect(talking.length, id).toBeGreaterThan(0);
    }
  });
});

describe('stage-1 coach presets speak sooner', () => {
  const card = { title: 'x', targets: [{ label: 'IAS', sig: 'asiKt' as SignalId, value: 100, tol: 10, unit: 'kt' }] };

  it('tunes the threshold and the persistence', () => {
    const base = bindPreset('speed', card)!;
    const tuned = bindPreset('speed', card, AB_INITIO_TUNING)!;
    expect(tuned.afterS).toBeLessThan(base.afterS);
    const tol = (r: CoachRule): number => ((r.when as { not: { tol: number } }).not.tol);
    expect(tol(tuned)).toBeLessThan(tol(base));
  });

  it('every stage-1 preset is bound and tuned; later lessons keep the plain presets', () => {
    for (const id of STAGE1_IDS) {
      for (const { t } of tasks(lesson(id))) for (const c of t.coach ?? []) {
        if (typeof c === 'string') expect(bindPreset(c, t.card), `${id}/${t.id}: '${c}' binds to nothing`).toBeNull();
        else if (c.correcting) expect(c.afterS, `${id}/${t.id}.${c.id}`).toBeLessThanOrEqual(AB_INITIO_TUNING.afterS!);
      }
    }
    expect(tasks(lesson('L10')).some(({ t }) => (t.coach ?? []).some((c) => typeof c === 'string'))).toBe(true);
  });
});

describe('the linter checks feedback and limits', () => {
  const mutate = (fn: (t: TaskStep) => void): string[] => {
    const l = JSON.parse(JSON.stringify(lesson('L03'))) as Lesson;
    fn(tasks(l).find(({ t }) => t.feedback?.milestones)!.t);
    return validateLesson(l, ctx).filter((i) => i.severity === 'error').map((i) => i.message);
  };
  it('lints clean as written', () => {
    for (const id of STAGE1_IDS) expect(validateLesson(lesson(id), ctx).map((i) => `${i.path}: ${i.message}`)).toEqual([]);
  });
  it('an unknown signal in a milestone', () => expect(mutate((t) => { t.feedback!.milestones![0].when = { sig: 'nope' as SignalId, op: '>', v: 1 }; }).join()).toMatch(/unknown signal 'nope'/));
  it('a line over 20 words', () => expect(mutate((t) => { t.feedback!.start = { text: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone.' }; }).join()).toMatch(/words/));
  it('duplicate milestone ids', () => expect(mutate((t) => { t.feedback!.milestones![1].id = t.feedback!.milestones![0].id; }).join()).toMatch(/duplicate milestone/));
  it('a limit with no bound', () => expect(mutate((t) => { t.limits = [{ id: 'x', sig: 'aiBankDeg', cue: { text: 'Too much.' } }]; }).join()).toMatch(/needs min or max/));
  it('a limit on an unknown run variable', () => expect(mutate((t) => { t.limits = [{ id: 'x', sig: 'altFt', min: { var: 'nope' }, cue: { text: 'Low.' } }]; }).join()).toMatch(/unknown run variable 'nope'/));
});
