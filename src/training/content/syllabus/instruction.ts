// Ab-initio instruction (owner playtest of L01: "There is no feedback from the instructor while the lesson is in
// progress"; "The instructor should take control back if the limits are exceeded"). Builders for the two task
// fields that carry it (types.ts TaskFeedback, TaskLimit):
//
//   feedback  what Kate says while the student flies the task: a 'start' line that says exactly what to do and
//             what to look at, 2-4 milestones that acknowledge progress the way an FI does ("That's it, the nose
//             is coming up."), a 'success' line that confirms and teaches the point, and a nudge for when nothing
//             happens.
//   limits    the lesson limits of the exercise: past one, she takes control ("I have control" is the runner's,
//             at Safety priority), says the limit's line (the reason and what she will do), restores straight
//             and level, and hands back; the task restarts.
//
// Lines are inline cues (like the coach presets): one builder serves several lessons, and the linter checks
// every line where it is used (20 words, templates). Numbers are written as digits; the phraseology renderer
// speaks them. Milestone predicates are written so that each one can only hold after the ones before it
// (`ever` of the earlier condition, or a later point of the same manoeuvre), so they read in order whatever
// order the runner evaluates them in.

import { all, any, ev, ever, ge, gt, held, le, lt, near, not, turned, v, vs } from '../../engine/dsl';
import type { CoachLevel, CoachRule, InlineCue, MissingItem, Pred, Ref, TaskFeedback, TaskLimit } from '../../types';

// ---- lines --------------------------------------------------------------------------------------------------

/** An inline instructor line (1-3 variants). */
export const line = (text: string | string[]): InlineCue => ({ text });

type Milestone = NonNullable<TaskFeedback['milestones']>[number];

/** Time-to-live of a start line, s: the brief ahead of it may take 10 s or more. */
const START_TTL_S = 25;
/** Nudge timing (the runner defaults are 12 s and 15 s). */
const NUDGE_AFTER_S = 20;
const NUDGE_EVERY_S = 30;

/** A milestone: spoken once when `when` first holds (and `minT` s into the task). */
export const ms = (id: string, when: Pred, text: string | string[], minT?: number): Milestone =>
  (minT === undefined ? { id, when, cue: line(text) } : { id, when, cue: line(text), minT });

export interface FeedbackSpec {
  start?: string | string[];
  milestones?: Milestone[];
  success?: string | string[];
  nudge?: string | string[];
  /** What can still be missing, in order: the nudge names the first that holds, and is silent when none does. */
  nudgeMissing?: MissingItem[];
  /** Seconds of silence before the first nudge (runner default 12). */
  nudgeAfterS?: number;
  /** Least gap between nudges (runner default 15). */
  nudgeEveryS?: number;
}

/** TaskFeedback from plain lines. */
export function feedback(o: FeedbackSpec): TaskFeedback {
  const f: TaskFeedback = {};
  // The start line follows the brief in the queue: its time-to-live runs from the task's entry, so it must outlast
  // a long brief (with the default 8 s it was dropped behind every brief over about six seconds).
  if (o.start !== undefined) f.start = { ...line(o.start), ttlS: START_TTL_S };
  if (o.milestones?.length) f.milestones = o.milestones;
  if (o.success !== undefined) f.success = line(o.success);
  if (o.nudge !== undefined) {
    // 20 s of silence before a nudge, then at most every 30 s: in a manoeuvre flown well the goal is simply not
    // reached yet (a turn half way round, a climb not yet at its altitude), and a nudge there is noise.
    const n: NonNullable<TaskFeedback['nudge']> = { cue: line(o.nudge), afterS: o.nudgeAfterS ?? NUDGE_AFTER_S, everyS: o.nudgeEveryS ?? NUDGE_EVERY_S };
    if (o.nudgeMissing?.length) n.missing = o.nudgeMissing;
    f.nudge = n;
  }
  return f;
}

/** The fields a task builder spreads in: only the ones given (lessons are plain JSON, no undefined keys). */
export function instruction(o: { feedback?: TaskFeedback; limits?: TaskLimit[] }): { feedback?: TaskFeedback; limits?: TaskLimit[] } {
  const out: { feedback?: TaskFeedback; limits?: TaskLimit[] } = {};
  if (o.feedback) out.feedback = o.feedback;
  if (o.limits?.length) out.limits = o.limits;
  return out;
}

