// Tile worker: builds terrain node meshes and tree cells off the main thread. Results are returned with
// their typed-array buffers transferred (no copies).

import { buildTile, type TileData, type TileRequest } from './tileBuilder';
import { setTownSite, type TownSite } from './townMask';
import { setEra } from '../era/eraState';
import type { EraId } from '../era/types';
import { buildTreeCell, type TreeCellData, type TreeCellRequest } from './vegetation/placement';

export type WorkerJob = { kind: 'tile'; req: TileRequest } | { kind: 'trees'; req: TreeCellRequest };
export type WorkerResult = TileData | TreeCellData;

function transferables(r: WorkerResult): Transferable[] {
  if ('positions' in r) {
    const t: Transferable[] = [r.positions.buffer, r.normals.buffer, r.morph.buffer, r.biome.buffer, r.shape.buffer, r.river.buffer];
    if (r.water) t.push(r.water.positions.buffer, r.water.depth.buffer, r.water.index.buffer);
    return t;
  }
  return [r.instances.buffer, r.order.buffer, r.bucketStart.buffer];
}

/**
 * Shared settings sent to every worker before any job (see WorkerPool.broadcast): the valley town site and the
 * era (src/world/era; tile building and tree placement read eraState.era() in the worker).
 */
export type WorkerSetup = { kind: 'setup'; town: TownSite | null; era: EraId };

self.onmessage = (e: MessageEvent<{ id: number; job: WorkerJob } | WorkerSetup>) => {
  if ('kind' in e.data) {
    // The era first: everything after it (the town mask included) may depend on it.
    setEra(e.data.era);
    setTownSite(e.data.town);
    return;
  }
  const { id, job } = e.data;
  const result = job.kind === 'tile' ? buildTile(job.req) : buildTreeCell(job.req);
  (self as unknown as Worker).postMessage({ id, result }, transferables(result));
};
