// The Career's boot plan (src/career/boot.ts careerBootPlan) row by row against docs/career.md's boot table: the
// Career unavailable and no career (a block is deleted only if present; career=1 still opens the hub), a store kept off localStorage (the block
// is always deleted), an explicit start (scenario=, lesson=, demo=, hover=, career=0 all arrive as `explicit`),
// another world seed, a pending report, a placed job of the booted type with a matching block (resume, also under
// resume=0) and without one (resume at once falls back), a placed job of another type, an unplaced job of the booted
// and of another type, in Career with the selected type booted (placeSelected) and otherwise (the hub only with
// career=1); and the four named regressions: a cstore=mem run never resumes a job from the local snapshot, a reload
// just after a settlement does not resume the finished job, "Start a new career" and an import do not resume the old
// job, and an unplaced job for this type is not overrun by this type's stale lesson snapshot.

import { describe, expect, it } from 'vitest';
import { careerBootPlan, type CareerBootUrl } from '../../src/career/boot';
import { createCareer } from '../../src/career/create';
import type { ActiveJob, CareerBootPlan, CareerSave, CareerStoreKind, JobFlightReport } from '../../src/career/types';
import { defaultWeather } from '../../src/core/types';

const URL0: CareerBootUrl = { explicit: false, open: false, resume: null };
const url = (o: Partial<CareerBootUrl> = {}): CareerBootUrl => ({ ...URL0, ...o });

function career(start: 'c152' | 'c172s' = 'c152'): CareerSave {
  return createCareer({ pilotName: 'A', companyName: 'Fable Air', callsign: '', start }, { seed: 0, licence: 'declared', authority: 'easa', homeCode: 'KFBL', now: 0 });
}

function job(over: Partial<ActiveJob> = {}): ActiveJob {
  return {
    offer: { id: '1-KFBL-0' } as ActiveJob['offer'], aircraftUid: 'a1', type: 'c152', fuelKg: 30, loading: null, items: [],
    phase: 'dispatched', placed: false, acceptedAtMin: 1920, elapsedBaseS: 0, elapsedS: 0,
    lastKnown: { north: 0, east: 0, onGround: true }, everAirborne: false, playerWeather: defaultWeather(), ...over,
  };
}

function withJob(over: Partial<ActiveJob> = {}, save = career()): CareerSave {
  return { ...save, active: job(over) };
}

const block = (jobId = '1-KFBL-0', aircraftUid = 'a1') => ({ career: { v: 1, jobId, aircraftUid, monitor: null } });

const plan = (deleteBlock: boolean, resumeParam: boolean | null, trainingExplicit: boolean, action: CareerBootPlan['action'], explicit = false): CareerBootPlan =>
  ({ deleteBlock, resumeParam, trainingExplicit, action, explicit });

const at = (save: CareerSave | null, snap: { career?: unknown } | null, u: CareerBootUrl = URL0, kind: CareerStoreKind = 'local', boot: 'c152' | 'c172s' = 'c152') =>
  careerBootPlan(save, snap, boot, u, kind);

describe('careerBootPlan: the default path', () => {
  it('with no career does nothing (deleting a block only if there is one), except career=1 opens it', () => {
    expect(at(null, null)).toEqual(plan(false, null, false, 'none'));
    expect(at(null, block())).toEqual(plan(true, null, false, 'none'));
    expect(at(null, null, url({ open: true }))).toEqual(plan(false, null, true, 'hub'));
    expect(at(null, null, url({ open: true, explicit: true }))).toEqual(plan(false, null, false, 'none', true));
  });
  it('where the Career is unavailable (era) does nothing, whatever the save', () => {
    const s = withJob({ placed: true });
    expect(at(s, block(), url({ available: false }))).toEqual(plan(true, null, false, 'none'));
    expect(at(s, null, url({ available: false, open: true }))).toEqual(plan(false, null, false, 'none'));
  });
});

describe('careerBootPlan: explicit starts and other worlds', () => {
  it('an explicit start keeps the Career out of the way and drops the block', () => {
    for (const s of [withJob({ placed: true }), withJob(), { ...career(), inCareer: true }]) {
      expect(at(s, block(), url({ explicit: true, open: true }))).toEqual(plan(true, null, false, 'none', true));
    }
  });
  it('another world seed shows only the hub (seed page) with career=1', () => {
    const s = withJob({ placed: true });
    expect(at(s, block(), url({ worldSeed: 7 }))).toEqual(plan(true, null, false, 'none'));
    expect(at(s, block(), url({ worldSeed: 7, open: true }))).toEqual(plan(true, null, true, 'hub'));
    expect(at(s, block(), url({ worldSeed: 0 })).action).toBe('resume');
  });
});

