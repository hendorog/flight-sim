// Checker T1: after FIELD_HOLD, does a held stream's water still stand over the drawn ground beside it?
// For each stream sample (20 m walk) inside an airfield's reach (nearField, copied), the drawn ground at the channel's
// edge + 3 m both sides (sampleTerrain) against the line's water. Also the same outside the airfields' reach.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight, fieldHeldCount } from '../../../../../src/world/terrain/heightfield';
import { generatedAirfields } from '../../../../../src/world/airfields';
import { AIRPORT } from '../../../../../src/core/world';
import { setWorldSeed } from '../../../../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('held over', () => {
  for (const seed of (env.SEEDS ?? '777777,1,42').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const RW = AIRPORT.runway;
    const C = Math.cos(RW.heading), S = Math.sin(RW.heading);
    const near = (n: number, e: number): string | null => {
      for (const f of generatedAirfields()) {
        const fn = n - f.north, fe = e - f.east;
        const reach = f.length / 2 + f.approachLength + f.blend;
        if (fn * fn + fe * fe <= reach * reach) return `field ${f.north.toFixed(0)},${f.east.toFixed(0)}`;
      }
      const dn = n - RW.center.north, de = e - RW.center.east;
      const along = dn * C + de * S, across = -dn * S + de * C;
      if (Math.abs(along) - RW.length / 2 < AIRPORT.approachLength && Math.abs(across) < 2 * (300 + 0.12 * AIRPORT.approachLength)) return 'home';
      return null;
    };
    const L = hydrology.rivers!;
    const s = makeSample();
    const rows: Array<[number, string]> = [];
    const hist = { in: [0, 0, 0, 0], out: [0, 0, 0, 0] };
    let walkedIn = 0, walkedOut = 0;
    const perLine = new Map<number, { n: number; worst: number; where: string }>();
    for (let li = 0; li < L.length; li++) {
      const r = L[li];
      if ((r.kind ?? 0) === 0) continue;
      const m = r.north.length;
      for (let i = 0; i < m - 1; i++) {
        const seg = r.s[i + 1] - r.s[i];
        const k1 = Math.max(1, Math.ceil(seg / 20));
        const tn0 = r.north[i + 1] - r.north[i], te0 = r.east[i + 1] - r.east[i];
        const tl = Math.hypot(tn0, te0) || 1;
        const tn = tn0 / tl, te = te0 / tl;
        for (let k = 0; k < k1; k++) {
          const t = k / k1;
          const cn = r.north[i] + tn0 * t, ce = r.east[i] + te0 * t;
          const zone = near(cn, ce);
          const inZ = zone !== null;
          if (inZ) walkedIn++; else walkedOut++;
          if (!inZ && (walkedOut % 7) !== 0) continue; // sample the outside sparsely
          const lv = r.level[i] + (r.level[i + 1] - r.level[i]) * t;
          const hw = r.halfWidth[i] + (r.halfWidth[i + 1] - r.halfWidth[i]) * t;
          sampleTerrain(cn, ce, s);
          if (s.standing > s.ground + 0.05) continue; // in a lake
          const g0 = s.ground;
          const off = hw + 3;
          sampleTerrain(cn + te * off, ce - tn * off, s);
          const gl = Math.max(s.ground, s.standing);
          sampleTerrain(cn - te * off, ce + tn * off, s);
          const gr = Math.max(s.ground, s.standing);
          const over = lv - Math.max(gl, gr);
          const h = inZ ? hist.in : hist.out;
          if (over > 1) h[0]++;
          if (over > 3) h[1]++;
          if (over > 5) h[2]++;
          if (over > 10) h[3]++;
          if (inZ && over > 3) {
            rows.push([over, `line ${li} s ${(r.s[i] + seg * t).toFixed(0)} at ${cn.toFixed(0)},${ce.toFixed(0)} (${zone}) water ${lv.toFixed(1)} centre ground ${g0.toFixed(1)} banks ${gl.toFixed(1)}/${gr.toFixed(1)} hw ${hw.toFixed(1)} -> over both banks ${over.toFixed(1)} m`]);
            const pl = perLine.get(li) ?? { n: 0, worst: 0, where: '' };
            pl.n++;
            if (over > pl.worst) { pl.worst = over; pl.where = `${cn.toFixed(0)},${ce.toFixed(0)}`; }
            perLine.set(li, pl);
          }
        }
      }
    }
    rows.sort((a, b) => b[0] - a[0]);
    console.log(`seed ${seed}: fieldHeld ${fieldHeldCount()} samples; walked in-zone ${walkedIn} (20 m steps), outside ${walkedOut} (1 in 7 checked)`);
    console.log(`  in airfield reach: water over both banks >1 ${hist.in[0]}  >3 ${hist.in[1]}  >5 ${hist.in[2]}  >10 ${hist.in[3]} (20 m steps)`);
    console.log(`  outside (1/7 sampled): >1 ${hist.out[0]}  >3 ${hist.out[1]}  >5 ${hist.out[2]}  >10 ${hist.out[3]}`);
    console.log(`  lines in reach with water >3 m over both banks: ${[...perLine.entries()].sort((a, b) => b[1].worst - a[1].worst).map(([li, v]) => `${li} (${v.n} x 20 m, worst ${v.worst.toFixed(1)} at ${v.where})`).join('; ')}`);
    for (const [, t] of rows.slice(0, 25)) console.log('   ' + t);
  }
  setWorldSeed(0);
});
