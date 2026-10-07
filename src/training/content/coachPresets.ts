// Coach presets (section 3.6.3): generic rules bound to the task card target with the matching signal
// (speed -> asiKt, altitude -> altFt, heading -> hdgDeg, bank -> aiBankDeg, vs -> vsiFpm). Lesson data names a
// preset and its card, nothing more; the rule that comes out is ordinary CoachRule data, so the coach treats
// presets and hand-written rules identically.
//
// The rung captions are inline cues (not LINES ids) so a preset is complete on its own and the linter can check
// it like any other line (at most 20 words). Their templates use the variables the coach supplies with every
// remark (coach.ts remarkVars): value, target, dev, dir, side/Side, nose, lead, limit.

import { AIRPORT } from '../../core/world';
import { all, any, eq, ge, gt, le, leg, lt, near, not } from '../engine/dsl';
import type { CoachLevel, CoachPresetId, CoachRule, CueRef, InlineCue, Lesson, Pred, Ref, SignalId, TaskCard, TaskStep, TolKey, TolRef } from '../types';

/** Runway 07 true heading, degrees: the track a final approach should hold. */
const RWY07_TRUE_DEG = Math.round((AIRPORT.runway.heading * 180) / Math.PI);
/** "Final > 1 NM": further than this before the 07 threshold (rwyAlongM is measured from it, + along 07). */
const ONE_NM_M = 1852;

// Coach priorities (types.ts CoachRule.priority): 0 safety, 1 energy and path, 2 attitude and balance, 3 refinement.
type RulePriority = CoachRule['priority'];
/** The lowest coach level that still hears a rule of this priority (section 3.6.1 rule 6). */
const MIN_LEVEL: Record<RulePriority, CoachLevel> = { 0: 'silent', 1: 'minimal', 2: 'reduced', 3: 'full' };

/**
 * levelOff: height-to-go bands, ft, from 20 ft (closer, the remark would come too late to help, and a level-off
 * flown with a lagging hand still shows 300 fpm there) to 80 ft.
 */
const LEVEL_OFF_BANDS: readonly [number, number][] = [[20, 30], [30, 40], [40, 50], [50, 60], [60, 70], [70, 80]];
/** levelOff: a rate above this many fpm per foot to go has not begun levelling (a 10 % lead flies about 10). */
const LATE_FPM_PER_FT = 14;

const line = (text: string | string[]): InlineCue => ({ text });
const PRAISE_FIXED: CueRef = line(["That's better.", 'Good, that\'s fixed.', 'Nicely corrected.']);

/** Scale a tolerance reference (a preset fires at 0.7 or 0.8 of the card tolerance). */
export function scaleTol(tol: TolRef, k: number): TolRef {
  if (typeof tol === 'number') return tol * k;
  if (typeof tol === 'string') return { key: tol, scale: k };
  if ('key' in tol) return { key: tol.key, scale: tol.scale * k };
  return { minus: tol.minus * k, plus: tol.plus * k };
}

interface Bound { sig: SignalId; value: Ref; tol: TolRef }

/** The first card target on one of `sigs`, with `fallback` when the card gives no tolerance. */
function cardTarget(card: TaskCard, sigs: readonly SignalId[], fallback: TolKey): Bound | null {
  const t = card.targets.find((x) => sigs.includes(x.sig));
  return t ? { sig: t.sig, value: t.value, tol: t.tol ?? fallback } : null;
}

/**
 * Preset tuning (owner playtest: an ab-initio student heard nothing while flying). `kScale` scales the fraction of
 * the card tolerance at which a target preset speaks; `afterS` caps every preset's persistence.
 */
export interface PresetTuning { kScale?: number; afterS?: number }
/**
 * Stage 1 (L01-L08): target presets speak at 0.85 of their usual threshold (speed at 0.6 of the card tolerance
 * rather than 0.7) and after 2 s rather than 3, so a first-lesson student hears about a drift while it is still
 * small. The coach's own ab-initio gaps (engine/coach.ts) apply on top.
 */
export const AB_INITIO_TUNING: PresetTuning = { kScale: 0.85, afterS: 2 };

let tuning: PresetTuning | undefined;

function rule(
  id: CoachPresetId, priority: RulePriority, when: Pred, afterS: number, say: CoachRule['say'],
  extra: Partial<Pick<CoachRule, 'correcting' | 'praise' | 'offerDemo'>> = {},
): CoachRule {
  const a = tuning?.afterS !== undefined ? Math.min(afterS, tuning.afterS) : afterS;
  return { id, topic: id, when, afterS: a, say, priority, minLevel: MIN_LEVEL[priority], ...extra };
}

