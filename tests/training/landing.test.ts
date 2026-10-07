// Landing grader (section 3.4): every item graded with the standard rules, the safety items, the training
// drift band and the crash rule; the exercise grade it produces through aggregation.

import { describe, expect, it } from 'vitest';
import { aggregateExercise } from '../../src/training/grading/grade';
import { gradeLanding, type LandingGradeOptions } from '../../src/training/grading/landing';
import { STANDARDS } from '../../src/training/grading/standards';
import type { LandingData } from '../../src/training/types';
import { ex } from './gradingFixtures';

const GOOD: LandingData = {
  sinkFpm: 180, kias: 58, firstWheel: 'left', distAimFt: 150, rwyAcrossM: -1.2, driftDeg: 1.5, bankDeg: 1, pitchDeg: 5,
  onRunway: true, kiasAt50Ft: 67, gpDevFtAt300: 12, bounces: 0, maxBounceFt: 0, floatS: 4, rolloutMaxAcrossM: 2,
  fullStop: true, crashed: false,
};
const opts = (o: Partial<LandingGradeOptions> = {}): LandingGradeOptions =>
  ({ standards: STANDARDS, authority: 'easa', standard: 'test', vrefKt: 65, zone: 'touchdownZoneFt', ...o });
const byId = (d: LandingData, o?: Partial<LandingGradeOptions>) => Object.fromEntries(gradeLanding(d, opts(o)).map((r) => [r.id, r]));
const exerciseGrade = (d: LandingData, o?: Partial<LandingGradeOptions>) =>
  aggregateExercise(gradeLanding(d, opts(o)), [], false, ex('land', 'assessed', o?.standard ?? 'test'));

describe('landing grader', () => {
  it('grades a good landing Excellent on every item', () => {
    const r = byId(GOOD);
    expect(Object.keys(r).sort()).toEqual(['landing.bounces', 'landing.centreline', 'landing.drift', 'landing.firstWheel',
      'landing.onRunway', 'landing.sink', 'landing.speed50', 'landing.zone'].sort());
    for (const id of ['landing.sink', 'landing.zone', 'landing.centreline', 'landing.drift', 'landing.speed50']) expect(r[id].grade).toBe(4);
    expect(exerciseGrade(GOOD)).toBe(4);
  });

  it('grades the sink rate against sinkFpm (0/+400 at test)', () => {
    expect(byId({ ...GOOD, sinkFpm: 350 })['landing.sink'].grade).toBe(3);
    const hard = byId({ ...GOOD, sinkFpm: 700 })['landing.sink'];
    expect(hard.grade).toBe(1);
    expect(hard.detail).toMatch(/700 fpm/);
    expect(byId({ ...GOOD, sinkFpm: 450 }, { standard: 'training' })['landing.sink'].grade).toBe(3);   // 0/+500
    expect(byId({ ...GOOD, sinkFpm: 450 }, { standard: 'training' })['landing.sink'].testGrade).toBe(1);
  });

  it('grades the touchdown point beyond the aim point, and the short-field zone', () => {
    expect(byId({ ...GOOD, distAimFt: 380 })['landing.zone'].grade).toBe(3);
    expect(byId({ ...GOOD, distAimFt: 450 })['landing.zone'].grade).toBe(1);
    expect(byId({ ...GOOD, distAimFt: -40 })['landing.zone'].grade).toBe(1);     // short of the aim point
    expect(byId({ ...GOOD, distAimFt: 150 }, { zone: 'touchdownZoneShortFt' })['landing.zone'].grade).toBe(3);   // 150 of 200
  });

  it('grades the centreline and the drift, with the wider training drift band', () => {
    expect(byId({ ...GOOD, rwyAcrossM: 4.5 })['landing.centreline'].grade).toBe(3);
    expect(byId({ ...GOOD, rwyAcrossM: -6 })['landing.centreline'].grade).toBe(1);
    expect(byId({ ...GOOD, driftDeg: 6 })['landing.drift'].grade).toBe(1);
    expect(byId({ ...GOOD, driftDeg: 6 }, { standard: 'training' })['landing.drift'].grade).toBe(3);
  });

  it('grades the speed at 50 ft against Vref with speedClimbApproach', () => {
    expect(byId({ ...GOOD, kiasAt50Ft: 62 })['landing.speed50'].grade).toBe(4);    // -3 on -5: 0.6
    expect(byId({ ...GOOD, kiasAt50Ft: 59 })['landing.speed50'].grade).toBe(1);    // -6 on -5
    expect(byId({ ...GOOD, kiasAt50Ft: 76 })['landing.speed50'].grade).toBe(3);    // +11 on +15
    expect(byId({ ...GOOD, kiasAt50Ft: NaN })['landing.speed50']).toMatchObject({ insufficient: true });
  });

  it('fails the exercise outright on a nose-first or off-runway touchdown (safety items)', () => {
    const nose = byId({ ...GOOD, firstWheel: 'nose' })['landing.firstWheel'];
    expect(nose).toMatchObject({ grade: 1, safety: true });
    expect(exerciseGrade({ ...GOOD, firstWheel: 'nose' })).toBe(1);
    expect(exerciseGrade({ ...GOOD, onRunway: false })).toBe(1);
  });

  it('fails a bounce higher than 3 ft or more than one bounce, but allows one small skip', () => {
    expect(byId({ ...GOOD, bounces: 1, maxBounceFt: 2 })['landing.bounces'].grade).toBe(3);
    expect(byId({ ...GOOD, bounces: 1, maxBounceFt: 5 })['landing.bounces'].grade).toBe(1);
    expect(byId({ ...GOOD, bounces: 2, maxBounceFt: 1 })['landing.bounces'].grade).toBe(1);
    expect(exerciseGrade({ ...GOOD, bounces: 2, maxBounceFt: 1 })).toBe(1);
  });

  it('ends a crash as grade 1', () => {
    const rows = gradeLanding({ ...GOOD, crashed: true }, opts());
    expect(rows[0]).toMatchObject({ id: 'landing.crash', grade: 1, safety: true });
    expect(exerciseGrade({ ...GOOD, crashed: true })).toBe(1);
  });

  it('uses the FAA table under FAA and the id prefix and required flag it is given', () => {
    const rows = gradeLanding(GOOD, opts({ authority: 'faa', idPrefix: 'ldg2', required: false }));
    expect(rows.every((r) => r.id.startsWith('ldg2.') && !r.required)).toBe(true);
  });
});
