// Round W S: what one sample of the streams' routing ground (streams.ts p.route) costs, so a full-domain 250 m raster of
// it (RASTER_N^2 samples) can be costed, and where a seeded world's build spends its time.
//   RC_SEED=42 npx vitest run --config scripts/probes/vitest.config.ts routeCost
import { it } from 'vitest';
import { hydrology, terrainHeight, naturalHeightSmooth } from '../../src/world/terrain/heightfield';
import { streamDebug, streamHeads } from '../../src/world/terrain/streams';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('route cost', () => {
  if (env.RC_LOWLAND) streamHeads.lowland = Number(env.RC_LOWLAND);
  if (env.RC_STEM) streamHeads.stem = env.RC_STEM === '1';
  for (const seed of (env.RC_SEED ?? '42').split(',').map(Number)) {
    const t0 = performance.now();
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const tb = performance.now() - t0;
    const rep = hydrology.streamReport as unknown as Record<string, unknown> & { samples: number; ms: number; tracePhases: number[]; phases?: number[]; form?: { ms: Record<string, number> }; km: number };
    console.log(`RC seed ${seed}: build ${(tb / 1000).toFixed(1)} s; streams ms ${rep.ms?.toFixed?.(0)} tracePhases ${rep.tracePhases.map((v) => v.toFixed(0)).join('/')} samples ${rep.samples}; phases ${(rep.phases ?? []).map((v) => v.toFixed(0)).join('/')}; form ${JSON.stringify(rep.form?.ms ?? {})} chains ${JSON.stringify(rep.chains)} rasterMs ${(rep.rasterMs as number)?.toFixed(0)} routingMs ${(rep.routingMs as number)?.toFixed(0)} snap ${rep.snapSamples}/${rep.snapped} ponds ${((rep.filledPonds as number[] | undefined)?.length ?? 0) / 10} pondWhy ${JSON.stringify(rep.pondWhy)} hollowWhy ${JSON.stringify(rep.hollowWhy)} fires ${JSON.stringify(rep.lowline)} at ${JSON.stringify(rep.hollowAt)} outlets ${rep.outlets} none ${rep.outletNone} ends ${JSON.stringify(rep.ends)}`);
    const route = streamDebug.route!;
    const n = 300;
    let s = 0;
    const t1 = performance.now();
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) s += route(-40000 + i * 250, -40000 + j * 250);
    const tr = (performance.now() - t1) / (n * n);
    const t2 = performance.now();
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) s += naturalHeightSmooth(-40000 + i * 250 + 20000, -40000 + j * 250);
    const ts = (performance.now() - t2) / (n * n);
    console.log(`RC seed ${seed}: route ${(tr * 1000).toFixed(2)} us/sample, naturalHeightSmooth ${(ts * 1000).toFixed(2)} us/sample; full 1281^2 raster ~ ${((tr * 1281 * 1281) / 1000).toFixed(1)} s (${s > 0})`);
  }
  setWorldSeed(0);
});
