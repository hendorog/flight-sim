// Pilatus PC-12/47: the airframe visual (plain data; the livery worker loads this file). SCAFFOLD STUB (owner: P2):
// the Cessna 208's airframe under the PC-12 id until P2 builds the PC-12 from geometry.ts and panelLayout.ts.
import C208_VISUAL from '../c208/visual';
import type { AirframeVisualDef } from '../types';

export const PC12_VISUAL: AirframeVisualDef = { ...C208_VISUAL, id: 'pc12' };

export default PC12_VISUAL;
