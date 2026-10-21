// Lockheed AH-56A Cheyenne: markings of the reconstructed rear-seat pilot panel. NO PHOTOGRAPH OR DRAWING of this panel exists
// in the sources (research-ah56 section 12): the arrangement is an AGENT reconstruction, marked UNVERIFIED on the panel. The BAND
// BOUNDARIES are published limits: ASTA-72 = USAASTA 72-08 safety-of-flight release (SoF para 5; 1972 ICS aircraft) and AMCS-73 =
// USAASTA 72-44 SoF (AMCS ship 7); APE-I = USAASTA 70-02 SoF 1.1 (page / paragraph tags in docs/ah56-panel.md). The scale SPACING
// (how far apart the numbers sit) is artwork ESTIMATE. Dots are drawn as thin arcs.
import { DEG } from '../../core/math';
import type { ArcDef, AsiMarkings, ScaleDef } from '../../instruments/panelDef';
import { AH56_COLLECTIVE_DEG, AH56_NF_100_RPM, AH56_NG_PCT, AH56_NR_PCT, AH56_PROP_BETA_DEG, AH56_TIT_C, AH56_TORQUE_100_SHP,
  AH56_TORQUE_LIMIT_PCT } from './facts';
import { AH56_REFERENCE as V } from './reference';

/** Jet A-1, 0.8 kg/l: kg per US gallon, and lb per US gallon. D */
export const AH56_KG_PER_GAL = 0.8 * 3.785411784;
export const AH56_LB_PER_KG = 2.2046226218;
const scale = (label: string, min: number, max: number, majors: readonly number[], minorStep: number,
  read: ScaleDef['read'], extra: Partial<ScaleDef> = {}): ScaleDef => ({ label, min, max, majors, minorStep, numbers: true, read, ...extra });

/** 100 % torque shaft torque, N m: 3435 shp x 745.7 W / (13,600 rpm x 2 pi / 60) = 1799 N m (D; Nf 13,600 rpm is S, research-ah56 section 9). */
export const AH56_TORQUE_100_NM = AH56_TORQUE_100_SHP * 745.699872 / (AH56_NF_100_RPM * 2 * Math.PI / 60);
export const ah56TorquePct = (nm: number): number => nm / AH56_TORQUE_100_NM * 100;

/**
 * Airspeed, KCAS. The sources give NO ASI marking: green 40 - 195 and the red radial at Vne 195 are ESTIMATE (Vne itself is INF,
 * research-ah56 section 10; pushovers began at 165 "to preclude exceeding Vne"). A white tick at the 130 KCAS gear limit (P ASTA-72 SoF
 * 4a(2)) is drawn as the blue radial slot. Dial map ESTIMATE (linear, 0 - 250 kt over 0 - 330 deg).
 */
export const AH56_ASI_MARKS: AsiMarkings = {
  scaleKt: [0, 250], scaleDeg: [0, 330],
  tickFrom: 40, tickTo: 240, minorStep: 10, numberStep: 20,
  arcs: [{ from: 40, to: V.vne, color: 'green' }], redLine: V.vne, blueLine: 130,
};

// ---------------------------------------------------------------------------------------------------- vertical tapes
export interface TapeBand { from: number; to: number; color: 'green' | 'yellow' | 'red' | 'blue' }
export interface TapeSpec {
  title: string; unit: string;
  min: number; max: number; majors: readonly number[]; minorStep: number;
  bands: readonly TapeBand[];
  /** Radial marks across the bar: red = limit, blue = "record" mark. */
  marks: readonly { at: number; color: 'red' | 'blue' }[];
  /** Digits after the point of the readout. */
  decimals: number;
}

/** Engine torque, % of 3435 shp at 100 % Nf: green 0-114, red above 114 (114 % = 3925 shp, the transmission limit) (P ASTA-72 SoF para 5 / APE-I SoF 1.2). */
export const AH56_TORQUE_TAPE: TapeSpec = { title: 'TORQUE', unit: '%', min: 0, max: 130, majors: [0, 20, 40, 60, 80, 100, 120], minorStep: 10,
  bands: [{ from: 0, to: AH56_TORQUE_LIMIT_PCT, color: 'green' }, { from: AH56_TORQUE_LIMIT_PCT, to: 130, color: 'red' }],
  marks: [{ at: AH56_TORQUE_LIMIT_PCT, color: 'red' }], decimals: 0 };
