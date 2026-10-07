// Building blocks shared by the lesson files: card targets, exercise and rule shorthands, the training-area
// start, and the circuit pieces (take-off, downwind, approach and landing) that stages 2-4, N1 and the
// challenges all fly. Everything here returns plain contract data (section 2.9), exactly what a lesson
// literal would contain; the linter checks the result, not these helpers.
//
// Geometry used below (src/world/airport/layout.ts, src/core/world.ts): runway 07 heading 070 true (no magnetic
// variation in the sim), threshold at rwyAlongM 0, 1,800 m long; rwyAcrossM + right of the 07 centreline, so
// taxiway A and the downwind leg are on the negative (left, north-west) side. Hold A1 is on connector A1 about
// 15 m along and 80 m left of the 07 centreline, 4 m behind the hold line (76 m). Field elevation 394 ft.

import {
  all, any, atEvent, binary, check, eq, ev, ge, gt, held, hold, le, leg, lt, near, not, peak, task as dslTask, vs,
} from '../../engine/dsl';
import { gateCoach } from '../coachPresets';
import type {
  Criterion, CueRef, ExerciseDef, LessonRules, Pred, Ref, SkillId, Standard, StartSpec, TaskCard,
  TaskFeedback, TaskLimit, TaskStep, TolRef,
} from '../../types';
import { instruction } from './instruction';

export const RWY_HDG = 70;
/** One nautical mile, m (rwyAlongM is in metres). */
export const NM_M = 1852;

// ---- tasks ----------------------------------------------------------------------------------------------------

/**
 * The lesson files' task builder: the DSL's, with the card-bound coach presets gated by the criteria that grade
 * the same target (coachPresets.ts gateCoach), so the coach speaks about a target only while it is graded.
 */
export const task = (def: Omit<TaskStep, 'kind'>): TaskStep => gateCoach(dslTask(def));

// ---- card targets ---------------------------------------------------------------------------------------------

type Target = TaskCard['targets'][number];
export const ias = (value: Ref, tol: TolRef = 'speed'): Target => ({ label: 'IAS', sig: 'asiKt', value, tol, unit: 'kt' });
export const alt = (value: Ref, tol: TolRef = 'altitude'): Target => ({ label: 'ALT', sig: 'altFt', value, tol, unit: 'ft' });
export const hdg = (value: Ref, tol: TolRef = 'heading'): Target => ({ label: 'HDG', sig: 'hdgDeg', value, tol, unit: 'deg' });
export const vsi = (value: Ref, tol: TolRef = 'vs'): Target => ({ label: 'VS', sig: 'vsiFpm', value, tol, unit: 'fpm' });
export const bank = (value: Ref, tol: TolRef = 'bankMedium'): Target => ({ label: 'BANK', sig: 'aiBankDeg', value, tol, unit: 'deg' });
export const rpm = (value: Ref, tol: TolRef = 100): Target => ({ label: 'RPM', sig: 'rpm', value, tol, unit: 'rpm' });
export const height = (value: Ref, tol: TolRef = 'altitude'): Target => ({ label: 'HGT', sig: 'hafFt', value, tol, unit: 'ft' });
export const centreline = (tol: TolRef = 'centrelineM'): Target => ({ label: 'CL', sig: 'rwyAcrossM', value: 0, tol, unit: 'm' });
export const slope = (tol: TolRef = 'glidepathFt'): Target => ({ label: 'SLOPE', sig: 'gpDevFt', value: 0, tol, unit: 'ft' });

// ---- exercises and rules --------------------------------------------------------------------------------------

export const demoEx = (id: string, title: string, skill: SkillId): ExerciseDef =>
  ({ id, title, skill, mode: 'demo', standard: 'training', required: false, weight: 0 });
export const practiceEx = (id: string, title: string, skill: SkillId, weight = 1): ExerciseDef =>
  ({ id, title, skill, mode: 'practice', standard: 'training', required: false, weight });
