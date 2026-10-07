// Piper PA-38-112 Tomahawk II: what only the browser needs of the type (3D model data, instrument panel, UI text,
// sound, Flight School type data). CLOSURES in `panel`, `instrumentSystems` and `ui`; `visual` and `audio` are
// plain data.
//
// Like index.ts it only assembles the files of this directory. The flight model never imports it.

import type { AircraftPresentation } from '../types';
import { PA38_AUDIO } from './audio';
import { PA38_INSTRUMENT_SYSTEMS, PA38_PANEL } from './panel';
import { PA38 } from './training';
import { PA38_UI } from './ui';
import { PA38_VISUAL } from './visual';

export const PA38_PRESENTATION: AircraftPresentation = {
  id: 'pa38',
  visual: PA38_VISUAL,
  panel: PA38_PANEL,
  instrumentSystems: PA38_INSTRUMENT_SYSTEMS,
  ui: PA38_UI,
  audio: PA38_AUDIO,
  training: PA38,
};

export default PA38_PRESENTATION;
