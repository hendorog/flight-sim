// Challenge scoring 0-100 and medals (section 4.3). Challenges never affect lesson competency.
//
// Where section 4.3 gives only the weight of a component, the component falls off linearly from full marks
// at the ideal to zero at the value named next to it below (choices recorded in the module report).

import type { ChallengeBest, ChallengeScoring, LandingData, Medal } from '../types';

/** Inputs a challenge score needs, collected by the runner during the attempt. */
export interface ChallengeInputs {
  landing: LandingData | null;
  /** Hold criteria normalised errors (precision circuit, Vglide hold). */
  meanNormalisedError: number;
  /** Fraction of the glide within the Vglide band (dead-stick). */
  glideWithin: number;
  stallWarning: boolean;
}

/** Bests kept per challenge and authority. */
export const BESTS_KEPT = 5;
/** The touchdown zone of the dead-stick and crosswind challenges: aim point to +400 ft. */
const ZONE_FT: [number, number] = [0, 400];
/** Sink: full marks up to 300 fpm, nothing at 700 fpm. */
const SINK_FULL = 300, SINK_ZERO = 700;

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
/** Linear fall-off: 1 at or below `full`, 0 at or beyond `zero`. */
const fall = (x: number, full: number, zero: number): number => clamp01((zero - x) / (zero - full));
/** Inside the zone: 1; outside it falls off linearly to 0 at 200 ft outside. */
const zoneScore = (d: number): number => {
  const outside = d < ZONE_FT[0] ? ZONE_FT[0] - d : d > ZONE_FT[1] ? d - ZONE_FT[1] : 0;
  return fall(outside, 0, 200);
};
/** A landing that cannot score at all: a crash, nose first or off the runway. */
const voidLanding = (l: LandingData): boolean => l.crashed || l.firstWheel === 'nose' || !l.onRunway;

export function scoreChallenge(kind: ChallengeScoring, i: ChallengeInputs): number {
  const l = i.landing;
  let score: number;
  switch (kind) {
    case 'spotLanding': {
      if (!l || voidLanding(l)) return 0;
      const sink = Math.max(0, l.sinkFpm);
      score = 100 - Math.abs(l.distAimFt) / 4 - (sink > 300 ? (sink - 300) / 10 : 0);
      break;
    }
    case 'deadStick': {
      if (!l || l.crashed) return 0;
      const zone = l.onRunway && l.firstWheel !== 'nose' ? 40 * zoneScore(l.distAimFt) : 0;
      score = zone + 30 * clamp01(i.glideWithin) + (i.stallWarning ? 0 : 15) + 15 * fall(Math.max(0, l.sinkFpm), SINK_FULL, SINK_ZERO);
      break;
    }
    case 'crosswindMaster': {
      if (!l || voidLanding(l)) return 0;
      score = 30 * fall(Math.abs(l.rwyAcrossM), 0, 10)       // centreline: 0 at 10 m off
        + 30 * fall(Math.abs(l.driftDeg), 0, 10)              // drift: 0 at 10°
        + 20 * fall(Math.max(0, l.sinkFpm), SINK_FULL, SINK_ZERO)
        + 20 * zoneScore(l.distAimFt);
      break;
    }
    case 'precisionCircuit':
      if (!Number.isFinite(i.meanNormalisedError)) return 0;
      score = 100 * (1 - Math.max(0, i.meanNormalisedError) / 2);
      break;
  }
  return Math.round(Math.max(0, Math.min(100, score)));
}

/** Bronze 60, silver 80, gold 92. */
export function medalFor(score: number): Medal | null {
  if (score >= 92) return 'gold';
  if (score >= 80) return 'silver';
  if (score >= 60) return 'bronze';
  return null;
}

/** Insert a best and keep the top 5 for its authority (other authorities' bests are untouched). */
export function addBest(list: readonly ChallengeBest[], b: ChallengeBest): ChallengeBest[] {
  const same = [...list.filter((x) => x.authority === b.authority), b]
    // Higher score first; on a tie the earlier flight keeps its place.
    .sort((x, y) => y.score - x.score || Date.parse(x.at) - Date.parse(y.at))
    .slice(0, BESTS_KEPT);
  return [...list.filter((x) => x.authority !== b.authority), ...same];
}
