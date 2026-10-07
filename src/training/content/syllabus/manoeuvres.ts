// Upper-air manoeuvre tasks shared by the handling lessons (L03-L07), the advanced lessons (L15, L19) and the
// skill test (L21): straight and level, climbs and descents with level-offs, level turns, slow flight,
// stalls, steep turns and unusual-attitude recoveries. Each builder returns one TaskStep; the caller names
// the step, the exercise it scores, the brief, and the standard-dependent tolerances.
//
// Conventions: run variables hold the reference altitude and heading captured just before the task
// (`altVar`, `hdgVar`), so a task always grades against where the student actually started. Bank is + right;
// `step.turnDeg` is the signed heading change since the step began (+ right).

import {
  all, any, binary, check, eq, ev, final, ge, gt, held, hold, lt, near, not, peak, turned, v, vs,
} from '../../engine/dsl';
import type { CoachPresetId, Criterion, CueRef, Outcome, Ref, TaskCard, TaskFeedback, TaskLimit, TaskStep, TolKey } from '../../types';
import { alt, bank, hdg, ias, task, vsi } from './common';
import { instruction } from './instruction';

interface Base {
  id: string;
  exercise: string;
  brief: CueRef;
  coach?: CoachPresetId[];
  /** Student flies (default true): the runner performs the handover before the task. */
  student?: boolean;
  required?: boolean;
  /** Running instruction while the student flies it (ab initio; instruction.ts). */
  feedback?: TaskFeedback;
  /** Lesson limits: past one, the instructor takes control, restores, and the task restarts. */
  limits?: TaskLimit[];
}
const pf = (b: Base): { pf?: 'student' } => (b.student === false ? {} : { pf: 'student' });
/** Practice tasks may hand a timed-out attempt to a demonstration and retry it (section 2.12: L04 climb). */
const timeoutOutcome = (demoId: string | undefined): Outcome => (demoId ? { demo: demoId, thenRetry: true } : 'fail');

/**
 * Wings level for 2 s: the end of a turn whose card names no roll-out heading (the runner arms the
 * rolloutComplete event only from a card heading, so such a goal would never be met).
 */
export const wingsLevel = held(near('aiBankDeg', 0, 3), 2);

/** Straight and level for `seconds`: altitude, heading and speed held. `instrument` uses the instrument bands. */
export function straightLevelTask(o: Base & { altVar: string; hdgVar: string; kias: Ref; seconds: number; instrument?: boolean; speedSettleS?: number }): TaskStep {
  const req = o.required ?? true;
  const altTol: TolKey = o.instrument ? 'instrAltitude' : 'altitude';
  const hdgTol: TolKey = o.instrument ? 'instrHeading' : 'heading';
  return task({
    id: o.id, exercise: o.exercise, brief: o.brief, ...pf(o), ...instruction(o),
    card: { title: 'Straight and level', targets: [alt(v(o.altVar), altTol), hdg(v(o.hdgVar), hdgTol), ias(o.kias)] },
    goal: { elapsed: o.seconds }, timeoutS: o.seconds + 30, onTimeout: 'next',
    coach: o.coach ?? ['altitude', 'heading', 'speed', 'ball', 'trim'],
    criteria: [
      hold(`${o.id}Alt`, 'Altitude', 'altFt', v(o.altVar), altTol, { settleS: 8, required: req }),
      hold(`${o.id}Hdg`, 'Heading', 'hdgDeg', v(o.hdgVar), hdgTol, { settleS: 8, required: req }),
      hold(`${o.id}Ias`, 'Speed', 'asiKt', o.kias, 'speed', { settleS: o.speedSettleS ?? 12, required: req }),
      hold(`${o.id}Ball`, 'Balance', 'ball', 0, 0.5, { settleS: 8, required: false, chart: false }),
    ],
  });
}

/**
 * Climb at `kias` (Vy by default) to `tgtVar` and level off (section 2.12 `climbTo`): climb speed until 150 ft
 * short, heading, the level-off overshoot (peak) and the altitude after the level-off (final).
 */
