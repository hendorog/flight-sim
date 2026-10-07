// Cessna 152: what only the browser needs of the type (3D model data, instrument panel, UI text, sound, Flight
// School type data). CLOSURES in `panel`, `instrumentSystems` and `ui`; `visual` and `audio` are plain data.
//
// Like index.ts it only assembles the files of this directory. The flight model never imports it.

import type { AircraftPresentation } from '../types';
import { C152_AUDIO } from './audio';
import { C152_INSTRUMENT_SYSTEMS, C152_PANEL } from './panel';
import { C152 } from './training';
import { C152_UI } from './ui';
import { C152_VISUAL } from './visual';

export const C152_PRESENTATION: AircraftPresentation = {
  id: 'c152',
  visual: C152_VISUAL,
  panel: C152_PANEL,
  instrumentSystems: C152_INSTRUMENT_SYSTEMS,
  ui: C152_UI,
  audio: C152_AUDIO,
  training: C152,
};

export default C152_PRESENTATION;
