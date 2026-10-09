// Assembly only: frozen boundary between exterior/audio and panel/UI owners during parallel work.
import type { AircraftPresentation } from '../types';
import { R44_VISUAL } from './visual';
import { R44_PANEL, R44_INSTRUMENT_SYSTEMS } from './panel';
import { R44_UI } from './ui';
import { R44_AUDIO } from './audio';
import { R44_TRAINING } from './training';
export const R44_PRESENTATION: AircraftPresentation = {
  id: 'r44', visual: R44_VISUAL, panel: R44_PANEL, instrumentSystems: R44_INSTRUMENT_SYSTEMS,
  ui: R44_UI, audio: R44_AUDIO, training: R44_TRAINING,
};
export default R44_PRESENTATION;