export function climbTask(o: Base & { tgtVar: string; hdgVar: string; kias?: Ref; instrument?: boolean; demoOnTimeout?: string }): TaskStep {
  const req = o.required ?? true;
  const kias = o.kias ?? vs('Vy');
  const altTol: TolKey = o.instrument ? 'instrAltitude' : 'altitude';
  const hdgTol: TolKey = o.instrument ? 'instrHeading' : 'heading';
  return task({
    id: o.id, exercise: o.exercise, brief: o.brief, ...pf(o), ...instruction(o),
    card: { title: 'Climb and level off', targets: [ias(kias, 'speedClimbApproach'), alt(v(o.tgtVar), altTol), hdg(v(o.hdgVar), hdgTol)] },
    goal: held(near('altFt', v(o.tgtVar), 60), 10), timeoutS: 240, onTimeout: timeoutOutcome(o.demoOnTimeout),
    coach: o.coach ?? ['speed', 'heading', 'ball', 'trim', 'levelOff'],
    criteria: [
      hold(`${o.id}Ias`, 'Climb speed', 'asiKt', kias, 'speedClimbApproach', { settleS: 12, activeWhen: lt('altFt', v(o.tgtVar, -150)), required: req,
        advice: { high: 'Raise the nose a little: in the climb, speed is controlled with attitude.',
          low: 'Lower the nose: at full power a low speed means too much attitude.' } }),
      hold(`${o.id}Hdg`, 'Heading', 'hdgDeg', v(o.hdgVar), hdgTol, { settleS: 8, required: req }),
      peak(`${o.id}Level`, 'Level-off overshoot', 'altFt', v(o.tgtVar), altTol, { peakOf: 'max', required: req,
        advice: { high: 'Start levelling at 10 % of the climb rate: about 50 ft early at 500 fpm.' } }),
      final(`${o.id}Alt`, 'Altitude after level-off', 'altFt', v(o.tgtVar), altTol, { required: req }),
    ],
  });
}

/**
 * A descent to `tgtVar` and level-off. `glide`: idle power at best glide speed; otherwise 500 fpm at the
 * descent speed with reduced power.
 */
export function descentTask(o: Base & { tgtVar: string; hdgVar: string; glide?: boolean; instrument?: boolean; heading?: boolean; demoOnTimeout?: string }): TaskStep {
  const req = o.required ?? true;
  const kias = o.glide ? vs('Vglide') : vs('Vdescent');
  const altTol: TolKey = o.instrument ? 'instrAltitude' : 'altitude';
  const hdgTol: TolKey = o.instrument ? 'instrHeading' : 'heading';
  const descending = gt('altFt', v(o.tgtVar, 150));
  const criteria: Criterion[] = [
    hold(`${o.id}Ias`, o.glide ? 'Glide speed' : 'Descent speed', 'asiKt', kias, 'speed', { settleS: 12, activeWhen: descending, required: req }),
  ];
  if (!o.glide) criteria.push(hold(`${o.id}Vs`, 'Descent rate', 'vsiFpm', -500, 'vs', { settleS: 15, activeWhen: descending, required: req }));
  if (o.heading !== false) criteria.push(hold(`${o.id}Hdg`, 'Heading', 'hdgDeg', v(o.hdgVar), hdgTol, { settleS: 8, required: req }));
  criteria.push(
    peak(`${o.id}Level`, 'Level-off', 'altFt', v(o.tgtVar), altTol, { peakOf: 'min', required: req,
      advice: { low: 'Lead the level-off by 10 % of the rate of descent: 50 ft early at 500 fpm.' } }),
    final(`${o.id}Alt`, 'Altitude after level-off', 'altFt', v(o.tgtVar), altTol, { required: req }),
  );
  const targets = [ias(kias), ...(o.glide ? [] : [vsi(-500)]), alt(v(o.tgtVar), altTol), hdg(v(o.hdgVar), hdgTol)];
  return task({
    id: o.id, exercise: o.exercise, brief: o.brief, ...pf(o), ...instruction(o),
    card: { title: o.glide ? 'Glide and level off' : '500 fpm descent, level off', targets },
    goal: held(near('altFt', v(o.tgtVar), 60), 10), timeoutS: 240, onTimeout: timeoutOutcome(o.demoOnTimeout),
    coach: o.coach ?? (o.glide ? ['speed', 'ball', 'levelOff'] : ['speed', 'vs', 'ball', 'trim', 'levelOff']),
    criteria,
  });
}

