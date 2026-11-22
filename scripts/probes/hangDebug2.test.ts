// Probe (debug): the channel sample nearest each HD_AT point (n,e;n,e...) and its neighbours: level vs the drawn ground.
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, naturalHeightSmooth, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('hang debug', () => {
  setWorldSeed(Number(process.env.HD_SEED ?? 42));
  const s = makeSample();
  for (const at of (process.env.HD_AT ?? '-46378,-23903').split(';')) {
    const [pn, pe] = at.split(',').map(Number);
    let bl = -1, bi = 0, bd = Infinity;
    hydrology.rivers!.forEach((r, li) => { for (let i = 0; i < r.north.length; i++) { const d = Math.hypot(r.north[i] - pn, r.east[i] - pe); if (d < bd) { bd = d; bl = li; bi = i; } } });
    const r = hydrology.rivers![bl];
    console.log(`at ${at}: line ${bl} kind ${r.kind} joins ${r.joins} n=${r.north.length} idx ${bi} dist ${bd.toFixed(0)}`);
    for (let i = Math.max(0, bi - 6); i < Math.min(r.north.length, bi + 7); i++) {
      sampleTerrain(r.north[i], r.east[i], s);
      console.log(`   ${i} s ${r.s[i].toFixed(0)} at ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)} level ${r.level[i].toFixed(1)} ground ${s.ground.toFixed(1)} natural ${naturalHeight(r.north[i], r.east[i]).toFixed(1)} smooth ${naturalHeightSmooth(r.north[i], r.east[i]).toFixed(1)} snapped ${naturalHeightSmooth(Math.round(r.north[i] / 250) * 250, Math.round(r.east[i] / 250) * 250).toFixed(1)} river ${s.river.toFixed(1)} hw ${r.halfWidth[i].toFixed(1)} regime ${r.regime![i]}`);
    }
  }
  setWorldSeed(0);
});
