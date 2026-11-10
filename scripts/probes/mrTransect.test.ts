// design V: drawn ground (and slope) along a transect, every 50 m: TR_SEED, TR_FROM=n,e TR_TO=n,e.
// (Round V step 0: ported unchanged from design-V/model-rivers/prototype.patch).
import { it } from 'vitest';
import { terrainHeight, debugMacro, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('transect', () => {
  setWorldSeed(Number(process.env.TR_SEED ?? 42));
  for (const pair of (process.env.TR ?? '-12000,-43000:-13500,-41500').split(';')) {
    const [a, b] = pair.split(':');
    const [n0, e0] = a.split(',').map(Number);
    const [n1, e1] = b.split(',').map(Number);
    const L = Math.hypot(n1 - n0, e1 - e0);
    const k = Math.round(L / 50);
    const out: string[] = [];
    const rows: string[] = [];
    for (let i = 0; i <= k; i++) {
      const t = i / k;
      const pn = n0 + (n1 - n0) * t, pe = e0 + (e1 - e0) * t;
      out.push(terrainHeight(pn, pe).toFixed(0));
      if (process.env.TR_PARTS) {
        const m = debugMacro(pn, pe);
        if (m) rows.push(`  ${(i * 50).toString().padStart(5)} drawn ${terrainHeight(pn, pe).toFixed(0)} natural ${naturalHeight(pn, pe).toFixed(0)} coarse ${m.coarse.toFixed(0)} ground ${m.ground.toFixed(0)} | d ${m.s.d.toFixed(0)} c ${m.s.c.toFixed(0)} f ${m.s.f.toFixed(2)} m ${m.s.m.toFixed(2)} hs ${m.s.hs.toFixed(0)} ch ${m.s.ch.toFixed(2)} mg ${m.s.mg.toFixed(2)} mw ${m.s.mw.toFixed(2)}`);
      }
    }
    console.log(`TR ${pair}: ${out.join(' ')}`);
    if (rows.length) console.log(rows.join('\n'));
  }
  setWorldSeed(0);
});
