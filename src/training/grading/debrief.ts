// The debrief text (section 3.4): safety items, outcome line, strength, main point (with the lesson's
// debriefTips, the criterion advice, or a generic pattern tip) and next time; spoken part <= 25 s.
//
// Field mapping onto LessonResult.debrief: safety items lead `main` (they are the main point whenever they
// exist); the outcome line opens `spoken` (the screen shows the outcome as the header word instead).

import type { Criterion, CriterionResult, ExerciseResult, FaultRecord, Lesson, LessonResult, Pattern, TaskStep } from '../types';
import { devText, tolText, unitOf, withUnit } from './format';
import { isInsufficient } from './rules';

/** Spoken summary budget: about 25 s at the default rate (2.4 words per second). */
export const SPOKEN_MAX_WORDS = 60;
/** At most this many safety sentences lead the main point. */
const MAX_SAFETY = 2;

const OUTCOME_LINES: Record<LessonResult['outcome'], string> = {
  competent: "Competent. That's this lesson signed off.",
  notYet: "Not yet competent. We'll fly this one again.",
  incomplete: "We ran out of time before the end, so it's not complete.",
  abandoned: 'Lesson abandoned.',
  crashed: "That flight ended in a crash. Let's talk about why.",
  testPass: "That's a pass. Congratulations.",
  testPartial: "Partial pass. You'll retake one section.",
  testFail: "I'm afraid that's not a pass this time.",
};

/** Used when neither the lesson tips nor the criterion advice cover the pattern. */
export const GENERIC_TIPS: Record<Pattern, string> = {
  ok: 'Keep the scan going: small corrections, early.',
  biasHigh: 'You sat consistently above the target: set the attitude for it, then trim.',
  biasLow: 'You sat consistently below the target: set the attitude for it, then trim.',
  oscillation: 'You were chasing it. Set the attitude, hold it, wait a few seconds, then adjust.',
  drift: 'It drifted away slowly: trim properly and keep the scan going.',
  late: 'Anticipate: start the correction earlier and lead the target.',
};

/** Every criterion definition of the lesson, by id (rows of composite graders resolve to their parent). */
function criterionDefs(lesson: Lesson): Map<string, Criterion> {
  const m = new Map<string, Criterion>();
  for (const ph of lesson.flow) for (const st of ph.steps) if (st.kind === 'task') for (const c of (st as TaskStep).criteria) m.set(c.id, c);
  return m;
}

const defFor = (defs: Map<string, Criterion>, id: string): Criterion | undefined => defs.get(id) ?? defs.get(id.split('.')[0]);
const isGate = (c: CriterionResult): boolean => c.kind === 'check' || c.kind === 'binary';
const sentence = (s: string): string => {
  const t = s.trim();
  return t === '' ? t : /[.!?]$/.test(t) ? t : `${t}.`;
};
const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;
const lowerFirst = (s: string): string => (s ? s[0].toLowerCase() + s.slice(1) : s);

interface Row { c: CriterionResult; ex: ExerciseResult; weight: number }

function rowsOf(lesson: Lesson, exercises: readonly ExerciseResult[]): Row[] {
  const weight = new Map(lesson.exercises.map((e) => [e.id, e.weight]));
  const out: Row[] = [];
  for (const ex of exercises) {
    if (ex.mode === 'demo') continue;
    for (const c of ex.criteria) if (!isInsufficient(c)) out.push({ c, ex, weight: weight.get(ex.exerciseId) ?? 0 });
  }
  return out;
}

/** "Climb speed held within 4 kt." / "Touchdown point: 120 ft long, inside 0/+400 ft." / "Prompt recovery: done well." */
function strengthSentence(r: Row, defs: Map<string, Criterion>): string {
  const c = r.c;
  if (isGate(c) || !c.worst) return sentence(`${c.label}: well done`);
  const u = unitOf(defFor(defs, c.id)?.sig);
  if (c.kind === 'hold') return sentence(`${c.label} held within ${withUnit(Math.abs(c.worst.dev), u)}`);
  return sentence(`${c.label}: ${devText(c.worst.dev, u)}${c.tol ? `, inside ${tolText(c.tol, u)}` : ''}`);
}

