// Probe (foundation stage 2 pictures): places worth a picture on a seeded world as built: the biggest range exits
// (relief classes, on the lattice the drainage routes) with their mouth's share, big confluences inside the ranges,
// and lakes with a river through them; each with an index.html camera (camPos/camLook = north,east,alt). VS_SEEDS.
import { it } from 'vitest';
import { DRAIN_CELL, type Drainage } from '../../src/world/terrain/drainage';
import { hydrology, seededDrainage, terrainHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { CLASS_MTN, measureTree, reliefClasses } from './treeMetrics';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

it('view sites 2', () => {
  for (const seed of (env.VS_SEEDS ?? '1,42,777777').split(',')) {
    setWorldSeed(seed);
    const d = seededDrainage as Drainage;
    const n = d.n;
    const at = (c: number): [number, number] => [d.origin + Math.floor(c / n) * DRAIN_CELL, d.origin + (c % n) * DRAIN_CELL];
    const cls = reliefClasses(n, d.height);
    const st = measureTree('', { n, cell: DRAIN_CELL, receiver: d.receiver, area: d.area }, cls, (c) => d.height[c] <= 0);
    // A camera 7 km down the flow from the point (looking back up the valley), 1200 m over the ground there.
    const cam = (c: number, back = 7): string => {
      let q = c;
      for (let k = 0; k < back && d.receiver[q] >= 0; k++) q = d.receiver[q];
      const [pn, pe] = at(c);
      const [qn, qe] = at(q);
      const dn = qn - pn, de = qe - pe;
      const L = Math.hypot(dn, de) || 1;
      const cn = pn + (dn / L) * 7000, ce = pe + (de / L) * 7000;
      const g = Math.max(0, terrainHeight(cn, ce));
      return `camPos=${cn.toFixed(0)},${ce.toFixed(0)},${(g + 1200).toFixed(0)}&camLook=${pn},${pe},${terrainHeight(pn, pe).toFixed(0)}`;
    };
    const mouthOf = new Map(st.mouths.map((m) => [m.outlet, m]));
    const ex = st.exits.slice().sort((a, b) => b.area - a.area).slice(0, 6);
    for (const e of ex) {
      const m = mouthOf.get(e.outlet);
      console.log(`seed ${seed} exit ${e.area.toFixed(0)} km² at ${at(e.cell).join(',')} (${terrainHeight(...at(e.cell)).toFixed(0)} m), mouth ${m ? m.area.toFixed(0) : '-'} km² (${m ? ((100 * e.area) / m.area).toFixed(0) : '-'} %): seed=${seed}&${cam(e.cell)}`);
    }
    const cf = st.confluences.filter((x) => x.cls === CLASS_MTN && x.a2 >= 150).sort((a, b) => b.a2 - a.a2).slice(0, 5);
    for (const x of cf) console.log(`seed ${seed} Y join ${x.a1.toFixed(0)} + ${x.a2.toFixed(0)} km² at ${at(x.cell).join(',')} (${terrainHeight(...at(x.cell)).toFixed(0)} m): seed=${seed}&${cam(x.cell, 4)}`);
    const lakes = hydrology.lakes.map((l, k) => ({ l, dl: d.lakes[k] })).filter((x) => x.dl && x.dl.river).sort((a, b) => b.dl.cells.length - a.dl.cells.length).slice(0, 5);
    for (const { l, dl } of lakes) {
      console.log(`seed ${seed} lake ${dl.cells.length} cells, level ${l.level.toFixed(0)} m, catchment ${dl.area.toFixed(0)} km² at ${l.north.toFixed(0)},${l.east.toFixed(0)}: seed=${seed}&camPos=${(l.north - 6000).toFixed(0)},${(l.east - 3000).toFixed(0)},${(l.level + 900).toFixed(0)}&camLook=${l.north.toFixed(0)},${l.east.toFixed(0)},${l.level.toFixed(0)}`);
    }
  }
  setWorldSeed(0);
});
