// Repair probe: an outlet's first point: the lake levels LakeMask reports there.
import { it } from 'vitest';
import { hydrology, terrainHeight, naturalHeightSmooth } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('outlet', () => {
  setWorldSeed(Number(process.env.RO_SEED ?? 42));
  const m = hydrology.lakeMask!;
  for (const p of (process.env.RO_AT ?? '-96000,26250').split(';')) {
    const [n, e] = p.split(',').map(Number);
    const rs = hydrology.rivers!;
    const li = rs.findIndex((r) => r.kind === 1 && Math.hypot(r.north[0] - n, r.east[0] - e) < 1);
    const r = rs[li];
    console.log(`${n},${e}: line ${li} level0 ${r?.level[0].toFixed(2)} level1 ${r?.level[1].toFixed(2)} at() ${m.at(n, e).toFixed(2)} pool ${m.poolHit} at(terrain ${terrainHeight(n, e).toFixed(1)}) ${m.at(n, e, terrainHeight(n, e)).toFixed(2)} pool ${m.poolHit} at(smooth ${naturalHeightSmooth(n, e).toFixed(1)}) ${m.at(n, e, naturalHeightSmooth(n, e)).toFixed(2)} pool ${m.poolHit}; pools here ${[0, 1, 2, 3].map((k) => m.poolAt(Math.round((n + 150000) / 250) + (k >> 1) - 0, Math.round((e + 150000) / 250) + (k & 1))).join(',')}`);
  }
  setWorldSeed(0);
});