/**
 * Turbine inlet temperature, C: green 300-740, yellow 740-770 (30 min) and 770-780 (10 min), red from 785 (inspection); radial at 740
 * (maximum continuous), blue 720 "record time above" (P ASTA-72 SoF para 5; AMCS-73). Range 0-900 ESTIMATE.
 */
export const AH56_TIT_TAPE: TapeSpec = { title: 'TIT', unit: '°C', min: 0, max: 900, majors: [0, 200, 400, 600, 800], minorStep: 50,
  bands: [{ from: 300, to: AH56_TIT_C.continuous, color: 'green' }, { from: AH56_TIT_C.continuous, to: AH56_TIT_C.yellow10min, color: 'yellow' },
    { from: AH56_TIT_C.inspection, to: 900, color: 'red' }],
  marks: [{ at: AH56_TIT_C.continuous, color: 'red' }, { at: 720, color: 'blue' }], decimals: 0 };
/** Gas generator, %: radial 58 (minimum idle), green 63-100, yellow 100-101.5 (10 s), red above 101.5 (P APE-I SoF 1.1 / ASTA-72 SoF para 5). */
export const AH56_NG_TAPE: TapeSpec = { title: 'Ng', unit: '%', min: 0, max: 110, majors: [0, 20, 40, 60, 80, 100], minorStep: 5,
  bands: [{ from: 63, to: AH56_NG_PCT.continuous, color: 'green' }, { from: AH56_NG_PCT.continuous, to: AH56_NG_PCT.red, color: 'yellow' }, { from: AH56_NG_PCT.red, to: 110, color: 'red' }],
  marks: [{ at: AH56_NG_PCT.idle[0], color: 'red' }, { at: AH56_NG_PCT.red, color: 'red' }], decimals: 0 };
/**
 * Nf (power turbine) and Nr (rotor): two bars on one tape. Nf band: yellow 95-98, green 98-105, red radials 95 and 105 (P ASTA-72 SoF
 * para 5, 1972; APE 1.2 98 minimum). Nr: green 95-105 power on, red radials at the power-off limits 85 and 110 (P ASTA-72 / AMCS-73).
 * 100 % Nr = 246 rpm even on the AMCS aircraft, which flies 97.5 %.
 */
export const AH56_NF_NR_TAPE: TapeSpec = { title: 'Nf  Nr', unit: '%', min: 40, max: 120, majors: [40, 60, 80, 100, 120], minorStep: 5,
  bands: [{ from: 95, to: 98, color: 'yellow' }, { from: 98, to: AH56_NR_PCT.powerOn[1], color: 'green' }],
  marks: [{ at: 85, color: 'red' }, { at: 95, color: 'red' }, { at: AH56_NR_PCT.powerOn[1], color: 'red' }, { at: AH56_NR_PCT.powerOff[1], color: 'red' }], decimals: 0 };

// ---------------------------------------------------------------------------------------------------- angle indicators
export interface AngleSpec {
  title: string; min: number; max: number; majors: readonly number[];
  /** Ticks drawn with a legend: the detents and the cruise value. */
  marks: readonly { at: number; label: string }[];
  bands?: readonly TapeBand[];
}
/**
 * Collective blade angle, indicated degrees. AMCS 4.5-21.5, 13 in cruise above 80 KCAS, autorotation 4.5-7 (P AMCS-73 SoF 2b); the ICS
 * aircraft reads 7 deg less ("13 deg AMCS = 6 deg ICS", D). The marks are the AMCS ones; the indicator shifts the ICS reading, not the marks.
 */
