// Probe: a seeded world's lakes and tarns (drainage.ts TARN_SPILL: one-cell hollows of the high country), the lakes
// with and without an outlet, and how the streams end (streams.ts report).
//   STREAM_SEEDS=1,42,777777
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('tarn count', () => {
  for (const seed of (env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    const t0 = performance.now();
    setWorldSeed(seed);
    const ms = performance.now() - t0;
    const mask = hydrology.lakeMask as unknown as { d: { lakes: Array<{ tarn?: boolean; river: boolean; level: number }> }; main: Int32Array; pools: Array<{ lake: number; level: number; bottom: number; wet: number; drained?: boolean }> };
    const d = mask.d;
    const rep0 = hydrology.streamReport as unknown as Record<string, unknown>;
    if (!d) {
      // (An older tree: the lake mask wraps the streams' tarns, streams.ts TarnMask.)
      const r = rep0 as Record<string, number & Record<string, number>>;
      (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write(`seed ${seed} (build ${ms.toFixed(0)} ms): lakes ${hydrology.lakes.length}, pools ${(hydrology.lakeMask as unknown as { pools: unknown[] }).pools.length}; stream tarns ${r.tarns} (wet ${r.tarnsWet}, drained ${r.tarnsDrained})\n` +
        `  outlets: pools ${r.pools}, river through ${r.riverPools}, outlet streams ${r.outlets} (to lake ${r.outletToLake}, sea ${r.outletToSea}), none ${r.outletNone} (rim higher than the sill allows ${r.outletHigh}); outlet ends ${JSON.stringify(r.outletEnds)}\n` +
        `  streams ${r.traced} ends ${JSON.stringify(r.ends)}; hollows ${r.hollows}; forced ${r.forced}; km ${Number(r.km).toFixed(0)}\n`);
      continue;
    }
    const tarnPools = mask.pools.filter((p) => !p.drained && d.lakes[p.lake].tarn);
    const tarnLakes = d.lakes.filter((l, k) => l.tarn && mask.main[k] >= 0).length;
    const rep = hydrology.streamReport!;
    const wet = tarnPools.map((p) => p.wet * 0.0625).sort((a, b) => a - b);
    const depth = tarnPools.map((p) => p.level - p.bottom).sort((a, b) => a - b);
    const lv = tarnPools.map((p) => p.level).sort((a, b) => a - b);
    const q = (a: number[], f: number): string => (a.length ? a[Math.min(a.length - 1, Math.floor(f * a.length))].toFixed(2) : '-');
    const leaky = (mask as unknown as { leaky?: number[] }).leaky ?? [];
    const line = `seed ${seed} (build ${ms.toFixed(0)} ms): lakes ${hydrology.lakes.length} (left dry for a leak: ${leaky.length}, ${leaky.filter((k) => d.lakes[k].tarn).length} tarns, ${leaky.filter((k) => d.lakes[k].river).length} on a river), pools ${mask.pools.filter((p) => !p.drained).length}; tarns ${tarnLakes} (${tarnPools.length} pools: km² p10 ${q(wet, 0.1)} p50 ${q(wet, 0.5)} p90 ${q(wet, 0.9)}; depth m p10 ${q(depth, 0.1)} p50 ${q(depth, 0.5)}; level m p10 ${q(lv, 0.1)} p50 ${q(lv, 0.5)})\n` +
      `  outlets: pools ${rep.pools}, river through ${rep.riverPools}, outlet streams ${rep.outlets} (to lake ${rep.outletToLake}, sea ${rep.outletToSea}), none ${rep.outletNone} (rim higher than the sill allows ${rep.outletHigh}); outlet ends ${JSON.stringify(rep.outletEnds)}\n` +
      `  streams ${rep.traced} ends ${JSON.stringify(rep.ends)}; hollows ${rep.hollows}; km ${rep.km.toFixed(0)}`;
    (globalThis as unknown as { process: { stderr: { write(s: string): void } } }).process.stderr.write(line + '\n');
  }
  setWorldSeed(0);
});