// ---- state-driven reminders ------------------------------------------------------------------------------------

export interface ReminderSpec {
  id: string;
  /** The thing still missing or wrong (the rule's `when`): each reminder is about one fact of the state. */
  when: Pred;
  /** Seconds it must persist before the first reminder. */
  afterS: number;
  /**
   * The escalation, each a different wording (never the previous line again): what is missing, then how to fix
   * it (the control, its position), then the reason. The coach escalates on its own timer and resets when
   * `when` stops holding.
   */
  say: [string, string?, string?];
  /** Coach priority (0 safety, 1 energy and path, 2 attitude and balance, 3 refinement; default 1). */
  priority?: CoachRule['priority'];
  /** Dropped below this coach level (default 'reduced'; safety reminders 'silent'). */
  minLevel?: CoachLevel;
  praise?: string;
  /** The third rung offers "Show me" ([) instead of a third line (a task with a demonstration only). */
  offerDemo?: boolean;
  /** The control the reminder names: the UI points at it while it is said. */
  point?: CoachRule['point'];
}

/**
 * A hand-written coach rule that says what is still missing (owner playtest: "the instructor is just repeating
 * the same thing, without consideration for what the student needs to know"). One rule per missing item, so
 * the line names exactly that item, from the state, instead of restating the whole instruction.
 */
export function reminder(o: ReminderSpec): CoachRule {
  const say = o.say.filter((x): x is string => x !== undefined).map((t) => line(t)) as CoachRule['say'];
  const r: CoachRule = { id: o.id, topic: o.id, when: o.when, afterS: o.afterS, say, priority: o.priority ?? 1, minLevel: o.minLevel ?? 'reduced' };
  if (o.praise !== undefined) r.praise = line(o.praise);
  if (o.offerDemo) r.offerDemo = true;
  if (o.point) r.point = o.point;
  return r;
}

// ---- limits -------------------------------------------------------------------------------------------------

/**
 * What she says after "I have control": the reason, and what she is about to do, so the recovery is itself a
 * demonstration. Calm; never a reproach.
 */
export const LIMIT_LINES = {
  bank: line(["That's more bank than we want today. I'll roll the wings level; watch the attitude indicator.",
    "We're past the bank limit for this exercise. Watch me roll the wings level."]),
  pitchHigh: line(["The nose is too high and the speed's falling away. I'll lower it to the horizon; watch.",
    "That's too much nose-up. Watch me put the horizon back where it belongs."]),
  pitchLow: line(["The nose is too low and the speed's building. I'll ease it back up to the horizon.",
    "That's too much nose-down. Watch me bring the nose back to the horizon, gently."]),
  slow: line(["The speed's too low for this exercise. Nose down a little and it comes back; watch the airspeed.",
    "We're getting slow. Watch me lower the nose and add power to get the speed back."]),
  fast: line(["The speed's getting high. I'll raise the nose gently and take some power off.",
    "Too fast for this exercise. Watch me ease the nose up and bring the power back."]),
  high: line(["We've climbed well above our altitude. I'll bring us back down; watch the altimeter.",
    "We're too high for this exercise. Watch how I lower the nose a little to get it back."]),
  low: line(["We've lost too much height. I'll bring us back up; watch the altimeter.",
    "We're too low for this exercise. Watch me raise the nose a little and add power."]),
} as const;

export interface LimitSpec {
  /** |aiBankDeg| beyond this, deg. */
  bank?: number;
  /** aiPitchDeg above this, deg. */
  pitchUp?: number;
  /** aiPitchDeg below this (negative), deg. */
  pitchDown?: number;
  /** asiKt below / above, KIAS. */
  minKias?: Ref;
  maxKias?: Ref;
  /** altFt band around a run variable: more than `below` ft under it, more than `above` ft over it. */
  alt?: { var: string; below?: number; above?: number };
  /** Persistence, s (runner default 1.5). */
  forS?: number;
}