export const AH56_COLLECTIVE_INDICATOR: AngleSpec = { title: 'COLL', min: 0, max: 25, majors: [0, 5, 10, 15, 20, 25],
  marks: [{ at: AH56_COLLECTIVE_DEG.amcsCruise, label: 'CRUISE' }, { at: AH56_COLLECTIVE_DEG.amcsIndicated[0], label: 'MIN' }],
  bands: [{ from: AH56_COLLECTIVE_DEG.amcsIndicated[0], to: AH56_COLLECTIVE_DEG.amcsIndicated[1], color: 'green' }] };
/** Propeller blade angle at 0.7 R (42 in), deg: range -17.2 to +40.8; flight minimum -12 (full reverse), hover detent -2.2, autorotation +8 (P ASTA-72 paras 66-67). */
export const AH56_BETA_INDICATOR: AngleSpec = { title: 'PROP β', min: -20, max: 45, majors: [-20, -10, 0, 10, 20, 30, 40],
  marks: [{ at: AH56_PROP_BETA_DEG.flightMin, label: 'REV' }, { at: AH56_PROP_BETA_DEG.hoverDetent, label: 'HOVER' }, { at: AH56_PROP_BETA_DEG.autorotation, label: 'AUTO' }],
  bands: [{ from: AH56_PROP_BETA_DEG.min, to: AH56_PROP_BETA_DEG.max, color: 'green' }] };

// ---------------------------------------------------------------------------------------------------- round gauges
/** Accelerometer, g: green 0.25-2.5 (the AMCS test envelope, P AMCS-73 paras 38-41; 0.25 g is the lower limit). Range -2 to 4 ESTIMATE. */
export const AH56_G_SCALE = scale('G', -2, 4, [-2, -1, 0, 1, 2, 3, 4], 0.25, () => 1,
  { signedNumbers: true, arcs: [{ from: 0.25, to: 2.5, color: 'green' }], redLines: [0.25, 2.5] });
/** Fuel quantity, lb x 100: red 0-3.9 (the 390 lb low-fuel warning, P APE-I / ASTA-72). Capacity ESTIMATE about 2,500 lb (research-ah56 section 3); range 0-30. */
export const AH56_FUEL_SCALE = scale('FUEL LB ×100', 0, 30, [0, 10, 20, 30], 2.5, () => 0,
  { arcs: [{ from: 0, to: 3.9, color: 'red' }] });
/** Engine oil temperature C: green 0-107, yellow 107-150 (30 min emergency); engine oil pressure psi: red radials 10 (minimum) and 83, green 10-83 (1972); (P ASTA-72 SoF para 5). */
export const AH56_ENGINE_OIL = {
  temp: { min: 0, max: 150, majors: [0, 50, 100, 150], arcs: [{ from: 0, to: 107, color: 'green' }, { from: 107, to: 150, color: 'yellow' }] as readonly ArcDef[], redLines: [107] },
  pressure: { min: 0, max: 100, majors: [0, 25, 50, 75, 100], arcs: [{ from: 10, to: 83, color: 'green' }] as readonly ArcDef[], redLines: [10, 83] },
} as const;
/** Transmission oil temperature C: green 0-113, yellow 113-130 (30 min) and 130-140 (10 min), red radial 140; pressure psi: green 70-110, red radials 70 (1972 minimum) and 110 (P APE-I SoF 1.1 / ASTA-72). */
export const AH56_XMSN_OIL = {
  temp: { min: 0, max: 150, majors: [0, 50, 100, 150], arcs: [{ from: 0, to: 113, color: 'green' }, { from: 113, to: 140, color: 'yellow' }] as readonly ArcDef[], redLines: [140] },
  pressure: { min: 0, max: 150, majors: [0, 50, 100, 150], arcs: [{ from: 70, to: 110, color: 'green' }] as readonly ArcDef[], redLines: [70, 110] },
} as const;
/** Hydraulic pressure, psi (systems 1, 1A, 2): normal 2800-3400, maximum 3400 (P APE-I SoF 1.1). Range 0-4000 ESTIMATE. */
export const AH56_HYDRAULIC = { min: 0, max: 4000, normal: [2800, 3400] as const, majors: [0, 1000, 2000, 3000, 4000] } as const;

export const AH56_DIAL_SWEEP = { a0: -125 * DEG, a1: 125 * DEG } as const;
