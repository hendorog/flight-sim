// Global fault rules (spec section 6, "content/globalRules.ts"): faults every lesson watches for, whatever its
// own data says, while the student has control. The runner evaluates them each frame (engine/runner.ts
// tickGlobalFaults); a fault goes to the exercise being flown (the open task's, else the last one flown in the
// phase), with the worst value of the episode in the debrief.
//
// Round 7, item 5: flap extended above the top of the white arc (VfeFull) for more than 2 s is a graded fault,
// not only a coaching line: minor in dual and solo lessons, a failed item (and so a failed section) in the skill
// test, by the spec's fault handling (an item below 2 fails its section; only a critical fault fails the test).

import { all, gt, vs } from '../engine/dsl';
import type { Lesson, Pred, Ref, SignalId } from '../types';

export interface GlobalFaultRule {
  id: string;
  /** The condition; a fault once it has held for `forS`. */
  when: Pred;
  forS: number;
  /** The severity by lesson kind; `failItem` (test) records a minor fault that fails the item it is in. */
  severity: Record<Lesson['kind'], 'minor' | 'major' | 'failItem'>;
  /** The signal whose worst value (max) over the episode is reported, and the limit it is compared with. */
  peak: { sig: SignalId; limit: Ref };
  /** Debrief text: {value} the worst value, {limit} the limit (both rounded). */
  detail: string;
}

export const FLAP_OVERSPEED_HOLD_S = 2;

export const GLOBAL_FAULT_RULES: readonly GlobalFaultRule[] = [
  {
    id: 'flapOverspeed',
    // Any flap out (more than half a degree) above the top of the white arc. Taught as one rule for every
    // stage, as the coach line says, even though the POH allows the first stage up to Vfe10.
    // No hysteresis: a speed latched high while clean must not make flap at exactly the limit a fault (the 2 s
    // hold filters the noise instead).
    when: all(gt('flapsDeg', 0.5, 0), gt('kias', vs('VfeFull'), 0)),
    forS: FLAP_OVERSPEED_HOLD_S,
    severity: { dual: 'minor', solo: 'minor', check: 'minor', test: 'failItem' },
    peak: { sig: 'kias', limit: vs('VfeFull') },
    detail: 'Flap extended at {value} KIAS, above the flap limit speed of {limit} KIAS',
  },
];
