// FROZEN rig of the golden tests (see README.md): an AeroInput for a given flight condition. Copied from
// tests/aero/helpers.ts of the untouched tree; do not "improve" it, its defaults are part of the records.

import { C172 } from '../../../src/core/c172';
import { DEG, quat, type Vec3 } from '../../../src/core/math';
import type { SurfaceState } from '../../../src/core/types';
import { atmosphereAt } from '../../../src/physics/atmosphere';
import type { AeroInput, Slipstream } from '../../../src/physics/interfaces';

export interface Condition {
  /** True airspeed, m/s. */
  V: number;
  alphaDeg?: number;
  betaDeg?: number;
  /** Body rates, rad/s. */
  p?: number;
  q?: number;
  r?: number;
  surfaces?: Partial<SurfaceState>;
  heightAGL?: number;
  slipstream?: Slipstream | null;
  cgOffset?: Vec3;
  altitude?: number;
  dt?: number;
}

export function neutralSurfaces(): SurfaceState {
  return { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0, flaps: 0, elevatorTrim: 0, rudderTrim: 0 };
}

export function makeInput(c: Condition): AeroInput {
  const a = (c.alphaDeg ?? 0) * DEG;
  const b = (c.betaDeg ?? 0) * DEG;
  const alt = c.altitude ?? 1000;
  return {
    body: {
      time: 0,
      position: { x: 0, y: 0, z: -alt },
      orientation: quat.identity(),
      velocityBody: { x: c.V * Math.cos(a) * Math.cos(b), y: c.V * Math.sin(b), z: c.V * Math.sin(a) * Math.cos(b) },
      angularVelocity: { x: c.p ?? 0, y: c.q ?? 0, z: c.r ?? 0 },
      cgOffset: c.cgOffset ?? { x: 0, y: 0, z: 0 },
      mass: C172.mass.maxTakeoff,
    },
    atmosphere: atmosphereAt(alt),
    windNED: { x: 0, y: 0, z: 0 },
    surfaces: { ...neutralSurfaces(), ...c.surfaces },
    slipstream: c.slipstream ?? null,
    // Out of ground effect unless asked for.
    heightAGL: c.heightAGL ?? 1000,
    dt: c.dt ?? 0,
  };
}