/** The lesson limits of an exercise (TaskLimit[]): one limit per side, each with its own line. */
export function limits(o: LimitSpec): TaskLimit[] {
  const out: TaskLimit[] = [];
  const add = (l: TaskLimit): void => { out.push(o.forS === undefined ? l : { ...l, forS: o.forS }); };
  if (o.bank !== undefined) {
    add({ id: 'bankLeft', sig: 'aiBankDeg', min: -o.bank, cue: LIMIT_LINES.bank });
    add({ id: 'bankRight', sig: 'aiBankDeg', max: o.bank, cue: LIMIT_LINES.bank });
  }
  if (o.pitchUp !== undefined) add({ id: 'pitchUp', sig: 'aiPitchDeg', max: o.pitchUp, cue: LIMIT_LINES.pitchHigh });
  if (o.pitchDown !== undefined) add({ id: 'pitchDown', sig: 'aiPitchDeg', min: o.pitchDown, cue: LIMIT_LINES.pitchLow });
  if (o.minKias !== undefined) add({ id: 'slow', sig: 'asiKt', min: o.minKias, cue: LIMIT_LINES.slow });
  if (o.maxKias !== undefined) add({ id: 'fast', sig: 'asiKt', max: o.maxKias, cue: LIMIT_LINES.fast });
  if (o.alt?.below !== undefined) add({ id: 'low', sig: 'altFt', min: v(o.alt.var, -o.alt.below), cue: LIMIT_LINES.low });
  if (o.alt?.above !== undefined) add({ id: 'high', sig: 'altFt', max: v(o.alt.var, o.alt.above), cue: LIMIT_LINES.high });
  return out;
}

/** Stage-1 upper-air defaults: wings within 30 deg (turns: 15 beyond the target), pitch +20/-15. */
export const HANDLING = { pitchUp: 20, pitchDown: -15 } as const;

// ---- feedback for the shared manoeuvres -------------------------------------------------------------------------

const absGe = (sig: 'aiBankDeg', x: number): Pred => any(ge(sig, x), le(sig, -x));

/** Straight and level for a while (L03): the scan, then praise for holding it. */
export function straightLevelFeedback(o: { altVar: string; hdgVar: string; kias: Ref; seconds: number }): TaskFeedback {
  const steady = all(near('altFt', v(o.altVar), 60), near('hdgDeg', v(o.hdgVar), 5));
  const m: Milestone[] = [
    ms('steady', held(steady, 8), ["That's it: altitude and heading steady. Now eyes back outside.",
      'Good, nice and steady. Most of your time looking outside, on the attitude.'], 8),
    ms('scan', all(held(near('altFt', v(o.altVar), 100), 10), { elapsed: Math.min(40, o.seconds * 0.4) }),
      ['Good scan. Lookout, attitude, instruments, then back to the attitude.', 'Nicely held. Lookout, attitude, instruments: keep that cycle going.']),
  ];
  if (o.seconds >= 90) {
    m.push(ms('trimCheck', all(lt('untrimmedS', 1), { elapsed: o.seconds * 0.7 }),
      ['Is it trimmed? Relax your grip for a moment and see if it holds.', 'Try a moment hands-light: a trimmed aircraft holds its attitude for you.']));
  }
  return feedback({
    start: ['Go ahead. Pick a point on the horizon, hold the attitude, and glance at the altimeter.',
      'Your aircraft. Nose on a point ahead, wings level; check the altimeter every few seconds.'],
    milestones: m,
    success: ['Good. Attitude holds the altitude, power sets the speed. That is straight and level.',
      "That's straight and level: lookout, attitude, instruments, small corrections. Well done."],
    nudge: ['Small corrections: move the nose a touch, hold it, and let the altimeter settle.',
      'Lookout, attitude, instruments. Keep the nose on your point ahead.'],
    // A timed task: the goal is "not met" until the time is up however well it is flown, so the reminder is rare.
    nudgeAfterS: 30, nudgeEveryS: 45,
  });
}

