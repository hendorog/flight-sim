// Checker A4p: heldOver's and fieldBanks' bank samples (hw + 3 m either side of the line) against the law's own edges.
// For every line sample (10 m walk) in a generated field's reach (fieldBanks' rule) or the home approaches (heldOver's),
// where the hw + 3 m point falls (in the water, on the bar inside the bed, past the bed), and the two measures at hw + 3
// (as the gates) and at the side's own bed edge + 3 (bedR/bedL from the line). CK_SEEDS.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, terrainHeight } from '../../src/world/terrain/heightfield';
import { generatedAirfields } from '../../src/world/airfields';
import { AIRPORT } from '../../src/core/world';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('chk banks', () => {
  const s = makeSample();
  for (const seed of (env.CK_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    terrainHeight(0, 0);
    const fields = generatedAirfields();
    const RW = AIRPORT.runway;
    const C = Math.cos(RW.heading), S = Math.sin(RW.heading);
    const near = (n: number, e: number): boolean => {
      for (const f of fields) { const reach = f.length / 2 + f.approachLength + f.blend; if ((n - f.north) ** 2 + (e - f.east) ** 2 <= reach * reach) return true; }
      const dn = n - RW.center.north, de = e - RW.center.east;
      const along = dn * C + de * S, across = -dn * S + de * C;
      return Math.abs(along) - RW.length / 2 < AIRPORT.approachLength && Math.abs(across) < 2 * (300 + 0.12 * AIRPORT.approachLength);
    };
    const L = hydrology.rivers!;
    const cat = { wet: 0, bar: 0, past: 0, noform: 0 };
    const held = { hw3: [0, 0, 0], bed3: [0, 0, 0] };
    const bank = { hw3: [0, 0], bed3: [0, 0] };
    const heldCat: Record<string, number> = { wet: 0, bar: 0, past: 0, noform: 0 };
    const bankCat: Record<string, number> = { wet: 0, bar: 0, past: 0, noform: 0 };
    let reach = 0;
    const g = (n: number, e: number): number => { sampleTerrain(n, e, s); return Math.max(s.ground, s.standing); };
    const gG = (n: number, e: number): number => { sampleTerrain(n, e, s); return s.ground; };
    for (const r of L) {
      const m = r.s.length;
      const f = r as unknown as { bedR?: Float32Array; bedL?: Float32Array; wetR?: Float32Array; wetL?: Float32Array };
      for (let sv = 0; sv <= r.s[m - 1]; sv += 10) {
        let i = 0;
        while (i < m - 2 && r.s[i + 1] < sv) i++;
        const fr = Math.min(1, Math.max(0, (sv - r.s[i]) / ((r.s[i + 1] - r.s[i]) || 1)));
        const n = r.north[i] + fr * (r.north[i + 1] - r.north[i]), e = r.east[i] + fr * (r.east[i + 1] - r.east[i]);
        if (!near(n, e)) continue;
        sampleTerrain(n, e, s);
        if (s.standing > s.ground + 0.05) continue;
        reach += 10;
        const W = r.level[i] + fr * (r.level[i + 1] - r.level[i]);
        const hw = r.halfWidth[i] + fr * (r.halfWidth[i + 1] - r.halfWidth[i]);
        const tn0 = r.north[i + 1] - r.north[i], te0 = r.east[i + 1] - r.east[i];
        const tl = Math.hypot(tn0, te0) || 1, tn = tn0 / tl, te = te0 / tl;
        // left: +d (n + te d, e - tn d); right: -d.
        const lerp = (a?: Float32Array) => (a ? a[i] + fr * (a[i + 1] - a[i]) : NaN);
        const bL = lerp(f.bedL), bR = lerp(f.bedR), wL = lerp(f.wetL), wR = lerp(f.wetR);
        const where = (d: number, wE: number, bE: number) => (Number.isNaN(bE) ? 'noform' : d < wE ? 'wet' : d < bE ? 'bar' : 'past');
        const cL = where(hw + 3, wL, bL), cR = where(hw + 3, wR, bR);
        cat[cL as keyof typeof cat]++; cat[cR as keyof typeof cat]++;
        const gl3 = g(n + te * (hw + 3), e - tn * (hw + 3)), gr3 = g(n - te * (hw + 3), e + tn * (hw + 3));
        const dL = Number.isNaN(bL) ? hw + 3 : Math.max(hw, bL) + 3, dR = Number.isNaN(bR) ? hw + 3 : Math.max(hw, bR) + 3;
        const glB = g(n + te * dL, e - tn * dL), grB = g(n - te * dR, e + tn * dR);
        const o3 = W - Math.max(gl3, gr3), oB = W - Math.max(glB, grB);
        [3, 5, 10].forEach((t, k) => { if (o3 > t) held.hw3[k]++; if (oB > t) held.bed3[k]++; });
        if (o3 > 3) { heldCat[cL]++; heldCat[cR]++; }
        const b3 = Math.min(gG(n + te * (hw + 3), e - tn * (hw + 3)), gG(n - te * (hw + 3), e + tn * (hw + 3))) - W;
        const bB = Math.min(gG(n + te * dL, e - tn * dL), gG(n - te * dR, e + tn * dR)) - W;
        if (b3 > 2.5) bank.hw3[0] += 10; if (b3 > 4) bank.hw3[1] += 10;
        if (bB > 2.5) bank.bed3[0] += 10; if (bB > 4) bank.bed3[1] += 10;
        if (b3 > 2.5) { bankCat[cL]++; bankCat[cR]++; }
      }
    }
    console.log(`seed ${seed}: in reach ${reach} m (10 m steps). hw+3 point lies (both sides): in water ${cat.wet}, on bar ${cat.bar}, past bed ${cat.past}, no form ${cat.noform}`);
    console.log(`  held (water over both sides) >3/>5/>10, 10 m steps: at hw+3 ${held.hw3.join('/')}; at bed edge+3 ${held.bed3.join('/')}; flagged >3 at hw+3 by where its points lie: ${JSON.stringify(heldCat)}`);
    console.log(`  banks (lower side over the water) >2.5/>4 m, m: at hw+3 ${bank.hw3.join('/')}; at bed edge+3 ${bank.bed3.join('/')}; flagged >2.5 at hw+3 by where: ${JSON.stringify(bankCat)}`);
  }
  setWorldSeed(0);
});
