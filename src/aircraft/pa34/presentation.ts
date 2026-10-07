// Piper PA-34-200 Seneca I: what only the browser needs of the type (3D model data, instrument panel, UI text,
// sound, Flight School type data). CLOSURES in `panel`, `instrumentSystems` and `ui`; `visual` and `audio` are
// plain data.
//
// Like index.ts it only assembles the files of this directory. The flight model never imports it.

import type { AircraftPresentation } from '../types';
import { PA34_AUDIO } from './audio';
import { PA34_INSTRUMENT_SYSTEMS, PA34_PANEL } from './panel';
import { PA34 } from './training';
import { PA34_UI } from './ui';
import { PA34_VISUAL } from './visual';

export const PA34_PRESENTATION: AircraftPresentation = {
  id: 'pa34',
  visual: PA34_VISUAL,
  panel: PA34_PANEL,
  instrumentSystems: PA34_INSTRUMENT_SYSTEMS,
  ui: PA34_UI,
  audio: PA34_AUDIO,
  training: PA34,
};

export default PA34_PRESENTATION;
