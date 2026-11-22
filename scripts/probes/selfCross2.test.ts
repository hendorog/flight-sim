// Lines that cross themselves (tests/terrain/seededWorld.test.ts's check), with where.
//   SX_SEED=7 npx vitest run --config scripts/probes/vitest.config.ts selfCross2
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('self cross', () => {
  setWorldSeed(env.SX_SEED ?? '7');
  hydrology.rivers!.forEach((r, li) => {
    const n = r.north.length;
    for (let i = 0; i < n - 1; i++) for (let j = i + 3; j < n - 1; j++) {
      if (Math.abs(r.north[j] - r.north[i]) > 300 || Math.abs(r.east[j] - r.east[i]) > 300) continue;
      const ax = r.east[i], ay = r.north[i], bx = r.east[i + 1], by = r.north[i + 1];
      const cx = r.east[j], cy = r.north[j], dx = r.east[j + 1], dy = r.north[j + 1];
      const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
      const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx), d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
      if (d1 * d2 < 0 && d3 * d4 < 0) console.log(`line ${li} kind ${r.kind} A0 ${r.area?.[0]?.toFixed(1)} n ${n} crosses itself: segments ${i} and ${j} at ${ay.toFixed(0)},${ax.toFixed(0)}; s ${r.s[i].toFixed(0)} / ${r.s[j].toFixed(0)}`);
    }
  });
});
