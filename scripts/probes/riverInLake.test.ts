// Probe (A1b): river and stream samples inside a standing lake's domain whose water runs well below the lake's level
// (the lake's water would stand against the channel: a water wall), per seed: count, worst, and the lines and pools.
//   STREAM_SEEDS=1,42,777777 RL_MARGIN=3
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('river in lake', () => {
  const margin = Number(env.RL_MARGIN ?? 3);
  for (const seed of (env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const mask = hydrology.lakeMask as unknown as { at(n: number, e: number): number; poolHit: number };
    const rs = hydrology.rivers ?? [];
    const hits = new Map<string, { n: number; worst: number; at: string }>();
    rs.forEach((r, li) => {
      for (let i = 0; i < r.north.length; i++) {
        const lv = mask.at(r.north[i], r.east[i]);
        if (!(lv > r.level[i] + margin)) continue;
        const key = `line ${li} (kind ${r.kind ?? 0}) pool ${mask.poolHit}`;
        const h = hits.get(key) ?? { n: 0, worst: 0, at: '' };
        h.n++;
        if (lv - r.level[i] > h.worst) { h.worst = lv - r.level[i]; h.at = `${r.north[i].toFixed(0)},${r.east[i].toFixed(0)}`; }
        hits.set(key, h);
      }
    });
    console.log(`RIVERINLAKE seed ${seed}: ${hits.size} line/pool pairs` + [...hits.entries()].map(([k, h]) => `\n  ${k}: ${h.n} samples, worst ${h.worst.toFixed(1)} m at ${h.at}`).join(''));
  }
  setWorldSeed(0);
});