/** The measured value against the tolerance: "Level-off overshoot: 160 ft high against ±150 ft." */
function quote(c: CriterionResult, defs: Map<string, Criterion>): string {
  if (isGate(c) || !c.worst || !c.tol) return sentence(`${c.label}: ${lowerFirst(c.detail)}`);
  const u = unitOf(defFor(defs, c.id)?.sig);
  const what = c.kind === 'hold' ? `worst ${devText(c.worst.dev, u)}` : devText(c.worst.dev, u);
  return sentence(`${c.label}: ${what} against ${tolText(c.tol, u)}`);
}

function tipFor(lesson: Lesson, c: CriterionResult, defs: Map<string, Criterion>): string {
  const tips = lesson.debriefTips ?? {};
  const key = isGate(c) && c.grade < 3 ? 'fail' : c.pattern;
  const own = tips[`${c.id}.${key}`] ?? tips[`${c.id.split('.')[0]}.${key}`];
  if (own) return own;
  const advice = defFor(defs, c.id)?.advice;
  if (advice) {
    if (isGate(c)) { if (advice.fail) return advice.fail; }
    else {
      // A bias names its side; otherwise the side of the worst deviation picks the advice.
      const high = c.pattern === 'biasHigh' || (c.pattern !== 'biasLow' && (c.worst?.dev ?? 0) > 0);
      const a = high ? advice.high : advice.low;
      if (a) return a;
    }
  }
  return isGate(c) ? '' : GENERIC_TIPS[c.pattern];
}

/**
 * `crashReason`: what the simulation reported for a crash ("Terrain impact at 80 kt, 987 fpm"); it leads the
 * main point, since the cause of a crash comes before anything about technique.
 */