/** Climb at `kias` and level off at `tgtVar` (L04, L19). */
export function climbFeedback(o: { tgtVar: string; kias?: Ref; instrument?: boolean }): TaskFeedback {
  const kias = o.kias ?? vs('Vy');
  const look = o.instrument ? 'Attitude indicator first,' : 'Lookout above first,';
  return feedback({
    start: [`Go ahead. ${look} then full power and raise the nose to the climb attitude.`],
    milestones: [
      ms('power', gt('throttle', 0.9), ['Full power, good. A little right rudder keeps the ball in the middle.',
        'Power up. Feel it yaw left? Right rudder to keep the ball centred.'], 1),
      ms('settled', held(all(gt('vsiFpm', 300), near('asiKt', kias, 5)), 4),
        ["That's the climb attitude, and the speed has settled. Now trim the pressure away.",
          'Speed steady in the climb. Good: hold that attitude and trim.']),
      ms('nearly', all(ever(gt('vsiFpm', 300)), ge('altFt', v(o.tgtVar, -150))),
        ['Getting close. At about 50 feet to go, lower the nose to the level attitude.',
          'Coming up on the altitude: lead the level-off by about 50 feet.']),
      ms('level', all(ever(ge('altFt', v(o.tgtVar, -150))), held(all(near('altFt', v(o.tgtVar), 60), near('vsiFpm', 0, 200)), 3)),
        ['Level. Now the power back, then trim. Attitude, power, trim.', "That's level. Power back to cruise, then trim it out."]),
    ],
    success: ['Nicely levelled. Attitude, power, trim, in that order, every time.', 'Good level-off. Attitude, then power, then trim.'],
    nudge: ['Hold the climb attitude and let the speed settle; adjust the nose a little at a time.',
      'Nose up a touch if fast, down a touch if slow. Then wait for it.'],
  });
}

/** Glide (`glide`) or 500 fpm powered descent, and level off at `tgtVar` (L04, L19). */
export function descentFeedback(o: { tgtVar: string; glide?: boolean; instrument?: boolean }): TaskFeedback {
  const look = o.instrument ? 'Attitude indicator first,' : 'Lookout below first,';
  const near150 = ms(o.glide ? 'nearlyG' : 'nearlyD', all(ever(lt('vsiFpm', -300)), le('altFt', v(o.tgtVar, 150))),
    o.glide ? ['Coming up on the altitude: power on, nose to the level attitude, then trim.',
      'Nearly there. At 50 feet to go, power on and raise the nose to level.']
      : ['Fifty feet to go: power up to cruise, raise the nose to level, trim.',
        'Coming up on the altitude: lead it by 50 feet, power on, nose up to level.']);
  const level = ms('level', all(ever(le('altFt', v(o.tgtVar, 150))), held(all(near('altFt', v(o.tgtVar), 60), near('vsiFpm', 0, 200)), 3)),
    ['Level. Cruise power, and trim.', "That's level. Check the power and trim it out."]);
  if (o.glide) {
    return feedback({
      start: [`Go ahead. ${look} then close the throttle and lower the nose to hold {vspeed.Vglide:kt}.`],
      milestones: [
        ms('idle', lt('throttle', 0.1), ['Throttle closed. Feel the nose want to drop? Hold it at the glide attitude.',
          'Power off. Let the nose come down to the glide attitude.'], 1),
        ms('gliding', held(all(lt('vsiFpm', -300), near('asiKt', vs('Vglide'), 5)), 4),
          ["That's it: glide speed steady. Trim it, and let it glide.", 'Good glide. Speed steady: trim the pressure away.']),
        near150, level,
      ],
      success: ['Good. In the glide the attitude holds the speed. Power on to level off.'],
      nudge: ['Attitude for speed: nose down a touch if slow, up a touch if fast.',
        'Hold {vspeed.Vglide:kt} with the attitude, then trim.'],
    });
  }
  return feedback({
    start: [`Go ahead. ${look} then power back to about {setting.descentRpm:rpm}, and hold {vspeed.Vdescent:kt}.`],
    milestones: [
      ms('power', lt('rpm', { setting: 'cruiseRpm', add: -200 }), ['Power coming back. Lower the nose a little to keep the speed.',
        'Good, power reduced. Nose down slightly to hold the speed.'], 1),
      ms('settled', held(all(near('vsiFpm', -500, 150), near('asiKt', vs('Vdescent'), 6)), 4),
        ["Five hundred feet a minute at {vspeed.Vdescent:kt}. That's it; trim it.", 'Good: rate and speed both on. Trim it out.']),
      near150, level,
    ],
    success: ['Good. Power sets the rate of descent, attitude holds the speed.'],
    nudge: ['Too slow a rate? A little less power. Speed wandering? Adjust the attitude.',
      'Power for the rate, attitude for the speed. Small changes, then wait.'],
  });
}

