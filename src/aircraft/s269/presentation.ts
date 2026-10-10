// Assembly only: shared handoff between the three aircraft workers.
import type { AircraftPresentation } from '../types';
import { S269_VISUAL } from './visual';
import { S269_PANEL, S269_INSTRUMENT_SYSTEMS } from './panel';
import { S269_UI } from './ui';
import { S269_AUDIO } from './audio';
import { S269_TRAINING } from './training';
export const S269_PRESENTATION: AircraftPresentation = {
  id: 's269', visual: S269_VISUAL, panel: S269_PANEL, instrumentSystems: S269_INSTRUMENT_SYSTEMS,
  ui: S269_UI, audio: S269_AUDIO, training: S269_TRAINING,
};
export default S269_PRESENTATION;
