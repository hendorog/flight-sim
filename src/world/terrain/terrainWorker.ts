// Tile worker: builds terrain node meshes and tree cells off the main thread. Results are returned with
// their typed-array buffers transferred (no copies).

import { setWorldSeed } from '../worldSeed';
import { modelMs, provideSeededModel, setSnowShift, type SeededModel } from './heightfield';
import { buildTile, type TileData, type TileRequest } from './tileBuilder';
import { setTownSite, type TownSite } from './townMask';
import { setEra } from '../era/eraState';
import type { EraId } from '../era/types';
import { buildTreeCell, type TreeCellData, type TreeCellRequest } from './vegetation/placement';
import { buildBoulderCell, type BoulderCellData, type BoulderCellRequest } from './vegetation/boulders';
import { buildRillPatch, type RillPatchData, type RillPatchRequest } from './rills';

export type WorkerJob = { kind: 'tile'; req: TileRequest } | { kind: 'trees'; req: TreeCellRequest } | { kind: 'boulders'; req: BoulderCellRequest } | { kind: 'rills'; req: RillPatchRequest };
export type WorkerResult = TileData | TreeCellData | BoulderCellData | RillPatchData;

function transferables(r: WorkerResult): Transferable[] {
  if ('positions' in r) {
    const t: Transferable[] = [r.positions.buffer, r.normals.buffer, r.morph.buffer, r.biome.buffer, r.shape.buffer, r.river.buffer];
    if (r.flow) t.push(r.flow.buffer);
    if (r.water) t.push(r.water.positions.buffer, r.water.depth.buffer, r.water.index.buffer);
    return t;
  }
  if ('boulders' in r) return [r.boulders.buffer];
  if ('texels' in r) return r.texels ? [r.texels.buffer] : [];
  return [r.instances.buffer, r.order.buffer, r.bucketStart.buffer, r.walls.buffer];
}

/**
 * Shared settings sent to every worker before any job (see WorkerPool.broadcast): the valley town site and the
 * era (src/world/era; tile building and tree placement read eraState.era() in the worker), and a seeded world's
 * macro model cells (heightfield.ts seededModel).
 */
export type WorkerSetup = { kind: 'setup'; town: TownSite | null; era: EraId; seed: number; snowShift?: number; model?: SeededModel | null };

self.onmessage = (e: MessageEvent<{ id: number; job: WorkerJob } | WorkerSetup>) => {
  if ('kind' in e.data) {
    // The era first: everything after it (the town mask included) may depend on it.
    setEra(e.data.era);
    setSnowShift(e.data.snowShift ?? 0);
    // A seeded world's macro model cells as the main thread built them (heightfield.ts provideSeededModel): this
    // worker's build takes them instead of working the model out again.
    provideSeededModel(e.data.model ?? null);
    // The world seed before the town mask (rebuilds the noise tables and the rivers when it changes).
    setWorldSeed(e.data.seed);
    if (e.data.seed !== 0 && modelMs > 0) console.warn(`[terrain] a terrain worker worked the macro model out itself (${Math.round(modelMs)} ms): none was handed over`);
    setTownSite(e.data.town);
    return;
  }
  const { id, job } = e.data;
  const result = job.kind === 'tile' ? buildTile(job.req) : job.kind === 'boulders' ? buildBoulderCell(job.req) : job.kind === 'rills' ? buildRillPatch(job.req) : buildTreeCell(job.req);
  (self as unknown as Worker).postMessage({ id, result }, transferables(result));
};