export function buildDebrief(lesson: Lesson, result: Omit<LessonResult, 'debrief'>, crashReason?: string, lessonFaults: readonly FaultRecord[] = []): LessonResult['debrief'] {
  const defs = criterionDefs(lesson);
  const rows = rowsOf(lesson, result.exercises);

  // 1. Safety items first.
  const safety: string[] = [];
  for (const r of rows) {
    if (!r.c.safety || r.c.grade !== 1) continue;
    const advice = defFor(defs, r.c.id)?.advice?.fail;
    safety.push(sentence(advice ?? `${r.c.label}: ${lowerFirst(r.c.detail)}. That's a safety item`));
  }
  for (const ex of result.exercises) {
    for (const f of ex.faults) if (f.severity === 'critical') safety.push(sentence(`A critical fault in ${lowerFirst(ex.title)}: ${f.id}`));
  }
  if (result.outcome === 'crashed' || (crashReason && result.outcome === 'testFail')) {
    safety.unshift(sentence(crashReason ? `What happened: ${lowerFirst(crashReason)}` : 'The flight ended in a crash'));
  }
  const safetyLines = [...new Set(safety)].slice(0, MAX_SAFETY);

  // 2. Outcome line.
  const outcomeLine = OUTCOME_LINES[result.outcome];

  // 3. Strength: the best graded required criterion with grade >= 3; never praise below 3. A binary row is
  // named after the fault it watches for ("Unstable approach continued below 200 ft"), so it is never praised.
  const good = rows.filter((r) => r.c.required && r.c.grade >= 3 && r.c.kind !== 'binary');
  good.sort((a, b) => b.c.grade - a.c.grade || Number(isGate(a.c)) - Number(isGate(b.c)) || b.c.within - a.c.within || a.c.maxN - b.c.maxN);
  const strength = good.length > 0 ? strengthSentence(good[0], defs) : 'You kept at it.';

  // 4. Main point: the largest weight x (4 - grade). A passed pass/fail item (grade 3 is its best) is not
  // something to work on.
  const scored = rows.filter((r) => r.weight > 0 && r.c.grade < 4 && !(isGate(r.c) && r.c.grade >= 3));
  scored.sort((a, b) => b.weight * (4 - b.c.grade) - a.weight * (4 - a.c.grade) || a.c.grade - b.c.grade
    || Number(b.c.required) - Number(a.c.required) || b.c.maxN - a.c.maxN);
  const top = scored[0];
  let point = top ? [quote(top.c, defs), sentence(tipFor(lesson, top.c, defs))].filter(Boolean).join(' ') : 'Nothing to fix today: keep flying it this accurately.';
  // A required item that was never flown long enough to grade holds the lesson back: say so first (release
  // playtest: L02 was "not yet" for an ungraded run-up rpm while the main point named a taxi speed in limits).
  const passedOutcome = result.outcome === 'competent' || result.outcome === 'testPass';
  const unflown = passedOutcome ? [] : result.exercises.filter((ex) => ex.mode !== 'demo')
    .flatMap((ex) => ex.criteria.filter((c) => c.required && isInsufficient(c)));
  if (unflown.length > 0) {
    const names = [...new Set(unflown.map((c) => focusPhrase(c.label)))];
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    const lead = sentence(`We didn't see ${list} for long enough to grade it, and that has to be seen before I can sign this off`);
    point = top && top.c.grade < 3 ? `${lead} ${point}` : lead;
  }
  // With safety items the screen stays within six sentences: one safety line may be followed by the point.
  const base = safetyLines.length === 0 ? point
    : safetyLines.length < MAX_SAFETY && top && !top.c.safety ? `${safetyLines[0]} ${point}` : safetyLines.join(' ');
  // Lesson-limit interventions (the instructor took control, levelled and handed back) are named, not hidden.
  const limitLine = limitSentence(result.exercises);
  // Graded faults with a description (the global rules: flap above the white arc) are named with the value.
  const faultLine = faultSentence(result.exercises, lessonFaults);
  const extra = [faultLine, limitLine].filter((x): x is string => !!x).join(' ');
  // A fault is something to fix: it replaces "Nothing to fix today" rather than following it.
  const nothing = !top && unflown.length === 0 && safetyLines.length === 0;
  const main = extra && nothing ? extra : extra && safetyLines.length < MAX_SAFETY ? `${base} ${extra}` : base;

  // 5. Next time.
  const passed = result.outcome === 'competent' || result.outcome === 'testPass';
  const next = passed
    ? sentence(lesson.lookAhead ?? 'Next time we build on this in the next lesson')
    : unflown.length > 0 && !(top && top.c.grade < 3) ? sentence(`Next time we'll fly this again, and make sure we see ${focusPhrase(unflown[0].label)} held long enough`)
      : top ? sentence(`Next time we'll fly this again and concentrate on ${focusPhrase(top.c.label)}`) : "Next time we'll fly this one again.";

  // Spoken: the outcome line plus the main point, within about 25 s.
  const spoken: string[] = [];
  let budget = SPOKEN_MAX_WORDS;
  for (const s of [outcomeLine, ...splitSentences(main)]) {
    const n = words(s);
    if (n > budget) break;
    spoken.push(s);
    budget -= n;
  }
  return { strength, main, next, spoken };
}

const COUNT_WORDS = ['no times', 'once', 'twice', 'three times', 'four times', 'five times'];

/** What a limit id watches, for the sentence: limits() ids (bankLeft, pitchUp, slow, low...) and test ids. */
function limitSubject(id: string): string {
  if (/bank|roll/i.test(id)) return 'the bank';
  if (/pitch/i.test(id)) return 'the pitch';
  if (/slow|fast|speed|kias/i.test(id)) return 'the speed';
  if (/low|high|alt|height/i.test(id)) return 'the height';
  if (/yaw|ball|rudder/i.test(id)) return 'the yaw';
  return '';
}

/**
 * "I took control three times when the bank went past the lesson limit (Your turn: pitch, roll and yaw).
 * Smaller, smoother inputs." (null: none). The exercise title stays as written, in brackets.
 */
