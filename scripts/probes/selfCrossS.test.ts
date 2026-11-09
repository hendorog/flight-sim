// Round S: lines crossing themselves (tests/terrain/seededWorld.test.ts's check), with where and the line's kind.
import { it } from 'vitest';
import { hydrology, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('self crossings', () => {
  for (const seed of (env.SX_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const rivers = (hydrology.rivers ?? []) as unknown as Array<{ north: Float64Array; east: Float64Array; kind?: number; area?: Float64Array; end?: string; s: Float64Array }>;
    rivers.forEach((r, li) => {
      const n = r.north.length;
      for (let i = 0; i < n - 1; i++)
        for (let j = i + 3; j < n - 1; j++) {
          if (Math.abs(r.north[i] - r.north[j]) > 300 || Math.abs(r.east[i] - r.east[j]) > 300) continue;
          const ax = r.east[i], ay = r.north[i], bx = r.east[i + 1], by = r.north[i + 1];
          const cx = r.east[j], cy = r.north[j], dx = r.east[j + 1], dy = r.north[j + 1];
          const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
          const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
          const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
          const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
          if (d1 * d2 < 0 && d3 * d4 < 0) console.log(`CROSS seed ${seed} line ${li} kind ${r.kind} A0 ${r.area?.[0]?.toFixed(1)} end ${r.end} samples ${i}/${j} of ${n} at ${ay.toFixed(0)},${ax.toFixed(0)} (s ${r.s[i].toFixed(0)} / ${r.s[j].toFixed(0)})`);
        }
    });
  }
  setWorldSeed(0);
});
