// Raven II markings: POH 2-7/2-8 (21 Oct 2016). Dial spacing is artwork, not instrument calibration.
import type { AsiMarkings, RotorTachMarkings, ScaleDef } from '../../instruments/panelDef';
import { R44_REFERENCE as V } from './reference';
import { R44_ROTOR_LIMITS } from './limits';

export const R44_ASI_MARKS: AsiMarkings = {
  scaleKt: [0, 20, 40, 60, 80, 100, 120, 140],
  scaleDeg: [0, 30, 75, 120, 165, 215, 270, 320],
  tickFrom: 0, tickTo: 140, minorStep: 5, numberStep: 20,
  arcs: [
    { from: V.asiGreenMin, to: V.asiGreenMax, color: 'green' },
    { from: V.asiGreenMax, to: V.vne, color: 'yellow' },
    // Shared ASI has no cross-hatched radial. Staggered red bands identify the 100 KIAS power-off
    // mark without borrowing the twin's Vmca radial; true diagonal hatching needs shared renderer work.
    { from: 98.8, to: 99.6, color: 'red' }, { from: 100.4, to: 101.2, color: 'red' },
    { from: 99.6, to: 100.4, color: 'red', inner: true },
  ],
  redLine: V.vne,
};
export const R44_TACH_MARKS: RotorTachMarkings = {
  min: 40, max: 110, majorStep: 10, minorStep: 2,
  // Shared dual tach has rotor radials only. Short red bands sit OUTSIDE the engine green boundaries;
  // 0.8% is a visible stroke width, not an additional operating range (POH 2-7 offset-line convention).
  engineArcs: [{ from: 100.2, to: 101, color: 'red' }, { from: 101, to: 102, color: 'green' },
    { from: 102, to: 102.8, color: 'red' }],
  rotorArcs: [{ from: R44_ROTOR_LIMITS.powerOff[0], to: R44_ROTOR_LIMITS.powerOff[1], color: 'green' }],
  rotorRedLines: R44_ROTOR_LIMITS.powerOff,
};
const scale = (label: string, min: number, max: number, majors: number[], minorStep: number,
  read: ScaleDef['read'], more: Partial<ScaleDef> = {}): ScaleDef =>
  ({ label, min, max, majors, minorStep, read, numbers: true, ...more });

export const R44_MAP_SCALE = scale('', 10, 35, [10, 15, 20, 25, 30, 35], 1, r => r.engines[0].manifoldInHg, {
  // Both published ranges retained. SingleGauge currently paints these at the same radius, so yellow
  // obscures the overlapping green; an inner band requires supervisor-owned renderer support.
  arcs: [{ from: 15, to: 23.3, color: 'green' }, { from: 19.1, to: 26.1, color: 'yellow', inner: true }],
  redLines: [26.1],
});
export const R44_ENGINE_SCALES = {
  amps: scale('AMPS', -60, 60, [-60, 0, 60], 20, r => r.ammeterAmps),
  oilPressure: scale('OIL PSI', 0, 120, [0, 55, 95, 115], 10, r => r.oilPressurePsi, {
    arcs: [{ from: 25, to: 55, color: 'yellow' }, { from: 55, to: 95, color: 'green' },
      { from: 95, to: 115, color: 'yellow' }], redLines: [25, 115],
  }),
  aux: scale('AUX GAL', 0, V.auxUsableGal, [0, 8, V.auxUsableGal], 2, r => r.fuelGal[1]),
  oilTemp: scale('OIL °F', 50, 250, [75, 150, 245], 25, r => r.oilTempF, {
    arcs: [{ from: 75, to: 245, color: 'green' }], redLines: [245],
  }),
  main: scale('MAIN GAL', 0, V.mainUsableGal, [0, 15, V.mainUsableGal], 5, r => r.fuelGal[0]),
  cht: scale('CHT °F', 0, 550, [0, 200, 500], 50, r => r.engines[0].chtF, {
    arcs: [{ from: 200, to: 500, color: 'green' }], redLines: [500],
  }),
};
