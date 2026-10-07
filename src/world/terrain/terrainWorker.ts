// Tile worker: builds terrain node meshes and tree cells off the main thread. Results are returned with
// their typed-array buffers transferred (no copies).

import { buildTile, type TileData, type TileRequest } from './tileBuilder';
import { setTownSite, type TownSite } from './townMask';
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

/** Shared settings sent to every worker before any job (see WorkerPool.broadcast). */
export type WorkerSetup = { kind: 'setup'; town: TownSite | null };

self.onmessage = (e: MessageEvent<{ id: number; job: WorkerJob } | WorkerSetup>) => {
  if ('kind' in e.data) {
    setTownSite(e.data.town);
    return;
  }
  const { id, job } = e.data;
  const result = job.kind === 'tile' ? buildTile(job.req) : buildTreeCell(job.req);
  (self as unknown as Worker).postMessage({ id, result }, transferables(result));
};
