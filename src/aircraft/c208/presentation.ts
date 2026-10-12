// Cessna 208 Caravan 675: what only the browser needs of the type (3D model data, instrument panel, UI text, sound,
// Flight School type data). CLOSURES in `panel`, `instrumentSystems` and `ui`; `visual` and `audio` are plain data.
//
// Like index.ts it only assembles the files of this directory. The flight model never imports it.

import type { AircraftPresentation } from '../types';
import { C208_AUDIO } from './audio';
import { C208_INSTRUMENT_SYSTEMS, C208_PANEL } from './panel';
import { C208 } from './training';
import { C208_UI } from './ui';
import { C208_VISUAL } from './visual';

export const C208_PRESENTATION: AircraftPresentation = {
  id: 'c208',
  visual: C208_VISUAL,
  panel: C208_PANEL,
  instrumentSystems: C208_INSTRUMENT_SYSTEMS,
  ui: C208_UI,
  audio: C208_AUDIO,
  training: C208,
};

export default C208_PRESENTATION;
