// Richard Pearse 1903 Waitohi Monoplane: browser presentation assembly.

import type { AircraftPresentation } from '../types';
import { PEARSE_AUDIO } from './audio';
import { PEARSE_INSTRUMENT_SYSTEMS, PEARSE_PANEL } from './panel';
import { PEARSE } from './training';
import { PEARSE_UI } from './ui';
import { PEARSE_VISUAL } from './visual';

export const PEARSE_PRESENTATION: AircraftPresentation = {
  id: 'pearse',
  visual: PEARSE_VISUAL,
  panel: PEARSE_PANEL,
  instrumentSystems: PEARSE_INSTRUMENT_SYSTEMS,
  ui: PEARSE_UI,
  audio: PEARSE_AUDIO,
  training: PEARSE,
};

export default PEARSE_PRESENTATION;
