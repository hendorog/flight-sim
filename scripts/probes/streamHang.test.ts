// Probe: where a stream's water stands over its lower bank (riverBed's measure, 1.5 half-widths + 30 m to either side)
// by more than 2 m, and why: near its outlet's lake, near its end, in a breach, on the routing ground too or only on the
// detailed ground (small relief and fine gullies), the drawn ground under the water.
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeightSmooth, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('stream hang', () => {
  for (const seed of (process.env.H2_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const s = makeSample();
    const mask: any = hydrology.lakeMask;
    let n = 0, hang = 0;
    const why: Record<string, number> = {};
    const add = (k: string) => (why[k] = (why[k] ?? 0) + 1);
    const ex: string[] = [];
    hydrology.rivers!.forEach((r, li) => {
      if (r.kind !== 1) return;
      const total = r.s[r.s.length - 1];
      const outlet = mask.at(r.north[0], r.east[0]) > -Infinity;
      for (let k = 1; k < r.north.length - 1; k += 3) {
        const pn = r.north[k], pe = r.east[k];
        sampleTerrain(pn, pe, s);
        if (s.standing > s.ground + 0.05 && s.standing > 0.5) continue;
        if (s.ground < 0.5) continue;
        n++;
        const L = r.level[k];
        const dn = r.north[k + 1] - r.north[k - 1], de = r.east[k + 1] - r.east[k - 1];
        const len = Math.hypot(dn, de) || 1;
        const off = 1.5 * r.halfWidth[k] + 30;
        let lo = Infinity, loR = Infinity;
        for (const sg of [-1, 1]) {
          const x = pn - (de / len) * off * sg, y = pe + (dn / len) * off * sg;
          sampleTerrain(x, y, s);
          lo = Math.min(lo, s.standing > s.ground + 0.05 && s.standing > 0.5 ? s.standing : Math.max(s.ground, s.river));
          loR = Math.min(loR, naturalHeightSmooth(x, y));
        }
        if (L - lo <= 2) continue;
        hang++;
        const tag = outlet && r.s[k] < 600 ? 'outlet-start' : total - r.s[k] < 400 ? `end-${r.end}` : (r.breach?.[k] ?? 0) > 0 ? 'in-breach' : 'open';
        add(tag);
        add(L - loR > 2 ? 'smooth-ground-lower-too' : 'detail-only');
        if (ex.length < 6 && tag === 'open') ex.push(`line ${li} @${(pn / 1000).toFixed(2)},${(pe / 1000).toFixed(2)} level ${L.toFixed(1)} bank ${lo.toFixed(1)} smooth ${loR.toFixed(1)} regime ${r.regime?.[k]}`);
      }
    });
    console.log(`HANG seed ${seed}: ${n} stream pts, ${hang} hang >2 m (${(100 * hang / n).toFixed(2)} %): ${JSON.stringify(why)}`);
    console.log(`  e.g. ${ex.join('; ')}`);
  }
  setWorldSeed(0);
});
