import { C152_VISUAL } from '../c152/visual';
import type { AirframeVisualDef } from '../../render/aircraft/airframe/types';
import { R22_ROTORCRAFT } from './rotorcraft';
/** Fixed-wing fields carry the legacy panel/camera contract; RotorcraftVisual builds the actual mesh. */
export const R22_VISUAL: AirframeVisualDef = {
  ...C152_VISUAL, id: 'r22', rotorcraft: R22_ROTORCRAFT,
  cockpit: { ...C152_VISUAL.cockpit, pilotEye: [0.7, 0.28, -0.35], defaultPitchDeg: -12 },
};
export default R22_VISUAL;
