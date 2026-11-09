// Round T repairs, item 2: lines under standing water (a seeded world's lakes and ponds, LakeMask), per seed (UL_SEEDS).
// (a) trench: km of line course inside a lake's domain on its bed (the natural ground under the lake's surface) where
//     the drawn ground stands more than UL_X m (and 1 m) under that bed while water covers it - a channel carved under
//     the lake. Apart: notch, where the natural ground inside the domain stands over the surface (dry ground the domain
//     takes in, as a filled hollow's routing notch) and the drawn ground is carved more than UL_X m into it under water.
// (b) shore steps: where a line runs into a lake (sample i-1 outside the domain, i inside, source first), how far the
//     line's water at i-1 stands under the lake's surface (a wall of water at the shore); > 1 m and > 5 m.
// (c) drowned levels: km of line course inside a domain whose water stands more than UL_X m under the lake's surface.
// Rivers (kind 0) and streams (kind 1) apart; the worst listed.
import { it } from 'vitest';
import { hydrology, terrainHeight, sampleTerrain, makeSample, naturalHeight } from '../../../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('under lake', () => {
  const s = makeSample();
  const X = Number(env.UL_X ?? 3);
  for (const seed of (env.UL_SEEDS ?? '1,42,777777,7').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const L = hydrology.rivers!;
    const mask = hydrology.lakeMask!;
    const trench = [0, 0], trench1 = [0, 0], drown = [0, 0], steps1 = [0, 0], steps5 = [0, 0], notch = [0, 0];
    const worstT: Array<{ v: number; t: string }> = [];
    const worstS: Array<{ v: number; t: string }> = [];
    const perLine = new Map<number, number>();
    for (let li = 0; li < L.length; li++) {
      const r = L[li];
      const k = r.kind === 0 ? 0 : 1;
      const n = r.north.length;
      let prevIn = false;
      for (let i = 0; i < n; i++) {
        const lv = mask.at(r.north[i], r.east[i]);
        const inside = lv > -Infinity;
        const ds = i > 0 ? r.s[i] - r.s[i - 1] : 0;
        if (inside) {
          const nat = naturalHeight(r.north[i], r.east[i]);
          sampleTerrain(r.north[i], r.east[i], s);
          const wet = s.standing > s.ground + 0.05;
          const dig = nat - s.ground;
          if (wet && nat >= lv && dig > X) notch[k] += ds;
          if (wet && nat < lv && dig > 1) trench1[k] += ds;
          if (wet && nat < lv && dig > X) {
            trench[k] += ds;
            perLine.set(li, (perLine.get(li) ?? 0) + ds);
            worstT.push({ v: dig, t: `${k ? 'stream' : 'river'} ${li} s ${r.s[i].toFixed(0)} at ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)}: ground ${s.ground.toFixed(1)} natural ${nat.toFixed(1)} (${dig.toFixed(1)} m under) lake ${lv.toFixed(1)} line water ${r.level[i].toFixed(1)}` });
          }
          if (lv - r.level[i] > X) drown[k] += ds;
          if (i > 0 && !prevIn) {
            const st = lv - r.level[i - 1];
            if (st > 1) steps1[k]++;
            if (st > 5) steps5[k]++;
            if (st > 1) {
              // (Its course up to 1 km above the shore: the lowest natural ground on it, and the most its water ran under
              // the ground it was traced on there - a notch it climbed out of its hollow through.)
              let low = Infinity, cutMax = 0;
              const cut = (r as unknown as { cut?: Float64Array }).cut;
              for (let q = i - 1; q >= 0 && r.s[i] - r.s[q] <= 1000; q--) { low = Math.min(low, naturalHeight(r.north[q], r.east[q])); if (cut) cutMax = Math.max(cutMax, cut[q]); }
              worstS.push({ v: st, t: `${k ? 'stream' : 'river'} ${li} into the lake at s ${r.s[i].toFixed(0)} ${r.north[i].toFixed(0)},${r.east[i].toFixed(0)}: its water ${r.level[i - 1].toFixed(1)} at ${r.north[i - 1].toFixed(0)},${r.east[i - 1].toFixed(0)}, lake ${lv.toFixed(1)} (${st.toFixed(1)} m under); 1 km above: lowest natural ground ${low.toFixed(1)} (${(lv - low).toFixed(1)} m under the lake), its cut up to ${cutMax.toFixed(1)} m` });
            }
          }
        }
        prevIn = inside;
      }
    }
    console.log(`seed ${seed}: trench under standing water > ${X} m (> 1 m): rivers ${(trench[0] / 1000).toFixed(2)} (${(trench1[0] / 1000).toFixed(2)}) km, streams ${(trench[1] / 1000).toFixed(2)} (${(trench1[1] / 1000).toFixed(2)}) km; shore steps (line water under the lake on the way in) > 1 m: rivers ${steps1[0]}, streams ${steps1[1]}; > 5 m: rivers ${steps5[0]}, streams ${steps5[1]}; line water > ${X} m under the lake surface inside it: rivers ${(drown[0] / 1000).toFixed(2)} km, streams ${(drown[1] / 1000).toFixed(2)} km; notch (natural over the surface, carved > ${X} m, water in it): rivers ${(notch[0] / 1000).toFixed(2)} km, streams ${(notch[1] / 1000).toFixed(2)} km`);
    const lines = [...perLine.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([li, m]) => `${li} ${m.toFixed(0)} m`);
    console.log(`  trench by line (top): ${lines.join(', ') || 'none'}`);
    worstT.sort((a, b) => b.v - a.v);
    for (const w of worstT.slice(0, Number(env.UL_TOP ?? 8))) console.log(`  trench ${w.t}`);
    worstS.sort((a, b) => b.v - a.v);
    for (const w of worstS.slice(0, Number(env.UL_TOP ?? 12))) console.log(`  step ${w.t}`);
  }
  setWorldSeed(0);
});