/** A target-tracking preset: fires when the error exceeds `k` of the card tolerance. */
function targetRule(id: CoachPresetId, priority: RulePriority, b: Bound, k: number, say: CoachRule['say']): CoachRule {
  return rule(id, priority, not(near(b.sig, b.value, scaleTol(b.tol, k * (tuning?.kScale ?? 1)))), 3, say, {
    correcting: { sig: b.sig, target: b.value },
    praise: PRAISE_FIXED,
    offerDemo: priority <= 1,
  });
}

/** The rule a preset produces for a card; null when the card has no target the preset can bind to. */
export function bindPreset(id: CoachPresetId, card: TaskCard, tune?: PresetTuning): CoachRule | null {
  tuning = tune;
  try {
    return bindPresetTuned(id, card);
  } finally {
    tuning = undefined;
  }
}

function bindPresetTuned(id: CoachPresetId, card: TaskCard): CoachRule | null {
  switch (id) {
    case 'speed': {
      const b = cardTarget(card, ['asiKt', 'kias'], 'speed');
      return b && targetRule(id, 1, b, 0.7, [
        line(["Speed's {dir}, {value:kt}.", 'Watch the speed: {value:kt}.']),
        line('Nose {nose} a touch; let the speed settle.'),
        line('Attitude first: set it, hold it, wait for the speed.'),
      ]);
    }
    case 'altitude': {
      const b = cardTarget(card, ['altFt'], 'altitude');
      return b && targetRule(id, 1, b, 0.7, [
        line(['{dev:alt}.', 'Check your altitude: {dev:alt}.']),
        line('Small pitch change, then trim.'),
        line('Pick an attitude on the horizon and hold it.'),
      ]);
    }
    case 'vs': {
      const b = cardTarget(card, ['vsiFpm', 'vsFpm'], 'vs');
      return b && targetRule(id, 1, b, 0.8, [
        line("Rate's {value:fpm}, we want {target:fpm}."),
        line('Adjust the power for the rate, attitude for the speed.'),
      ]);
    }
    case 'heading': {
      const b = cardTarget(card, ['hdgDeg'], 'heading');
      return b && targetRule(id, 3, b, 0.7, [
        line("Heading's drifting {side}, {value:hdg}."),
        line('Pick a point on the horizon.'),
      ]);
    }
    case 'bank': {
      const b = cardTarget(card, ['aiBankDeg', 'bankDeg'], 'bankMedium');
      return b && targetRule(id, 2, b, 0.8, [
        line('Bank {value:deg}, we want {target:deg}.'),
        line('Check the attitude indicator.'),
      ]);
    }
    case 'ball':
      return rule(id, 2, any(gt('ball', 0.35), lt('ball', -0.35)), 3, [
        line("Ball's out {side}."),
        line('{Side} rudder: step on the ball.'),
      ], { correcting: { sig: 'ball', target: 0 }, praise: line('Balanced. Good.') });
    case 'trim':
      // untrimmedS is itself a duration (> 10 s holding pressure), so the rule needs only a short persistence.
      return rule(id, 3, gt('untrimmedS', 10), 1, [line("You're holding pressure. Trim it out: Home or End.")]);
    case 'levelOff': {
      const b = cardTarget(card, ['altFt'], 'altitude');
      if (!b) return null;
      // Spec: "within 1.2 x 10 % of VS of the target and no pitch change started". A level-off begun at 10 % of
      // the rate and flown smoothly arrives with the rate falling in step with the height to go (about 10 fpm per
      // foot: 500 fpm at 50 ft, 300 fpm at 30 ft); one not yet begun still has its full rate there. Predicates
      // cannot multiply signals, so the height to go is cut into 10 ft bands and the remark is made when the rate
      // in a band is more than 14 fpm per foot of the band's far edge (and over 300 fpm): late and not yet
      // levelling (700 fpm with 40 ft to go; 420 fpm with 30). (Wave-3
      // calibration: the earlier fixed 75 ft band spoke during every correct level-off from a 700 fpm climb.)
      // The bands use a 2 ft hysteresis (altFt's default 20 ft would blur 10 ft bands). The remark quotes the true
      // 10 % lead ({lead}).
      const late = (sign: 1 | -1): Pred => any(...LEVEL_OFF_BANDS.map(([near, far]) => {
        const rate = Math.max(300, LATE_FPM_PER_FT * far);
        return sign > 0
          ? all(gt('vsiFpm', rate), gt('altFt', add(b.value, -far), 2), le('altFt', add(b.value, -near), 2))
          : all(lt('vsiFpm', -rate), lt('altFt', add(b.value, far), 2), ge('altFt', add(b.value, near), 2));
      }));
      return rule(id, 1, any(late(1), late(-1)), 0.3, [
        line('Start levelling now.'),
        line('Lead by 10 % of your rate: about {lead:alt} early.'),
      ]);
    }
    case 'flapLimit':
      // Taught as "flap only in the white arc" (VfeFull) for every stage, the conservative training rule, even
      // though the POH allows the first stage up to Vfe10.
      return rule(id, 0, all(gt('flapsDeg', 0.5), gt('kias', { vspeed: 'VfeFull' })), 1, [
        line('Flap above the white arc: speed back below {limit:kt}.'),
      ]);
    case 'stallWarning':
      return rule(id, 0, eq('stallWarn', true), 0.5, [line('Stall warning: lower the nose, add power.')]);
    case 'rpmRedline':
      return rule(id, 0, gt('rpm', 2700), 1, [line('Watch the RPM, red line.')]);
    case 'approachSpeed': {
      const vref: Ref = { vspeed: 'Vref' };
      return rule(id, 1, all(leg('final'), not(near('asiKt', vref, 'speedClimbApproach'))), 3, [
        line('Speed {value:kt}, we want {target:kt}.'),
      ], { correcting: { sig: 'asiKt', target: vref }, praise: PRAISE_FIXED });
    }
    case 'centreline':
      // Off the line and not heading back to it (a track at least 1 degree toward the centreline is a correction
      // already flown: wave-3 calibration, the remark otherwise came while intercepting from the base turn).
      return rule(id, 1, all(leg('final'), any(
        all(gt('rwyAcrossM', 15), ge('trackDeg', RWY07_TRUE_DEG - 1)),
        all(lt('rwyAcrossM', -15), le('trackDeg', RWY07_TRUE_DEG + 1)),
      )), 3, [
        line('Drifting {side} of the centreline.'),
        line('More into wind.'),
      ], { correcting: { sig: 'rwyAcrossM', target: 0 }, praise: PRAISE_FIXED });
    case 'glidepath':
      return rule(id, 1, all(leg('final'), lt('rwyAlongM', -ONE_NM_M), any(gt('gpDevFt', 100), lt('gpDevFt', -100))), 3, [
        line("You're {dev:alt} on the slope. Check the PAPI."),
        line('Power for the slope, attitude for the speed.'),
      ], { correcting: { sig: 'gpDevFt', target: 0 }, praise: PRAISE_FIXED });
    case 'flare':
      // Still sinking at approach rate with the wheels about 10 ft up (aglFt reads about 4 ft on the wheels): the
      // round-out has not started. (Wave-3 calibration: at 20 ft aglFt a normal 3 degree approach still sinks
      // 400 fpm, so the remark came before every flare.)
      return rule(id, 0, all(lt('aglFt', 14), eq('onGround', false), lt('vsFpm', -400)), 0.3, [line('Hold it off... hold it off.')]);
    case 'crosswindDrift':
      // On the centreline the track equals the runway heading whatever the crab, so the track error is the
      // "drift beyond the crab needed". Drifting means moving away from the line: a track error toward the
      // centreline from either side is an intercept, not drift.
      return rule(id, 1, all(leg('final'), any(
        all(gt('trackDeg', RWY07_TRUE_DEG + 3), gt('rwyAcrossM', -5)),
        all(lt('trackDeg', RWY07_TRUE_DEG - 3), lt('rwyAcrossM', 5)),
      )), 3, [
        line("You're drifting {side}; more into wind."),
      ], { correcting: { sig: 'trackDeg', target: RWY07_TRUE_DEG } });
    case 'circuitHeight': {
      const h: Ref = { setting: 'patternAglFt' };
      return rule(id, 1, all(leg('downwind'), not(near('hafFt', h, 100))), 3, [
        line("Circuit height is {target:alt}; you're {dev:alt}."),
      ], { correcting: { sig: 'hafFt', target: h }, praise: PRAISE_FIXED });
    }
    case 'downwindSpacing':
      return rule(id, 2, all(leg('downwind'), any(lt('downwindOffsetNm', 0.6), gt('downwindOffsetNm', 1.1))), 3, [
        line("You're {dir} on downwind; aim the wingtip just along the runway."),
      ], { correcting: { sig: 'downwindOffsetNm', target: 0.85 } });
    case 'lookout':
      // Head movement is not modelled in v1: the preset stays valid in lesson data and binds to nothing.
      return null;
    default:
      return null;
  }
}

