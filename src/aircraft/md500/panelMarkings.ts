// MD 500E (369E, 250-C20B) instrument markings. Sources: RFM CSP-E-1 Rev 16, Section II limits and Fig 2-5
// (instrument markings, sheets 1-3), via research-md500.md sections 4, 10, 12. Dial SPACING is artwork estimated from
// the figures and the Radecki cockpit photo (ESTIMATE); every band boundary is a published limit (P).
// Dots (blue 74.3 psi / 738 C, red 843 C, 35 lb fuel) are drawn as thin arcs: the shared single-dial renderer has no
// dot primitive (renderer compromise, docs/md500-panel.md).
import { DEG } from '../../core/math';
import type { AsiMarkings, ScaleDef } from '../../instruments/panelDef';
import { MD500_FUEL, MD500_N1_PCT, MD500_N2_PCT, MD500_NR_100, MD500_NR_LIMITS, MD500_TORQUE_PSI, MD500_TOT_C, md500TorquePsi } from './facts';
import { MD500_REFERENCE as V } from './reference';

/** Jet A: 435.0 lb total in 64.0 US gal (RFM 1-13). D */
export const MD500_LB_PER_GAL = 435 / 64;
export const MD500_KG_PER_GAL = MD500_LB_PER_GAL * 0.45359237;

/** Fig 2-5 sheet 1: 0-160 kt, green 42-152 (P), red 152 (P), red/white hatched radial at 130 (autorotation Vne, P). Dial map ESTIMATE. */
export const MD500_ASI_MARKS: AsiMarkings = {
  scaleKt: [0, 20, 40, 60, 80, 100, 120, 140, 160],
  scaleDeg: [0, 36, 78, 120, 162, 204, 246, 288, 330],
  tickFrom: 20, tickTo: 160, minorStep: 5, numberStep: 20,
  arcs: [{ from: 42, to: V.vne, color: 'green' }], redLine: V.vne, crossHatchedLine: V.autorotationVne,
};

const scale = (label: string, min: number, max: number, majors: readonly number[], minorStep: number,
  read: ScaleDef['read'], extra: Partial<ScaleDef> = {}): ScaleDef =>
  ({ label, min, max, majors, minorStep, numbers: true, read, ...extra });

/** A thin arc standing for a painted dot, centred on `at`, `half` either side. */
const dot = (at: number, half: number, color: 'red' | 'blue') => ({ from: at - half, to: at + half, color });
const c = (f: number): number => (f - 32) * 5 / 9;

/** Percent tach scales: the shared transport carries percent; the dual tach is N2 % (outer) over Nr rpm (inner). */
export const MD500_N2_SCALE = { max: 120, majors: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120], minorStep: 2,
  /** RFM 2-13 Fig 2-5 sheet 2: green 102-103 %, red radials 102 and 103 %, red dot 113 %. P */
  green: [MD500_N2_PCT.setTakeoff - 1, MD500_N2_PCT.setTakeoff] as const, redLines: [102, 103] as const, redDot: 113 } as const;
/** Inner scale: rotor rpm x 100, 0-5+; green 410-523, red 410 and 523. P */
export const MD500_NR_SCALE = { majorsHundreds: [0, 1, 2, 3, 4, 5], green: MD500_NR_LIMITS.powerOff, redLines: MD500_NR_LIMITS.powerOff } as const;
/** Rotor rpm to the common needle position (N2 percent at the same angle). */
export const nrToDialPct = (rpm: number): number => rpm / MD500_NR_100 * 100;

/** N1: 0-110 % with 0-9 vernier; green 64-105, red 59 and 105 (P). */
export const MD500_N1_SCALE = { max: 110, majors: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110],
  green: [MD500_N1_PCT.groundIdle[0], MD500_N1_PCT.continuous] as const, redLines: [59, MD500_N1_PCT.continuous] as const } as const;

/** Engine column, left to right of Fig 4-2. */
export const MD500_SCALES = {
  /** Engine oil temperature 0-107 C green (RFM 2-6). Range -50..150 C ESTIMATE. */
  oilTemp: scale('OIL °C', -50, 150, [-50, 0, 100, 150], 10, r => c(r.oilTempF),
    { signedNumbers: true, arcs: [{ from: 0, to: 107, color: 'green' }], redLines: [107] }),
  /** Torque psi: green 0-81.3, yellow 81.3-87.2, red 87.2, blue dot 74.3 (RFM 2-5, Fig 2-5). */
  torque: scale('TORQUE PSI', 0, 110, [0, 20, 40, 60, 80, 100], 5, r => md500TorquePsi(r.engines[0].torqueNm),
    { arcs: [{ from: 0, to: MD500_TORQUE_PSI.mcp, color: 'green' }, { from: MD500_TORQUE_PSI.mcp, to: MD500_TORQUE_PSI.takeoff, color: 'yellow' },
      dot(MD500_TORQUE_PSI.mcpHot, 0.35, 'blue')], redLines: [MD500_TORQUE_PSI.takeoff] }),
  /** TOT, C x 100: green 360-755, yellow 755-810, red 810, red dot 843, blue dot 738 (RFM 2-5, Fig 2-5). */
  tot: scale('TOT °C ×100', 0, 12, [0, 2, 4, 6, 8, 10, 12], 0.5, r => r.engines[0].ittC / 100,
    { arcs: [{ from: 3.6, to: MD500_TOT_C.mcp / 100, color: 'green' }, { from: MD500_TOT_C.mcp / 100, to: MD500_TOT_C.takeoff / 100, color: 'yellow' },
      dot(MD500_TOT_C.mcpHighTorque / 100, 0.035, 'blue'), dot(MD500_TOT_C.transient6s / 100, 0.035, 'red')], redLines: [MD500_TOT_C.takeoff / 100] }),
  /** Engine oil pressure 0-150 psi: yellow 50-90, green 90-130, red 50 and 130 (RFM 2-6, Fig 2-5). */
  oilPressure: scale('OIL PSI', 0, 150, [0, 25, 50, 75, 100, 125, 150], 5, r => r.oilPressurePsi,
    { arcs: [{ from: 50, to: 90, color: 'yellow' }, { from: 90, to: 130, color: 'green' }], redLines: [50, 130] }),
  /** Fuel quantity, lb x 100, 0-4: red at 12.5 lb, red dot at the 35 lb FUEL LEVEL LOW point (RFM Fig 2-5, 3-23). */
  fuel: scale('FUEL LBS ×100', 0, 4, [0, 1, 2, 3, 4], 0.25, r => r.fuelGal[0] * MD500_LB_PER_GAL / 100,
    { arcs: [{ from: 0, to: 0.125, color: 'red' }, dot(MD500_FUEL.lowLb / 100, 0.02, 'red')] }),
  /** Generator load 0-150 A: green 0-85, yellow 85-150, red 150 (RFM 2-9, Fig 2-5 sheet 3). */
  amps: scale('DC AMPS', 0, 150, [0, 50, 100, 150], 10, r => r.alternatorAmps[0] ?? 0,
    { arcs: [{ from: 0, to: 85, color: 'green' }, { from: 85, to: 150, color: 'yellow' }], redLines: [150] }),
} as const;
export const MD500_DIAL_SWEEP = { a0: -150 * DEG, a1: 150 * DEG } as const;
