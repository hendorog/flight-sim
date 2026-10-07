// Module 6 (content): the syllabus is data, and the linter is what makes data safe. These tests
//   1. lint every lesson, the N1 rating and every challenge against the real registries (telemetry signals,
//      the C172S profile and checklists, the demo scripts and their start variables, the line table): zero
//      issues, warnings included;
//   2. prove the linter catches each class of mistake it exists for, one mutation at a time;
//   3. pin the syllabus shape of section 4 (order, prerequisites, kinds, personas, awards, standards);
//   4. check the line table (20 words, briefing summaries per sentence, no orphan lines);
//   5. check the weather presets and their seeded sampling, and the weather line;
//   6. survey the navigation route against the terrain and re-solve its nav log;
//   7. run the data through the other modules' real code: every predicate compiles and evaluates, every value
//      and tolerance resolves, every line renders through the phraseology module with nothing left over.

import { describe, expect, it } from 'vitest';
import { C172S } from '../../src/training/aircraft/c172s';
import { getAircraftType, SCHOOL_AIRCRAFT } from '../../src/training/aircraft/registry';
import { DEMO_START_VARS, DEMOS } from '../../src/training/content/demos';
import { LINES } from '../../src/training/content/lines';
import { CHALLENGES, lessonById, RATINGS, STAGE1, STAGE2, STAGE3, STAGE4, SYLLABUS } from '../../src/training/content/syllabus/index';
import { cruiseWind, DIVERSION, NAV_ROUTE, ROUTE_ALT_FT, tasFor, WAYPOINTS, courseTo, windTriangle } from '../../src/training/content/syllabus/route';
import { countWords, lintLine, MAX_LINE_WORDS, validateLesson, validateLines, validateSyllabus, type LintContext } from '../../src/training/content/validate';
import { buildWeather, WEATHER_PRESETS, weatherLine } from '../../src/training/content/weatherPresets';
import { Telemetry } from '../../src/training/telemetry/telemetry';
import type { InlineCue, Lesson, LintIssue, StepDef, TaskStep } from '../../src/training/types';
import { defaultWeather } from '../../src/core/types';
import { terrainHeight } from '../../src/world/terrain/heightfield';
import { TrainingBus } from '../../src/training/engine/bus';
import { compile } from '../../src/training/engine/predicates';
import { resolveRef, resolveTol } from '../../src/training/engine/refs';
import { STANDARDS } from '../../src/training/grading/standards';
import { render } from '../../src/training/speech/phraseology';
import type { EvalContext, Pred, Ref, SignalId, TolRef } from '../../src/training/types';

const ctx: LintContext = { signals: new Telemetry().defs(), lines: LINES, demos: DEMOS, aircraft: SCHOOL_AIRCRAFT.map((id) => getAircraftType(id)), demoVars: DEMO_START_VARS };
const ALL_LESSONS: Lesson[] = [...SYLLABUS, ...CHALLENGES.map((c) => c.lesson)];
const fmt = (issues: readonly LintIssue[]): string => issues.map((i) => `${i.severity} ${i.lessonId} ${i.path}: ${i.message}`).join('\n');

/** A deep copy to mutate: lessons are plain JSON (section 2), so a JSON round trip is exact. */
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const allSteps = (l: Lesson): StepDef[] => l.flow.flatMap((p) => p.steps);
const firstTask = (l: Lesson): TaskStep => allSteps(l).find((s): s is TaskStep => s.kind === 'task')!;
const errors = (issues: readonly LintIssue[]): LintIssue[] => issues.filter((i) => i.severity === 'error');
const lintMutated = (id: string, mutate: (l: Lesson) => void): LintIssue[] => {
  const l = copy(lessonById(id)!);
  mutate(l);
  return validateLesson(l, ctx);
};
const expectError = (issues: readonly LintIssue[], pattern: RegExp): void => {
  expect(errors(issues).some((i) => pattern.test(i.message)), `expected an error matching ${pattern}, got:\n${fmt(issues)}`).toBe(true);
};

// =============================================================================================================

describe('the linter passes for every lesson', () => {
  it('lints the whole course, the rating and the challenges with no issues', () => {
    const issues = validateSyllabus(ALL_LESSONS, ctx);
    expect(fmt(issues)).toBe('');
  });

  it.each(ALL_LESSONS.map((l) => [l.id, l] as const))('%s lints clean on its own', (_id, l) => {
    expect(fmt(validateLesson(l, ctx))).toBe('');
  });

  it('is plain JSON: a round trip changes nothing (resume, export and the linter rely on it)', () => {
    for (const l of ALL_LESSONS) expect(copy(l)).toEqual(l);
  });
});

