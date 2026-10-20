// Lockheed AH-56A Cheyenne: the rear-seat pilot panel and instrument systems. SCAFFOLD STUB (owner after the scaffold:
// PN): the MD 500E's under the AH-56A id until PN builds the reconstructed rear panel (vertical tapes, basic T, collective
// and prop-beta indicators, gyro configuration placard; plan revision 2, section 7.6) inside the frozen panelLayout.ts.
import type { InstrumentSystemsDef, PanelDef } from '../types';
import { MD500_INSTRUMENT_SYSTEMS, MD500_PANEL } from '../md500/panel';

export const AH56_PANEL: PanelDef = { ...MD500_PANEL, id: 'ah56' };
export const AH56_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = MD500_INSTRUMENT_SYSTEMS;
