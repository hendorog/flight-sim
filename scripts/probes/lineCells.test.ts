// Probe: a drainage line's lattice cells (LC_SEED, LC_LINE): T (routed), noise lattice, natural ground at the cell,
// area; and the drawn course's nearest sample to each cell (level, natural ground, offset from the cell).
import { it } from 'vitest';
import { hydrology, naturalHeight, naturalHeightRaw, seededDrainage, seededModel } from '../../src/world/terrain/heightfield';
import { cellEast, cellNorth } from '../../src/world/terrain/drainage';
import { setWorldSeed } from '../../src/world/worldSeed';
it('line cells', () => {
  const e = process.env;
  setWorldSeed(Number(e.LC_SEED ?? 1));
  const d = seededDrainage!;
  const L = d.lines[Number(e.LC_LINE ?? 22)];
  const r = hydrology.rivers![Number(e.LC_LINE ?? 22)];
  for (let k = 0; k < Math.min(L.cells.length, Number(e.LC_N ?? 12)); k++) {
    const c = L.cells[k], pn = cellNorth(d, c), pe = cellEast(d, c);
    let best = 0, bd = Infinity;
    for (let q = 0; q < r.north.length; q++) { const dd = Math.hypot(r.north[q] - pn, r.east[q] - pe); if (dd < bd) (bd = dd), (best = q); }
    console.log(`cell ${k} (${pn},${pe}) model ${seededModel()!.lattice[c].toFixed(0)} height ${d.height[c].toFixed(0)} cut ${d.cutWhy[c]} T ${d.routed[c].toFixed(0)} noise ${naturalHeightRaw(pn, pe, false).toFixed(0)} natural ${naturalHeight(pn, pe).toFixed(0)} A ${L.area[k].toFixed(0)} | course ${bd.toFixed(0)} m off: level ${r.level[best].toFixed(0)} natural ${naturalHeight(r.north[best], r.east[best]).toFixed(0)}`);
  }
  setWorldSeed(0);
});
