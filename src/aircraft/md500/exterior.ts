// MD 500E: the detailed exterior class factory, injected in AircraftVisual (the S269 / R44 pattern, so no import
// cycle: importOrder.test.ts). SCAFFOLD STUB (owner: M2): returns the generic RotorcraftVisual unchanged. M2 builds
// the 5-blade articulated head, the E nose and the T-tail here, reading the articulated blade pose through
// `readRotorPose` (AircraftVisual passes ctx => ctx.state.rotorcraft?.articulated, as for the S269).
import type { SimContext } from '../../core/context';
import type { RotorcraftState } from '../../physics/rotorcraft/definition';
import type { RotorcraftVisual } from '../../render/aircraft/RotorcraftVisual';
import type { FuselageShape } from '../../render/aircraft/fuselageShape';
import type { sectionHalfWidth } from '../../render/aircraft/fuselage';

export type MD500RotorPoseReader = (ctx: SimContext) => RotorcraftState['articulated'];

export function md500ExteriorVisualClass(Base: typeof RotorcraftVisual, _Shape: typeof FuselageShape,
  _halfWidth: typeof sectionHalfWidth, _readRotorPose?: MD500RotorPoseReader): typeof RotorcraftVisual {
  return Base;
}
