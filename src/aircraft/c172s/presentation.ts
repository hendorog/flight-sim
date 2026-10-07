// Cessna 172S: what only the browser needs of the type (3D model data, instrument panel, UI text, sound, Flight
// School type data). CLOSURES in `panel`, `instrumentSystems` and `ui`; `visual` and `audio` are plain data.
//
// Like index.ts it only assembles the files of this directory. The flight model never imports it.

import type { AircraftPresentation } from '../types';
import { C172S_AUDIO } from './audio';
import { C172S_INSTRUMENT_SYSTEMS, C172S_PANEL } from './panel';
import { C172S } from './training';
import { C172S_UI } from './ui';
import { C172S_VISUAL } from './visual';

export const C172S_PRESENTATION: AircraftPresentation = {
  id: 'c172s',
  visual: C172S_VISUAL,
  panel: C172S_PANEL,
  instrumentSystems: C172S_INSTRUMENT_SYSTEMS,
  ui: C172S_UI,
  audio: C172S_AUDIO,
  training: C172S,
};

export default C172S_PRESENTATION;
