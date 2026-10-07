// Landing grader (section 3.4): turns a LandingData summary (from engine/events.ts LandingDetector) into
// criterion rows graded with the standard rules: sink, touchdown zone, centreline, drift, first wheel,
// bounces, speed at 50 ft, on runway. A crash ends the landing as grade 1.

import type { AuthorityId, CriterionResult, LandingData, Standard, Tol, ToleranceTable } from '../types';
import { unitOf } from './format';
import { insufficientResult, passFailResult, sampleResult } from './rules';

export interface LandingGradeOptions {
  standards: ToleranceTable; authority: AuthorityId; standard: Standard;
  /** Reference speed at 50 ft, KIAS (Vref, VappFlapsUp for flapless, VshortField...). */
  vrefKt: number;
  /** Touchdown zone key: 'touchdownZoneFt' or 'touchdownZoneShortFt'. */
  zone: 'touchdownZoneFt' | 'touchdownZoneShortFt';
  /** Row ids are `${idPrefix}.sink` etc. (default 'landing'). */
  idPrefix?: string;
  /** Whether the rows count toward the exercise grade (default true). */
  required?: boolean;
}

/** Drift at contact: ≤ 5° (training 8°). Not in the authority tables; the spec fixes it here. */
const DRIFT_TOL_DEG: Record<Standard, number> = { training: 8, test: 5, commercial: 5 };
/** Bounces: more than one, or one higher than this, fails. */
const MAX_BOUNCE_FT = 3;

const sym = (x: number): Tol => ({ minus: x, plus: x });

export function gradeLanding(d: LandingData, opts: LandingGradeOptions): CriterionResult[] {
  const p = opts.idPrefix ?? 'landing';
  const required = opts.required ?? true;
  const lesson = opts.standards[opts.authority][opts.standard];
  const test = opts.standards[opts.authority].test;
  const head = (item: string, label: string, kind: CriterionResult['kind'], safety = false) =>
    ({ id: `${p}.${item}`, label, kind, required, safety });
  const st = opts.standard;
  const rows: CriterionResult[] = [];

  if (d.crashed) rows.push(passFailResult(head('crash', 'Landing without damage', 'binary', true), false, 'The landing ended in a crash'));

  const sink = Math.max(0, d.sinkFpm);
  rows.push(sampleResult(head('sink', 'Sink rate at touchdown', 'atEvent'), sink, 0, sink, lesson.sinkFpm, test.sinkFpm, st,
    { unit: unitOf('vsFpm'), what: 'Sink' }));
  rows.push(sampleResult(head('zone', 'Touchdown point', 'atEvent'), d.distAimFt, 0, d.distAimFt, lesson[opts.zone], test[opts.zone], st,
    { sig: 'distAimFt', what: 'Touched down' }));
  rows.push(sampleResult(head('centreline', 'Centreline at touchdown', 'atEvent'), d.rwyAcrossM, 0, d.rwyAcrossM, lesson.centrelineM, test.centrelineM, st,
    { sig: 'rwyAcrossM', what: 'Main gear' }));
  rows.push(sampleResult(head('drift', 'Drift at touchdown', 'atEvent'), d.driftDeg, 0, d.driftDeg, sym(DRIFT_TOL_DEG[st]), sym(DRIFT_TOL_DEG.test), st,
    { sig: 'driftDeg', what: 'Drift' }));
  rows.push(passFailResult(head('firstWheel', 'Main wheels first', 'binary', true), d.firstWheel !== 'nose',
    d.firstWheel === 'nose' ? 'The nosewheel touched first' : 'Main wheels first'));
  const bounced = d.bounces > 1 || d.maxBounceFt > MAX_BOUNCE_FT;
  rows.push(passFailResult(head('bounces', 'No bounce', 'binary'), !bounced,
    d.bounces === 0 ? 'No bounce' : `${d.bounces} bounce${d.bounces > 1 ? 's' : ''}, highest ${Math.round(d.maxBounceFt)} ft`));
  if (Number.isFinite(d.kiasAt50Ft)) {
    const dev = d.kiasAt50Ft - opts.vrefKt;
    rows.push(sampleResult(head('speed50', 'Speed at 50 ft', 'atEvent'), d.kiasAt50Ft, opts.vrefKt, dev, lesson.speedClimbApproach,
      test.speedClimbApproach, st, { sig: 'kias', what: 'At 50 ft' }));
  } else {
    rows.push(insufficientResult(head('speed50', 'Speed at 50 ft', 'atEvent'), 'Not measured (the approach started below 50 ft)'));
  }
  rows.push(passFailResult(head('onRunway', 'On the runway', 'binary', true), d.onRunway,
    d.onRunway ? 'On the runway' : 'Touched down off the runway'));
  return rows;
}
