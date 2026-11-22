// Foundation stage 4: where the streams that end in a hollow (streams.ts end 'sink') end, and the threshold
// hillslopes' fields there (weight m, gully weight mg, channel floor ch).  SK_SEEDS=1 npx vitest run --config
// scripts/probes/vitest.config.ts streamSinks
import { it } from 'vitest';
import { debugMacro, hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('stream sinks', () => {
  for (const seed of (env.SK_SEEDS ?? '1').split(',')) {
    setWorldSeed(seed);
    const cls: Record<string, number> = {};
    for (const r of hydrology.rivers ?? []) {
      const sl = r as unknown as { end?: string; area: Float64Array };
      if (sl.end !== 'sink') continue;
      const k = r.north.length - 1;
      const d = debugMacro(r.north[k], r.east[k]);
      const c = !d ? 'none' : d.s.m > 0.5 ? 'mountain' : d.s.m > 0 || d.s.m > 0 ? 'edge' : 'outside';
      cls[c] = (cls[c] ?? 0) + 1;
      console.log(`SINK seed ${seed} ${r.north[k].toFixed(0)},${r.east[k].toFixed(0)} len ${(r.s[k] / 1000).toFixed(1)} km A ${sl.area[k].toFixed(1)} m ${d?.s.m.toFixed(2)} mg ${d?.s.m.toFixed(2)} ch ${d?.s.ch.toFixed(2)} f ${d?.s.f.toFixed(2)} ${c}`);
    }
    console.log(`seed ${seed}: sinks by place ${JSON.stringify(cls)}`);
  }
});
