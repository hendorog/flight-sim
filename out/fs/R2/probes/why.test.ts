// Round T repairs 2: the stream report's notes for lines WY_LINES (seed WY_SEED): endWhy, filled, ponds' outlets, pondClosed
// and pondInflowDetail rows naming the line or WY_POOLS.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('why', () => {
  setWorldSeed(Number(env.WY_SEED ?? 7));
  terrainHeight(0, 0);
  const rep = hydrology.streamReport as unknown as Record<string, unknown> & { endWhy?: Record<number, string>; filled?: number[]; pondClosed?: string[]; pondInflowDetail?: string[]; ponds?: number[] };
  const lines = (env.WY_LINES ?? '567').split(',').map(Number);
  const pools = (env.WY_POOLS ?? '26').split(',');
  const mask = hydrology.lakeMask! as unknown as { pools: Array<{ level: number; lake: number; drained?: boolean }> };
  for (const li of lines) console.log(`line ${li}: endWhy ${rep.endWhy?.[li] ?? '-'}; filled ${rep.filled?.includes(li)}`);
  for (const p of pools) { const q = mask.pools[Number(p)]; console.log(`pool ${p}: level ${q?.level} lake ${q?.lake} drained ${q?.drained}`); }
  for (const r of rep.pondClosed ?? []) if (lines.some((l) => r.includes(`line ${l})`)) || pools.some((p) => r.includes(`pool ${p} `))) console.log(`closed: ${r}`);
  for (const r of rep.pondInflowDetail ?? []) if (lines.some((l) => r.includes(`${l}`)) || pools.some((p) => r.includes(`pool ${p} `))) console.log(`inflow: ${r}`);
  const ponds = rep.ponds ?? [];
  for (let i = 0; i < ponds.length; i += 2) if (pools.includes(String(ponds[i]))) console.log(`pond ${ponds[i]}: ${ponds[i + 1]} raster points`);
  const L = hydrology.rivers!;
  L.forEach((r, li) => { const x = r as unknown as { pool?: number; joins: number; end?: string }; if (pools.includes(String(x.pool))) console.log(`outlet of pool ${x.pool}: line ${li} joins ${x.joins} end ${x.end}`); });
  setWorldSeed(0);
});
