// Probe: the river and stream lines passing within NL_R m of (NL_N, NL_E) in seed NL_SEED: kind, level, ground, area.
import { it } from 'vitest';
import { hydrology, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('near line', () => {
  const e = process.env;
  setWorldSeed(Number(e.NL_SEED ?? 1));
  const pn = Number(e.NL_N), pe = Number(e.NL_E), R = Number(e.NL_R ?? 600);
  (hydrology.rivers ?? []).forEach((r, li) => {
    let best = -1, bd = R;
    for (let k = 0; k < r.north.length; k++) { const d = Math.hypot(r.north[k] - pn, r.east[k] - pe); if (d < bd) (bd = d), (best = k); }
    if (best < 0) return;
    const k = best, last = r.north.length - 1;
    console.log(`line ${li} kind ${r.kind} joins ${r.joins} at ${bd.toFixed(0)} m: sample ${k}/${last} level ${r.level[k].toFixed(0)} natural ${naturalHeight(r.north[k], r.east[k]).toFixed(0)} area ${r.area?.[k].toFixed(0)}; head ${r.north[0].toFixed(0)},${r.east[0].toFixed(0)} level ${r.level[0].toFixed(0)} natural ${naturalHeight(r.north[0], r.east[0]).toFixed(0)}; end ${r.north[last].toFixed(0)},${r.east[last].toFixed(0)} level ${r.level[last].toFixed(0)}`);
  });
  setWorldSeed(0);
});
