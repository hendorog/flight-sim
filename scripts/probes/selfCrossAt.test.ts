// The seededWorld test's self-crossing check (tests/terrain/seededWorld.test.ts), listing each crossing's line, kind,
// place and the segments. SX_SEEDS.
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('self crossings', () => {
  for (const seed of (process.env.SX_SEEDS ?? '99991').split(',').map(Number)) {
    setWorldSeed(seed);
    const rivers = hydrology.rivers as unknown as Array<{ north: Float64Array; east: Float64Array; kind?: number; end?: string; level: Float64Array }>;
    rivers.forEach((r, li) => {
      const n = r.north.length;
      const grid = new Map<number, number[]>();
      const key = (pn: number, pe: number): number => (Math.floor(pn / 100) + 32768) * 65536 + (Math.floor(pe / 100) + 32768);
      for (let i = 0; i < n - 1; i++) {
        const k = key(r.north[i], r.east[i]);
        const l = grid.get(k);
        if (l) l.push(i);
        else grid.set(k, [i]);
      }
      for (let i = 0; i < n - 1; i++)
        for (let a = -1; a <= 1; a++)
          for (let b = -1; b <= 1; b++)
            for (const j of grid.get(key(r.north[i] + a * 100, r.east[i] + b * 100)) ?? []) {
              if (j <= i + 2) continue;
              const ax = r.east[i], ay = r.north[i], bx = r.east[i + 1], by = r.north[i + 1];
              const cx = r.east[j], cy = r.north[j], dx = r.east[j + 1], dy = r.north[j + 1];
              const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
              const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
              const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
              const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
              if (d1 * d2 < 0 && d3 * d4 < 0) console.log(`SX seed ${seed} line ${li} kind ${r.kind ?? 0} end ${r.end ?? '-'} (${n} points): segments ${i} and ${j} cross at about ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)}, levels ${r.level[i].toFixed(1)} / ${r.level[j].toFixed(1)}`);
            }
    });
  }
  setWorldSeed(0);
});
