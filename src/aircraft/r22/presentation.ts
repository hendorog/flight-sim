import type { AircraftPresentation } from '../types';
import { C152_PRESENTATION } from '../c152/presentation';
import { HP } from '../../core/math';
import { R22_ROTORCRAFT } from './rotorcraft';
import { R22_VISUAL } from './visual';
import { R22_PANEL, R22_INSTRUMENT_SYSTEMS } from './panel';
import { R22_UI } from './ui';
import { R22_TRAINING } from './training';
export { R22_UI } from './ui';

export const R22_PRESENTATION: AircraftPresentation = {
  ...C152_PRESENTATION, id: 'r22', visual: R22_VISUAL, ui: R22_UI,
  instrumentSystems: R22_INSTRUMENT_SYSTEMS,
  audio: { ...C152_PRESENTATION.audio, flapMotor: false, busPoweredV: 10,
    stallWarner: { kind: 'electric', baseHz: 800, sweepHz: 0, needsBus: true },
    engines: [{ engine: { ...C152_PRESENTATION.audio.engines[0].engine, ratedPowerW: 131 * HP,
      gearRatio: R22_ROTORCRAFT.engineRatio },
      prop: { blades: 2, diameterM: R22_ROTORCRAFT.main.radius * 2, cruiseThrustN: 6000, level: 1 } }] },
  panel: R22_PANEL,
  training: R22_TRAINING,
};
export default R22_PRESENTATION;
