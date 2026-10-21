// MBB Bo 105 CB-4 instrument markings (FM Fig 7-3 "typical" pedestal). Sources: Flight Manual BO 105 CB-5/CBS-5 used for the
// CB-4 (P5), Section 2 limits and the instrument-marking figures 2-18 .. 2-21; EASA TCDS R.011 (P); BO 105 Training Manual
// 00-32 .. 00-47 (P TM). Every band boundary is a published limit; dial SPACING (the angle each number sits at) is artwork
// ESTIMATE: no scale drawing was found, only the marking lists. Pages in docs/bo105-panel.md and research-bo105 sections 3-5, 12.
// Dots (red 843 / 927 C on the TOT) are drawn as thin arcs: the shared single-dial renderer has no dot primitive.
import { DEG } from '../../core/math';
import type { AsiMarkings, ScaleDef } from '../../instruments/panelDef';
import { BO105_FUEL, BO105_N1_PCT, BO105_N2_PCT, BO105_NR_PCT, BO105_PCT_PER_NM, BO105_TORQUE_PCT, BO105_TOT_C, BO105_NR_100,
  BO105_N2_100_RPM } from './facts';
import { BO105_REFERENCE as V } from './reference';
import { BO105_ROTORCRAFT } from './rotorcraft';
import type { AircraftState } from '../../core/types';

/** kp/cm2 per psi (the Bo 105 pressure gauges read kp/cm2): 0.070307. D */
export const KPCM2_PER_PSI = 0.070307;

/** A thin arc standing for a painted dot, centred on `at`, `half` either side. */
const dot = (at: number, half: number, color: 'red' | 'blue') => ({ from: at - half, to: at + half, color });
const scale = (label: string, min: number, max: number, majors: readonly number[], minorStep: number,
  read: ScaleDef['read'], extra: Partial<ScaleDef> = {}): ScaleDef => ({ label, min, max, majors, minorStep, numbers: true, read, ...extra });

/**
 * ASI, 10-150 kt, 5 kt graduations (P TM 00-32): yellow arc 10-45, green arc 45-145, red radial 145, BLUE radial 100 (the
 * power-off Vne) (P5 FM 2-18). Dial map ESTIMATE (linear, 10 kt at 20 deg to 150 kt at 340 deg; ticks from 20 kt, numbered every 20).
 */
export const BO105_ASI_MARKS: AsiMarkings = {
  scaleKt: [10, 150], scaleDeg: [20, 340],
  tickFrom: 20, tickTo: 150, minorStep: 5, numberStep: 20,
  arcs: [{ from: 10, to: 45, color: 'yellow' }, { from: 45, to: V.vne, color: 'green' }], redLine: V.vne, blueLine: 100,
};

/** Dual torque, % of 298 kW per engine (D, facts.ts): green 0-86, red radials 86 (AEO limit) and 95 (OEI limit) (P5 FM 2-18). */
export const BO105_TORQUE_SCALE = { max: 120, majors: [0, 20, 40, 60, 80, 100, 120],
  arcs: [{ from: 0, to: BO105_TORQUE_PCT.aeo, color: 'green' }] as ScaleDef['arcs'],
  redLines: [BO105_TORQUE_PCT.aeo, BO105_TORQUE_PCT.oei] } as const;

/** Torque % of one engine from its output-shaft N m (D: 298 kW at 6016 rpm = 100 %). */
export const bo105TorquePct = (nm: number): number => nm * BO105_PCT_PER_NM;

/** TOT, C x 100: green 0-779, yellow 779-810, red radial 810, red dots 843 (6 s) and 927 (10 s, start) (P5 FM 2-18; TCDS p9). */
export const BO105_TOT_SCALE = scale('TOT °C ×100', 0, 10, [0, 2, 4, 6, 8, 10], 0.5, r => r.engines[0].ittC / 100,
  { arcs: [{ from: 0, to: BO105_TOT_C.mcp / 100, color: 'green' }, { from: BO105_TOT_C.mcp / 100, to: BO105_TOT_C.takeoff / 100, color: 'yellow' },
    dot(BO105_TOT_C.transient6s / 100, 0.04, 'red'), dot(BO105_TOT_C.start / 100, 0.04, 'red')], redLines: [BO105_TOT_C.takeoff / 100] });
/** N1 gas producer, %: green 59-105, red radial 105 (P5 FM 2-18; the 59 is the idle floor). */
export const BO105_N1_SCALE = scale('N1 %', 0, 120, [0, 20, 40, 60, 80, 100, 120], 5, r => r.engines[0].ngPct,
  { arcs: [{ from: BO105_N1_PCT.idle[0], to: BO105_N1_PCT.continuous, color: 'green' }], redLines: [BO105_N1_PCT.continuous] });

/** Fuel pressure, kp/cm2: yellow 0-0.6, green 0.6-1.7, red radial 1.7 (P5 FM 2-21). */
export const BO105_FUEL_PRESSURE = { max: 2, majors: [0, 0.5, 1, 1.5, 2],
  arcs: [{ from: 0, to: 0.6, color: 'yellow' }, { from: 0.6, to: 1.7, color: 'green' }] as ScaleDef['arcs'], redLines: [1.7] } as const;

