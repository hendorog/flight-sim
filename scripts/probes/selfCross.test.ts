// Probe: rivers crossing themselves. npx vitest run --config scripts/probes/vitest.config.ts selfCross  (CROSS_SEEDS=99991)
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';

it('self crossings', () => {
  for (const seed of (process.env.CROSS_SEEDS ?? '99991').split(',').map(Number)) {
    setWorldSeed(seed);
    hydrology.rivers!.forEach((r, li) => {
      const n = r.north.length;
      for (let i = 0; i < n - 1; i++) for (let j = i + 3; j < n - 1; j++) {
        if (Math.abs(r.north[i] - r.north[j]) > 300 || Math.abs(r.east[i] - r.east[j]) > 300) continue;
        const ax = r.east[i], ay = r.north[i], bx = r.east[i + 1], by = r.north[i + 1];
        const cx = r.east[j], cy = r.north[j], dx = r.east[j + 1], dy = r.north[j + 1];
        const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
        const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
        const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
        if (d1 * d2 < 0 && d3 * d4 < 0) console.log(`seed ${seed} line ${li} (${n} pts, hw ${r.halfWidth[i].toFixed(0)}) crosses at ${i}/${j}: s ${r.s[i].toFixed(0)}..${r.s[j].toFixed(0)} (arc ${(r.s[j] - r.s[i]).toFixed(0)} m) at ${ay.toFixed(0)}, ${ax.toFixed(0)}; spacing ${Math.hypot(bx - ax, by - ay).toFixed(0)} m`);
      }
    });
  }
  setWorldSeed(0);
});
