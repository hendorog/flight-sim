// Probe (debug): every line passing within NL_R m of NL_AT, with its nearest sample.
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('near lines', () => {
  setWorldSeed(Number(process.env.NL_SEED ?? 42));
  const [pn, pe] = (process.env.NL_AT ?? '-46378,-23903').split(',').map(Number);
  const R = Number(process.env.NL_R ?? 60);
  hydrology.rivers!.forEach((r, li) => {
    let bi = -1, bd = Infinity;
    for (let i = 0; i < r.north.length - 1; i++) {
      const an = r.north[i], ae = r.east[i], dn = r.north[i + 1] - an, de = r.east[i + 1] - ae;
      const l2 = dn * dn + de * de; const t = l2 > 0 ? Math.max(0, Math.min(1, ((pn - an) * dn + (pe - ae) * de) / l2)) : 0;
      const d = Math.hypot(an + dn * t - pn, ae + de * t - pe);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bd < R) console.log(`line ${li} kind ${r.kind} joins ${r.joins} n ${r.north.length} seg ${bi} dist ${bd.toFixed(0)} level ${r.level[bi].toFixed(1)}->${r.level[bi + 1].toFixed(1)} hw ${r.halfWidth[bi].toFixed(1)} last ${r.north.length - 1} end ${r.north[r.north.length - 1].toFixed(0)},${r.east[r.east.length - 1].toFixed(0)}`);
  });
  setWorldSeed(0);
});