/** A required exercise graded at `standard` (default test). */
export const assessedEx = (id: string, title: string, skill: SkillId, opts: { standard?: Standard; weight?: number; testSection?: 1 | 2 | 3 | 4 | 5; required?: boolean } = {}): ExerciseDef => {
  const e: ExerciseDef = { id, title, skill, mode: 'assessed', standard: opts.standard ?? 'test', required: opts.required ?? true, weight: opts.weight ?? 2 };
  if (opts.testSection !== undefined) e.testSection = opts.testSection;
  return e;
};

/** Dual-lesson rules: instructor saves on, autopilot forbidden, 1x. */
export const dualRules = (o: Partial<LessonRules> & { maxDurationS: number; coachLevel: LessonRules['coachLevel'] }): LessonRules =>
  ({ autopilot: 'forbidden', maxTimeScale: 1, instructorSaves: true, ...o });
/** Solo, check-ride and test rules: the instructor does not save (section 1.6; check rides keep saves). */
export const soloRules = (o: Partial<LessonRules> & { maxDurationS: number }): LessonRules =>
  ({ coachLevel: 'silent', autopilot: 'forbidden', maxTimeScale: 1, instructorSaves: false, ...o });

/** Upper-air lessons keep 1,500 ft above the ground (section 3.8). */
export const UPPER_AIR = { minAglFt: 1500 } as const;

/**
 * An in-flight start over the training area (geo/areas.ts). Headings 100-210 from the area keep over ground
 * below 1,750 ft for 9 NM, so the long straight legs never run toward the high ground to the north and west.
 */
export const areaStart = (altFt: number, hdgDeg: number, kias: Ref = vs('Vcruise'), flapsDeg?: number): StartSpec => {
  const s: StartSpec = { kind: 'air', at: 'trainingArea', altFt, altRef: 'msl', hdgDeg, kias };
  if (flapsDeg !== undefined) s.flapsDeg = flapsDeg;
  return s;
};

export const LINEUP: StartSpec = { kind: 'ground', spot: 'lineup07', engine: 'running' };
export const HOLD_A1: StartSpec = { kind: 'ground', spot: 'holdA1', engine: 'running' };
export const PARKING_COLD: StartSpec = { kind: 'ground', spot: 'parking', engine: 'cold' };
export const finalStart = (distNm: number, flapsDeg = 20, heightOffsetFt?: number, kias: Ref = vs('Vapp')): StartSpec => {
  const s: StartSpec = { kind: 'final', distNm, kias, flapsDeg };
  if (heightOffsetFt !== undefined) s.heightOffsetFt = heightOffsetFt;
  return s;
};
export const DOWNWIND_MID: StartSpec = { kind: 'circuit', leg: 'downwind', position: 'abeamMid', kias: vs('Vdownwind') };

// ---- shared criteria --------------------------------------------------------------------------------------------

/** On the ground below 5 ft: shorthand for "airborne" conditions. */
export const airborne: Pred = gt('aglFt', 5);

/**
 * The landing items of the landing grader (section 3.4), as ordinary criteria on the `landing` and
 * `mainsTouchdown` events so the standard grading rules apply: sink, touchdown zone, centreline, drift,
 * nose-first contact (safety), bounces, speed at 50 ft and runway (safety). Drift is 5 degrees (8 at the
 * training standard). `prefix` keeps criterion ids unique when a task scores two landings.
 */
