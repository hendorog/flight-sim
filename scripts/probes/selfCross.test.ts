// Probe (foundation stage 2): river lines that cross themselves (seededWorld's check), with where and the line's kind,
// catchment and meander state there. SC_SEEDS.
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('self cross', () => {
  for (const seed of (env.SC_SEEDS ?? '1234').split(',')) {
    setWorldSeed(seed);
    (hydrology.rivers ?? []).forEach((r, li) => {
      const n = r.north.length;
      for (let i = 0; i < n - 1; i++) for (let j = i + 3; j < n - 1; j++) {
        if (Math.abs(r.north[j] - r.north[i]) > 300 || Math.abs(r.east[j] - r.east[i]) > 300) continue;
        const ax = r.east[i], ay = r.north[i], bx = r.east[i + 1], by = r.north[i + 1];
        const cx = r.east[j], cy = r.north[j], dx = r.east[j + 1], dy = r.north[j + 1];
        const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
        const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
        if (d1 * d2 < 0 && d3 * d4 < 0) console.log(`seed ${seed} line ${li} kind ${r.kind} crosses itself at ${ay.toFixed(0)},${ax.toFixed(0)}: samples ${i} and ${j} (s ${r.s[i].toFixed(0)} / ${r.s[j].toFixed(0)}), A ${r.area?.[i].toFixed(0)}, level ${r.level[i].toFixed(1)}/${r.level[j].toFixed(1)}`);
      }
    });
  }
  setWorldSeed(0);
});
