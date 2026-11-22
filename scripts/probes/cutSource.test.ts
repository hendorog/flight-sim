// Probe: where a river's deep cuts (>60 m below the natural ground) come from: a breach the drainage made on its
// lattice (a gorge it allowed), or the river's own level falling below the drainage's routed surface (the running
// minimum of the detailed ground, the confluence and gradient rules).
import { it } from 'vitest';
import { buildDrainage } from '../../src/world/terrain/drainage';
import { hydrology, naturalHeight, naturalHeightCoarse, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('cut source', () => {
  for (const seed of (process.env.STREAM_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const d = buildDrainage(naturalHeightCoarse, naturalHeight);
    const routed = d.routed ?? d.height;
    const s = makeSample();
    // Bilinear lattice field.
    const bil = (f: Float32Array, pn: number, pe: number): number => {
      const x = (pe - d.origin) / 1000, y = (pn - d.origin) / 1000;
      const j = Math.floor(x), i = Math.floor(y), fx = x - j, fy = y - i, c = i * d.n + j;
      return f[c] * (1 - fx) * (1 - fy) + f[c + 1] * fx * (1 - fy) + f[c + d.n] * (1 - fx) * fy + f[c + d.n + 1] * fx * fy;
    };
    let n = 0, deep = 0, lattice = 0, detail = 0, below = 0; const why = [0, 0, 0, 0];
    for (const r of hydrology.rivers!) {
      for (let k = 0; k < r.north.length; k += 3) {
        const pn = r.north[k], pe = r.east[k];
        if (hydrology.lakeMask && hydrology.lakeMask.at(pn, pe) > -Infinity) continue;
        const g = naturalHeight(pn, pe);
        if (g < 0.5) continue;
        n++;
        sampleTerrain(pn, pe, s);
        if (g - s.ground <= 60) continue;
        deep++;
        const coarse = naturalHeightCoarse(pn, pe);
        // The lowest routed cell and the deepest lattice cut within a cell of the point (the course wanders off the lattice).
        let rt = Infinity, cut = 0, w = 0;
        const i0 = Math.round((pn - d.origin) / 1000), j0 = Math.round((pe - d.origin) / 1000);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const c = (i0 + a) * d.n + j0 + b;
          rt = Math.min(rt, routed[c]);
          if (d.height[c] - routed[c] > cut) { cut = d.height[c] - routed[c]; w = d.cutWhy[c]; }
        }
        void bil;
        if (cut > 40) { lattice++; why[w]++; }            // the drainage cut here
        else if (g - coarse > 40) detail++;     // the detailed ground stands high over the coarse (a ridge of the gully filter)
        else if (r.level[k] < rt - 40) { below++; if (process.env.CUT_SHOW && below % 200 === 1) console.log(`  under at ${pn.toFixed(0)},${pe.toFixed(0)}: level ${r.level[k].toFixed(0)} routed-min ${rt.toFixed(0)} natural ${g.toFixed(0)} coarse ${coarse.toFixed(0)}`); } // the river's level fell under the routed surface
      }
    }
    const p = (a: number): string => (100 * a / n).toFixed(1);
    console.log(`seed ${seed}: cut >60 m ${p(deep)} %: lattice breach ${p(lattice)} % (allowed ${p(why[1])}, pond cap ${p(why[2])}, no-lake cut ${p(why[3])}), detail ridge ${p(detail)} %, level under routed ${p(below)} %, other ${p(deep - lattice - detail - below)} %`);
  }
  setWorldSeed(0);
});