export function landingCriteria(o: { prefix?: string; standard: Standard; vref?: Ref; zone?: 'touchdownZoneFt' | 'touchdownZoneShortFt'; required?: boolean; sinkTol?: TolRef }): Criterion[] {
  const p = o.prefix ?? '';
  const req = o.required ?? true;
  const vref = o.vref ?? vs('Vref');
  const drift = o.standard === 'training' ? 8 : 5;
  return [
    binary(`${p}onRunway`, 'Landed on the runway', any(ev('landing', { onRunway: false }), ev('crash')), { required: true, safety: true }),
    binary(`${p}noseFirst`, 'Mains first', ev('mainsTouchdown', { firstWheel: 'nose' }), { required: true, safety: true,
      advice: { fail: 'The nosewheel touched first: hold the nose up in the flare, the mains must land first.' } }),
    atEvent(`${p}sink`, 'Sink rate at touchdown', 'landing', 'vsFpm', 0, o.sinkTol ?? 'sinkFpm', { field: 'sinkFpm', required: req,
      advice: { high: 'Firm arrival: close the throttle in the flare and keep raising the nose until it settles.' } }),
    atEvent(`${p}zone`, 'Touchdown point', 'landing', 'distAimFt', 0, o.zone ?? 'touchdownZoneFt', { field: 'distAimFt', required: req,
      advice: { high: 'You floated long: arrive at the right speed and close the throttle at the flare.',
        low: 'Short of the aim point: keep the aim point fixed in the windscreen with power on the approach.' } }),
    atEvent(`${p}cl`, 'Centreline at touchdown', 'landing', 'rwyAcrossM', 0, 'centrelineM', { field: 'rwyAcrossM', required: req }),
    atEvent(`${p}drift`, 'Drift at touchdown', 'landing', 'driftDeg', 0, drift, { field: 'driftDeg', required: req,
      advice: { high: 'Land straight: rudder to line the nose up with the centreline just before touchdown.',
        low: 'Land straight: rudder to line the nose up with the centreline just before touchdown.' } }),
    binary(`${p}bounce`, 'No bounce', any(ev('landing', { bounces: [2, 99] }), ev('landing', { maxBounceFt: [3, 1000] })), { required: req,
      advice: { fail: 'After a bounce, hold the attitude and add power if it is high; go around if in doubt.' } }),
    atEvent(`${p}vref`, 'Speed at 50 ft', 'landing', 'kias', vref, 'speedClimbApproach', { field: 'kiasAt50Ft', required: req }),
  ];
}

/**
 * The stabilised-approach gate at 300 ft above the field (L09): speed, line and sink sampled through the gate
 * window (300 down to 150 ft), flaps set by the gate, and an unstable approach continued below 200 ft fails as
 * a safety item. `flapsMin` is the landing-flap minimum in degrees (0 for a flapless approach).
 */
export function stabilisedGate(o: { prefix?: string; vref?: Ref; flapsMin?: number; required?: boolean } = {}): Criterion[] {
  const p = o.prefix ?? '';
  const vref = o.vref ?? vs('Vref');
  const req = o.required ?? true;
  const window = all(leg('final'), lt('hafFt', 300), gt('hafFt', 150));
  const unstable = any(not(near('kias', vref, 'speedClimbApproach')), not(near('rwyAcrossM', 0, 45)), lt('vsFpm', -1000));
  const out: Criterion[] = [
    hold(`${p}gateIas`, 'Speed through the 300 ft gate', 'asiKt', vref, 'speedClimbApproach', { settleS: 0, activeWhen: window, required: req, chart: true }),
    hold(`${p}gateLine`, 'Lined up through the gate', 'rwyAcrossM', 0, 45, { settleS: 0, activeWhen: window, required: req, chart: false }),
    binary(`${p}gateSink`, 'Sink below 1,000 fpm at the gate', held(all(window, lt('vsFpm', -1000)), 1.5), { required: req }),
    // Judged down to the flare (30 ft): in the flare the speed decays below Vref - 5 by design (wave-2
    // integration fix: with `airborne` (5 ft) every normal flare read as an unstable approach).
    binary(`${p}unstable`, 'Unstable approach continued below 200 ft', held(all(lt('hafFt', 200), gt('aglFt', 30), leg('final'), unstable), 2),
      { required: true, safety: true, advice: { fail: 'Unstable at 200 feet means go around, every time.' } }),
  ];
  if ((o.flapsMin ?? 25) > 0) {
    out.push(binary(`${p}gateFlaps`, 'Landing flap set by 300 ft', held(all(window, lt('flapsDeg', o.flapsMin ?? 25)), 1), { required: req }));
  }
  return out;
}

/** 3-degree path tracking beyond 1 NM from the threshold. */
export const glidepathHold = (id = 'slope', required = true): Criterion =>
  hold(id, 'Glide path beyond 1 NM', 'gpDevFt', 0, 'glidepathFt', { settleS: 5, activeWhen: all(leg('final'), lt('rwyAlongM', -NM_M)), required });

