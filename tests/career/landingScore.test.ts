// The landing score (src/career/runtime/landingScore.ts, LANDING_SCORE_RULES): a perfect aeroplane landing scores
// 100 and each part falls as documented (centreline 0 at 10 m, sink full to 300 fpm and 0 at 700, drift 0 at 10
// deg, bounce 0 above 1 ft); the zone on a long sealed runway is full from the aim point to 400 ft past it and 0 at
// 200 ft outside, and on a grass strip (or under 900 m) full from 15 m past the threshold to the first third, so a
// touchdown 20 m past the threshold of a 650 m grass strip gets full zone points; a crash, a touchdown off the
// runway or a nosewheel first scores 0; and a helicopter is scored on sink, bank and ground speed at contact and
// its distance from the spot, 0 for a crash.

import { describe, expect, it } from 'vitest';
import { aimPointM } from '../../src/career/runtime/fieldGeo';
import { aeroplaneLandingPoints, scoreAeroplaneLanding, scoreHeliLanding, zoneFraction, type HeliContact } from '../../src/career/runtime/landingScore';
import { FT } from '../../src/core/math';
import type { LandingData } from '../../src/training/types';

const SEALED = { kind: 'sealed' as const, length: 1200 };
const GRASS = { kind: 'grass' as const, length: 650 };

const GOOD: LandingData = {
  sinkFpm: 150, kias: 60, firstWheel: 'left', distAimFt: 100, rwyAcrossM: 0, driftDeg: 0, bankDeg: 0, pitchDeg: 6, onRunway: true,
  kiasAt50Ft: 65, gpDevFtAt300: 0, bounces: 0, maxBounceFt: 0, floatS: 2, rolloutMaxAcrossM: 1, fullStop: true, crashed: false,
};

/** distAimFt of a touchdown `m` past the landing threshold of `f`. */
const pastThreshold = (f: { length: number }, m: number): number => (m - aimPointM(f)) / FT;

describe('aeroplanes', () => {
  it('scores a perfect landing 100', () => {
    expect(scoreAeroplaneLanding(GOOD, SEALED).score).toBeCloseTo(100, 9);
    const s = scoreAeroplaneLanding(GOOD, SEALED);
    expect([s.helicopter, s.onTarget, s.distAimFt, s.centrelineM, s.firstWheel]).toEqual([false, true, 100, 0, 'left']);
  });

  it('takes the documented points off each part', () => {
    const p = (d: Partial<LandingData>) => aeroplaneLandingPoints({ ...GOOD, ...d }, SEALED);
    expect(p({ rwyAcrossM: 5 }).centreline).toBeCloseTo(12.5, 9);
    expect(p({ rwyAcrossM: -10 }).centreline).toBe(0);
    expect(p({ sinkFpm: 300 }).sink).toBeCloseTo(35, 9);
    expect(p({ sinkFpm: 500 }).sink).toBeCloseTo(17.5, 9);
    expect(p({ sinkFpm: 700 }).sink).toBe(0);
    expect(p({ driftDeg: -5 }).drift).toBeCloseTo(5, 9);
    expect(p({ bounces: 1, maxBounceFt: 0.8 }).bounce).toBe(10);
    expect(p({ bounces: 1, maxBounceFt: 1.5 }).bounce).toBe(0);
  });

  it('gives full zone points from the aim point to 400 ft past it on a long sealed runway, 0 at 200 ft outside', () => {
    expect(zoneFraction(SEALED, 0)).toBe(1);
    expect(zoneFraction(SEALED, 400)).toBe(1);
    expect(zoneFraction(SEALED, 500)).toBeCloseTo(0.5, 9);
    expect(zoneFraction(SEALED, 600)).toBe(0);
    expect(zoneFraction(SEALED, -100)).toBeCloseTo(0.5, 9);
    expect(zoneFraction(SEALED, -200)).toBe(0);
  });

  it('gives full zone points 20 m past the threshold of a 650 m grass strip', () => {
    const d = pastThreshold(GRASS, 20);
    expect(d).toBeLessThan(0); // short of the 97.5 m aim point, which the short-field zone does not use
    expect(zoneFraction(GRASS, d)).toBe(1);
    expect(aeroplaneLandingPoints({ ...GOOD, distAimFt: d }, GRASS).zone).toBe(20);
    expect(scoreAeroplaneLanding({ ...GOOD, distAimFt: d }, GRASS).score).toBeCloseTo(100, 9);
  });

  it('runs the short-field zone from threshold + 15 m to the first third, 0 at the threshold and at half length', () => {
    expect(zoneFraction(GRASS, pastThreshold(GRASS, 15))).toBeCloseTo(1, 9);
    expect(zoneFraction(GRASS, pastThreshold(GRASS, 7.5))).toBeCloseTo(0.5, 9);
    expect(zoneFraction(GRASS, pastThreshold(GRASS, 0))).toBe(0);
    expect(zoneFraction(GRASS, pastThreshold(GRASS, 650 / 3))).toBeCloseTo(1, 9);
    expect(zoneFraction(GRASS, pastThreshold(GRASS, 325))).toBeCloseTo(0, 9);
    // A sealed runway shorter than 900 m is flown short-field too.
    expect(zoneFraction({ kind: 'sealed', length: 850 }, pastThreshold({ length: 850 }, 30))).toBe(1);
  });

  it('scores a crash, a touchdown off the runway and a nosewheel first 0', () => {
    expect(scoreAeroplaneLanding({ ...GOOD, crashed: true }, SEALED).score).toBe(0);
    expect(scoreAeroplaneLanding({ ...GOOD, onRunway: false }, SEALED).score).toBe(0);
    expect(scoreAeroplaneLanding({ ...GOOD, firstWheel: 'nose' }, SEALED).score).toBe(0);
    expect(scoreAeroplaneLanding({ ...GOOD, onRunway: false }, SEALED).onTarget).toBe(false);
  });
});

describe('helicopters', () => {
  const C: HeliContact = { sinkFpm: 100, bankDeg: 0, gsKt: 0, spotDistM: 5, bounces: 0, crashed: false };

  it('scores a gentle vertical landing on the spot 100', () => {
    const s = scoreHeliLanding(C);
    expect(s.score).toBeCloseTo(100, 9);
    expect([s.helicopter, s.onTarget, s.firstWheel, s.spotDistM]).toEqual([true, true, 'left', 5]);
  });

  it('takes the documented points off each part', () => {
    expect(scoreHeliLanding({ ...C, sinkFpm: 350 }).score).toBeCloseTo(75, 9);
    expect(scoreHeliLanding({ ...C, sinkFpm: 500 }).score).toBeCloseTo(50, 9);
    expect(scoreHeliLanding({ ...C, bankDeg: -5 }).score).toBeCloseTo(92.5, 9);
    expect(scoreHeliLanding({ ...C, gsKt: 6 }).score).toBeCloseTo(92.5, 9);
    expect(scoreHeliLanding({ ...C, gsKt: 12 }).score).toBeCloseTo(85, 9);
    expect(scoreHeliLanding({ ...C, spotDistM: 57.5 }).score).toBeCloseTo(90, 9);
    expect(scoreHeliLanding({ ...C, spotDistM: 150 }).score).toBeCloseTo(80, 9);
    expect(scoreHeliLanding({ ...C, spotDistM: 150 }).onTarget).toBe(false);
  });

  it('scores a crash 0', () => {
    expect(scoreHeliLanding({ ...C, crashed: true }).score).toBe(0);
  });
});
