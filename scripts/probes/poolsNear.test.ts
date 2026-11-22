// Probe (A1b): the lake pools within PN_R m of a point (PN_AT='seed@north,east'), with their level, drained flag and
// whether the lake mask smooths the ground there.
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('pools near', () => {
  const [sd, p] = (env.PN_AT ?? '42@-25280,71168').split('@');
  const [n, e] = p.split(',').map(Number);
  setWorldSeed(Number(sd));
  const mask = hydrology.lakeMask as unknown as { pools: Array<{ lake: number; level: number; wet: number; north: number; east: number; drained?: boolean }>; smooth(n: number, e: number): number; leaky: number[]; d: { lakes: Array<{ tarn?: boolean; level: number; spill: number }> } };
  mask.pools.forEach((q, id) => { const d = Math.hypot(q.north - n, q.east - e); if (d < Number(env.PN_R ?? 3000)) console.log(`POOL ${id} lake ${q.lake} tarn ${!!mask.d.lakes[q.lake].tarn} leaky ${mask.leaky.includes(q.lake)} drained ${!!q.drained} level ${q.level.toFixed(1)} wet ${q.wet} at ${q.north.toFixed(0)},${q.east.toFixed(0)} dist ${d.toFixed(0)}`); });
  console.log(`SMOOTH at point ${mask.smooth(n, e).toFixed(2)}`);
  setWorldSeed(0);
});