export function limitSentence(exercises: readonly ExerciseResult[]): string | null {
  const hit = exercises.filter((e) => (e.limitInterventions ?? 0) > 0);
  if (hit.length === 0) return null;
  const total = hit.reduce((n, e) => n + (e.limitInterventions ?? 0), 0);
  const times = COUNT_WORDS[total] ?? `${total} times`;
  const subjects = [...new Set(hit.flatMap((e) => e.limitIds ?? []).map(limitSubject).filter(Boolean))];
  const what = subjects.length === 0 ? 'it went past the lesson limits'
    : subjects.length === 1 ? `${subjects[0]} went past the lesson limit`
      : `${subjects.slice(0, -1).join(', ')} and ${subjects.at(-1)} went past the lesson limits`;
  const where = hit.length === 1 ? ` (${hit[0].title})` : '';
  return `I took control ${times} when ${what}${where}. Smaller, smoother inputs.`;
}

/**
 * "The flap was out at 97 KIAS, above the flap limit of 85 (Climb and level off). Slow into the white arc before
 * the flap goes down." (null: no such fault). The worst episode is named; more episodes are counted.
 */
export function faultSentence(exercises: readonly ExerciseResult[], lessonFaults: readonly FaultRecord[] = []): string | null {
  const byEx = exercises.flatMap((e) => e.faults.filter((f) => f.id === 'flapOverspeed').map((f) => ({ f, title: e.title as string | null })));
  // Faults outside every exercise (flown before the first task of a phase): named without an exercise.
  const all = [...byEx, ...lessonFaults.filter((f) => f.id === 'flapOverspeed' && !byEx.some((x) => x.f.atS === f.atS)).map((f) => ({ f, title: null }))];
  if (all.length === 0) return null;
  const worst = all.reduce((a, b) => ((b.f.value ?? 0) > (a.f.value ?? 0) ? b : a));
  const kt = worst.f.value !== undefined ? ` at ${Math.round(worst.f.value)} KIAS` : '';
  const limit = /limit speed of (\d+)/.exec(worst.f.detail ?? '')?.[1];
  const times = all.length > 1 ? ` (${COUNT_WORDS[all.length] ?? `${all.length} times`})` : '';
  const where = worst.title ? `, in ${lowerFirst(worst.title)}` : '';
  return `The flap was out${kt}${limit ? `, above the flap limit of ${limit}` : ', above the white arc'}${where}${times}. Slow into the white arc before the flap goes down.`;
}

/** Sentence split for the speech backend (it speaks one short utterance at a time). */
function splitSentences(s: string): string[] {
  return s.split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map((x) => x.trim()).filter(Boolean);
}

/** Irregular past forms that open criterion labels. */
const ING: Record<string, string> = { held: 'holding', kept: 'keeping', flown: 'flying', set: 'setting', made: 'making', left: 'leaving' };

/**
 * A criterion label as the object of "concentrate on ..." / "we didn't see ...": a label written as what was
 * done ("Stayed on the paved surface", "Never switched to OFF") becomes the activity ("staying on the paved
 * surface", "never switching to OFF"); a noun label gets its article ("the run-up rpm"). Playtest 3: "concentrate
 * on stayed on the paved surface".
 */
export function focusPhrase(label: string): string {
  const words = label.trim().split(/\s+/);
  const lead = words[0]?.toLowerCase() ?? '';
  const verbAt = lead === 'never' || lead === 'always' ? 1 : 0;
  const w = words[verbAt]?.toLowerCase() ?? '';
  let ing: string | null = ING[w] ?? null;
  if (!ing && /^[a-z]{3,}ed$/.test(w) && !/(speed|need|bleed|feed)$/.test(w)) {
    // stayed -> staying, stopped -> stopping, centred -> centring, raised -> raising: -ing on the bare stem.
    ing = `${w.slice(0, -2)}ing`;
  }
  if (ing) {
    const out = [...words];
    out[verbAt] = ing;
    if (verbAt === 1) out[0] = lead;
    return out.join(' ');
  }
  const first = lowerFirst(label);
  return /^(the|a|an|your|each|every|both|no)\b/i.test(first) ? first : `the ${first}`;
}
