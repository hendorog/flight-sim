// Tolerance tables by authority and standard (section 2.2). ±x is { minus: x, plus: x }. Values marked
// "sim standard" or "examiner practice" are design choices where the authority publishes no figure; the
// briefing labels them (STANDARD_NOTES). Changing a value is a one-line data edit reviewed by the owner.
//
// Filled in wave 0 straight from the spec table: it is data the whole engine needs from the first test.

import type { AuthorityId, Standard, Tol, TolKey, ToleranceTable } from '../types';

type Band = number | [minus: number, plus: number];
/** [EASA test, FAA test, training (both), commercial (both)] */
type Row = [easaTest: Band, faaTest: Band, training: Band, commercial: Band];

const ROWS: Record<TolKey, Row> = {
  altitude: [150, 100, 200, 100],
  altitudeEngineOut: [200, 100, 250, 100],
  heading: [10, 10, 15, 10],
  headingEngineOut: [15, 10, 20, 10],
  speed: [15, 10, 15, 5],
  speedClimbApproach: [[5, 15], [5, 10], [5, 15], [0, 5]],
  slowFlightSpeed: [[0, 10], [0, 10], [0, 15], [0, 5]],
  bankMedium: [10, 10, 10, 5],
  bankSteep: [10, 5, 10, 5],
  rollout: [10, 10, 15, 10],
  vs: [200, 200, 300, 100],
  touchdownZoneFt: [[0, 400], [0, 400], [0, 600], [0, 200]],
  touchdownZoneShortFt: [[0, 200], [0, 200], [0, 300], [0, 100]],
  centrelineM: [5, 5, 8, 3],
  glidepathFt: [100, 100, 150, 75],
  stallHeightLossFt: [[0, 200], [0, 200], [0, 300], [0, 100]],
  navAltitude: [200, 200, 300, 100],
  navHeading: [10, 15, 20, 10],
  xtkNm: [1, 1, 2, 0.5],
  etaMin: [3, 3, 5, 2],
  instrAltitude: [150, 100, 200, 100],
  instrHeading: [10, 10, 20, 10],
  turnRate: [0.2, 0.2, 0.3, 0.15],
  sinkFpm: [[0, 400], [0, 400], [0, 500], [0, 300]],
};

const tol = (b: Band): Tol => (typeof b === 'number' ? { minus: b, plus: b } : { minus: b[0], plus: b[1] });

function table(authority: AuthorityId): Record<Standard, Record<TolKey, Tol>> {
  const pick = (col: (r: Row) => Band): Record<TolKey, Tol> =>
    Object.fromEntries((Object.keys(ROWS) as TolKey[]).map((k) => [k, tol(col(ROWS[k]))])) as Record<TolKey, Tol>;
  return {
    training: pick((r) => r[2]),
    test: pick((r) => (authority === 'easa' ? r[0] : r[1])),
    commercial: pick((r) => r[3]),
  };
}

export const STANDARDS: ToleranceTable = { easa: table('easa'), faa: table('faa') };

/** Briefing footnotes for values the authorities do not tabulate. */
export const STANDARD_NOTES: Partial<Record<TolKey, Partial<Record<AuthorityId, string>>>> = {
  bankSteep: { easa: 'Examiner practice; not tabulated in AMC1 FCL.235' },
  touchdownZoneFt: { easa: 'Sim standard', faa: 'Sim standard' },
  stallHeightLossFt: { easa: 'Sim standard', faa: 'Sim standard' },
};
