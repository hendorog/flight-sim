// Probe (stage S): stream water against the ground, every SW_STEP m along every stream (kind 1) outside lakes:
// the water over the natural ground (perched), over the drawn ground beside it (sampleTerrain at 1.5 half-widths +
// 30 m either side, the lower: hydro2Metrics' bank measure; and at the water's edge + 3 m), and the drawn ground over
// the water at the centreline (the bed poking through). Shares by length and the worst cases.
//   SW_SEEDS=1,42,777777 SW_STEP=10
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('stream water', () => {
  const step = Number(env.SW_STEP ?? 10);
  for (const seed of (env.SW_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const h: any = hydrology;
    const mask = h.lakeMask;
    const sm = makeSample();
    let n = 0;
    const c = { nat2: 0, nat5: 0, bank2: 0, bank10: 0, edge2: 0, bed05: 0, bed2: 0 };
    /** Where the water over the natural ground > 2 m lies: a backed-up last reach, an outlet's first 500 m, elsewhere; and how
     * many of those hold the drawn ground beside them (over the edge <= 0.5 m). */
    const why: Record<string, number> = { tail: 0, outlet: 0, run: 0, heldByBank: 0 };
    const worst: Record<string, Array<[number, string]>> = { nat: [], bank: [], edge: [], bed: [] };
    const push = (k: string, v: number, at: string): void => {
      const w = worst[k];
      w.push([v, at]);
      w.sort((a, b) => b[0] - a[0]);
      if (w.length > 5) w.pop();
    };
    (h.rivers as any[]).forEach((r, li) => {
      if (r.kind !== 1) return;
      for (let i = 0; i + 1 < r.s.length; i++) {
        const len = r.s[i + 1] - r.s[i];
        for (let t0 = (step - (r.s[i] % step)) % step; t0 < len; t0 += step) {
          const t = t0 / len;
          const pn = r.north[i] + (r.north[i + 1] - r.north[i]) * t, pe = r.east[i] + (r.east[i + 1] - r.east[i]) * t;
          if (mask.at(pn, pe) > -Infinity) continue;
          const L = r.level[i] + (r.level[i + 1] - r.level[i]) * t;
          const hw = r.halfWidth[i] + (r.halfWidth[i + 1] - r.halfWidth[i]) * t;
          const nat = naturalHeight(pn, pe);
          if (nat < 0.5 || L < 0.5) continue;
          sampleTerrain(pn, pe, sm);
          if (sm.standing > sm.ground + 0.05 && sm.standing > 0.5 && sm.standing > L + 0.5) continue;
          n++;
          const at = `s${seed} l${li} ${pn.toFixed(0)},${pe.toFixed(0)}`;
          const bed = sm.ground - L;
          if (bed > 0.5) c.bed05++;
          if (bed > 2) c.bed2++;
          push('bed', bed, at);
          const dn = r.north[i + 1] - r.north[i], de = r.east[i + 1] - r.east[i], dl = Math.hypot(dn, de) || 1;
          let lo = Infinity, loE = Infinity;
          for (const sg of [-1, 1]) {
            const off = 1.5 * hw + 30;
            sampleTerrain(pn - (de / dl) * off * sg, pe + (dn / dl) * off * sg, sm);
            lo = Math.min(lo, sm.standing > sm.ground + 0.05 && sm.standing > 0.5 ? sm.standing : Math.max(sm.ground, sm.river));
            const offE = hw + 3;
            sampleTerrain(pn - (de / dl) * offE * sg, pe + (dn / dl) * offE * sg, sm);
            loE = Math.min(loE, sm.standing > sm.ground + 0.05 && sm.standing > 0.5 ? sm.standing : Math.max(sm.ground, sm.river));
          }
          if (L - nat > 2) {
            c.nat2++;
            const last = r.level.length - 1;
            const outlet = mask.at(r.north[0], r.east[0]) > -Infinity;
            if (Math.abs(L - r.level[last]) < 0.05 && r.s[last] - r.s[i] < 1500) why.tail++;
            else if (outlet && r.s[i] < 500) why.outlet++;
            else why.run++;
            if (L - loE <= 0.5) why.heldByBank++;
          }
          if (L - nat > 5) c.nat5++;
          if (L - lo > 2) c.bank2++;
          if (L - lo > 10) c.bank10++;
          if (L - loE > 2) c.edge2++;
          push('nat', L - nat, at);
          push('bank', L - lo, at);
          push('edge', L - loE, at);
        }
      }
    });
    const pc = (v: number): string => ((100 * v) / Math.max(1, n)).toFixed(2);
    console.log(`SW seed ${seed}: ${n} pts (every ${step} m); water over natural >2/5 m ${pc(c.nat2)}/${pc(c.nat5)} %; over lower bank (1.5hw+30) >2/10 m ${pc(c.bank2)}/${pc(c.bank10)} %; over edge (hw+3) >2 m ${pc(c.edge2)} %; bed over water >0.5/2 m ${pc(c.bed05)}/${pc(c.bed2)} %`);
    console.log(`SW seed ${seed} over natural >2 m by place (% of all pts): tail ${pc(why.tail)} outlet ${pc(why.outlet)} run ${pc(why.run)}; of them held by the drawn bank ${pc(why.heldByBank)}`);
    for (const k of Object.keys(worst)) console.log(`SW seed ${seed} worst ${k}: ${worst[k].map(([v, a]) => `${v.toFixed(1)} m @${a}`).join('; ')}`);
  }
  setWorldSeed(0);
});
