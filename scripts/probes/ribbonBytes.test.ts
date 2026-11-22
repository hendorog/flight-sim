// Probe (Round V A4'+B join): the main thread's river-network ribbons (water.ts createRiverNetworkGeometries) for a seed
// (RB_SEED): geometries, vertices and the bytes of their attributes and indices, plus the small ribbons' chunks.
import { it } from 'vitest';
import { terrainHeight } from '../../src/world/terrain/heightfield';
import { createRiverNetworkGeometries } from '../../src/world/terrain/water';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('ribbon bytes', () => {
  const seed = Number(env.RB_SEED ?? 1);
  setWorldSeed(seed);
  terrainHeight(0, 0);
  const small: unknown[] = [];
  const t0 = performance.now();
  const gs = createRiverNetworkGeometries(small as never);
  const ms = performance.now() - t0;
  let bytes = 0, verts = 0;
  const bytesOf = (o: unknown, seen = new Set<unknown>(), d = 0): number => {
    if (!o || typeof o !== 'object' || seen.has(o) || d > 5) return 0;
    seen.add(o);
    if (ArrayBuffer.isView(o)) return (o as ArrayBufferView).byteLength;
    let b = 0;
    for (const v of Object.values(o as Record<string, unknown>)) b += bytesOf(v, seen, d + 1);
    return b;
  };
  for (const g of gs) {
    for (const a of Object.values(g.attributes)) bytes += (a as { array: ArrayBufferView }).array.byteLength;
    if (g.index) bytes += g.index.array.byteLength;
    verts += g.attributes.position?.count ?? 0;
  }
  console.log(`RB seed ${seed}: ${gs.length} geometries, ${verts} vertices, ${(bytes / 1e6).toFixed(0)} MB; small ribbon chunks ${small.length}, ${(bytesOf(small) / 1e6).toFixed(0)} MB; ${ms.toFixed(0)} ms`);
});