describe('the linter catches each class of mistake', () => {
  it('unknown signal', () => expectError(lintMutated('L03', (l) => { firstTask(l).goal = { sig: 'altitudeFt' as never, op: '>', v: 1 }; }), /unknown signal 'altitudeFt'/));
  it('unknown run variable', () => expectError(lintMutated('L03', (l) => { firstTask(l).criteria[0].target = { var: 'nope' }; }), /unknown run variable 'nope'/));
  it('unknown cue id', () => expectError(lintMutated('L03', (l) => { firstTask(l).brief = 'L03.noSuchLine'; }), /unknown cue id 'L03.noSuchLine'/));
  it('unknown template name in a cue', () => expectError(lintMutated('L03', (l) => { firstTask(l).brief = { text: 'Climb to {nowhere:alt}.' }; }), /'nowhere' is not a cue var/));
  it('unknown template format', () => expectError(lintMutated('L03', (l) => { firstTask(l).brief = { text: 'Climb to {altFt:metres}.' }; }), /unknown template format 'metres'/));
  it('unknown demo script', () => expectError(lintMutated('L04', (l) => {
    const d = allSteps(l).find((s) => s.kind === 'demo')!;
    if (d.kind === 'demo') d.script = 'noSuchDemo';
  }), /unknown demo script 'noSuchDemo'/));
  it('a demo script reading a variable the lesson never captures', () => expectError(validateLesson({ ...copy(lessonById('L03')!), flow: [{ id: 'x', title: 'x', steps: [
    { kind: 'demo', id: 'd', script: { id: 'inline', segments: [{ kind: 'ap', ap: { altFt: { var: 'alt9' } }, until: { const: true }, timeoutS: 5 }] } },
    { kind: 'end', id: 'e' }] }], exercises: [] }, ctx), /unknown run variable 'alt9'/));
  it('an until segment without a timeout', () => expectError(validateLesson({ ...copy(lessonById('L03')!), flow: [{ id: 'x', title: 'x', steps: [
    { kind: 'demo', id: 'd', script: { id: 'inline', segments: [{ kind: 'ap', ap: {}, until: { const: true }, timeoutS: 0 }] } },
    { kind: 'end', id: 'e' }] }], exercises: [] }, ctx), /positive timeoutS/));
  it('unknown checklist', () => expectError(lintMutated('L02', (l) => {
    const c = allSteps(l).find((s) => s.kind === 'checklist')!;
    if (c.kind === 'checklist') c.checklist = 'preflightInspection';
  }), /checklist 'preflightInspection' is not defined/));
  it('unknown V-speed', () => expectError(lintMutated('L03', (l) => { firstTask(l).criteria[2].target = { vspeed: 'Vzz' as never }; }), /V-speed 'Vzz'/));
  it('unknown setting', () => expectError(lintMutated('L04', (l) => { l.briefing.numbers[5].value = { setting: 'idleRpm' as never }; }), /setting 'idleRpm'/));
  it('unknown tolerance key', () => expectError(lintMutated('L03', (l) => { firstTask(l).criteria[0].tol = 'altitudes' as never; }), /unknown tolerance key 'altitudes'/));
  it('unknown coach preset', () => expectError(lintMutated('L03', (l) => { firstTask(l).coach = ['nagging' as never]; }), /unknown coach preset 'nagging'/));
  it('unknown event and event field', () => {
    expectError(lintMutated('L09', (l) => { firstTask(l).goal = { event: 'touchDown' as never }; }), /unknown event 'touchDown'/);
    expectError(lintMutated('L09', (l) => { firstTask(l).goal = { event: 'landing', where: { sink: [0, 300] } }; }), /'landing' has no field 'sink'/);
    expectError(lintMutated('L09', (l) => { firstTask(l).goal = { event: 'landing', where: { onRunway: [0, 1] } }; }), /'onRunway' is a boolean/);
  });
  it('atEvent on a field the event does not have', () => expectError(lintMutated('L09', (l) => {
    const c = firstTask(l).criteria.find((x) => x.kind === 'atEvent')!;
    c.field = 'sinkRate';
  }), /'sinkRate' is not a numeric field of 'landing'/));
  it('eq against a signal of the wrong kind', () => expectError(lintMutated('L03', (l) => { firstTask(l).goal = { sig: 'onGround', eq: 1 }; }), /'onGround' is a bool signal/));
  it('goto to a step or phase that does not exist', () => {
    expectError(lintMutated('L03', (l) => { firstTask(l).onTimeout = { goto: 'nowhere' }; }), /goto target step 'nowhere'/);
    expectError(lintMutated('L03', (l) => { firstTask(l).onTimeout = { goto: 'phase:nowhere' }; }), /goto target phase 'nowhere'/);
  });
  it('unreachable phase after an unconditional end', () => expectError(lintMutated('L03', (l) => {
    l.flow[0].steps.push({ kind: 'end', id: 'early' });
  }), /phase 'cruise' is unreachable/));
  it('a phase reached only by a goto into one of its steps is reachable; one reached by nothing is not', () => {
    // demo -> branch (no fall-through) -> cruise (else) -> end; slow only via the goto to its first step.
    const reached = lintMutated('L03', (l) => {
      l.flow[0].steps.push({ kind: 'branch', id: 'jump', cases: [{ when: { const: false }, goto: 'reposS' }], else: 'phase:cruise' });
      l.flow[1].steps.push({ kind: 'end', id: 'stop' });
    });
    expect(errors(reached).filter((i) => /unreachable/.test(i.message))).toEqual([]);
    const orphan = lintMutated('L03', (l) => {
      l.flow[0].steps.push({ kind: 'branch', id: 'jump', cases: [], else: 'phase:cruise' });
      l.flow[1].steps.push({ kind: 'end', id: 'stop' });
    });
    expect(errors(orphan).filter((i) => /unreachable/.test(i.message)).map((i) => i.path)).toEqual(['flow.slow', 'flow.assessed']);
  });
  it('an exercise no task scores', () => expectError(lintMutated('L03', (l) => {
    l.exercises.push({ id: 'ghost', title: 'Ghost', skill: 'straightLevel', mode: 'practice', standard: 'training', required: false, weight: 1 });
  }), /'ghost' is not scored by any task/));
  it('a task scoring an unknown exercise', () => expectError(lintMutated('L03', (l) => { firstTask(l).exercise = 'ghost'; }), /unknown exercise 'ghost'/));
  it('a task or a wait without a timeout', () => {
    expectError(lintMutated('L03', (l) => { delete firstTask(l).timeoutS; }), /every task needs a timeoutS/);
    expectError(lintMutated('L12', (l) => {
      const w = allSteps(l).find((s) => s.kind === 'wait')!;
      delete w.timeoutS;
    }), /every wait step needs a timeoutS/);
  });
  it('a required exercise without a required criterion', () => expectError(lintMutated('L03', (l) => {
    for (const s of allSteps(l)) if (s.kind === 'task' && s.exercise === 'assessedSL') s.criteria.forEach((c) => { c.required = false; });
  }), /required exercise 'assessedSL' has no required criterion/));
  it('a criterion missing the fields its kind needs', () => {
    expectError(lintMutated('L03', (l) => { delete firstTask(l).criteria[0].tol; }), /needs a tolerance/);
    expectError(lintMutated('L03', (l) => { firstTask(l).criteria.push({ id: 'chk', label: 'Check', kind: 'check', required: false }); }), /needs a pred/);
  });
  it('a lesson without an end step', () => expectError(lintMutated('L03', (l) => {
    for (const p of l.flow) p.steps = p.steps.filter((s) => s.kind !== 'end');
  }), /no end step/));
  it('duplicate step ids', () => expectError(lintMutated('L03', (l) => { l.flow[1].steps[0].id = l.flow[0].steps[0].id; }), /duplicate step id/));
  it('instructor saves in a solo lesson', () => expectError(lintMutated('L14', (l) => { l.rules.instructorSaves = true; }), /saves must be off/));
  it('a v1 wind that is not into wind for runway 07', () => expectError(lintMutated('L03', (l) => { l.weather = { preset: 'light', windDirDeg: [250, 290] }; }), /040-160/));
  it('nav signals without a route', () => expectError(lintMutated('L20', (l) => { delete l.route; }), /nav\.\* signals but has no route/));
  it('a debrief tip for a criterion that does not exist, or a pattern that does not', () => {
    expectError(lintMutated('L03', (l) => { l.debriefTips = { 'nothing.biasHigh': 'x' }; }), /no criterion 'nothing'/);
    expectError(lintMutated('L03', (l) => { l.debriefTips = { 'aSLAlt.wobbly': 'x' }; }), /unknown pattern 'wobbly'/);
  });
  it('a briefing key that is neither an input action nor a training key', () => expectError(lintMutated('L03', (l) => { l.briefing.keys.push('selfDestruct'); }), /unknown key id 'selfDestruct'/));
  it('a flap setting that is not a detent', () => expectError(lintMutated('L09', (l) => { l.start = { kind: 'final', distNm: 3, kias: 75, flapsDeg: 15 }; }), /flap 15° is not a detent/));
  it('unknown area, ground spot and weather preset', () => {
    expectError(lintMutated('L03', (l) => { l.start = { kind: 'air', at: 'mountains' as never, altFt: 3500, altRef: 'msl', hdgDeg: 200, kias: 100 }; }), /unknown area 'mountains'/);
    expectError(lintMutated('L02', (l) => { l.start = { kind: 'ground', spot: 'hangar' as never, engine: 'cold' }; }), /unknown ground spot 'hangar'/);
    expectError(lintMutated('L03', (l) => { l.weather = { preset: 'hurricane' as never }; }), /unknown weather preset 'hurricane'/);
  });
  it('prerequisites that do not exist, or form a cycle', () => {
    const a = copy(lessonById('L03')!);
    const b = copy(lessonById('L04')!);
    a.requires = ['L04'];
    b.requires = ['L03', 'L99'];
    const issues = validateSyllabus([a, b], ctx);
    expectError(issues, /unknown prerequisite 'L99'/);
    expectError(issues, /prerequisite cycle/);
  });
  it('a line over 20 words, a malformed template, and variant counts that do not match', () => {
    const long: InlineCue = { text: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone' };
    expect(lintLine(long, { longForm: false }).join()).toMatch(/21 words/);
    expect(lintLine({ text: 'Turn onto {hdg:hdg.' }, { longForm: false }).join()).toMatch(/malformed template/);
    expect(lintLine({ text: ['a', 'b'], speak: ['a'] }, { longForm: false }).join()).toMatch(/1 speak variants for 2 text variants/);
    const issues = validateLines({ 'x.too.long': long, 'runner.override': { text: 'You have the {gizmo}.' } });
    expect(issues.map((i) => i.path).sort()).toEqual(['runner.override', 'x.too.long']);
  });
});

// =============================================================================================================

describe('the syllabus of section 4', () => {
  it('runs L01-L21 in order, then N1', () => {
    expect(SYLLABUS.map((l) => l.id)).toEqual([...Array.from({ length: 21 }, (_, i) => `L${String(i + 1).padStart(2, '0')}`), 'N1']);
    expect(SYLLABUS.slice(0, 21).map((l) => l.number)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    expect([...STAGE1, ...STAGE2, ...STAGE3, ...STAGE4, ...RATINGS]).toEqual(SYLLABUS);
    expect(STAGE1.every((l) => l.stage === 'handling')).toBe(true);
    expect(STAGE2.every((l) => l.stage === 'circuits')).toBe(true);
    expect(STAGE3.every((l) => l.stage === 'advanced')).toBe(true);
    expect(STAGE4.map((l) => l.stage)).toEqual(['navigation', 'test']);
  });

  it('has the prerequisites of section 4.2', () => {
    const req = Object.fromEntries(SYLLABUS.map((l) => [l.id, [...l.requires].sort()]));
    expect(req.L01).toEqual([]);
    for (let n = 2; n <= 14; n++) expect(req[`L${String(n).padStart(2, '0')}`]).toEqual([`L${String(n - 1).padStart(2, '0')}`]);
    for (const id of ['L15', 'L16', 'L17', 'L18', 'L19']) expect(req[id]).toEqual(['L14']);
    expect(req.L20).toEqual(['L15', 'L16', 'L17', 'L18', 'L19']);
    expect(req.L21).toEqual(['L20']);
    expect(req.N1).toEqual(['L14']);
    expect(lessonById('N1')!.requiredFor).toEqual(['faa']);
  });

  it('has the right kinds, personas, saves and awards', () => {
    const kinds = Object.fromEntries(SYLLABUS.map((l) => [l.id, l.kind]));
    expect(kinds.L13).toBe('check');
    expect(kinds.L14).toBe('solo');
    expect(kinds.L21).toBe('test');
    expect(SYLLABUS.filter((l) => l.kind === 'dual').map((l) => l.id)).toHaveLength(19);
    expect(lessonById('L21')!.persona).toBe('examiner');
    expect(SYLLABUS.filter((l) => l.persona === 'examiner').map((l) => l.id)).toEqual(['L21']);
    expect(lessonById('L13')!.rules.instructorSaves).toBe(true);
    for (const id of ['L14', 'L21']) expect(lessonById(id)!.rules.instructorSaves).toBe(false);
    for (const c of CHALLENGES) expect(c.lesson.rules.instructorSaves).toBe(false);
    expect(lessonById('L14')!.awards).toEqual([{ id: 'firstSolo', when: 'competent', title: 'First solo' }]);
    expect(lessonById('L21')!.awards).toEqual([{ id: 'ppl', when: 'testPass', title: 'Private Pilot Licence' }]);
  });

  it('grades assessed exercises at the test standard and practice at the training standard', () => {
    for (const l of SYLLABUS) {
      for (const e of l.exercises) {
        if (e.mode === 'practice') expect(e.standard, `${l.id} ${e.id}`).toBe('training');
        if (e.mode === 'demo') expect(e.required, `${l.id} ${e.id}`).toBe(false);
      }
      expect(l.exercises.some((e) => e.required), `${l.id} has a required exercise`).toBe(true);
    }
    // L01, L02 and the first solo are graded at the training standard (section 4.1: "(T)").
    for (const id of ['L01', 'L02', 'L14']) expect(lessonById(id)!.exercises.filter((e) => e.required).every((e) => e.standard === 'training'), id).toBe(true);
  });

  it('puts every skill-test exercise in a section, and covers all five', () => {
    const l21 = lessonById('L21')!;
    expect(l21.exercises.every((e) => e.testSection !== undefined && e.required && e.standard === 'test')).toBe(true);
    expect(new Set(l21.exercises.map((e) => e.testSection))).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it('works the training area at or above 3,500 ft, with long legs on low-terrain headings', () => {
    for (const l of ALL_LESSONS) {
      const starts = [l.start, ...allSteps(l).flatMap((s) => (s.kind === 'setup' && s.reposition ? [s.reposition] : [])), ...l.flow.flatMap((p) => (p.retryFrom ? [p.retryFrom] : []))];
      for (const s of starts) {
        if (s.kind !== 'air' || s.at !== 'trainingArea') continue;
        expect(s.altFt, l.id).toBeGreaterThanOrEqual(3500);
        expect([100, 200], `${l.id} heading ${s.hdgDeg}`).toContain(s.hdgDeg);
      }
    }
  });

  it('flies every ground and circuit phase as low level (the minimum-height rule is off there)', () => {
    const lowStarts = new Set(['ground', 'final', 'circuit']);
    for (const l of ALL_LESSONS) {
      for (const p of l.flow) {
        const repositions = p.steps.flatMap((s) => (s.kind === 'setup' && s.reposition ? [s.reposition.kind] : []));
        const isFirst = p === l.flow[0];
        const low = repositions.some((k) => lowStarts.has(k)) || (isFirst && lowStarts.has(l.start.kind));
        if (low) expect(p.lowLevel, `${l.id} ${p.id}`).toBe(true);
      }
    }
  });

  it('finds challenge lessons by id too, and unlocks them from course lessons', () => {
    for (const c of CHALLENGES) {
      expect(lessonById(c.lesson.id)).toBe(c.lesson);
      expect(lessonById(c.unlockedBy)).toBeDefined();
    }
    expect(CHALLENGES.map((c) => [c.id, c.unlockedBy, c.scoring])).toEqual([
      ['spotLanding', 'L09', 'spotLanding'], ['deadStick', 'L16', 'deadStick'],
      ['crosswindMaster', 'L17', 'crosswindMaster'], ['precisionCircuit', 'L10', 'precisionCircuit'],
    ]);
  });
});

// =============================================================================================================

describe('the line table', () => {
  const briefingIds = new Set(ALL_LESSONS.map((l) => l.briefing.spoken).filter((s): s is string => typeof s === 'string'));
  const variants = (c: InlineCue): string[] => [...[c.text].flat(), ...(c.speak === undefined ? [] : [c.speak].flat())];

  it('keeps every line to 20 words (briefing summaries: every sentence)', () => {
    for (const [id, line] of Object.entries(LINES)) {
      for (const t of variants(line)) {
        const units = briefingIds.has(id) ? t.split(/(?<=[.!?])\s+/) : [t];
        for (const u of units) expect(countWords(u), `${id}: "${u}"`).toBeLessThanOrEqual(MAX_LINE_WORDS);
      }
    }
  });

  it('gives every lesson briefing a 30-45 s summary, and every challenge a short one', () => {
    // 2.7 words a second plus the sentence gaps: 70-120 words is 30-45 s spoken (section 2.9).
    for (const l of SYLLABUS) {
      const words = countWords([LINES[l.briefing.spoken as string].text].flat()[0]);
      expect(words, l.id).toBeGreaterThanOrEqual(70);
      expect(words, l.id).toBeLessThanOrEqual(120);
    }
    // A challenge briefing only restates the scoring (choice recorded in the module report).
    for (const c of CHALLENGES) expect(countWords([LINES[c.lesson.briefing.spoken as string].text].flat()[0]), c.id).toBeGreaterThanOrEqual(25);
  });

  it('counts a template as one word', () => {
    expect(countWords('Climb to {alt:alt} at {vspeed.Vy:kt}. Lookout first.')).toBe(7);
    expect(countWords('Hold it off... hold it off.')).toBe(6);
  });

  it('has no orphan lines: every line is spoken by a lesson, a challenge or a demo script', () => {
    const used = new Set<string>();
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) { x.forEach(walk); return; }
      if (typeof x === 'string') { if (x in LINES) used.add(x); return; }
      if (x && typeof x === 'object') {
        for (const [k, v] of Object.entries(x)) {
          if ((k === 'script' || k === 'demo') && typeof v === 'string' && DEMOS[v]) walk(DEMOS[v]);
          walk(v);
        }
      }
    };
    walk(ALL_LESSONS);
    // limit.teach.<limitId>: spoken by the runner after a lesson-limit intervention, keyed by the limit's id.
    const limitIds = new Set(ALL_LESSONS.flatMap((l) => l.flow.flatMap((p) => p.steps)).flatMap((s) => (s.kind === 'task' ? (s.limits ?? []).map((x) => x.id) : [])));
    for (const id of Object.keys(LINES)) if (id.startsWith('limit.teach.') && limitIds.has(id.slice('limit.teach.'.length))) used.add(id);
    expect(Object.keys(LINES).filter((id) => !used.has(id))).toEqual([]);
  });

  it('voices the skill test as the examiner and the student never', () => {
    for (const [id, line] of Object.entries(LINES)) {
      if (id.startsWith('L21.')) expect(line.actor, id).toBe('examiner');
      expect(line.actor, id).not.toBe('student');
    }
  });
});

// =============================================================================================================

describe('weather presets', () => {
  const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length]; };

  it('defines all nine presets with v1 winds into runway 07', () => {
    expect(Object.keys(WEATHER_PRESETS).sort()).toEqual(['calm', 'gusty', 'hazy', 'imc', 'light', 'night', 'smooth', 'xwind10', 'xwind15']);
    for (const p of Object.values(WEATHER_PRESETS)) {
      const dirs = p.ranges?.windDirDeg ?? [p.settings.windDirectionDeg!, p.settings.windDirectionDeg!];
      expect(dirs[0], p.id).toBeGreaterThanOrEqual(40);
      expect(dirs[1], p.id).toBeLessThanOrEqual(160);
    }
  });

  it('applies the section 2.8 values', () => {
    const base = defaultWeather();
    const mid = () => 0.5;
    const w = (id: keyof typeof WEATHER_PRESETS) => buildWeather({ preset: id }, base, mid);
    expect(w('calm').windSpeedKt).toBeLessThanOrEqual(3);
    expect(w('calm').turbulence).toBe(0.03);
    expect(w('calm').cloudCover).toBe(0.2);
    expect(w('smooth')).toMatchObject({ windSpeedKt: 5, turbulence: 0.05 });
    expect(w('light')).toMatchObject({ windDirectionDeg: 90, windSpeedKt: 7, turbulence: 0.1, cloudCover: 0.35 });
    expect(w('xwind10')).toMatchObject({ windDirectionDeg: 160, windSpeedKt: 10, gustKt: 14 });
    expect(w('xwind15')).toMatchObject({ windDirectionDeg: 160, windSpeedKt: 13, gustKt: 17 });
    expect(w('gusty')).toMatchObject({ windDirectionDeg: 90, windSpeedKt: 12, gustKt: 20 });
    expect(w('hazy').visibilityM).toBe(6000);
    expect(w('night')).toMatchObject({ timeOfDay: 21.5, cloudCover: 0 });
    expect(w('imc')).toMatchObject({ cloudCover: 1, cloudBaseM: 600, visibilityM: 1500 });
    // Daytime lessons fly at a fixed time of day, whatever the player's own weather was.
    expect(buildWeather({ preset: 'light' }, { ...base, timeOfDay: 23 }, mid).timeOfDay).toBe(9.5);
  });

  it('samples ranges from the seeded source, deterministically, lesson ranges over preset ranges', () => {
    const base = defaultWeather();
    const a = buildWeather({ preset: 'light' }, base, seq(0.1, 0.9, 0.5, 0.5));
    const b = buildWeather({ preset: 'light' }, base, seq(0.1, 0.9, 0.5, 0.5));
    expect(a).toEqual(b);
    expect(a.windDirectionDeg).toBe(74);
    expect(a.windSpeedKt).toBeCloseTo(8.6, 5);
    const c = buildWeather({ preset: 'calm', windDirDeg: [40, 100], windKt: [0, 6] }, base, seq(1, 1, 0, 0));
    expect(c.windDirectionDeg).toBe(100);
    expect(c.windSpeedKt).toBe(6);
    // Adding a gust range does not reshuffle the direction and speed drawn for the same seed.
    const d = buildWeather({ preset: 'light', gustKt: [10, 12] }, base, seq(0.1, 0.9, 0.5, 0.5));
    expect([d.windDirectionDeg, d.windSpeedKt]).toEqual([a.windDirectionDeg, a.windSpeedKt]);
    expect(d.gustKt).toBe(11);
  });

  it('applies overrides last, never leaves a gust below the mean wind, and wraps direction ranges', () => {
    const base = defaultWeather();
    expect(buildWeather({ preset: 'xwind15', override: { gustKt: 23 } }, base, () => 0.5).gustKt).toBe(23);
    expect(buildWeather({ preset: 'xwind10', windKt: [16, 16] }, base, () => 0.5).gustKt).toBe(16);
    expect(buildWeather({ preset: 'light', windDirDeg: [340, 20] }, base, () => 0.75).windDirectionDeg).toBe(10);
    expect(() => buildWeather({ preset: 'tornado' as never }, base, () => 0)).toThrow(/unknown weather preset/);
  });

  it('writes the weather line', () => {
    const base = { ...defaultWeather(), windDirectionDeg: 92, windSpeedKt: 7.2, gustKt: 0, turbulence: 0.1, cloudCover: 0.35, cloudBaseM: 1500, visibilityM: 40000, timeOfDay: 9.5 };
    expect(weatherLine(base)).toBe('Wind 090/7, SCT 4,900 ft, turbulence light, 09:30');
    expect(weatherLine({ ...base, cloudBaseM: 1800, turbulence: 0.03 })).toBe('Wind 090/7, CAVOK, 09:30');
    expect(weatherLine({ ...base, windSpeedKt: 0.4 })).toMatch(/^Wind calm, /);
    expect(weatherLine({ ...base, windDirectionDeg: 160, windSpeedKt: 13, gustKt: 17 })).toMatch(/^Wind 160\/13G17, /);
    expect(weatherLine({ ...base, windDirectionDeg: 3 })).toMatch(/^Wind 360\/7/);
    expect(weatherLine({ ...base, visibilityM: 1500, cloudCover: 1, cloudBaseM: 600, timeOfDay: 21.5 })).toBe('Wind 090/7, visibility 1,500 m, OVC 2,000 ft, turbulence light, 21:30');
    expect(weatherLine({ ...base, visibilityM: 6000 })).toMatch(/visibility 6 km, SCT 4,900 ft/);
  });
});

