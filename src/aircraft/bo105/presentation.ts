// MBB Bo 105 CB-4: what only the browser needs of the type. Assembly only (final form at the scaffold; integrator-owned):
// each member comes from its own file with one owner (visual BX; panel, ui, training PN; audio AU).
import type { AircraftPresentation } from '../types';
import { BO105_AUDIO } from './audio';
import { BO105_INSTRUMENT_SYSTEMS, BO105_PANEL } from './panel';
import { BO105_TRAINING } from './training';
import { BO105_UI } from './ui';
import { BO105_VISUAL } from './visual';

export const BO105_PRESENTATION: AircraftPresentation = {
  id: 'bo105', visual: BO105_VISUAL, panel: BO105_PANEL, instrumentSystems: BO105_INSTRUMENT_SYSTEMS,
  ui: BO105_UI, audio: BO105_AUDIO, training: BO105_TRAINING,
};

export default BO105_PRESENTATION;