// ---- circuit tasks ------------------------------------------------------------------------------------------------

/** Above-the-field shorthands: circuit height is 1,000 ft above the field. */
export const CCT_HEIGHT = 1000;

interface TaskOpts {
  id: string; exercise: string; standard: Standard; brief: CueRef; coach?: TaskStep['coach']; required?: boolean; timeoutS?: number;
  /** The student flies this task: the runner hands over first (default: authority unchanged). */
  student?: boolean;
  /** Further criteria appended to the builder's own. */
  extra?: Criterion[];
  /** Running instruction while the student flies it (ab initio; instruction.ts). */
  feedback?: TaskFeedback;
  /** Lesson limits: past one, the instructor takes control, restores, and the task restarts. */
  limits?: TaskLimit[];
}
const pf = (o: TaskOpts): { pf?: 'student' } => (o.student ? { pf: 'student' } : {});

/**
 * Normal take-off and climb to 500 ft above the field (section 4.1 L08): centreline on the roll until lift-off,
 * rotate at Vr -0/+10, Vy from 200 ft, runway heading, and flaps up for a normal take-off.
 */
export function takeoffTask(o: TaskOpts & { rotateKias?: Ref; climbKias?: Ref; flapsMax?: number }): TaskStep {
  const req = o.required ?? true;
  const climb = o.climbKias ?? vs('Vy');
  return task({
    id: o.id, exercise: o.exercise, pf: 'student', brief: o.brief, ...instruction(o),
    card: { title: 'Take-off and climb', targets: [ias(climb, 'speedClimbApproach'), hdg(RWY_HDG), centreline()] },
    goal: gt('hafFt', 500), timeoutS: o.timeoutS ?? 240, onTimeout: 'fail',
    coach: o.coach ?? ['centreline', 'speed', 'heading', 'ball'],
    criteria: [
      hold(`${o.id}Cl`, 'Centreline on the roll', 'rwyAcrossM', 0, 'centrelineM', { settleS: 2, activeWhen: all(eq('onGround', true), gt('kias', 20)), required: req, chart: false }),
      atEvent(`${o.id}Vr`, 'Rotation speed', 'liftoff', 'kias', o.rotateKias ?? vs('Vr'), { minus: 0, plus: 10 }, { field: 'kias', required: req,
        advice: { low: 'Wait for the rotation speed: lifting off early leaves you slow and close to the stall.',
          high: 'Rotate at the rotation speed: holding it down wastes runway.' } }),
      hold(`${o.id}Vy`, 'Climb speed', 'asiKt', climb, 'speedClimbApproach', { settleS: 6, activeWhen: gt('aglFt', 200), required: req }),
      hold(`${o.id}Hdg`, 'Runway track', 'hdgDeg', RWY_HDG, 'heading', { settleS: 4, activeWhen: gt('aglFt', 50), required: req }),
      binary(`${o.id}Flaps`, 'Take-off flap setting', all(gt('kias', 30), eq('onGround', true), gt('flapsDeg', o.flapsMax ?? 2)), { required: req }),
      ...(o.extra ?? []),
    ],
  });
}

/**
 * Climb-out, crosswind and downwind at circuit height (L10): circuit height on downwind, the downwind spacing
 * 0.6-1.1 NM from the runway, and the downwind speed. Ends when the aircraft turns base.
 */
