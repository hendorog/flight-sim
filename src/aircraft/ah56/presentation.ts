// Lockheed AH-56A Cheyenne: what only the browser needs of the type. Assembly only (final form at the scaffold;
// integrator-owned): visual AX; panel, ui, training PN; audio AU.
import type { AircraftPresentation } from '../types';
import { AH56_AUDIO } from './audio';
import { AH56_INSTRUMENT_SYSTEMS, AH56_PANEL } from './panel';
import { AH56_TRAINING } from './training';
import { AH56_UI } from './ui';
import { AH56_VISUAL } from './visual';

export const AH56_PRESENTATION: AircraftPresentation = {
  id: 'ah56', visual: AH56_VISUAL, panel: AH56_PANEL, instrumentSystems: AH56_INSTRUMENT_SYSTEMS,
  ui: AH56_UI, audio: AH56_AUDIO, training: AH56_TRAINING,
};

export default AH56_PRESENTATION;
