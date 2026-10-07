// Diamond DA20-C1: what only the browser needs of the type (3D model data, instrument panel, UI text, sound,
// Flight School type data). CLOSURES in `panel`, `instrumentSystems` and `ui`; `visual` and `audio` are plain data.
//
// Like index.ts it only assembles the files of this directory. The flight model never imports it.

import type { AircraftPresentation } from '../types';
import { DA20_AUDIO } from './audio';
import { DA20_INSTRUMENT_SYSTEMS, DA20_PANEL } from './panel';
import { DA20 } from './training';
import { DA20_UI } from './ui';
import { DA20_VISUAL } from './visual';

export const DA20_PRESENTATION: AircraftPresentation = {
  id: 'da20',
  visual: DA20_VISUAL,
  panel: DA20_PANEL,
  instrumentSystems: DA20_INSTRUMENT_SYSTEMS,
  ui: DA20_UI,
  audio: DA20_AUDIO,
  training: DA20,
};

export default DA20_PRESENTATION;
