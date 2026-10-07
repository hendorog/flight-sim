// The logbook timer (section 3.11) on flights flown by the real flight model and the existing autoflight
// (a take-off from the runway and an approach to a full-stop landing), its rules on synthetic frames,
// logbook lines and career totals.

import { describe, expect, it } from 'vitest';
import { KT } from '../../src/core/math';
import { defaultWeather } from '../../src/core/types';
import { SimPhysics } from '../../src/sim/SimPhysics';
import { FlightTimer, examinerSignature, freeFlightEntryFor, instructorSignature, logbookEntryFor } from '../../src/training/career/logbook';
import { totals } from '../../src/training/career/totals';
import type { SignalFrame } from '../../src/training/types';
import { TEST_AIRCRAFT, lesson, lessonResult } from './gradingFixtures';

/** The signals the timer reads, from the flight-model state (what the core telemetry provider produces). */
function frameOf(p: SimPhysics, sunElevDeg = 30): SignalFrame {
  const s = p.state;
  return { engineRunning: s.engine.running, onGround: s.onGround, gsKt: s.groundSpeed / KT, sunElevDeg };
}

/**
 * Fly `seconds` in 1/30 s frames; the timer is fed like the runner feeds it (liftoff and landing events from
 * ground-contact transitions). Returns the times of the first lift-off and the first touchdown.
 */
function fly(p: SimPhysics, timer: FlightTimer, seconds: number, o: { sun?: number; instrument?: boolean } = {}) {
  const dt = 1 / 30;
  let wasOnGround = p.state.onGround;
  let liftoffAt: number | null = null;
  let touchdownAt: number | null = null;
  for (let t = 0; t < seconds; t += dt) {
    p.step(dt);
    const on = p.state.onGround;
    if (wasOnGround && !on && liftoffAt === null) { liftoffAt = t; timer.takeoff(); }
    // A landing is a touchdown after real flight (the runner's LandingDetector does this properly).
    if (!wasOnGround && on && touchdownAt === null && timer.state.airborne) { touchdownAt = t; timer.landing((o.sun ?? 30) < -6); }
    wasOnGround = on;
    timer.update(frameOf(p, o.sun), dt, o.instrument ?? false);
  }
  return { liftoffAt, touchdownAt };
}

describe('FlightTimer on real flights', () => {
  it('times a take-off: block from the start of the roll, airborne from lift-off', () => {
    const p = new SimPhysics({ weather: defaultWeather() });
    p.autoflightOnReset = true;
    p.reset('runway');
    const timer = new FlightTimer(false);   // engine running but standing: the block starts with movement
    const { liftoffAt } = fly(p, timer, 60);
    expect(liftoffAt).not.toBeNull();
    const t = timer.state.times;
    expect(t.blockS).toBeGreaterThan(55);           // the roll starts within a few seconds
    expect(t.blockS).toBeLessThanOrEqual(60);
    expect(t.airborneS).toBeCloseTo(60 - liftoffAt!, 0);
    expect(t.takeoffs).toBe(1);
    expect(t.landingsDay + t.landingsNight).toBe(0);
    expect(timer.state.airborne).toBe(true);
    expect(p.state.crashed).toBe(false);
  }, 60000);

  it('times an approach from final to a full stop: airborne until the touchdown, one landing', () => {
    const p = new SimPhysics({ weather: defaultWeather() });
    p.autoflightOnReset = true;
    p.reset('final');
    const timer = new FlightTimer(true);   // the lesson starts airborne: block from the start
    const { touchdownAt } = fly(p, timer, 200, { sun: -10, instrument: true });
    expect(touchdownAt).not.toBeNull();
    expect(p.state.crashed).toBe(false);
    const t = timer.state.times;
    expect(t.blockS).toBeCloseTo(200, 0);
    // The approach starts airborne: the first 2 s are confirmed retroactively, so airborne time is the whole
    // time to the touchdown.
    expect(t.airborneS).toBeCloseTo(touchdownAt!, 0);
    expect(t.landingsNight).toBe(1);
    expect(t.landingsDay).toBe(0);
    expect(t.nightS).toBeCloseTo(t.blockS, 6);
    expect(t.instrumentS).toBeCloseTo(t.airborneS, 6);
    expect(timer.state.airborne).toBe(false);
  }, 60000);
});

describe('FlightTimer rules', () => {
  const tick = (timer: FlightTimer, s: number, f: SignalFrame, instrument = false) => {
    for (let t = 0; t < s - 1e-9; t += 0.1) timer.update(f, 0.1, instrument);
  };

  it('does not count a hop shorter than 2 s as airborne, and counts the 2 s once confirmed', () => {
    const timer = new FlightTimer(true);
    tick(timer, 1.5, { engineRunning: true, onGround: false, gsKt: 50 });
    tick(timer, 1, { engineRunning: true, onGround: true, gsKt: 50 });
    expect(timer.state.times.airborneS).toBe(0);
    tick(timer, 5, { engineRunning: true, onGround: false, gsKt: 60 });
    expect(timer.state.times.airborneS).toBeCloseTo(5, 6);
  });

  it('stops the block when the engine stops on the ground and ignores a paused frame', () => {
    const timer = new FlightTimer(false);
    tick(timer, 3, { engineRunning: true, onGround: true, gsKt: 0 });
    expect(timer.state.times.blockS).toBe(0);
    tick(timer, 10, { engineRunning: true, onGround: true, gsKt: 8 });
    tick(timer, 4, { engineRunning: false, onGround: true, gsKt: 0 });
    timer.update({ engineRunning: true, onGround: true, gsKt: 8 }, 0, false);
    expect(timer.state.times.blockS).toBeCloseTo(10, 6);
    expect(timer.state.blockOn).toBe(false);
  });

  it('falls back to the night signal when there is no sun elevation, and resumes from a saved state', () => {
    const timer = new FlightTimer(true);
    tick(timer, 4, { engineRunning: true, onGround: false, gsKt: 90, night: true });
    const again = new FlightTimer(false, JSON.parse(JSON.stringify(timer.state)));
    tick(again, 2, { engineRunning: true, onGround: false, gsKt: 90, night: true });
    expect(again.state.times.nightS).toBeCloseTo(6, 6);
    expect(again.state.times.airborneS).toBeCloseTo(6, 6);
    again.stop();
    expect(again.state.blockOn).toBe(false);
  });
});

