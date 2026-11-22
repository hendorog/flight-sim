// Probe (foundation stage 2): a drainage line's lattice cells: the noise ground, the model's cells, the drained
// lattice, the routed level, catchment, and whether the cell is base level / held / kept-lake. LC_SEED, LC_LINE.
import { it } from 'vitest';
import { seededDrainage, seededInputs, seededModel } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('line cells T', () => {
  setWorldSeed(env.LC_SEED ?? '42');
  const d = seededDrainage!, inp = seededInputs!, T = seededModel()!.lattice;
  const L = d.lines[Number(env.LC_LINE ?? 0)];
  const n = d.n;
  const out: string[] = [];
  for (let k = 0; k < L.cells.length; k += Number(env.LC_STEP ?? 3)) {
    const c = L.cells[k];
    out.push(`${k} (${d.origin + Math.floor(c / n) * 1000},${d.origin + (c % n) * 1000}) h0 ${inp.h0[c].toFixed(0)} T ${T[c].toFixed(0)} lat ${d.height[c].toFixed(0)} routed ${d.routed[c].toFixed(0)} filled ${d.filled[c].toFixed(0)} A ${d.area[c].toFixed(0)} u ${inp.u[c].toFixed(2)}${inp.fixed[c] ? ' FIXED' : ''}${inp.cap[c] >= 1 ? ' cap' : ''}${inp.sill[c] > 0 ? ' sill' : ''}`);
  }
  console.log(out.join('\n'));
  setWorldSeed(0);
});
