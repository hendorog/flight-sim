// Carburetted 300CB, CSP-C1-1 (16 Jan 2019), Fig 2-3, pp 2-8..2-11.
// Dial spacing is artwork estimated from the figures; band boundaries are published limits.
import type { AsiMarkings, ScaleDef } from '../../instruments/panelDef';
import { S269_REFERENCE as V } from './reference';

export const S269_ASI_MARKS: AsiMarkings = {
  scaleKt: [0, 20, 40, 60, 80, 100, 120, 140],
  scaleDeg: [0, 43, 94, 145, 198, 253, 307, 360],
  tickFrom: 10, tickTo: 130, minorStep: 5, numberStep: 10,
  // The RFM specifies a red radial, not Robinson green/yellow or airplane flap arcs.
  arcs: [], redLine: V.vne,
};

const scale = (label: string, min: number, max: number, majors: readonly number[], minorStep: number,
  read: ScaleDef['read'], extra: Partial<ScaleDef> = {}): ScaleDef =>
  ({ label, min, max, majors, minorStep, numbers: true, read, ...extra });

/** The shared instrument transport uses percent. Convert back to independent absolute shaft RPM.
 * Neither upper-limit reference is a governor target or a printed percent scale. */
export const s269EngineRpm: ScaleDef['read'] = r => r.engineRpmPct * V.engineRpm100 / 100;
export const s269RotorRpm: ScaleDef['read'] = r => r.rotorRpmPct * V.rotorRpm100 / 100;

export const S269_ENGINE_RPM = scale('ENGINE', 0, 3500, [0, 500, 1000, 1500, 2000, 2500, 3000, 3500], 100,
  s269EngineRpm, { arcs: [{ from: 1200, to: 1600, color: 'green' }, { from: 2530, to: 2700, color: 'green' }],
    // FAA 4H12 says 2534; the selected RFM instrument marking explicitly says 2530.
    redLines: [2530, 2700] });
export const S269_ROTOR_RPM = scale('ROTOR', 0, 3500 * V.rotorRpm100 / V.engineRpm100, [0, 100, 200, 300, 400, 500, 600], 20,
  s269RotorRpm, { arcs: [{ from: 390, to: 504, color: 'green' }], redLines: [390, 504] });
/** Red triangle, maximum engine speed with rotor disengaged (RFM 2-11). Not an operating red radial. */
export const S269_DISENGAGED_RPM = 1600;

// RFM 4-2A shows 5..35 inHg without a MAP power-limit arc or a Robinson altitude/MAP placard.
export const S269_MAP_SCALE = scale('', 5, 35, [5, 10, 15, 20, 25, 30, 35], 1, r => r.engines[0].manifoldInHg);
export const S269_ENGINE_SCALES = {
  fuel: scale('FUEL US GAL', 0, V.mainUsableGal, [0, 10, 20, V.mainUsableGal], 5, r => r.fuelGal[0]),
  cht: scale('CHT °F', 200, 600, [200, 300, 400, 500, 600], 50, r => r.engines[0].chtF,
    { arcs: [{ from: 230, to: 450, color: 'green' }, { from: 450, to: 500, color: 'yellow' }], redLines: [500] }),
  oilPressure: scale('OIL PSI', 0, 115, [0, 30, 55, 95, 115], 10, r => r.oilPressurePsi,
    { arcs: [{ from: 55, to: 95, color: 'green' }], redLines: [55, 115] }),
  oilTemp: scale('OIL °F', 75, 245, [75, 100, 150, 200, 245], 25, r => r.oilTempF,
    { arcs: [{ from: 100, to: 245, color: 'green' }], redLines: [245] }),
  // ±70 is visible in RFM Fig 2-3 sheet 1. This is battery charge/discharge current.
  amps: scale('', -70, 70, [-70, 0, 70], 35, r => r.ammeterAmps, { signedNumbers: true }),
  carb: scale('', -30, 30, [-20, -10, 0, 10, 20], 5, r => r.carbAirTempC,
    { signedNumbers: true, arcs: [{ from: -15, to: 5, color: 'yellow' }] }),
};
