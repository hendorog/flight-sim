// Stall-recovery grader (section 3.4): height loss from the break (or the warning, for incipient recoveries)
// to positive climb vs stallHeightLossFt; recovery start > 2 s after the warning caps at 2; a secondary break
// within 10 s is a safety fail; bank in the recovery > 20° caps at 2.
//
// The recovery start is timed from the reference event: the warning for an incipient recovery, the break for
// a full stall. (Timed from the warning, a full-stall exercise, where the student holds the nose up through
// the warning until the break, could never grade above 2.) It is the first frame where the elevator has moved
// forward by 0.1 from its position at the reference, or the nose pitches down faster than 3°/s.
//
// Fed by the Grader with every bus event and every sampled frame of the task. One instance grades the first
// stall of its task attempt; later stalls only matter as secondary breaks.

import type { CriterionResult, Grade, SignalFrame, Standard, Tol, TrainingEventRecord } from '../types';
import { unitOf } from './format';
import { insufficientResult, passFailResult, sampleResult } from './rules';

/** Recovery must start within this time of the reference event (else the grade is capped at 2), s. */
export const RECOVERY_START_MAX_S = 2;
/** A second break within this time of the first is a secondary stall (safety), s. */
export const SECONDARY_WINDOW_S = 10;
/** Bank beyond this during the recovery caps the grade at 2, deg. */
export const RECOVERY_MAX_BANK_DEG = 20;
/** "Positive climb": vertical speed above zero for this long, s. */
const CLIMB_CONFIRM_S = 1;
/** Nose being lowered: the elevator moved forward this much from its value at the reference, or ... */
const ELEVATOR_FORWARD = 0.1;
/** ... the pitch rate is below this, deg/s. */
const PITCH_DOWN_RATE_DPS = -3;

const num = (f: Readonly<SignalFrame>, k: string): number => {
  const x = f[k];
  return typeof x === 'number' ? x : typeof x === 'boolean' ? Number(x) : NaN;
};

export class StallGrader {
  private readonly tol: Tol;
  private readonly testTol: Tol;
  private readonly standard: Standard;
  private readonly incipient: boolean;
  private readonly prefix: string;
  private readonly required: boolean;

  private warnT: number | null = null;
  private refElevator: number | null = null;
  private firstBreakT: number | null = null;
  private refT: number | null = null;
  private refAlt: number | null = null;
  private pendingRefAlt = false;
  private minAlt = Infinity;
  private recoveryStartT: number | null = null;
  private climbS = 0;
  private recoveredT: number | null = null;
  private maxBank = 0;
  private secondary = false;
  private brokeInIncipient = false;
  private lastAlt = NaN;
  private lastElevator = NaN;
  private lastT = 0;
  private finished: CriterionResult[] | null = null;

  constructor(opts: { tol: Tol; testTol: Tol; standard: Standard; incipient: boolean; idPrefix?: string; required?: boolean }) {
    this.tol = opts.tol;
    this.testTol = opts.testTol;
    this.standard = opts.standard;
    this.incipient = opts.incipient;
    this.prefix = opts.idPrefix ?? 'stall';
    this.required = opts.required ?? true;
  }

  onEvent(r: TrainingEventRecord): void {
    if (this.finished) return;
    if (r.type === 'stallWarnOn' && this.warnT === null) {
      this.warnT = r.simT;
      if (this.incipient && this.refT === null) this.setRef(r.simT, this.lastAlt);
    } else if (r.type === 'stallBreak') {
      const data = r.data as { altFt: number };
      if (this.firstBreakT === null) {
        this.firstBreakT = r.simT;
        if (this.incipient) {
          if (this.recoveredT === null) this.brokeInIncipient = true;
        } else if (this.refT === null) {
          this.setRef(r.simT, data.altFt);
        }
      } else if (r.simT - this.firstBreakT <= SECONDARY_WINDOW_S) {
        this.secondary = true;
      }
    }
  }

  private setRef(t: number, alt: number): void {
    this.refT = t;
    this.refElevator = Number.isFinite(this.lastElevator) ? this.lastElevator : null;
    if (Number.isFinite(alt)) {
      this.refAlt = alt;
      this.minAlt = alt;
    } else {
      this.pendingRefAlt = true;   // no frame yet: take the next one
    }
  }