/** A level turn through `degrees` at `bankDeg` (L05, L15). */
export function turnFeedback(o: { dir: 'left' | 'right'; bankDeg: number; degrees?: number }): TaskFeedback {
  const sign = o.dir === 'left' ? -1 : 1;
  const deg = o.degrees ?? 360;
  const lead = Math.round(o.bankDeg / 2);
  const banked = sign < 0 ? le('aiBankDeg', -(o.bankDeg - 5)) : ge('aiBankDeg', o.bankDeg - 5);
  const steep = o.bankDeg >= 45;
  const m: Milestone[] = [];
  if (steep) {
    m.push(ms('power', absGe('aiBankDeg', 30), ['Passing 30 degrees: add some power, and firm back pressure.',
      'Through 30 degrees: power on, and more back pressure.'], 1));
  }
  m.push(
    ms('banked', held(banked, 2), [`That's ${o.bankDeg} degrees. Hold it there; keep the nose on the horizon.`,
      `Good, ${o.bankDeg} degrees of bank. A little back pressure holds the height.`]),
    ms('half', all(ever(banked), turned(deg / 2)), ['Halfway round. Keep the bank and the height; lookout through the turn.',
      'Halfway. Nice and steady: bank, nose on the horizon, lookout.']),
    ms('rollout', all(ever(banked), turned(deg - 60)), [`Coming round. Start rolling out about ${lead} degrees before the heading.`,
      `Look for your heading: roll out ${lead} degrees early.`]),
  );
  return feedback({
    start: [`Go ahead. Lookout ${o.dir}, then roll on ${o.bankDeg} degrees and add a little back pressure.`],
    milestones: m,
    success: ['Nicely rolled out. Release the back pressure as the wings come level.',
      steep ? 'Good steep turn. Power and back pressure in, then both out on the roll-out.' : 'Good turn. Lookout, roll, hold the bank, and roll out early.'],
    nudge: [`Hold ${o.bankDeg} degrees on the attitude indicator, and the nose on the horizon.`,
      'Keep the bank constant; a touch more back pressure if the nose drops.'],
  });
}

/** A medium turn onto a heading (L05). */
export function ontoFeedback(o: { dir: 'left' | 'right'; hdgDeg: number }): TaskFeedback {
  return feedback({
    start: [`Go ahead. Lookout ${o.dir}, roll on 30 degrees, and watch the heading indicator come round.`],
    milestones: [
      ms('banked', held(absGe('aiBankDeg', 25), 2), ['Good bank. Now watch the heading: roll out 15 degrees early.',
        "That's the bank. Keep an eye on the heading indicator."]),
      ms('lead', all(ever(absGe('aiBankDeg', 25)), near('hdgDeg', o.hdgDeg, 25)), ['Coming up on the heading: start rolling out now.',
        'Nearly there. Roll out now, smoothly.']),
    ],
    success: ['On heading, wings level. Nicely judged.', 'Right on the heading. Good roll-out.'],
    nudge: ['Keep the bank steady and watch the heading indicator.'],
  });
}