/**
 * A level 360 at `bankDeg` (30 medium, 45 steep) in direction `dir`, rolling out on the entry heading:
 * bank and speed through the turn, altitude, and the roll-out heading.
 */
export function turn360Task(o: Base & { dir: 'left' | 'right'; bankDeg: number; bankTol: TolKey; kias: Ref; altVar: string; hdgVar: string; degrees?: number }): TaskStep {
  const req = o.required ?? true;
  const sign = o.dir === 'left' ? -1 : 1;
  const deg = o.degrees ?? 360;
  // Sample the bank only while established: after 20 degrees of turn and until 30 degrees before the roll-out.
  const established = o.dir === 'left'
    ? all(lt('step.turnDeg', -20), gt('step.turnDeg', -(deg - 30)))
    : all(gt('step.turnDeg', 20), lt('step.turnDeg', deg - 30));
  return task({
    id: o.id, exercise: o.exercise, brief: o.brief, ...pf(o), ...instruction(o),
    card: { title: `${o.bankDeg}° turn ${o.dir}, ${deg}°`, targets: [bank(sign * o.bankDeg, o.bankTol), alt(v(o.altVar)), ias(o.kias), hdg(v(o.hdgVar), 'rollout')] },
    goal: all(turned(deg - 15), ev('rolloutComplete')), timeoutS: o.bankDeg >= 45 ? 120 : 150, onTimeout: 'fail',
    coach: o.coach ?? ['bank', 'altitude', 'speed', 'ball'],
    criteria: [
      hold(`${o.id}Bank`, 'Bank angle', 'aiBankDeg', sign * o.bankDeg, o.bankTol, { settleS: 3, activeWhen: established, required: req }),
      hold(`${o.id}Alt`, 'Altitude', 'altFt', v(o.altVar), 'altitude', { settleS: 5, required: req,
        advice: { low: 'In the turn the nose wants to drop: add back pressure as the bank goes on.',
          high: 'Too much back pressure: relax it a little as you hold the bank.' } }),
      hold(`${o.id}Ias`, 'Speed', 'asiKt', o.kias, 'speed', { settleS: 5, required: req }),
      final(`${o.id}Rollout`, 'Roll-out heading', 'hdgDeg', v(o.hdgVar), 'rollout', { required: req,
        advice: { high: 'Lead the roll-out by about half the bank angle: 15 degrees early at 30 degrees of bank.',
          low: 'You rolled out early: start the roll-out about half the bank angle before the heading.' } }),
    ],
  });
}

/** A 180-degree (or `degrees`) rate-one turn on instruments: turn rate, altitude and speed. */
export function rateOneTurnTask(o: Base & { dir: 'left' | 'right'; altVar: string; hdgVar: string; kias: Ref; degrees?: number }): TaskStep {
  const req = o.required ?? true;
  const sign = o.dir === 'left' ? -1 : 1;
  const deg = o.degrees ?? 180;
  const established = o.dir === 'left' ? all(lt('step.turnDeg', -15), gt('step.turnDeg', -(deg - 20))) : all(gt('step.turnDeg', 15), lt('step.turnDeg', deg - 20));
  return task({
    id: o.id, exercise: o.exercise, brief: o.brief, ...pf(o), ...instruction(o),
    card: { title: `Rate-one turn ${o.dir}, ${deg}°`, targets: [{ label: 'RATE', sig: 'turnRate', value: sign, tol: 'turnRate', unit: '' }, alt(v(o.altVar), 'instrAltitude'), ias(o.kias)] },
    goal: all(turned(deg - 10), ev('rolloutComplete')), timeoutS: 120, onTimeout: 'fail',
    coach: o.coach ?? ['altitude', 'speed', 'ball'],
    criteria: [
      hold(`${o.id}Rate`, 'Turn rate', 'turnRate', sign, 'turnRate', { settleS: 3, activeWhen: established, required: req }),
      hold(`${o.id}Alt`, 'Altitude', 'altFt', v(o.altVar), 'instrAltitude', { settleS: 5, required: req }),
      hold(`${o.id}Ias`, 'Speed', 'asiKt', o.kias, 'speed', { settleS: 5, required: req }),
      final(`${o.id}Rollout`, 'Roll-out heading', 'hdgDeg', v(o.hdgVar, sign * deg), 'instrHeading', { required: req }),
    ],
  });
}