// =============================================================================================================

describe('the navigation route (L20, L21)', () => {
  const FT = 0.3048;
  const NM = 1852;
  /** Highest terrain within `halfWidthM` of the straight line a -> b, ft MSL (sampled every 150 m). */
  const corridorMaxFt = (a: { north: number; east: number }, b: { north: number; east: number }, halfWidthM = NM): number => {
    const len = Math.hypot(b.north - a.north, b.east - a.east);
    const un = (b.north - a.north) / len;
    const ue = (b.east - a.east) / len;
    let max = -Infinity;
    for (let s = 0; s <= len; s += 150) {
      for (let x = -halfWidthM; x <= halfWidthM; x += 150) max = Math.max(max, terrainHeight(a.north + un * s - ue * x, a.east + ue * s + un * x));
    }
    return max / FT;
  };

  it('clears the terrain by 1,000 ft within 1 NM of every leg and of the diversion', () => {
    const w = NAV_ROUTE.waypoints;
    for (let i = 0; i < w.length - 1; i++) expect(corridorMaxFt(w[i], w[i + 1]), `leg ${i + 1}`).toBeLessThanOrEqual(ROUTE_ALT_FT - 1000);
    const mid = { north: (WAYPOINTS.foothillLake.north + WAYPOINTS.valleyLake.north) / 2, east: (WAYPOINTS.foothillLake.east + WAYPOINTS.valleyLake.east) / 2 };
    expect(corridorMaxFt(mid, WAYPOINTS.glacialLake)).toBeLessThanOrEqual(ROUTE_ALT_FT - 1000);
  });

  it('places the waypoints on water and the town on its site', () => {
    // Lakes sit in basins: the surface at the centre is well below the surrounding hills and nearly flat.
    for (const p of [WAYPOINTS.foothillLake, WAYPOINTS.valleyLake, WAYPOINTS.glacialLake]) {
      const c = terrainHeight(p.north, p.east);
      expect(Math.abs(terrainHeight(p.north + 200, p.east) - c), p.id).toBeLessThan(0.5);
    }
  });

  it('solves the nav log from the cruise wind', () => {
    const wind = cruiseWind();
    // The surface 100/9 veers and strengthens with height (boundaryLayer.ts): about 125/14 at cruise.
    expect(wind.dirDeg).toBeGreaterThan(115);
    expect(wind.dirDeg).toBeLessThan(135);
    expect(wind.kt).toBeGreaterThan(12);
    expect(wind.kt).toBeLessThan(17);
    const w = NAV_ROUTE.waypoints;
    for (let i = 0; i < w.length - 1; i++) {
      const { courseDeg, distNm } = courseTo(w[i], w[i + 1]);
      const { headingDeg, gsKt } = windTriangle(courseDeg, tasFor(105, ROUTE_ALT_FT), wind);
      expect(Math.abs(((NAV_ROUTE.legHeadingsDeg[i] - headingDeg + 540) % 360) - 180), `leg ${i + 1} heading`).toBeLessThanOrEqual(0.5);
      expect(NAV_ROUTE.legMinutes[i], `leg ${i + 1} time`).toBeCloseTo((distNm / gsKt) * 60, 1);
    }
    expect(DIVERSION.headingDeg).toBeGreaterThan(70);
    expect(DIVERSION.headingDeg).toBeLessThan(95);
    expect(DIVERSION.distNm).toBeGreaterThan(10);
  });

  it('solves the wind triangle like an E6B', () => {
    expect(windTriangle(90, 100, { dirDeg: 90, kt: 20 })).toEqual({ headingDeg: 90, gsKt: 80 });
    const x = windTriangle(0, 100, { dirDeg: 90, kt: 20 });
    expect(x.headingDeg).toBeCloseTo(11.54, 2);
    expect(x.gsKt).toBeCloseTo(97.98, 2);
    expect(courseTo({ north: 0, east: 0 }, { north: 0, east: NM })).toEqual({ courseDeg: 90, distNm: 1 });
  });

  it('closes the route on the field with unique waypoint ids, and L20/L21 share it', () => {
    const w = NAV_ROUTE.waypoints;
    expect([w[0].north, w[0].east]).toEqual([w[w.length - 1].north, w[w.length - 1].east]);
    expect(new Set(w.map((p) => p.id)).size).toBe(w.length);
    expect(lessonById('L20')!.route).toBe(NAV_ROUTE);
    expect(lessonById('L21')!.route).toBe(NAV_ROUTE);
  });
});

