// Probe (design-V one-network): the stream tracer's own counts and km by class, per seed.
//   ON_SEEDS=42 npx vitest run --config scripts/probes/vitest.config.ts onStreams --silent=false --disable-console-intercept
// (Round V step 0: ported unchanged from design-V/one-network/prototype.patch).
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Line = { s: Float64Array; area?: Float64Array; kind?: number };
it('stream classes', () => {
  for (const seed of (env.ON_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = (hydrology.rivers ?? []) as unknown as Line[];
    const rep = hydrology.streamReport as unknown as Record<string, unknown> & { chains?: { traced: number; km: number; heads: number; skipped: number } };
    const nR = L.filter((r) => (r.kind ?? 0) === 0).length;
    let cs = nR;
    for (let i = nR; i < L.length; i++) { const a0 = L[i].area?.[0] ?? 0; if (Math.abs(a0 - 5) < 1e-6 || Math.abs(a0 - 6) < 1e-6) cs = i + 1; else if (a0 >= 9.95 && a0 < 10.05 && i > cs + 30) break; }
    const ce = cs + (rep.chains?.traced ?? 0);
    const km: Record<string, number> = {};
    const n: Record<string, number> = {};
    for (let i = 0; i < L.length; i++) {
      const r = L[i];
      let c = 'river';
      if ((r.kind ?? 0) !== 0) {
        if (i >= cs && i < ce) c = 'chain';
        else if (i >= ce) c = 'cont';
        else { const a0 = r.area?.[0] ?? 0; c = Math.abs(a0 - 6) < 1e-6 ? 'head' : Math.abs(a0 - 5) < 1e-6 ? 'feeder' : 'outlet'; }
      }
      km[c] = (km[c] ?? 0) + r.s[r.s.length - 1] / 1000;
      n[c] = (n[c] ?? 0) + 1;
    }
    console.log(`seed ${seed}: ` + Object.keys(km).map((c) => `${c} ${n[c]} lines ${km[c].toFixed(0)} km`).join(', '));
    const r = rep as Record<string, unknown> & { chains?: Record<string, number>; feed?: Record<string, number>; shape?: Record<string, number> };
    const cnt = (k: string): unknown => { const v = r[k]; return Array.isArray(v) ? v.length : v; };
    console.log(`  fires: pits ${cnt('pits')} climbs ${cnt('floods')} sinks ${cnt('sinks')} hollows ${cnt('hollows')} continued ${cnt('continued')} passWalks ${cnt('passWalks')} connects ${cnt('connects')} ponds ${Array.isArray(r.ponds) ? (r.ponds as number[]).length / 2 : 0} filled ${cnt('filled')} chainCrossed ${r.chains?.crossed} chainLowered ${cnt('chainLowered')} junctions ${cnt('junctions')} feeders ${r.feed?.feeders} fedAlready ${r.feed?.fedAlready} outletHigh ${cnt('outletHigh')} breachSamples ${cnt('breachSamples')} shape ${JSON.stringify(r.shape ?? {})} hollowWhy ${JSON.stringify(r.hollowWhy ?? {})}`);
    console.log(`  report: heads ${rep.heads} traced ${rep.traced} outlets ${rep.outlets} chains ${JSON.stringify({ heads: rep.chains?.heads, traced: rep.chains?.traced, km: rep.chains?.km?.toFixed?.(0), skipped: rep.chains?.skipped })} continued ${rep.continued} feed ${JSON.stringify(rep.feed ?? {}).slice(0, 300)}`);
  }
});