/**
 * Slow flight at Vslow (or `kias`) for `seconds`: speed on the slow-flight band (no lower margin), altitude,
 * heading (unless turning), and the stall warning never held for more than 2 s.
 */
export function slowFlightTask(o: Base & { altVar: string; hdgVar?: string; kias?: Ref; seconds: number; flapsDeg?: number; turnDir?: 'left' | 'right' }): TaskStep {
  const req = o.required ?? true;
  const kias = o.kias ?? vs('Vslow');
  // A gentle turn follows slow flight already established at the same speed and height, and lasts about 20 s:
  // sampled from 3 s (with the 20 s and 10 s settling of an entry it had too little data to grade).
  const turning = o.turnDir !== undefined;
  const criteria: Criterion[] = [
    hold(`${o.id}Ias`, 'Slow-flight speed', 'asiKt', kias, 'slowFlightSpeed', { settleS: turning ? 3 : 20, required: req,
      advice: { low: 'Below the target the drag rises fast: a little more power, and hold the attitude.' } }),
    hold(`${o.id}Alt`, 'Altitude', 'altFt', v(o.altVar), 'altitude', { settleS: turning ? 3 : 10, required: req }),
    binary(`${o.id}Warn`, 'Stall warning held over 2 s', held(eq('stallWarn', true), 2), { required: req,
      advice: { fail: 'A held stall warning means the wing is close to the stall: lower the nose slightly, add power.' } }),
  ];
  const targets = [ias(kias, 'slowFlightSpeed'), alt(v(o.altVar))];
  if (o.turnDir) {
    const sign = o.turnDir === 'left' ? -1 : 1;
    criteria.push(hold(`${o.id}Bank`, 'Bank in the gentle turn', 'aiBankDeg', sign * 15, 10, { settleS: 4,
      activeWhen: o.turnDir === 'left' ? lt('step.turnDeg', -10) : gt('step.turnDeg', 10), required: req }));
    targets.push(bank(sign * 15, 10));
  } else if (o.hdgVar) {
    criteria.push(hold(`${o.id}Hdg`, 'Heading', 'hdgDeg', v(o.hdgVar), 'heading', { settleS: 10, required: req }));
    targets.push(hdg(v(o.hdgVar)));
  }
  if (o.flapsDeg !== undefined) {
    criteria.push(check(`${o.id}Flaps`, `Flap ${o.flapsDeg} set`, { pred: held(near('flapsDeg', o.flapsDeg, 3), 2), withinS: 40, required: req }));
  }
  return task({
    id: o.id, exercise: o.exercise, brief: o.brief, ...pf(o), ...instruction(o),
    card: { title: o.turnDir ? `Slow flight: gentle turn ${o.turnDir}` : 'Slow flight', targets },
    goal: o.turnDir ? all({ elapsed: 20 }, turned(90)) : { elapsed: o.seconds },
    timeoutS: o.seconds + 60, onTimeout: o.turnDir ? 'fail' : 'next',
    coach: o.coach ?? ['speed', 'altitude', 'heading', 'ball', 'stallWarning'],
    criteria,
  });
}

/**
 * A lookout clearing turn of at least `degrees` (HASELL "lookout"; section 4.1 L07: >= 180 within 120 s).
 * `safety` makes the check a safety item (assessed stalls: no stall without a clearing turn).
 */