  update(frame: Readonly<SignalFrame>, simT: number, dt: number): void {
    if (this.finished) return;
    const alt = num(frame, 'altFt');
    const elev = num(frame, 'elevator');
    this.lastT = simT;
    this.lastElevator = elev;
    this.lastAlt = alt;
    if (this.refT === null) return;
    if (this.refElevator === null && Number.isFinite(elev)) this.refElevator = elev;
    if (this.recoveryStartT === null) {
      const pitchRate = num(frame, 'pitchRateDps');
      const forward = this.refElevator !== null && Number.isFinite(elev) && elev <= this.refElevator - ELEVATOR_FORWARD;
      if (forward || pitchRate <= PITCH_DOWN_RATE_DPS) this.recoveryStartT = simT;
    }
    if (this.pendingRefAlt && Number.isFinite(alt)) {
      this.refAlt = alt;
      this.minAlt = alt;
      this.pendingRefAlt = false;
    }
    if (Number.isFinite(alt)) this.minAlt = Math.min(this.minAlt, alt);

    if (this.recoveredT === null) {
      const bank = Math.abs(num(frame, 'bankDeg'));
      if (Number.isFinite(bank)) this.maxBank = Math.max(this.maxBank, bank);
      let vs = num(frame, 'vsFpm');
      if (!Number.isFinite(vs)) vs = num(frame, 'vsiFpm');
      this.climbS = vs > 0 ? this.climbS + dt : 0;
      if (this.climbS >= CLIMB_CONFIRM_S) this.recoveredT = simT;
    }
    // The result waits out the secondary-stall window.
    if (this.recoveredT !== null && simT - (this.firstBreakT ?? this.refT) >= SECONDARY_WINDOW_S) this.finished = this.build();
  }

  /** Null until the recovery is complete (positive climb) and the secondary-stall window has passed. */
  result(): CriterionResult[] | null {
    return this.finished;
  }

  /** Task exit: the rows from what was seen (null when no stall happened in the task). */
  close(): CriterionResult[] | null {
    if (!this.finished && this.refT !== null) this.finished = this.build();
    return this.finished;
  }

  private build(): CriterionResult[] {
    const head = (item: string, label: string, kind: CriterionResult['kind'], safety = false) =>
      ({ id: `${this.prefix}.${item}`, label, kind, required: this.required, safety });
    const rows: CriterionResult[] = [];
    const refAlt = this.refAlt ?? this.minAlt;
    const loss = Number.isFinite(refAlt) && Number.isFinite(this.minAlt) ? Math.max(0, refAlt - this.minAlt) : NaN;
    if (!Number.isFinite(loss)) {
      rows.push(insufficientResult(head('heightLoss', 'Height loss', 'peak'), 'No altitude reading'));
    } else {
      const lossRow = sampleResult(head('heightLoss', 'Height loss', 'peak'), loss, 0, loss, this.tol, this.testTol, this.standard,
      { unit: unitOf('altFt'), peakOf: 'abs' });
      rows.push({ ...lossRow, detail: `Lost ${Math.round(loss)} ft from the ${this.incipient ? 'warning' : 'break'} (limit ${Math.round(this.tol.plus)} ft)` });
    }

    if (this.recoveredT === null) {
      rows.push(passFailResult(head('recovered', 'Recovered to a climb', 'check'), false, 'No positive climb before the task ended'));
    }
    const from = this.refT ?? this.lastT;
    const startT = this.recoveryStartT ?? this.recoveredT;
    const delay = startT === null ? Infinity : Math.max(0, startT - from);
    const startGrade: Grade = delay <= RECOVERY_START_MAX_S ? 3 : 2;
    rows.push(passFailResult(head('recoveryStart', 'Prompt recovery', 'check'), delay <= RECOVERY_START_MAX_S,
      Number.isFinite(delay) ? `Recovery started ${delay.toFixed(1)} s after the ${this.incipient ? 'warning' : 'break'}` : 'No recovery action seen',
      startGrade));
    rows.push(passFailResult(head('secondary', 'No secondary stall', 'binary', true), !this.secondary,
      this.secondary ? `A second stall within ${SECONDARY_WINDOW_S} s` : 'No secondary stall'));
    rows.push(passFailResult(head('bank', 'Wings level in the recovery', 'check'), this.maxBank <= RECOVERY_MAX_BANK_DEG,
      `Bank up to ${Math.round(this.maxBank)}° in the recovery (limit ${RECOVERY_MAX_BANK_DEG}°)`,
      this.maxBank <= RECOVERY_MAX_BANK_DEG ? 3 : 2));
    if (this.incipient) {
      rows.push(passFailResult(head('atWarning', 'Recovered at the warning', 'binary'), !this.brokeInIncipient,
        this.brokeInIncipient ? 'The wing stalled before the recovery' : 'Recovered before the break'));
    }
    return rows;
  }
}
