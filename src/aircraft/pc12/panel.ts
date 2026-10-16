// Pilatus PC-12/47: instrument panel and instrument systems. SCAFFOLD STUB (owner: P3): the Cessna 208's panel under
// the PC-12 id until P3 builds the analogue PC-12 panel (plan 5.4) on panelLayout.ts.
import { C208_INSTRUMENT_SYSTEMS, C208_PANEL } from '../c208/panel';
import type { InstrumentSystemsDef, PanelDef } from '../types';

export const PC12_PANEL: PanelDef = { ...C208_PANEL, id: 'pc12' };
export const PC12_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = C208_INSTRUMENT_SYSTEMS;
