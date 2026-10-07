// Unusual-attitude recovery grader (section 3.4): nose-low (power reduced and wings within 15° of level
// before g exceeds 1.5), nose-high (power added and nose lowered before IAS falls below Vs1 + 5), g <= 3.0,
// IAS < Vne, level attitude within 8 s. Timing starts at the first frame the grader sees, which the Grader
// feeds only while the student has control: the recovery is timed from the handover.

import type { AircraftTypeDef, CriterionResult, SignalFrame, Standard } from '../types';
import { passFailResult } from './rules';

/** Recovery must reach a level attitude within this time, s. */
export const LEVEL_WITHIN_S = 8;
export const UA_MAX_G = 3.0;
const NOSE_LOW_MAX_G_BEFORE_LEVEL = 1.5;
const WINGS_LEVEL_DEG = 15;
/** Level attitude: |bank| and |pitch| within these, deg. */
const LEVEL_BANK_DEG = 10;
const LEVEL_PITCH_DEG = 10;
/** Throttle counts as reduced at or below this (or 0.2 below where it started). */
const THROTTLE_REDUCED = 0.1;
/** Throttle counts as added at or above this (or 0.2 above where it started). */
const THROTTLE_ADDED = 0.9;
/** The nose counts as lowered below this pitch, deg. */
const NOSE_LOWERED_DEG = 5;

const num = (f: Readonly<SignalFrame>, k: string): number => {
  const x = f[k];
  return typeof x === 'number' ? x : NaN;
};

export class UnusualAttitudeGrader {
  private kind: 'noseLow' | 'noseHigh' | null;
  private readonly aircraft: AircraftTypeDef;
  private readonly prefix: string;
  private readonly required: boolean;
  private t0: number | null = null;
  private throttle0 = NaN;
  private sequenceOk: boolean | null = null;   // decided once: the first action came before the limit
  private sequenceDetail = '';
  private maxG = -Infinity;
  private maxKias = 0;
  private levelAtS: number | null = null;
  private lastT = 0;
  private finished: CriterionResult[] | null = null;

  /** `kind` null: decided from the pitch at the first frame (nose above the horizon -> noseHigh). */
  constructor(opts: { kind: 'noseLow' | 'noseHigh' | null; aircraft: AircraftTypeDef; standard: Standard; idPrefix?: string; required?: boolean }) {
    this.kind = opts.kind;
    this.aircraft = opts.aircraft;
    this.prefix = opts.idPrefix ?? 'unusual';
    this.required = opts.required ?? true;
    void opts.standard;   // the items are pass/fail and identical at every standard
  }

  update(frame: Readonly<SignalFrame>, simT: number, dt: number): void {
    void dt;
    if (this.finished) return;
    const pitch = num(frame, 'pitchDeg'), bank = num(frame, 'bankDeg'), g = num(frame, 'gLoad');
    const kias = num(frame, 'kias'), throttle = num(frame, 'throttle');
    if (this.t0 === null) {
      this.t0 = simT;
      this.throttle0 = throttle;
      if (this.kind === null) this.kind = pitch > 0 ? 'noseHigh' : 'noseLow';
    }
    this.lastT = simT;
    if (Number.isFinite(g)) this.maxG = Math.max(this.maxG, g);
    if (Number.isFinite(kias)) this.maxKias = Math.max(this.maxKias, kias);

    if (this.sequenceOk === null) {
      if (this.kind === 'noseLow') {
        const reduced = throttle <= THROTTLE_REDUCED || throttle <= this.throttle0 - 0.2;
        if (reduced && Math.abs(bank) <= WINGS_LEVEL_DEG) {
          this.sequenceOk = true;
          this.sequenceDetail = 'Power off and wings level before pulling out';
        } else if (g > NOSE_LOW_MAX_G_BEFORE_LEVEL) {
          this.sequenceOk = false;
          this.sequenceDetail = `Pulled to ${g.toFixed(1)} g before ${reduced ? 'levelling the wings' : 'closing the throttle'}`;
        }
      } else {
        const added = throttle >= THROTTLE_ADDED || throttle >= this.throttle0 + 0.2;
        const minKias = this.aircraft.vspeeds.Vs1 + 5;
        if (added && pitch < NOSE_LOWERED_DEG) {
          this.sequenceOk = true;
          this.sequenceDetail = 'Nose lowered and power added in time';
        } else if (kias < minKias) {
          this.sequenceOk = false;
          this.sequenceDetail = `Speed fell to ${Math.round(kias)} kt before ${added ? 'lowering the nose' : 'adding power'}`;
        }
      }
    }
    if (this.levelAtS === null && Math.abs(bank) <= LEVEL_BANK_DEG && Math.abs(pitch) <= LEVEL_PITCH_DEG) this.levelAtS = simT - this.t0;
    if (this.levelAtS !== null || simT - this.t0 >= LEVEL_WITHIN_S) this.finished = this.build();
  }

  /** Null until level flight is regained or 8 s have passed. */
  result(): CriterionResult[] | null {
    return this.finished;
  }

  /** Task exit: the rows from what was seen (null when the student never had control). */
  close(): CriterionResult[] | null {
    if (!this.finished && this.t0 !== null) this.finished = this.build();
    return this.finished;
  }

  private build(): CriterionResult[] {
    const head = (item: string, label: string, kind: CriterionResult['kind'], safety = false) =>
      ({ id: `${this.prefix}.${item}`, label, kind, required: this.required, safety });
    const elapsed = this.lastT - (this.t0 ?? this.lastT);
    const level = this.levelAtS !== null && this.levelAtS <= LEVEL_WITHIN_S;
    const vne = this.aircraft.vspeeds.Vne;
    return [
      // "X before Y" fails only when Y came first: a recovery that never reached the limit passes.
      passFailResult(head('sequence', this.kind === 'noseHigh' ? 'Nose-high recovery sequence' : 'Nose-low recovery sequence', 'check'),
        this.sequenceOk !== false, this.sequenceDetail || 'Recovered within the limits'),
      passFailResult(head('g', `Load factor within ${UA_MAX_G} g`, 'binary'), this.maxG <= UA_MAX_G,
        `Peak ${Number.isFinite(this.maxG) ? this.maxG.toFixed(1) : '?'} g`),
      passFailResult(head('vne', 'Below Vne', 'binary', true), this.maxKias < vne, `Peak ${Math.round(this.maxKias)} kt (Vne ${vne} kt)`),
      passFailResult(head('level', `Level within ${LEVEL_WITHIN_S} s`, 'check'), level,
        this.levelAtS !== null ? `Level after ${this.levelAtS.toFixed(1)} s` : `Not level after ${elapsed.toFixed(1)} s`),
    ];
  }
}
