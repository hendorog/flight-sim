// Pilatus PC-12/47 (PT6A-67B): the aircraft definition. SCAFFOLD STUB (owner after the scaffold: P1).
//
// Until P1 lands the type's own flight model this is the Cessna 208's definition under the PC-12's identity, so
// that every loader, the consistency check and the scenario spawns run on a coherent turboprop from day one. It is
// NOT a placeholder (`placeholder` stays unset): the catalogue row's `available: false` is the only gate. The
// PC-12 facts (geometry.ts, facts.ts, reference.ts) are written already and are wired in here by P1.

import C208_DEFINITION from '../c208/index';
import type { AircraftDefinition } from '../types';

export const PC12_DEFINITION: AircraftDefinition = {
  ...C208_DEFINITION,
  id: 'pc12',
  name: 'Pilatus PC-12/47',
  shortName: 'PC-12',
  variant: 'PC-12/47 (P&WC PT6A-67B 1200 shp, 4740 kg)',
  icaoType: 'PC12',
  notModelled: [
    'IN DEVELOPMENT: this build flies the Cessna 208 flight model under the PC-12 name; the PC-12 flight model, beta and reverse, stick pusher and stabiliser trim are being built.',
  ],
};

export default PC12_DEFINITION;