export function clearingTurnTask(o: Base & { degrees: number; safety?: boolean }): TaskStep {
  return task({
    id: o.id, exercise: o.exercise, brief: o.brief, ...pf(o), ...instruction(o),
    card: { title: `Clearing turn, ${o.degrees}°`, targets: [] },
    goal: all(turned(o.degrees), wingsLevel), timeoutS: 120, onTimeout: 'next',
    coach: o.coach ?? ['bank', 'altitude'],
    criteria: [
      check(`${o.id}Turn`, `Clearing turn ${o.degrees}°`, { pred: turned(o.degrees), required: o.required ?? true, ...(o.safety ? { safety: true } : {}) }),
    ],
  });
}

/**
 * A stall, entry and recovery in one task (section 4.1 L07): power off (flap 30 and 1,500 rpm in the approach
 * configuration), the height and heading held with back pressure until the warning (`at: 'warning'`, an
 * incipient recovery) or the break, then the recovery to a climb. One task, because the stall-recovery grader
 * (grading/stall.ts: height loss against `stallHeightLossFt`, recovery started within 2 s, no secondary stall,
 * bank under 20 degrees) times everything from the warning or break event, which it must see. (Wave-3
 * calibration: split into an entry task and a recovery task, the recovery was graded by "the warning silent
 * within 3 s", which a prompt recovery from the break never achieves; and the height loss used literal bands
 * rather than the table.) Heading is held to the stall; load factor at most 2.5 g; with flap, none retracted
 * below Vx. `callRecovery`: the instructor calls "Recover" when 2 s after the stall (the grader's limit for
 * starting the recovery) the warning is still on and the nose still above the horizon (practice only).
 */
export function stallTask(o: Base & { at: 'warning' | 'break'; approach?: boolean; hdgVar: string; callRecovery?: boolean }): TaskStep {
  const req = o.required ?? true;
  const ref = o.at === 'warning' ? 'stallWarnOn' : 'stallBreak';
  const stalled = ev(ref);
  const card: TaskCard = {
    title: `${o.approach ? 'Flap 30, 1,500 rpm' : 'Power off'}: stall, recover at the ${o.at}`,
    targets: [hdg(v(o.hdgVar)), bank(0, 10)],
  };
  const criteria: Criterion[] = [
    hold(`${o.id}Hdg`, 'Heading to the stall', 'hdgDeg', v(o.hdgVar), 'heading', { settleS: 5, activeWhen: not(stalled), required: req }),
    { id: `${o.id}Rec`, label: o.at === 'warning' ? 'Recovery at the warning' : 'Recovery from the stall', kind: 'atEvent', event: ref, tol: 'stallHeightLossFt', required: req,
      advice: { high: 'Lower the nose only enough to unstall the wing, full power at once, then climb away.',
        fail: 'At the warning or the break, move the control column forward first: unload the wing.' } },
    peak(`${o.id}G`, 'Load factor', 'gLoad', 1, { minus: 1, plus: 1.5 }, { peakOf: 'max', activeWhen: stalled, required: req,
      advice: { high: 'Too hard a pull-out: ease out of the dive, you risk a secondary stall.' } }),
  ];
  if (o.approach) {
    criteria.push(binary(`${o.id}Flaps`, 'Flap raised in stages, above Vx', all(stalled, lt('kias', vs('Vx', -5)), lt('flapsDeg', 15)), { required: req }));
  }
  const coach: TaskStep['coach'] = o.callRecovery
    ? [{ id: 'stallRecover', topic: 'stallRecover', when: all(stalled, eq('stallWarn', true), gt('aiPitchDeg', 3)), afterS: 2, priority: 0, minLevel: 'silent',
      say: ['L07.recover'] }]
    : [];
  return task({
    id: o.id, exercise: o.exercise, brief: o.brief, ...pf(o), ...instruction(o), card,
    goal: all(stalled, held(all(gt('vsFpm', 0), gt('kias', vs('Vs1', 15))), 2)), timeoutS: 150, onTimeout: 'fail',
    coach, criteria,
  });
}

/**
 * Recovery from a spiral dive (L15): power off, wings level within 4 s, speed kept below Vno, load factor
 * below 3.0 g (a safety item at 3.3 g), then a gentle pull to level flight.
 */
