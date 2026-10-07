// Pattern diagnosis per hold criterion (section 3.4): biasHigh/biasLow, oscillation, drift, late, ok. The
// pattern selects the debrief tip ("climbIas.oscillation"), so the order of the tests below decides which
// single story the debrief tells when several apply:
//   late        the student got there too slowly (the level-off or roll-out itself was the problem);
//   oscillation chasing the needle (the bias and the slope of a chased value mean little);
//   bias        consistently on one side;
//   drift       a slow trend away from the target (trim, inattention).

import type { Pattern, Tol } from '../types';
import type { HoldSummary } from './accumulators';

/** Qualifying sign changes per minute that count as chasing (section 3.4). */
export const OSCILLATION_PER_MIN = 4;
/** Below this many changes in total the rate is noise (a 5 s sample with one change is 12 per minute). */
const OSCILLATION_MIN_CHANGES = 3;
/** |mean e| above this fraction of the tolerance side is a bias. */
const BIAS_FRACTION = 0.4;
/** "Consistent sign": the mean is most of the mean magnitude (0.7: at most 15 % of the error on the other side). */
const BIAS_CONSISTENCY = 0.7;
/** |slope| above this fraction of the tolerance per minute is a drift. */
const DRIFT_FRACTION = 0.5;

const sideOf = (tol: Tol, positive: boolean): number => {
  const s = positive ? tol.plus : tol.minus;
  return s > 0 ? s : 0.5;
};

export function diagnose(s: HoldSummary, tol: Tol, settleS: number): Pattern {
  if (s.sampledS <= 0) return 'ok';
  // Never in tolerance at all is better told as a bias or a drift when it was one; otherwise 'late' below.
  if (s.firstInS !== null && s.firstInS > 2 * settleS) return 'late';
  const minutes = s.sampledS / 60;
  if (s.signChanges >= OSCILLATION_MIN_CHANGES && s.signChanges / minutes >= OSCILLATION_PER_MIN) return 'oscillation';
  const consistent = s.meanAbsE > 0 && Math.abs(s.meanE) >= BIAS_CONSISTENCY * s.meanAbsE;
  if (consistent && Math.abs(s.meanE) > BIAS_FRACTION * sideOf(tol, s.meanE > 0)) return s.meanE > 0 ? 'biasHigh' : 'biasLow';
  if (Math.abs(s.slopePerMin) > DRIFT_FRACTION * sideOf(tol, s.slopePerMin > 0)) return 'drift';
  if (s.firstInS === null) return 'late';
  return 'ok';
}

/**
 * Pattern of a single-sample criterion (peak, final, atEvent), so debrief tips can name them too
 * ('levelOff.late' in L04). An overshoot of a one-sided peak (peakOf max/min) worse than grade 4 is a late
 * level-off; any other sample worse than grade 4 is a bias in the direction of its error.
 */
export function samplePattern(dev: number, n: number, peakOf: 'abs' | 'max' | 'min' | null): Pattern {
  if (!(n > 0.6)) return 'ok';
  if (peakOf === 'max' || peakOf === 'min') return 'late';
  return dev > 0 ? 'biasHigh' : 'biasLow';
}