export function downwindTask(o: TaskOpts & { heightTol?: TolRef }): TaskStep {
  const req = o.required ?? true;
  const onDw = leg('downwind');
  return task({
    id: o.id, exercise: o.exercise, brief: o.brief, ...pf(o), ...instruction(o),
    card: { title: 'Circuit: downwind at 1,000 ft', targets: [height(CCT_HEIGHT, o.heightTol ?? 'altitude'), ias(vs('Vdownwind')),
      { label: 'SPACING', sig: 'downwindOffsetNm', value: 0.85, tol: 0.25, unit: 'nm' }] },
    goal: leg('base', 'final'), timeoutS: o.timeoutS ?? 420, onTimeout: 'fail',
    coach: o.coach ?? ['circuitHeight', 'downwindSpacing', 'speed', 'ball'],
    criteria: [
      hold(`${o.id}Hgt`, 'Circuit height on downwind', 'hafFt', CCT_HEIGHT, o.heightTol ?? 'altitude', { settleS: 10, activeWhen: onDw, required: req }),
      hold(`${o.id}Space`, 'Downwind spacing', 'downwindOffsetNm', 0.85, 0.25, { settleS: 10, activeWhen: onDw, required: req, chart: false }),
      // Until abeam the threshold, where the briefed slow-down (1,500 rpm, flap 10) begins.
      hold(`${o.id}Ias`, 'Downwind speed', 'asiKt', vs('Vdownwind'), 'speed', { settleS: 10, activeWhen: all(onDw, gt('rwyAlongM', 150)), required: false }),
      ...(o.extra ?? []),
    ],
  });
}

/**
 * Base, final and the landing to a full stop: stabilised gate, glide path, the landing items, and the roll-out.
 * Ends on the `stopped` event after a landing. `slope`: 'required' grades the 3-degree path, 'shown' charts it
 * without counting, 'none' leaves it out. `safeOnly` keeps only the safety items of the landing (on the
 * runway, mains first) and the sink limit (`sinkTol`): the first solo's "landing safe".
 */
export function approachLandingTask(o: TaskOpts & { vref?: Ref; flapsMin?: number; zone?: 'touchdownZoneFt' | 'touchdownZoneShortFt'; slope?: 'required' | 'shown' | 'none'; safeOnly?: boolean; sinkTol?: TolRef }): TaskStep {
  const req = o.required ?? true;
  const vref = o.vref ?? vs('Vref');
  let landing = landingCriteria({ prefix: o.id, standard: o.standard, vref, zone: o.zone, required: req, sinkTol: o.sinkTol });
  if (o.safeOnly) landing = landing.filter((c) => c.safety || c.id === `${o.id}sink`);
  const slopeMode = o.slope ?? 'shown';
  const criteria: Criterion[] = [
    ...stabilisedGate({ prefix: o.id, vref, flapsMin: o.flapsMin, required: req }),
    ...landing,
    ...(slopeMode === 'none' ? [] : [glidepathHold(`${o.id}Slope`, slopeMode === 'required' && req)]),
    ...(o.extra ?? []),
  ];
  return task({
    id: o.id, exercise: o.exercise, brief: o.brief, ...pf(o), ...instruction(o),
    card: { title: 'Approach and landing', targets: [ias(vref, 'speedClimbApproach'), slope(), centreline(45)] },
    goal: all(ev('landing'), ev('stopped')), timeoutS: o.timeoutS ?? 420, onTimeout: 'fail',
    coach: o.coach ?? ['approachSpeed', 'glidepath', 'centreline', 'flare'],
    criteria,
  });
}

/** A go-around flown on the instructor's call (L11): power within 3 s, climbing within 8 s, no flap retraction below 60 kt. */
export function goAroundCriteria(prefix: string, required = true): Criterion[] {
  return [
    check(`${prefix}Power`, 'Full power within 3 s', { pred: gt('throttle', 0.9), withinS: 3, required }),
    check(`${prefix}Climb`, 'Climbing within 8 s', { pred: held(gt('vsFpm', 0), 1), withinS: 8, required }),
    peak(`${prefix}Vx`, 'Lowest speed in the go-around', 'kias', vs('Vx'), { minus: 0, plus: 200 }, { peakOf: 'min', required }),
    binary(`${prefix}Flaps`, 'Flap retracted in stages above 60 kt', all(lt('flapsDeg', 5), lt('kias', 60), airborne), { required }),
    hold(`${prefix}Hdg`, 'Runway heading', 'hdgDeg', RWY_HDG, 10, { settleS: 4, required }),
  ];
}

/** Within [lo, hi] (inclusive), with the signal's default hysteresis. */
export const between = (sig: Parameters<typeof ge>[0], lo: Ref, hi: Ref): Pred => all(ge(sig, lo), le(sig, hi));
