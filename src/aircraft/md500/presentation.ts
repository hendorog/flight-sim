// MD 500E: what only the browser needs of the type. Assembly only (final form at the scaffold): each member comes
// from its own file with one owner (visual M2; panel, ui, training M3; audio A1).
import type { AircraftPresentation } from '../types';
import { MD500_AUDIO } from './audio';
import { MD500_INSTRUMENT_SYSTEMS, MD500_PANEL } from './panel';
import { MD500_TRAINING } from './training';
import { MD500_UI } from './ui';
import { MD500_VISUAL } from './visual';

export const MD500_PRESENTATION: AircraftPresentation = {
  id: 'md500', visual: MD500_VISUAL, panel: MD500_PANEL, instrumentSystems: MD500_INSTRUMENT_SYSTEMS,
  ui: MD500_UI, audio: MD500_AUDIO, training: MD500_TRAINING,
};

export default MD500_PRESENTATION;