describe('logbook lines', () => {
  const L04 = lesson({ id: 'L04', title: 'Climbing and descending', syllabusRef: { easa: 'Ex 7 & 8', faa: 'ACS VI.B-C' } });

  it('writes a dual lesson line signed by the instructor', () => {
    const e = logbookEntryFor(L04, lessonResult('L04', { traceId: 'tr1', phaseRetries: 1 }), TEST_AIRCRAFT, 'easa', 'Kate Mercer', 'id-1');
    expect(e).toMatchObject({
      id: 'id-1', date: '2026-09-01', aircraftType: 'C172', registration: 'G-FSCK', role: 'dual', lessonId: 'L04', lessonVersion: 1,
      exercise: 'Ex 7 & 8 Climbing and descending', outcome: 'competent', stars: 2, signedBy: 'K. Mercer FI(A)', traceId: 'tr1',
      remarks: 'kbd assists; 1 retry',
    });
    expect(e.stamp).toBeUndefined();
    const faa = logbookEntryFor(L04, lessonResult('L04', { stars: 0, outcome: 'notYet' }), TEST_AIRCRAFT, 'faa', 'Kate Mercer', 'id-2');
    expect(faa).toMatchObject({ registration: 'N172FS', exercise: 'ACS VI.B-C Climbing and descending', signedBy: 'K. Mercer CFI', stars: null });
  });

  it('logs the first solo unsigned with its stamp, and the skill test signed by the examiner', () => {
    const L14 = lesson({ id: 'L14', kind: 'solo', awards: [{ id: 'firstSolo', when: 'competent', title: 'First solo' }] });
    expect(logbookEntryFor(L14, lessonResult('L14'), TEST_AIRCRAFT, 'easa', 'Kate Mercer', 'x')).toMatchObject({ role: 'solo', signedBy: null, stamp: 'FIRST SOLO' });
    const L21 = lesson({ id: 'L21', kind: 'test', awards: [{ id: 'ppl', when: 'testPass', title: 'PPL' }] });
    expect(logbookEntryFor(L21, lessonResult('L21', { outcome: 'testPass' }), TEST_AIRCRAFT, 'faa', 'Kate Mercer', 'y'))
      .toMatchObject({ role: 'test', signedBy: 'D. Hale DPE', stamp: 'SKILL TEST PASS' });
    expect(logbookEntryFor(L21, lessonResult('L21', { outcome: 'testFail', stars: 0 }), TEST_AIRCRAFT, 'faa', 'Kate Mercer', 'z').stamp).toBeUndefined();
    expect(instructorSignature('Mercer', 'easa')).toBe('Mercer FI(A)');
    expect(examinerSignature('easa')).toBe('D. Hale FE(A)');
  });

  it('logs a free flight only with a minute airborne, solo before the PPL and PIC after', () => {
    const times = { blockS: 600, airborneS: 59, nightS: 0, instrumentS: 0, landingsDay: 1, landingsNight: 0, takeoffs: 1 };
    const d = new Date('2026-09-05T12:00:00Z');
    expect(freeFlightEntryFor(times, TEST_AIRCRAFT, 'easa', false, 'f', d)).toBeNull();
    expect(freeFlightEntryFor({ ...times, airborneS: 300 }, TEST_AIRCRAFT, 'easa', false, 'f', d)).toMatchObject({ role: 'solo', outcome: 'freeFlight', remarks: 'free flight', date: '2026-09-05' });
    expect(freeFlightEntryFor({ ...times, airborneS: 300 }, TEST_AIRCRAFT, 'easa', true, 'f', d)?.role).toBe('pic');
  });
});

describe('career totals', () => {
  it('derives every total from the logbook', () => {
    const L = lesson({ id: 'L04' });
    const dual = logbookEntryFor(L, lessonResult('L04'), TEST_AIRCRAFT, 'easa', 'Kate Mercer', 'a');
    const solo = { ...dual, id: 'b', role: 'solo' as const, times: { ...dual.times, nightS: 100, landingsNight: 2, landingsDay: 0 } };
    const pic = { ...dual, id: 'c', role: 'pic' as const, times: { ...dual.times, instrumentS: 50 } };
    const test = { ...dual, id: 'd', role: 'test' as const };
    expect(totals([dual, solo, pic, test])).toEqual({
      totalS: 3600, dualS: 900, soloS: 900, picS: 900, nightS: 100, instrumentS: 50,
      landingsDay: 3, landingsNight: 2, takeoffs: 4, flights: 4,
    });
    expect(totals([]).flights).toBe(0);
  });
});