/**
 * A preset bound to a card target speaks only while the task grades that target (wave-3 calibration): when
 * every hold criterion on the preset's signal and target has an `activeWhen` (the climb speed until 150 ft short
 * of the level-off, the bank while established in the turn, the glide speed on base and final, ...), the rule
 * is gated by the same condition. Without the gate the coach told a student rolling out of a turn "Bank 11,
 * we want 30", or a student levelled off after a climb that the speed was fast. Presets with their own
 * conditions (circuit legs, final approach) and targets nothing grades stay as they are. Applied to every task
 * by the syllabus `task` builder (syllabus/common.ts).
 */
export function gateCoach(step: TaskStep): TaskStep {
  if (!step.coach?.length) return step;
  const coach = step.coach.map((entry) => {
    if (typeof entry !== 'string') return entry;
    const rule = bindPreset(entry, step.card);
    const c = rule?.correcting;
    if (!rule || !c) return entry;
    const holds = step.criteria.filter((x) => x.kind === 'hold' && x.sig === c.sig && sameRef(x.target, c.target));
    const gates = holds.map((x) => x.activeWhen).filter((p): p is Pred => p !== undefined);
    if (gates.length === 0 || gates.length < holds.length) return entry;
    return { ...rule, when: all(rule.when, gates.length === 1 ? gates[0] : any(...gates)) };
  });
  return { ...step, coach };
}

