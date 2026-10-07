// Composite criteria: the landing, stall-recovery and unusual-attitude graders (section 3.4) expressed as
// ordinary Criterion data, so lesson files stay plain JSON and need no new step kind.
//
// Convention (the contract has no `grader` field; see the module report): an `atEvent` criterion WITHOUT `sig`
// and WITHOUT `field` names a composite grader by its event:
//   event 'landing'      landing grader; `target` = reference speed at 50 ft (default Vref), `tol` = the
//                        touchdown-zone key (default 'touchdownZoneFt');
//   event 'stallBreak'   stall-recovery grader, height loss from the break;
//   event 'stallWarnOn'  stall-recovery grader, incipient: height loss from the warning;
//   event 'authority'    unusual-attitude grader, from the moment the student has control (nose-high or
//                        nose-low is read from the attitude at that moment).
// One composite criterion produces several CriterionResults with ids `${criterion.id}.${item}`.
// Use the builders below rather than writing the objects by hand.

import type { Criterion, Ref, TrainingEventName } from '../types';

export type CompositeKind = 'landing' | 'stall' | 'stallIncipient' | 'unusualAttitude';

const COMPOSITE_EVENTS: Partial<Record<TrainingEventName, CompositeKind>> = {
  landing: 'landing', stallBreak: 'stall', stallWarnOn: 'stallIncipient', authority: 'unusualAttitude',
};

/** The composite grader a criterion names, or null for an ordinary criterion. */
export function compositeKind(c: Criterion): CompositeKind | null {
  if (c.kind !== 'atEvent' || c.sig !== undefined || c.field !== undefined || c.event === undefined) return null;
  return COMPOSITE_EVENTS[c.event] ?? null;
}

type Opts = Partial<Pick<Criterion, 'safety' | 'chart' | 'advice'>> & { required: boolean };

/** The landing grader: sink, touchdown zone, centreline, drift, first wheel, bounces, speed at 50 ft, on runway. */
export const landing = (id: string, label: string, opts: Opts & { vref?: Ref; zone?: 'touchdownZoneFt' | 'touchdownZoneShortFt' }): Criterion => {
  const { vref, zone, ...rest } = opts;
  return { ...rest, id, label, kind: 'atEvent', event: 'landing', target: vref ?? { vspeed: 'Vref' }, tol: zone ?? 'touchdownZoneFt' };
};

/** The stall-recovery grader; `incipient` measures from the warning (recovery at the warning). */
export const stallRecovery = (id: string, label: string, opts: Opts & { incipient?: boolean }): Criterion => {
  const { incipient, ...rest } = opts;
  return { ...rest, id, label, kind: 'atEvent', event: incipient ? 'stallWarnOn' : 'stallBreak', tol: 'stallHeightLossFt' };
};

/** The unusual-attitude recovery grader (nose-high or nose-low from the attitude at the handover). */
export const unusualAttitude = (id: string, label: string, opts: Opts): Criterion =>
  ({ ...opts, id, label, kind: 'atEvent', event: 'authority' });