describe('careerBootPlan: a placed job', () => {
  it('of the booted type with a matching block resumes, even with the resume preference off', () => {
    expect(at(withJob({ placed: true }), block())).toEqual(plan(false, true, true, 'resume'));
    expect(at(withJob({ placed: true }), block(), url({ open: true }))).toEqual(plan(false, true, true, 'resume'));
  });
  it('under resume=0 keeps the block but leaves the URL to refuse (the afterBoot fallback follows)', () => {
    expect(at(withJob({ placed: true }), block(), url({ resume: false }))).toEqual(plan(false, null, true, 'resume'));
  });
  it('without a block, or with another job’s or airframe’s, falls back at once', () => {
    for (const snap of [null, {}, block('2-KFBL-1'), block('1-KFBL-0', 'a2'), { career: { v: 2, jobId: '1-KFBL-0', aircraftUid: 'a1' } }]) {
      expect(at(withJob({ placed: true }), snap)).toEqual(plan(true, false, true, 'resume'));
    }
  });
  it('of another type than booted opens the hub with career=1, else nothing (afterBoot settles or parks it)', () => {
    const s = withJob({ placed: true, type: 'c172s' });
    expect(at(s, block())).toEqual(plan(true, null, false, 'none'));
    expect(at(s, block(), url({ open: true }))).toEqual(plan(true, null, true, 'hub'));
  });
  it('with a pending report is settled by afterBoot, then the job’s aircraft is placed when booted', () => {
    const pending = { outcome: 'crashed' } as JobFlightReport;
    expect(at(withJob({ placed: true, pendingReport: pending }), block())).toEqual(plan(true, false, true, 'placeSelected'));
    expect(at(withJob({ placed: true, pendingReport: pending, type: 'c172s' }), block())).toEqual(plan(true, null, false, 'none'));
    expect(at({ ...withJob({ placed: true, pendingReport: pending }), inCareer: false }, block(), url({ open: true }))).toEqual(plan(true, null, true, 'hub'));
  });
});

describe('careerBootPlan: an unplaced job and no job', () => {
  it('an unplaced job of the booted type is placed, ignoring this type’s stale snapshot', () => {
    expect(at(withJob(), null)).toEqual(plan(true, false, true, 'place'));
    expect(at(withJob({ type: 'c172s' }), null, URL0, 'session', 'c172s')).toEqual(plan(true, false, true, 'place'));
  });
  it('an unplaced job of another type waits: the hub with career=1, else nothing', () => {
    expect(at(withJob({ type: 'c172s' }), null)).toEqual(plan(true, null, false, 'none'));
    expect(at(withJob({ type: 'c172s' }), null, url({ open: true }))).toEqual(plan(true, null, true, 'hub'));
  });
  it('in Career with no job and the selected type booted places the selected aircraft', () => {
    expect(at(career(), null)).toEqual(plan(true, null, true, 'placeSelected'));
    expect(at(career(), null, url({ open: true }))).toEqual(plan(true, null, true, 'placeSelected'));
  });
  it('in Career with another type booted, or out of Career mode, opens the hub only with career=1', () => {
    expect(at(career('c172s'), null)).toEqual(plan(true, null, false, 'none'));
    expect(at(career('c172s'), null, url({ open: true }))).toEqual(plan(true, null, true, 'hub'));
    const out = { ...career(), inCareer: false };
    expect(at(out, null)).toEqual(plan(true, null, false, 'none'));
    expect(at(out, null, url({ open: true }))).toEqual(plan(true, null, true, 'hub'));
  });
});

describe('careerBootPlan: the named regressions', () => {
  it('a cstore=mem (or session) run never resumes a job from the local snapshot', () => {
    for (const kind of ['mem', 'session'] as const) expect(at(withJob({ placed: true }), block(), URL0, kind)).toEqual(plan(true, false, true, 'resume'));
  });
  it('a reload just after a settlement does not resume the finished job', () => {
    // settleJob cleared `active`; the snapshot written a moment before still carries the job's block.
    const settled = career();
    const p = at(settled, block());
    expect(p.deleteBlock).toBe(true);
    expect(p.action).toBe('placeSelected');
    expect(p.resumeParam).toBeNull();
  });
  it('"Start a new career" and an import do not resume the old job', () => {
    expect(at(career(), block()).deleteBlock).toBe(true);
    const imported = withJob({ placed: true, offer: { id: '5-KFBL-3' } as ActiveJob['offer'] });
    expect(at(imported, block('1-KFBL-0'))).toEqual(plan(true, false, true, 'resume'));
  });
  it('an unplaced job for this type is not overrun by this type’s stale lesson snapshot', () => {
    const p = at(withJob(), { career: undefined });
    expect(p.resumeParam).toBe(false);
    expect(p.trainingExplicit).toBe(true);
    expect(p.action).toBe('place');
  });
});