/** A card-bound preset that speaks only while `gate` holds (e.g. the bank while still turning). */
export function presetWhile(id: CoachPresetId, card: TaskCard, gate: Pred): CoachRule {
  const rule = bindPreset(id, card);
  if (!rule) throw new Error(`coach preset '${id}' does not bind to the card '${card.title}'`);
  return { ...rule, when: all(rule.when, gate) };
}

/**
 * A task's presets re-bound with `tune` (stage 1: AB_INITIO_TUNING). A preset named by id becomes its tuned rule;
 * a preset already bound and gated (gateCoach, presetWhile: `all(rule.when, gate)`) keeps its gate around the
 * tuned condition. Hand-written rules are left as they are.
 */
export function tuneCoach(step: TaskStep, tune: PresetTuning): TaskStep {
  if (!step.coach?.length) return step;
  const coach = step.coach.map((entry) => {
    if (typeof entry === 'string') return bindPreset(entry, step.card, tune) ?? entry;
    if (!(entry.id in PRESET_IDS)) return entry;
    const id = entry.id as CoachPresetId;
    const base = bindPreset(id, step.card);
    const tuned = bindPreset(id, step.card, tune);
    if (!base || !tuned) return entry;
    const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
    if (same(entry, base)) return tuned;
    const w = entry.when;
    if ('all' in w && w.all.length >= 2 && same(w.all[0], base.when) && same({ ...entry, when: base.when }, base)) {
      return { ...tuned, when: all(tuned.when, ...w.all.slice(1)) };
    }
    return entry;
  });
  return { ...step, coach };
}

/** Every task of a lesson with its presets tuned (stage 1). */
export function tuneLessonCoach(lesson: Lesson, tune: PresetTuning = AB_INITIO_TUNING): Lesson {
  return { ...lesson, flow: lesson.flow.map((p) => ({ ...p, steps: p.steps.map((s) => (s.kind === 'task' ? tuneCoach(s, tune) : s)) })) };
}

const PRESET_IDS: Record<CoachPresetId, 1> = {
  speed: 1, altitude: 1, heading: 1, bank: 1, ball: 1, trim: 1, levelOff: 1, vs: 1, flapLimit: 1, stallWarning: 1, rpmRedline: 1,
  approachSpeed: 1, centreline: 1, glidepath: 1, flare: 1, crosswindDrift: 1, circuitHeight: 1, downwindSpacing: 1, lookout: 1,
};

const sameRef = (a: Ref | undefined, b: Ref): boolean => a !== undefined && JSON.stringify(a) === JSON.stringify(b);

/** `ref + k` (refs are data, so the offset is folded into `add`). */
function add(ref: Ref, k: number): Ref {
  if (typeof ref === 'number') return ref + k;
  return { ...ref, add: (ref.add ?? 0) + k };
}