/** Slow flight (L06): clean, full flap, or a gentle turn. */
export function slowFlightFeedback(o: { altVar: string; kias: Ref; flapsDeg?: number; turnDir?: 'left' | 'right' }): TaskFeedback {
  if (o.turnDir) {
    const sign = o.turnDir === 'left' ? -1 : 1;
    const banked = sign < 0 ? le('aiBankDeg', -12) : ge('aiBankDeg', 12);
    return feedback({
      start: [`Go ahead. Lookout ${o.turnDir}, then a gentle ${o.turnDir} turn, 15 degrees. A touch of power holds the height.`],
      milestones: [
        ms('banked', held(banked, 2), ["That's 15 degrees. At this speed, more bank would raise the stall speed.",
          'Good, gentle bank. Watch the speed: it wants to drop in the turn.']),
        ms('half', all(ever(banked), turned(45)), ['Halfway. Keep the height with power, the speed with attitude.']),
      ],
      success: ['Wings level. Gentle turns at low speed: small bank, and watch the speed.'],
      nudge: ['Roll on just 15 degrees, and add a little power to hold the height.'],
    });
  }
  if (o.flapsDeg !== undefined) {
    return feedback({
      start: ['Go ahead. Flap down in stages, checking the speed each time, then slow to {vspeed.Vslow:kt}.'],
      milestones: [
        ms('flap', ge('flapsDeg', o.flapsDeg - 2), ['Full flap. See the nose attitude lower? More power to hold the height.',
          "Flap's down. More drag now, so more power for the same height."]),
        ms('steady', all(ever(ge('flapsDeg', o.flapsDeg - 2)), held(all(near('asiKt', o.kias, 5), near('altFt', v(o.altVar), 100)), 5)),
          ["That's it: slow, level, full flap. Keep the ball in the middle.", 'Good, steady at slow speed with full flap.']),
        ms('ball', all(ever(ge('flapsDeg', o.flapsDeg - 2)), { elapsed: 50 }), ['Check the ball: high power, low speed, it needs right rudder.']),
      ],
      success: ['Good. Full flap lowers the stall speed and the nose, and needs more power.'],
      nudge: ['Power for height, attitude for speed. Small changes, then wait.'], nudgeAfterS: 30, nudgeEveryS: 45,
    });
  }
  return feedback({
    start: ['Go ahead. Power back, and raise the nose to hold the height as the speed decays. Watch the airspeed.'],
    milestones: [
      ms('slowing', lt('asiKt', { vspeed: 'Vcruise', add: -20 }), ['Speed coming back. More nose-up, and some power to hold the height.',
        'Slowing nicely. Raise the nose to hold the height.']),
      ms('steady', held(all(near('asiKt', o.kias, 5), near('altFt', v(o.altVar), 100)), 5),
        ["That's slow flight. Feel how soft the controls are? Bigger, slower movements.", 'Good, steady and slow. The controls feel soft: bigger movements.']),
      ms('ball', all(ever(near('asiKt', o.kias, 8)), { elapsed: 50 }), ['Keep the ball in the middle: right rudder with the power on.']),
    ],
    success: ['Good. At low speed, power holds the height and attitude holds the speed.'],
    nudge: ['Power for height, attitude for speed. Small changes, then wait.'], nudgeAfterS: 30, nudgeEveryS: 45,
  });
}

/** A clearing turn (L07, L15). */
export function clearingTurnFeedback(o: { degrees: number }): TaskFeedback {
  return feedback({
    start: ['Go ahead. Roll into a turn and look out all round: below, behind, and above.'],
    milestones: [
      ms('half', turned(o.degrees / 2), ['Halfway. Keep looking: under the nose and behind the wing.', 'Keep turning, keep looking. Anything below us?']),
      ms('nearly', turned(o.degrees - 30), ['Nearly round. One more look behind and below, then roll level.']),
    ],
    success: ['Clear all round. Now we are ready.', 'All clear. Good lookout.'],
    nudge: ['Roll on about 30 degrees of bank, and keep turning while you look out.'],
  });
}

/** A stall and its recovery (L07). */
export function stallFeedback(o: { at: 'warning' | 'break'; approach?: boolean }): TaskFeedback {
  const ref = o.at === 'warning' ? 'stallWarnOn' : 'stallBreak';
  const start = o.approach
    ? 'Go ahead. Flap 30, power to 1,500 rpm, and hold the height. Recover at the stall.'
    : o.at === 'warning'
      ? 'Go ahead. Throttle closed, hold the height with back pressure. Listen for the stall warning.'
      : 'Go ahead. Throttle closed, keep easing back. Feel the buffet, then the nose drops.';
  return feedback({
    start,
    milestones: [
      ms('symptoms', all(lt('asiKt', vs('Vs1', 20)), gt('aiPitchDeg', 3)), ['Speed falling, nose high. Keep the wings level with rudder.',
        'Nose high, speed low: those are the symptoms. Wings level.']),
      ms('stalled', ev(ref), o.at === 'warning' ? ['There is the warning.', 'Stall warning.'] : ["That's the stall.", 'There it goes.']),
      ms('climbing', all(ev(ref), held(gt('vsFpm', 0), 1)), ['Climbing away. Good: now check the height you lost.', 'Recovered and climbing. Nicely done.']),
    ],
    success: ['Good recovery. Forward to unstall, full power, wings level, climb away.'],
    nudge: o.at === 'warning'
      ? ['Keep easing the control column back to hold the height. Wings level.']
      : ['Keep the control column coming back, wings level, until the nose drops.'],
  });
}

