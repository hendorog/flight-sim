import { DEG } from '../../core/math';
import type { RotorcraftDefinition } from '../../physics/rotorcraft/definition';

/** R22 Beta II baseline. Published dimensions/speeds plus explicitly estimated dynamic parameters;
 * see docs/r22-flight-model.md before interpreting these as validated handling data. */
export const R22_ROTORCRAFT: RotorcraftDefinition = {
  nominalRpm: 530, rotation: 1, engineRatio: 2652 / 530, tailRatio: 47 / 11 * 1.5,
  transmissionEfficiency: 0.94, cyclicLimit: 10 * DEG, flapTime: 0.12,
  main: { radius: 3.8354, rootCutout: 0.75, chord: 0.18923, blades: 2,
    minPitch: 0 * DEG, maxPitch: 15 * DEG, twist: -8 * DEG,
    liftSlope: 5.7, maxCl: 1.25, profileCd: 0.011, inducedDrag: 0.012,
    inertia: 105, hub: { x: 0, y: 0, z: -1.25 } },
  tail: { radius: 0.5334, rootCutout: 0.1, chord: 0.1016, blades: 2,
    minPitch: -8 * DEG, maxPitch: 24 * DEG, twist: 0,
    liftSlope: 5.7, maxCl: 1.2, profileCd: 0.012, inducedDrag: 0.012,
    inertia: 0.22, hub: { x: -3.85, y: 0.16, z: -0.35 } },
  dragArea: { x: 0.65, y: 1.8, z: 2.2 }, dragCentre: { x: -0.35, y: 0, z: 0 },
  skids: { halfTrack: 0.965, front: 0.85, rear: -1.1, z: 0.9,
    stiffness: 65000, damping: 2200, friction: 0.65, maxSink: 3.5 },
};
