// The fauna subsystem (Deep Time): herds and flyers of the era's roster, streamed around the camera, animated in
// the vertex shader and drawn as instanced meshes. WP0 fixes the seam the shell uses; WP5 implements it.
//
// SHELL CONTRACT (src/sim/Simulator.ts):
//   - createFaunaSystem(era()) after the terrain is initialised. null for a roster with no entries (the present
//     day): nothing is constructed and the present pays nothing.
//   - init(ctx) BEFORE cloudShadows.scan and warmUpShaders: it allocates every InstancedMesh and buffer at the
//     quality maximum and adds them to ctx.scene, so their materials get the cloud-shadow patch and are compiled
//     before the first frame. Afterwards only instance counts change (never a reallocation).
//   - update(dt, ctx) runs every frame after the airport (Simulator.run('fauna', ...)), with the frame's simulated
//     dt (0 while paused); it never throws (NaN guarded, counts clamped).
//   - Emits 'faunaSighted' {species, distanceM} on a species' first approach within 500 m and below 300 m AGL
//     in a session.

import type { SimContext, Subsystem } from '../../core/context';
import type { EraParams } from '../era/types';
import { ROSTERS } from './roster';
import type { FaunaStats } from './types';

export interface FaunaSystem extends Subsystem {
  init(ctx: SimContext): void | Promise<void>;
  update(dt: number, ctx: SimContext): void;
  dispose(): void;
  readonly stats: FaunaStats;
}

/** The fauna system of an era, or null when its roster is empty (the present day). */
export function createFaunaSystem(era: EraParams): FaunaSystem | null {
  const roster = ROSTERS[era.fauna];
  if (roster.entries.length === 0) return null;
  // STUB (WP0): WP5 constructs the real system here.
  return null;
}
