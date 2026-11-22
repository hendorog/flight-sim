// Probe (debug): the lines joining river FL_LINE's head (within 300 m): each one's profile (level, natural ground,
// half-width, breach, cut, gradient) every FL_EVERY samples. FL_SEED.
import { it } from 'vitest';
import { hydrology, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('feeder look', () => {
  setWorldSeed(Number(process.env.FL_SEED ?? 42));
  const L = hydrology.rivers!;
  const li = Number(process.env.FL_LINE ?? 160);
  const r = L[li];
  const every = Number(process.env.FL_EVERY ?? 6);
  L.forEach((q, lj) => {
    if (q.joins !== li) return;
    const k = q.north.length - 1;
    if (Math.hypot(q.north[k] - r.north[0], q.east[k] - r.east[0]) > 300) return;
    console.log(`line ${lj} -> ${li}: len ${q.s[k].toFixed(0)} samples ${q.s.length}, river head hw ${r.halfWidth[0].toFixed(1)}`);
    const b = (q as { breach?: Float64Array }).breach, c = (q as { cut?: Float64Array }).cut;
    for (let i = 0; i <= k; i += every) console.log(`  s ${q.s[i].toFixed(0)} at ${q.north[i].toFixed(0)},${q.east[i].toFixed(0)} level ${q.level[i].toFixed(1)} ground ${naturalHeight(q.north[i], q.east[i]).toFixed(1)} hw ${q.halfWidth[i].toFixed(1)} breach ${b?.[i]?.toFixed(0)} cut ${c?.[i]?.toFixed(1)}`);
  });
  setWorldSeed(0);
});
