// MBB Bo 105 CB-4: instrument panel and instrument systems. SCAFFOLD STUB (owner after the scaffold: PN): the MD 500E's
// under the Bo 105 id until PN builds the FM Fig 7-3 pedestal (plan revision 2, section 6.4) inside the face of the
// frozen panelLayout.ts (mast-moment indicator, dual torque %, triple tach, TOT/N1 per engine, caution segments).
import type { InstrumentSystemsDef, PanelDef } from '../types';
import { MD500_INSTRUMENT_SYSTEMS, MD500_PANEL } from '../md500/panel';

export const BO105_PANEL: PanelDef = { ...MD500_PANEL, id: 'bo105' };
export const BO105_INSTRUMENT_SYSTEMS: InstrumentSystemsDef = MD500_INSTRUMENT_SYSTEMS;
