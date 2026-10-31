// Landing score (docs/career.md "The job runtime", LANDING_SCORE_RULES): one number out of 100 for the debrief
// and the settlement's landing line, from the school's LandingData (src/training/engine/events.ts LandingDetector,
// fed by the field geo provider) or, for a helicopter, from its contact.
//
// Aeroplanes: 25 centreline (full on it, 0 at 10 m off) + 35 sink (full to 300 fpm, 0 at 700) + 20 zone + 10
// drift (0 at 10 deg) + 10 bounce (0 if a bounce rose above 1 ft); 0 for a crash, a touchdown off the runway or a
// nosewheel first. The zone depends on the runway: a sealed runway of 900 m or more has aim markings, so full
// marks from the aim point to 400 ft beyond it, falling to 0 at 200 ft outside either way; a grass strip or a
// shorter runway is flown with short-field technique, so full from 15 m past the threshold to the end of the
// first third, falling to 0 at the threshold and at half the length. The zone works from distAimFt and the same
// aim point the provider used (fieldGeo.ts aimPointM), so a 650 m strip's aim point (97.5 m) and its short-field
// zone agree.
//
// Helicopters (skids report one 'left' touchdown, and kiasAt50Ft means nothing on a vertical approach): 50 sink
// (full to 200 fpm, 0 at 500) + 15 bank at contact (0 at 10 deg) + 15 ground speed at contact (full to 2 kt, 0 at
// 10) + 20 distance from the spot (full within 15 m, 0 at 100 m); 0 for a crash. `onTarget` for a helicopter is
// within COMPLETION_RULES.siteRadiusM of the spot (the stand, or a site).
//
// Pure; the gradeLanding rows with standard 'commercial' stay available to the debrief for the detail text.

import { FT } from '../../core/math';
import type { LandingData } from '../../training/types';
import type { Airfield } from '../../world/airfields';
import { COMPLETION_RULES, LANDING_SCORE_RULES, type LandingSummary } from '../types';
import { aimPointM } from './fieldGeo';

/** Full marks up to `full`, none from `zero`, linear between (either order of full and zero). */
function fall(x: number, full: number, zero: number): number {
  if (!Number.isFinite(x)) return 0;
  const k = (x - full) / (zero - full);
  return Math.min(1, Math.max(0, 1 - k));
}

/** Short-field technique applies: a grass strip, or a runway shorter than LANDING_SCORE_RULES.shortFieldM. */
export function isShortField(f: Pick<Airfield, 'kind' | 'length'>): boolean {
  return f.kind === 'grass' || f.length < LANDING_SCORE_RULES.shortFieldM;
}

/** Zone fraction 0..1 for a touchdown `distAimFt` past the aim point of `f` (see the header). */
export function zoneFraction(f: Pick<Airfield, 'kind' | 'length'>, distAimFt: number): number {
  const R = LANDING_SCORE_RULES;
  if (!Number.isFinite(distAimFt)) return 0;
  if (!isShortField(f)) {
    if (distAimFt < 0) return fall(distAimFt, 0, -R.zoneZeroFt);
    return fall(distAimFt, R.zoneFullFt, R.zoneFullFt + R.zoneZeroFt);
  }
  const alongThr = aimPointM(f) + distAimFt * FT;
  const start = R.shortZoneStartM;
  const third = f.length / 3;
  const half = f.length / 2;
  if (alongThr < start) return fall(alongThr, start, 0);
  return fall(alongThr, third, half);
}

/** The aeroplane landing score's parts (points each) and total; all 0 for a crash, off the runway or nose first. */
export function aeroplaneLandingPoints(d: LandingData, f: Pick<Airfield, 'kind' | 'length'>): { centreline: number; sink: number; zone: number; drift: number; bounce: number; total: number } {
  const R = LANDING_SCORE_RULES;
  if (d.crashed || !d.onRunway || d.firstWheel === 'nose') return { centreline: 0, sink: 0, zone: 0, drift: 0, bounce: 0, total: 0 };
  const centreline = R.centreline * fall(Math.abs(d.rwyAcrossM), 0, R.centrelineZeroM);
  const sink = R.sink * fall(d.sinkFpm, R.sinkFullFpm, R.sinkZeroFpm);
  const zone = R.zone * zoneFraction(f, d.distAimFt);
  const drift = R.drift * fall(Math.abs(d.driftDeg), 0, R.driftZeroDeg);
  const bounce = d.maxBounceFt > 1 ? 0 : R.bounce;
  return { centreline, sink, zone, drift, bounce, total: centreline + sink + zone + drift + bounce };
}

/** The debrief's landing summary of an aeroplane landing at field `f`. */
export function scoreAeroplaneLanding(d: LandingData, f: Pick<Airfield, 'kind' | 'length'>): LandingSummary {
  const p = aeroplaneLandingPoints(d, f);
  const out: LandingSummary = {
    score: Math.min(100, Math.max(0, p.total)),
    sinkFpm: Math.max(0, d.sinkFpm),
    bounces: d.bounces,
    firstWheel: d.firstWheel,
    helicopter: false,
    onTarget: d.onRunway && !d.crashed,
  };
  if (Number.isFinite(d.distAimFt)) out.distAimFt = d.distAimFt;
  if (Number.isFinite(d.rwyAcrossM)) out.centrelineM = Math.abs(d.rwyAcrossM);
  return out;
}

/** What a helicopter landing is scored on, taken at the skids' first contact. */
export interface HeliContact {
  /** Sink rate at contact, fpm. */
  sinkFpm: number;
  /** Bank at contact, deg (either way). */
  bankDeg: number;
  /** Ground speed at contact, kt. */
  gsKt: number;
  /** Horizontal distance from the landing spot (the stand, or the site), m; NaN when there is none. */
  spotDistM: number;
  bounces: number;
  crashed: boolean;
}

/** The helicopter landing score's parts (points each) and total; all 0 for a crash. */
export function heliLandingPoints(c: HeliContact): { sink: number; bank: number; gs: number; spot: number; total: number } {
  const R = LANDING_SCORE_RULES;
  if (c.crashed) return { sink: 0, bank: 0, gs: 0, spot: 0, total: 0 };
  const sink = R.heliSink * fall(c.sinkFpm, R.heliSinkFullFpm, R.heliSinkZeroFpm);
  const bank = R.heliBank * fall(Math.abs(c.bankDeg), 0, R.heliBankZeroDeg);
  const gs = R.heliGs * fall(c.gsKt, R.heliGsFullKt, R.heliGsZeroKt);
  const spot = R.heliSpot * fall(c.spotDistM, R.heliSpotFullM, R.heliSpotZeroM);
  return { sink, bank, gs, spot, total: sink + bank + gs + spot };
}

/** The debrief's landing summary of a helicopter landing. */
export function scoreHeliLanding(c: HeliContact): LandingSummary {
  const out: LandingSummary = {
    score: Math.min(100, Math.max(0, heliLandingPoints(c).total)),
    sinkFpm: Math.max(0, c.sinkFpm),
    bounces: c.bounces,
    firstWheel: 'left',
    helicopter: true,
    onTarget: !c.crashed && Number.isFinite(c.spotDistM) && c.spotDistM <= COMPLETION_RULES.siteRadiusM,
  };
  if (Number.isFinite(c.spotDistM)) out.spotDistM = c.spotDistM;
  return out;
}
