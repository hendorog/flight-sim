// Probe: waterWalls' river-over-bank metric (channel water over a dry neighbour 50 m away, on a 50 m grid) split by
// the channel there: a river, a stream, or a river head's feeder (streams.ts feedHeads; StreamReport.feed.firstFeeder).
//   SEED=42 npx vitest run --config scripts/probes/vitest.config.ts bankSplit --silent=false
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('bank split', () => {
  const seed = Number(process.env.SEED ?? 42);
  const HALF = 150000, STEP = 50;
  setWorldSeed(seed);
  const ff = ((hydrology.streamReport as unknown as { feed?: { firstFeeder?: number } }).feed?.firstFeeder) ?? Infinity;
  const nR = hydrology.rivers!.filter((r) => r.kind === 0).length;
  const s = makeSample();
  const n = Math.round((2 * HALF) / STEP) + 1;
  const mk = () => ({ g: new Float32Array(n), w: new Uint8Array(n), r: new Float32Array(n) });
  let prev = mk(), cur = mk();
  const fill = (row: ReturnType<typeof mk>, y: number) => {
    const north = HALF - y * STEP;
    for (let x = 0; x < n; x++) {
      sampleTerrain(north, -HALF + x * STEP, s);
      row.g[x] = s.ground;
      row.w[x] = s.standing > s.ground + 0.05 && s.standing > 0.5 ? 1 : 0;
      row.r[x] = s.river;
    }
  };
  const flow = { dist: Infinity, line: -1 } as unknown as Parameters<typeof hydrology.queryFlow>[2];
  const cnt: Record<string, [number, number, number]> = { river: [0, 0, 0], stream: [0, 0, 0], feeder: [0, 0, 0] };
  const kindAt = (north: number, east: number): string => {
    hydrology.queryFlow!(north, east, flow);
    const li = (flow as unknown as { line: number }).line;
    return li < 0 || li < nR ? 'river' : li >= ff ? 'feeder' : 'stream';
  };
  const check = (R: number, row: ReturnType<typeof mk>, x: number, north: number, east: number) => {
    if (row.r[x] > -Infinity || row.w[x]) return;
    const h = R - row.g[x];
    const k = kindAt(north, east);
    cnt[k][0]++;
    if (h > 2) cnt[k][1]++;
    if (h > 10) cnt[k][2]++;
  };
  for (let y = 0; y < n; y++) {
    fill(cur, y);
    const north = HALF - y * STEP;
    for (let x = 0; x < n; x++) {
      const east = -HALF + x * STEP;
      if (x + 1 < n) {
        if (cur.r[x] > -Infinity) check(cur.r[x], cur, x + 1, north, east);
        if (cur.r[x + 1] > -Infinity) check(cur.r[x + 1], cur, x, north, east + STEP);
      }
      if (y > 0) {
        if (prev.r[x] > -Infinity) check(prev.r[x], cur, x, north + STEP, east);
        if (cur.r[x] > -Infinity) check(cur.r[x], prev, x, north, east);
      }
    }
    [prev, cur] = [cur, prev];
  }
  console.log(`BANK seed ${seed}: ` + Object.entries(cnt).map(([k, [e, a, b]]) => `${k} edges ${e} >2 m ${a} (${(100 * a / Math.max(1, e)).toFixed(2)} %) >10 m ${b}`).join('; '));
  setWorldSeed(0);
});
