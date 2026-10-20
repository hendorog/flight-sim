// Lockheed AH-56A Cheyenne: the detailed exterior class factory, injected in AircraftVisual (no import cycle:
// importOrder.test.ts). SCAFFOLD STUB (owner after the scaffold: AX): returns the generic RotorcraftVisual unchanged. AX
// reads the WHOLE rotorcraft state through `readRotorcraft` (blade pose, `controlGyro` tilt and mode for the ICS gyro X,
// `pusher.beta`), and the swashplate from swashplateCyclic() (src/physics/rotorcraft/swashplate.ts).
import type { SimContext } from '../../core/context';
import type { RotorcraftState } from '../../physics/rotorcraft/definition';
import type { RotorcraftVisual } from '../../render/aircraft/RotorcraftVisual';
import type { FuselageShape } from '../../render/aircraft/fuselageShape';
import type { sectionHalfWidth } from '../../render/aircraft/fuselage';

export type Ah56RotorcraftReader = (ctx: SimContext) => RotorcraftState | undefined;

export function ah56ExteriorVisualClass(Base: typeof RotorcraftVisual, _Shape: typeof FuselageShape,
  _halfWidth: typeof sectionHalfWidth, _readRotorcraft?: Ah56RotorcraftReader): typeof RotorcraftVisual {
  return Base;
}