/** Take-off and climb to 500 ft (L08, L10). */
export function takeoffFeedback(): TaskFeedback {
  return feedback({
    start: ['Go ahead. Full power smoothly, keep straight with rudder, and look at the far end of the runway.'],
    milestones: [
      ms('power', all(gt('throttle', 0.9), gt('kias', 20)), ['Full power, airspeed alive. Right rudder to keep straight.',
        'Power set, speed building. Keep it on the centreline.']),
      ms('rotate', gt('kias', vs('Vr', -5)), ['Rotate speed coming up: ease back to the climb attitude.', 'Approaching rotate: gently back.']),
      ms('airborne', all(ev('liftoff'), gt('aglFt', 50)), ['Airborne. Hold the attitude; let it accelerate to {vspeed.Vy:kt}.',
        "We're flying. Hold the attitude and let the speed come to {vspeed.Vy:kt}."]),
      ms('vy', all(ev('liftoff'), gt('aglFt', 200), held(near('asiKt', vs('Vy'), 5), 3)), ["That's {vspeed.Vy:kt}. Keep runway heading and trim for the climb.",
        'Good climb speed. Runway heading, and trim.']),
    ],
    success: ['Five hundred feet. Nice take-off: straight, rotated on speed, climbing at {vspeed.Vy:kt}.'],
    nudge: ['Keep straight with the rudder, and look well ahead along the centreline.'],
    nudgeAfterS: 15,
  });
}

/** Downwind at circuit height (L10-L12): light. */
export function downwindFeedback(): TaskFeedback {
  return feedback({
    start: ['Level at circuit height, runway just along the wingtip. Downwind checks when settled.'],
    milestones: [
      ms('abeam', all({ leg: 'downwind' }, lt('rwyAlongM', 150), gt('rwyAlongM', -300)), ['Abeam the threshold: power back, flap 10, and slow down.',
        'Abeam the threshold now. Power back and the first stage of flap.']),
    ],
    success: ['Turning base. Good downwind.'],
    nudge: ['Hold circuit height, and keep the runway just along the wingtip.'],
    nudgeAfterS: 25, nudgeEveryS: 40,
  });
}

/** Approach and landing (L09-L12, L17, L18): light. */
export function approachFeedback(o: { vref?: Ref } = {}): TaskFeedback {
  const vref = o.vref ?? vs('Vref');
  return feedback({
    start: ['Your approach. Aim point fixed in the windscreen; power for the path, attitude for the speed.'],
    milestones: [
      ms('stable', all({ leg: 'final' }, lt('hafFt', 400), gt('hafFt', 250), near('asiKt', vref, 5)), ['Stable at 300 feet. Keep it coming.',
        "That's a stable approach. Keep the aim point still."]),
      ms('flare', all(lt('aglFt', 25), gt('aglFt', 8)), ['Throttle closed, and start the flare.', 'Now the flare: look ahead, ease back.']),
      ms('down', ev('mainsTouchdown'), ['Down. Keep straight with rudder.', 'On the ground. Straight, and gently brake.']),
    ],
    success: ['Stopped. Nicely done.', "That's a landing. Well done."],
    nudge: ['Watch the PAPI: two white, two red. Power for the slope.'],
    nudgeAfterS: 20, nudgeEveryS: 30,
  });
}

/** Unusual-attitude recovery (L19): what she says as the student recovers. */
export function recoveryFeedback(kind: 'noseLow' | 'noseHigh'): TaskFeedback {
  return feedback({
    milestones: [
      ms('first', kind === 'noseLow' ? lt('throttle', 0.3) : gt('throttle', 0.9),
        kind === 'noseLow' ? ['Power off, good. Now wings level.'] : ['Full power, good. Now the nose down.']),
    ],
    success: ['Good recovery. Read the attitude, then recover in the right order.'],
  });
}

/** Spiral-dive recovery (L15). */
export function spiralFeedback(): TaskFeedback {
  return feedback({
    milestones: [
      ms('power', lt('throttle', 0.3), ['Power off. Now roll the wings level before you pull.'], 0.5),
      ms('level', all(ever(lt('throttle', 0.3)), near('bankDeg', 0, 10)), ['Wings level. Now ease out of the dive, gently.']),
    ],
    success: ['Good. Power off, roll level, then ease out. Never pull in a steep bank.'],
  });
}

/** `|sig| > x` (outside a symmetric band around zero). */
export const beyond = (sig: 'ball' | 'driftDeg' | 'turnRate' | 'rudder', x: number): Pred => not(near(sig, 0, x));
