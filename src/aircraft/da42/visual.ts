// Diamond DA42 NG: PLACEHOLDER until the type's own airframe lands. The Cessna 172S airframe under this id. Plain
// data; the livery worker loads this file, so it imports nothing but the C172S visual.
import C172S_VISUAL from '../c172s/visual';
import type { AirframeVisualDef } from '../types';

const visual: AirframeVisualDef = { ...C172S_VISUAL, id: 'da42' };

export default visual;
