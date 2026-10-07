// Time-weighted accumulators behind every hold criterion (section 3.4). A HoldAccumulator evaluates each
// sample against the lesson tolerance and, in parallel, against the test tolerance, so every result carries
// both the grade at the exercise's standard and the honest test-standard grade.
//
// Pure and allocation-free per sample: the runner feeds it once per rendered frame.

import type { Tol } from '../types';

/** What a hold criterion measured (input to gradeHold and diagnose). */
export interface HoldSummary {
  /** Sampled sim time, s (< 5 s: insufficient data). */
  sampledS: number;
  /** Fraction of sampled time with n <= 1. */
  within: number;
  maxN: number;
  worst: { value: number; dev: number; atS: number } | null;
  meanE: number; meanN2: number;
  /** Time-weighted mean of |e|: with meanE it tells a one-sided bias from a centred scatter. */
  meanAbsE: number;
  /** Sign changes of e with |n| > 0.5. */
  signChanges: number;
  /** Least-squares slope of e, units per minute. */
  slopePerMin: number;
  /** Contiguous n > 1 of at least 2 s. */
  excursions: { fromS: number; durationS: number; peakN: number }[];
  longestOutS: number;
  /** Time from the start (or a target change) to the first sample inside tolerance, s; null: never. */
  firstInS: number | null;
}

/** Anti-frustration rule 2: an excursion shorter than this counts in "within" but never as an excursion, s. */
export const EXCURSION_FLOOR_S = 2;
/** Samples further apart than this (activeWhen went false, the instructor flew) break an excursion, s. */
const GAP_S = 0.5;

/** One side of a tolerance; a zero side uses a floor of 0.5 unit so n stays finite and meaningful. */
const side = (x: number): number => (x > 0 ? x : 0.5);

/** Normalised error n of a deviation e against a tolerance (floor 0.5 unit for a zero side). */
export function normalisedError(e: number, tol: Tol): number {
  return e > 0 ? e / side(tol.plus) : e < 0 ? -e / side(tol.minus) : 0;
}

/** Wrap an angle difference to (-180, 180]. */
export function wrap180(d: number): number {
  const r = ((((d + 180) % 360) + 360) % 360) - 180;
  return r === -180 ? 180 : r;
}

/** The accumulation against one tolerance band. */
class Track {
  private sampled = 0;
  private withinS = 0;
  private maxN = 0;
  private worst: HoldSummary['worst'] = null;
  private sumE = 0;
  private sumAbsE = 0;
  private sumN2 = 0;
  private signChanges = 0;
  private lastSign = 0;
  // Weighted least squares of e over t.
  private sw = 0; private st = 0; private se = 0; private stt = 0; private ste = 0;
  private readonly excursions: HoldSummary['excursions'] = [];
  private run: { fromS: number; durationS: number; peakN: number } | null = null;
  private lastT = -Infinity;
  private refT = 0;
  private firstIn: number | null = null;
  private wasIn = false;

  constructor(private readonly tol: Tol) {}

  add(x: number, e: number, tS: number, dt: number): void {
    const n = normalisedError(e, this.tol);
    if (tS - this.lastT > GAP_S + dt) this.closeRun();
    this.lastT = tS;

    this.sampled += dt;
    this.sumE += e * dt;
    this.sumAbsE += Math.abs(e) * dt;
    this.sumN2 += n * n * dt;
    this.sw += dt; this.st += tS * dt; this.se += e * dt; this.stt += tS * tS * dt; this.ste += tS * e * dt;

    if (this.worst === null || n > this.maxN) {
      this.maxN = Math.max(this.maxN, n);
      this.worst = { value: x, dev: e, atS: tS };
    }
    if (n > 0.5) {
      const s = Math.sign(e);
      if (this.lastSign !== 0 && s !== this.lastSign) this.signChanges++;
      this.lastSign = s;
    }
    if (n <= 1) {
      this.withinS += dt;
      if (!this.wasIn) { this.wasIn = true; if (this.firstIn === null) this.firstIn = tS - this.refT; }
      this.closeRun();
    } else {
      if (!this.run) this.run = { fromS: tS, durationS: 0, peakN: 0 };
      this.run.durationS += dt;
      this.run.peakN = Math.max(this.run.peakN, n);
    }
  }

  targetChanged(tS: number): void {
    this.refT = tS;
    this.firstIn = null;
    this.wasIn = false;
  }

  private closeRun(): void {
    if (this.run && this.run.durationS >= EXCURSION_FLOOR_S) this.excursions.push(this.run);
    this.run = null;
  }

  summary(): HoldSummary {
    const excursions = [...this.excursions];
    if (this.run && this.run.durationS >= EXCURSION_FLOOR_S) excursions.push({ ...this.run });
    const w = this.sampled;
    const den = this.sw * this.stt - this.st * this.st;
    const slope = this.sw > 0 && Math.abs(den) > 1e-9 ? (this.sw * this.ste - this.st * this.se) / den : 0;
    return {
      sampledS: w,
      within: w > 0 ? this.withinS / w : 0,
      maxN: this.maxN,
      worst: this.worst ? { ...this.worst } : null,
      meanE: w > 0 ? this.sumE / w : 0,
      meanN2: w > 0 ? this.sumN2 / w : 0,
      meanAbsE: w > 0 ? this.sumAbsE / w : 0,
      signChanges: this.signChanges,
      slopePerMin: slope * 60,
      excursions,
      longestOutS: excursions.reduce((m, x) => Math.max(m, x.durationS), 0),
      firstInS: this.firstIn,
    };
  }
}

export class HoldAccumulator {
  private readonly lesson: Track;
  private readonly test: Track;

  /** `angle`: wrap e to ±180. A zero-sided tolerance uses a floor of 0.5 unit. */
  constructor(readonly tol: Tol, readonly testTol: Tol, private readonly angle: boolean) {
    this.lesson = new Track(tol);
    this.test = new Track(testTol);
  }

  /** One sample: value x against target at task time tS, weighted by dt. Non-finite input is ignored. */
  add(x: number, target: number, tS: number, dt: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(target) || !(dt > 0)) return;
    const e = this.angle ? wrap180(x - target) : x - target;
    this.lesson.add(x, e, tS, dt);
    this.test.add(x, e, tS, dt);
  }

  /** The target moved (a new level-off): restarts the `late` measurement. */
  targetChanged(tS: number): void {
    this.lesson.targetChanged(tS);
    this.test.targetChanged(tS);
  }

  summary(): HoldSummary {
    return this.lesson.summary();
  }

  /** The same samples against the test tolerance. */
  testSummary(): HoldSummary {
    return this.test.summary();
  }
}
