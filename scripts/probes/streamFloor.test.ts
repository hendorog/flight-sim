// Probe: do the streams run on the valley floor? For every few stream samples (outside lakes): the ground under it
// minus the lowest ground across the course within 250 m either side (0 on the floor; a stream on a hillside or a
// spur stands high over it), and the water over the ground (sampleTerrain) under it and beside it. Rivers alike.
//   STREAM_SEEDS=42 npx vitest run --config scripts/probes/vitest.config.ts streamFloor --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('stream floor', () => {
  for (const seed of (process.env.STREAM_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    const s = makeSample();
    for (const kind of [1, 0]) {
      const off: number[] = [], notch: number[] = [], hang: number[] = [];
      for (const r of hydrology.rivers!) {
        if ((r.kind ?? 0) !== kind) continue;
        const every = kind ? 4 : 12;
        for (let k = 1; k < r.north.length - 1; k += every) {
          const pn = r.north[k], pe = r.east[k];
          if (hydrology.lakeMask!.at(pn, pe) > -Infinity) continue;
          const g = naturalHeight(pn, pe);
          if (g < 1) continue;
          const dn = r.north[k + 1] - r.north[k - 1], de = r.east[k + 1] - r.east[k - 1];
          const len = Math.hypot(dn, de) || 1;
          let lo = g;
          for (const d of [50, 100, 150, 250]) for (const sg of [-1, 1]) lo = Math.min(lo, naturalHeight(pn - (de / len) * d * sg, pe + (dn / len) * d * sg));
          off.push(g - lo);
          notch.push(g - r.level[k]);
          // water over the drawn ground 1.5 hw + 10 m either side (lower side)
          const o = 1.5 * r.halfWidth[k] + 10;
          let bank = Infinity;
          for (const sg of [-1, 1]) { sampleTerrain(pn - (de / len) * o * sg, pe + (dn / len) * o * sg, s); bank = Math.min(bank, Math.max(s.ground, s.river, s.standing > s.ground + 0.05 ? s.standing : -Infinity)); }
          hang.push(r.level[k] - bank);
        }
      }
      const q = (a: number[], f: number) => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor((b.length - 1) * f)]; };
      const pc = (a: number[], t: number) => ((100 * a.filter((x) => x > t).length) / a.length).toFixed(1);
      console.log(`FLOOR seed ${seed} ${kind ? 'streams' : 'rivers '}: ${off.length} pts; ground over the lowest within 250 m across: median ${q(off, 0.5).toFixed(1)} p75 ${q(off, 0.75).toFixed(1)} p90 ${q(off, 0.9).toFixed(1)} m (>10 m ${pc(off, 10)} %, >30 m ${pc(off, 30)} %); natural ground over the water median ${q(notch, 0.5).toFixed(1)} p90 ${q(notch, 0.9).toFixed(1)} p99 ${q(notch, 0.99).toFixed(1)} m (>10 m ${pc(notch, 10)} %, >30 m ${pc(notch, 30)} %); water over the lower bank >2 m ${pc(hang, 2)} %, >5 m ${pc(hang, 5)} %`);
    }
  }
  setWorldSeed(0);
});
