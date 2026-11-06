// Probe: rivers' dry heads and what feeds them. RH_SEED (42), RH_R (km from home, 40).
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
import { AIRPORT } from '../../src/core/world';
it('river heads', () => {
  for (const seed of (process.env.RH_SEED ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    const L = hydrology.rivers!;
    const ends: Array<[number, number, number]> = [];
    L.forEach((r, li) => { const k = r.north.length - 1; ends.push([r.north[k], r.east[k], li]); });
    let n = 0, fed = 0, unfed = 0, near = 0;
    const rows: string[] = [];
    L.forEach((r, li) => {
      if (r.kind !== 0) return;
      n++;
      const hn = r.north[0], he = r.east[0];
      // any other line ending (joining) within 300 m of the head or within the first 1.5 km of this line
      let best = Infinity, bw = 0;
      for (const [en, ee, lj] of ends) {
        if (lj === li || L[lj].joins !== li) continue;
        const d = Math.hypot(en - hn, ee - he);
        if (d < best) { best = d; bw = L[lj].halfWidth[L[lj].halfWidth.length - 1]; }
      }
      const dh = Math.hypot(hn - AIRPORT.runway.center.north, he - AIRPORT.runway.center.east) / 1000;
      if (best < 400) fed++; else unfed++;
      if (dh < Number(process.env.RH_R ?? 40)) { near++; rows.push(`  line ${li} head ${hn.toFixed(0)},${he.toFixed(0)} ${dh.toFixed(1)} km from home, level ${r.level[0].toFixed(0)} hw0 ${r.halfWidth[0].toFixed(1)} hw@1.5km ${r.halfWidth[Math.min(r.s.findIndex((s) => s > 1500) >>> 0, r.halfWidth.length - 1)].toFixed(1)} nearest feeder end ${best.toFixed(0)} m (hw ${bw.toFixed(1)})`); }
    });
    console.log(`seed ${seed}: rivers ${n}, fed at head ${fed}, unfed ${unfed}; heads within range:\n${rows.join('\n')}`);
  }
  setWorldSeed(0);
});