// =============================================================================================================

describe('the content runs through the engine modules', () => {
  /** Every Pred, Ref and TolRef in the lessons and the demo scripts they fly, found structurally. */
  const collect = () => {
    const preds: Pred[] = [];
    const refs: Ref[] = [];
    const tols: TolRef[] = [];
    const varNames = new Set<string>(DEMO_START_VARS);
    const PRED_KEYS = ['goal', 'when', 'until', 'failIf', 'pred', 'activeWhen', 'release', 'abortWhen'];
    const REF_KEYS = ['target', 'value', 'kias', 'near', 'v', 'hdgDeg', 'bankDeg', 'pitchDeg', 'vsFpm', 'altFt', 'to', 'belowKias'];
    const walk = (x: unknown, key = ''): void => {
      if (Array.isArray(x)) { x.forEach((y) => walk(y, key)); return; }
      if (!x || typeof x !== 'object') return;
      const o = x as Record<string, unknown>;
      if (o.kind === 'capture') for (const k of Object.keys(o.vars as object)) varNames.add(k);
      for (const [k, v] of Object.entries(o)) {
        if (PRED_KEYS.includes(k) && v && typeof v === 'object') preds.push(v as Pred);
        if (REF_KEYS.includes(k) && v !== undefined && (typeof v === 'number' || (typeof v === 'object' && v && !Array.isArray(v) && !('kind' in v)))) refs.push(v as Ref);
        if (k === 'tol' && v !== undefined) tols.push(v as TolRef);
        if ((k === 'script' || k === 'demo') && typeof v === 'string' && DEMOS[v]) walk(DEMOS[v]);
        walk(v, k);
      }
    };
    walk(ALL_LESSONS);
    return { preds, refs: refs.filter((r) => typeof r === 'number' || 'var' in r || 'vspeed' in r || 'setting' in r || 'field' in r || 'sig' in r), tols, varNames };
  };
  const { preds, refs, tols, varNames } = collect();

  const evalCtx = (): EvalContext => {
    const tel = new Telemetry();
    const vars = Object.fromEntries([...varNames].map((k) => [k, 1000]));
    return {
      frame: tel.frame, signalDef: (id: SignalId) => tel.def(id), vars, aircraft: C172S, fieldElevFt: 394, standards: STANDARDS,
      authority: 'easa', standard: 'test', events: new TrainingBus(), stepMark: 0, stepT: 1, dt: 0.1, simT: 1, pilot: 'student',
      speechIdle: true, exerciseGrade: () => null,
    };
  };

  it('finds the data it checks', () => {
    expect(preds.length).toBeGreaterThan(300);
    expect(refs.length).toBeGreaterThan(300);
    expect(tols.length).toBeGreaterThan(200);
  });

  it('compiles and evaluates every predicate (an unknown shape throws)', () => {
    const c = evalCtx();
    for (const p of preds) expect(() => compile(p).eval(c), JSON.stringify(p).slice(0, 120)).not.toThrow();
  });

  it('resolves every value to a finite number and every tolerance to a band, under both authorities', () => {
    for (const authority of ['easa', 'faa'] as const) {
      const c = { ...evalCtx(), authority };
      for (const r of refs) {
        if (typeof r === 'object' && 'sig' in r) continue;   // a signal reads NaN until the telemetry samples
        expect(Number.isFinite(resolveRef(r, c)), JSON.stringify(r)).toBe(true);
      }
      for (const standard of ['training', 'test'] as const) {
        for (const t of tols) {
          const band = resolveTol(t, { ...c, standard });
          expect(band.minus >= 0 && band.plus >= 0 && band.minus + band.plus > 0, JSON.stringify(t)).toBe(true);
        }
      }
    }
  });

  it('renders every line through the phraseology module with no template left over', () => {
    const lookup = (name: string): number | string => (/side/i.test(name) ? 'left' : /dir/.test(name) ? 'high' : 1234);
    for (const [id, line] of Object.entries(LINES)) {
      const texts = [line.text].flat();
      const speaks = line.speak === undefined ? texts.map(() => undefined) : [line.speak].flat();
      texts.forEach((t, i) => {
        const r = render(t, { lookup }, speaks[i] ?? (speaks.length === 1 ? speaks[0] : undefined));
        expect(r.caption, id).not.toMatch(/[{}?]/.test(t) ? /[{}]/ : /[{}?]/);
        expect(r.speak, id).not.toMatch(/[{}]/);
        expect(r.speak.length, id).toBeGreaterThan(0);
      });
    }
  });
});
