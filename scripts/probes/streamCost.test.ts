// Round V B (item 4): what the streams cost and what they are, per seed (SC_SEEDS): the world's build time, the streams'
// trace time and ground samples, lines by the pass that built them (streams.ts streamDebug.src) with their km, chain heads
// traced, and every line's ends.
//   SC_SEEDS=1,42,777777,7 npx vitest run --config scripts/probes/vitest.config.ts streamCost --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { streamDebug } from '../../src/world/terrain/streams';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
type Line = { s: Float64Array; kind?: number };
it('stream cost', () => {
  for (const sd of (env.SC_SEEDS ?? '1,42,777777,7').split(',').map(Number)) {
    const t0 = performance.now();
    setWorldSeed(sd);
    terrainHeight(0, 0);
    const t1 = performance.now();
    const r = hydrology.streamReport as unknown as { ms: number; samples: number; traced: number; km: number; ends: Record<string, number>; pits: number; chains?: { heads: number; traced: number; km: number; ms: number }; phases?: number[] };
    const L = hydrology.rivers as unknown as Line[];
    const nR = L.filter((x) => (x.kind ?? 0) === 0).length;
    const src = streamDebug.src ?? [];
    const by = new Map<string, [number, number]>();
    for (let i = nR; i < L.length; i++) {
      const k = src[i - nR] ?? '?';
      const v = by.get(k) ?? [0, 0];
      v[0]++;
      v[1] += L[i].s[L[i].s.length - 1] / 1000;
      by.set(k, v);
    }
    let rkm = 0;
    for (let i = 0; i < nR; i++) rkm += L[i].s[L[i].s.length - 1] / 1000;
    console.log(`SC seed ${sd}: build ${(t1 - t0).toFixed(0)} ms; streams traced in ${r.ms.toFixed(0)} ms (${r.samples} ground samples, ${r.pits} hollows filled); network phases ${(r.phases ?? []).map((x) => x.toFixed(0)).join('/')} ms; rivers ${nR} (${rkm.toFixed(0)} km); streams ${L.length - nR} (${(r.km).toFixed(0)} km): ${[...by.entries()].map(([k, v]) => `${k} ${v[0]} (${v[1].toFixed(0)} km)`).join(', ')}; chains ${r.chains?.traced}/${r.chains?.heads} heads in ${r.chains?.ms.toFixed(0)} ms; ends ${JSON.stringify(r.ends)}`);
  }
  setWorldSeed(0);
});