export function spiralRecoveryTask(o: Base): TaskStep {
  const req = o.required ?? true;
  return task({
    id: o.id, exercise: o.exercise, brief: o.brief, ...pf(o), ...instruction(o),
    card: { title: 'Spiral dive: recover', targets: [bank(0, 10), ias(vs('Vno'), { minus: 60, plus: 0 })] },
    goal: held(all(near('bankDeg', 0, 10), gt('vsFpm', -500)), 3), timeoutS: 40, onTimeout: 'fail',
    coach: o.coach ?? [],
    criteria: [
      check(`${o.id}Level`, 'Wings level within 4 s', { pred: near('bankDeg', 0, 10), withinS: 4, required: req,
        advice: { fail: 'Power off, then roll the wings level before you pull: pulling in a bank tightens the spiral.' } }),
      binary(`${o.id}Vno`, 'Speed below Vno', held(gt('kias', vs('Vno')), 0.5), { required: req }),
      binary(`${o.id}G`, 'Load factor below 3.0 g', gt('gLoad', 3.0), { required: req }),
      binary(`${o.id}GLimit`, 'Load factor limit', gt('gLoad', 3.3), { required: true, safety: true }),
      check(`${o.id}Power`, 'Power reduced', { pred: lt('throttle', 0.3), withinS: 4, required: req }),
    ],
  });
}

/**
 * Unusual-attitude recovery (L19, L21; section 3.4 unusual-attitude grader). Nose low: power off and wings
 * within 15 degrees before 1.5 g. Nose high: power on and the nose lowered before the speed decays to
 * Vs1 + 5. Both: below 3.0 g and Vne, and straight and level within 8 s.
 */
export function unusualAttitudeTask(o: Base & { kind: 'noseLow' | 'noseHigh' }): TaskStep {
  const req = o.required ?? true;
  const levelNow = held(all(near('aiBankDeg', 0, 10), near('aiPitchDeg', 2, 6)), 1);
  const order: Criterion = o.kind === 'noseLow'
    ? binary(`${o.id}Order`, 'Power off and wings level before pulling', all(gt('gLoad', 1.5), any(gt('throttle', 0.3), not(near('bankDeg', 0, 15)))), { required: req,
      // A second to react: the entry itself is a banked dive at 1.4-1.6 g with power on, and in the skill test
      // control passes with no handover pause, so the first frames are the examiner's, not the student's.
      activeWhen: gt('step.t', 1),
      advice: { fail: 'Nose low: power off, roll wings level, then ease out of the dive.' } })
    : binary(`${o.id}Order`, 'Nose lowered before the speed decayed', lt('kias', vs('Vs1', 5)), { required: req,
      advice: { fail: 'Nose high: full power and lower the nose to the horizon before the speed is gone.' } });
  return task({
    id: o.id, exercise: o.exercise, brief: o.brief, ...pf(o), ...instruction(o),
    card: { title: o.kind === 'noseLow' ? 'Recover: nose low' : 'Recover: nose high', targets: [bank(0, 10), ias(vs('Vcruise'), 'speed')] },
    goal: held(all(near('aiBankDeg', 0, 10), near('aiPitchDeg', 2, 6), gt('vsFpm', -500), lt('vsFpm', 800)), 3), timeoutS: 40, onTimeout: 'fail',
    coach: o.coach ?? [],
    criteria: [
      order,
      ...(o.kind === 'noseHigh' ? [check(`${o.id}Power`, 'Power added', { pred: gt('throttle', 0.9), withinS: 3, required: req })] : []),
      binary(`${o.id}G`, 'Load factor below 3.0 g', gt('gLoad', 3.0), { required: req }),
      binary(`${o.id}Vne`, 'Speed below Vne', ge('kias', vs('Vne')), { required: true, safety: true }),
      check(`${o.id}Level`, 'Level within 8 s', { pred: levelNow, withinS: 8, required: req }),
    ],
  });
}

/** Engine-failure touch drills: fuel selector BOTH, mixture RICH, magnetos BOTH, fuel pump ON. */
export const touchDrills = all(eq('fuelSel', 'both'), gt('mixture', 0.9), eq('mags', 3), eq('fuelPump', true));
