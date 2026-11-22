// Probe (Round W S): why a river's dry head has no line joining it anywhere (headFeed's "no feeder at all"): where the
// drawn ground's routing (streams.ts) takes the water about its head - the largest catchment within 2 km of the head
// and whether that point is an outlet (a lake's water, the sea) or runs off the domain's edge, and how its ground stands
// against the river's water at the head.   HW_SEEDS=1,42,777777 npx vitest run --config scripts/probes/vitest.config.ts headWhy
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { streamDebug } from '../../src/world/terrain/streams';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('head why', () => {
  streamDebug.keep = true;
  const R = 1281, O = -160000;
  for (const seed of (env.HW_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const rt = streamDebug.routing!;
    const L = hydrology.rivers!;
    const mask = hydrology.lakeMask!;
    const tribs = new Set<number>();
    L.forEach((q) => { if ((q.joins ?? -1) >= 0) tribs.add(q.joins!); });
    const why: Record<string, number> = {};
    const rows: string[] = [];
    L.forEach((r, li) => {
      if (r.kind !== 0 || tribs.has(li) || mask.at(r.north[0], r.east[0]) > -Infinity) return;
      const i0 = Math.round((r.north[0] - O) / 250), j0 = Math.round((r.east[0] - O) / 250);
      let best = -1;
      for (let a = -8; a <= 8; a++) for (let b = -8; b <= 8; b++) {
        const i = i0 + a, j = j0 + b;
        if (i < 0 || j < 0 || i >= R || j >= R) continue;
        const q = i * R + j;
        if (best < 0 || rt.area[q] > rt.area[best]) best = q;
      }
      const edge = Math.max(Math.abs(r.north[0]), Math.abs(r.east[0])) > 155000;
      const outlet = rt.rdir[best] < 0;
      const k = edge ? 'domain edge' : outlet && rt.G[best] <= 0.5 ? 'sea beside its head' : outlet ? 'a lake beside its head' : rt.G[best] < r.level[0] ? 'lower ground beside its head drains elsewhere' : 'other';
      why[k] = (why[k] ?? 0) + 1;
      rows.push(`${li} ${r.north[0].toFixed(0)},${r.east[0].toFixed(0)}: ${k} (largest catchment within 2 km ${rt.area[best].toFixed(1)} km², ground ${rt.G[best].toFixed(0)} m against the river's ${r.level[0].toFixed(0)} m)`);
    });
    console.log(`HW seed ${seed}: rivers with no line joining ${rows.length}: ${JSON.stringify(why)}`);
    for (const x of rows) console.log(`   ${x}`);
  }
  streamDebug.keep = false;
  setWorldSeed(0);
});
