// Pilatus PC-12/47: what only the browser needs of the type. Assembly only (final form at the scaffold): each member
// comes from its own file, and each file has one owner (visual P2; panel, ui, training P3; audio A1).

import type { AircraftPresentation } from '../types';
import { PC12_AUDIO } from './audio';
import { PC12_INSTRUMENT_SYSTEMS, PC12_PANEL } from './panel';
import { PC12 } from './training';
import { PC12_UI } from './ui';
import { PC12_VISUAL } from './visual';

export const PC12_PRESENTATION: AircraftPresentation = {
  id: 'pc12',
  visual: PC12_VISUAL,
  panel: PC12_PANEL,
  instrumentSystems: PC12_INSTRUMENT_SYSTEMS,
  ui: PC12_UI,
  audio: PC12_AUDIO,
  training: PC12,
};

export default PC12_PRESENTATION;