/** Triple tachometer (FM 2-19), as percent. Outer scale N2 (power on): red dot 95, red radial 98, green 98-102, red radial 102,
 *  red dot 105 (P5 FM 2-19; the 98-102 band is the TCDS p10 continuous range). Inner scale NR (power off, Model C):
 *  red radial 85, green 85-110, red radial 110 (TCDS p10). */
export const BO105_TACH = { max: 120, majors: [0, 20, 40, 60, 80, 100, 120],
  n2: { green: BO105_NR_PCT.powerOn, redLines: [BO105_NR_PCT.powerOn[0], BO105_NR_PCT.powerOn[1]],
    redDots: [BO105_NR_PCT.transientMin, BO105_N2_PCT.transient15s] },
  nr: { green: BO105_NR_PCT.powerOff, redLines: BO105_NR_PCT.powerOff } } as const;

/**
 * Triple oil temperature: pointers 1 and 2 are the engines (green 30-107 C, red radial 107), pointer R the main
 * transmission (green 30-105 C, red radial 105) (P5 FM 2-20; TM 00-47). Range -30..150 C ESTIMATE.
 */
export const BO105_OIL_TEMP = { min: -30, max: 150, majors: [-30, 0, 30, 60, 90, 120, 150],
  engine: { arcs: [{ from: 30, to: 107, color: 'green' }] as ScaleDef['arcs'], redLines: [107] },
  transmission: { arcs: [{ from: 30, to: 105, color: 'green' }] as ScaleDef['arcs'], redLines: [105] } } as const;

/**
 * Triple oil pressure, kp/cm2. Engines 1 and 2: red radial 3.5, yellow 3.5-6.3 (idle band, FM 2-10: 3.5-9.1 below 79 % N1),
 * green 6.3-9.1, red radial 9.1. Transmission R: red radial 0.5, yellow 0.5-0.8, green 0.8-2.0 (P5 FM 2-20/2-21; max
 * 1.75 bar from the maintenance manual). Dial ranges ESTIMATE.
 */
export const BO105_OIL_PRESSURE = { max: 10, majors: [0, 2, 4, 6, 8, 10],
  engine: { arcs: [{ from: 3.5, to: 6.3, color: 'yellow' }, { from: 6.3, to: 9.1, color: 'green' }] as ScaleDef['arcs'], redLines: [3.5, 9.1] },
  transmission: { max: 3, majors: [0, 1, 2, 3],
    arcs: [{ from: 0.5, to: 0.8, color: 'yellow' }, { from: 0.8, to: 2.0, color: 'green' }] as ScaleDef['arcs'], redLines: [0.5, 2.0] } } as const;

/** Fuel (kg, Jet A-1 0.8 kg/l): supply tank 0-100 kg with the red LOW FUEL point at 60 kg, main tank 0-400 kg (usable 74 + 382 kg,
 *  P TCDS p9; LOW FUEL 60 kg, P5 FM 3-13). Dial maps ESTIMATE. */
export const BO105_FUEL_SCALES = {
  supply: { min: 0, max: 100, majors: [0, 50, 100], arcs: [dot(BO105_FUEL.lowFuelKg, 1.2, 'red')] as ScaleDef['arcs'] },
  main: { min: 0, max: 400, majors: [0, 100, 200, 300, 400], arcs: [] as ScaleDef['arcs'] },
} as const;

/** Mast-moment indicator (P5 FM 7-13 text: green / yellow / red bands, CAL, TEST and LIMIT; no numbers are published).
 *  The needle reads percent of the LIMIT moment; yellow starts at the hub's `mastMomentYellow` fraction. The fallbacks apply
 *  only until the flight model publishes its hub values: ESTIMATE (16.5 deg of TPP-to-shaft tilt x the UNVERIFIED
 *  K_beta 113,000 N m/rad = 32 kN m; yellow at 0.5, about 8 deg). */
export const BO105_MAST_MOMENT = { max: 120, limitFallbackNm: 32_000, yellowFallback: 0.5 } as const;

/** Rounded-off dial sweep shared by the single-pointer engine dials, rad. */
export const BO105_DIAL_SWEEP = { a0: -125 * DEG, a1: 125 * DEG } as const;

/** N2 % and NR % from the shaft rpm the state carries. */
export const bo105N2Pct = (rpm: number): number => rpm / BO105_N2_100_RPM * 100;
export const bo105NrPct = (rpm: number): number => rpm / BO105_NR_100 * 100;

/** The hub's LIMIT moment (N m) and where yellow starts (fraction of it): the flight model's hingeless hub when it declares them, else the fallback. */
export function bo105MastMomentLimit(): { limit: number; yellow: number } {
  const hub = BO105_ROTORCRAFT.hubModel;
  return hub?.kind === 'hingeless' && hub.mastMomentLimit !== undefined
    ? { limit: hub.mastMomentLimit, yellow: hub.mastMomentYellow ?? BO105_MAST_MOMENT.yellowFallback }
    : { limit: BO105_MAST_MOMENT.limitFallbackNm, yellow: BO105_MAST_MOMENT.yellowFallback };
}
/** Mast moment as percent of the LIMIT mark; null when the flight model does not publish it. */
export function bo105MastMomentPct(s: AircraftState): number | null {
  const m = s.rotorcraft?.mastMoment;
  return m === undefined ? null : 100 * m / bo105MastMomentLimit().limit;
}
