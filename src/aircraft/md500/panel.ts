// MD 500E: instrument panel and instrument systems. SCAFFOLD STUB (owner: M3): the Schweizer 300CB's under the MD 500E
// id until M3 builds the RFM Fig 4-2 panel (plan 6.4) on panelLayout.ts.
import type { InstrumentSystemsDef, PanelDef } from '../types';
import { S269_INSTRUMENT_SYSTEMS, S269_PANEL } from '../s269/panel';

export const MD500_PANEL: PanelDef = { ...S269_PANEL, id: 'md500' };
export const MD500_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = S269_INSTRUMENT_SYSTEMS;
