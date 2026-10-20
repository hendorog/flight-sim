// MBB Bo 105 CB-4: the detailed exterior class factory, injected in AircraftVisual (the S269 / MD 500E pattern, so no
// import cycle: importOrder.test.ts). SCAFFOLD STUB (owner after the scaffold: BX): returns the generic RotorcraftVisual
// unchanged. BX builds the Bo 105 here, reading the WHOLE rotorcraft state through `readRotorcraft` (AircraftVisual
// passes ctx => ctx.state.rotorcraft): the hingeless blade pose from `articulated.blades[i].flap` (bent over the root,
// no hinge) and the swashplate from swashplateCyclic() (src/physics/rotorcraft/swashplate.ts), never the controls.
import type { SimContext } from '../../core/context';
import type { RotorcraftState } from '../../physics/rotorcraft/definition';
import type { RotorcraftVisual } from '../../render/aircraft/RotorcraftVisual';
import type { FuselageShape } from '../../render/aircraft/fuselageShape';
import type { sectionHalfWidth } from '../../render/aircraft/fuselage';

export type Bo105RotorcraftReader = (ctx: SimContext) => RotorcraftState | undefined;

export function bo105ExteriorVisualClass(Base: typeof RotorcraftVisual, _Shape: typeof FuselageShape,
  _halfWidth: typeof sectionHalfWidth, _readRotorcraft?: Bo105RotorcraftReader): typeof RotorcraftVisual {
  return Base;
}
