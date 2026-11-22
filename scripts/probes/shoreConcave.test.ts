// Measure the terrain shader's 'concave' (clamp(90 * curvature, 0, 1), curvature on the 32 m cover lattice) at lake shores and river banks.
import { it } from 'vitest';
import { CoverShapeField, makeCoverShape } from '../../src/world/terrain/biome';
import { hydrology, makeSample, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('shore concavity', () => {
  const s = makeSample();
  const sh = makeCoverShape();
  const q = (a: number[]) => { a.sort((x, y) => x - y); const p = (f: number) => a[Math.floor(f * (a.length - 1))].toFixed(2); return `n ${a.length} p10 ${p(0.1)} p25 ${p(0.25)} med ${p(0.5)} p75 ${p(0.75)} p90 ${p(0.9)} mean ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2)}`; };
  for (const seed of [131, 1, 42]) {
    setWorldSeed(seed);
    const lake: number[] = [], bed: number[] = [], bank: number[] = [];
    const lakes = [...hydrology.lakes].sort((a, b) => b.level - a.level).slice(0, 25);
    for (const l of lakes) {
      const R = l.bound + 300;
      const f = new CoverShapeField().build(l.north - R, l.east - R, l.north + R, l.east + R);
      for (let k = 0; k < 72; k++) {
        const a = (k / 72) * 2 * Math.PI;
        let wasWet = true;
        for (let r = 0; r < R; r += 8) {
          const n = l.north + r * Math.cos(a), e = l.east + r * Math.sin(a);
          sampleTerrain(n, e, s);
          const wet = s.ground < s.standing;
          f.at(n, e, sh);
          const c = Math.min(1, Math.max(0, 90 * sh.curvature));
          if (wet && s.standing - s.ground > 3) bed.push(c);
          if (wasWet && !wet) { lake.push(c); break; }
          wasWet = wet;
        }
      }
    }
    const rs = hydrology.rivers ?? [];
    for (const r of rs.slice(0, 40)) {
      for (let i = 0; i < r.north.length; i += 25) {
        const n = r.north[i], e = r.east[i];
        const f = new CoverShapeField().build(n - 100, e - 100, n + 100, e + 100);
        for (const side of [-1, 1]) {
          const tn = r.north[Math.min(i + 1, r.north.length - 1)] - r.north[Math.max(i - 1, 0)], te = r.east[Math.min(i + 1, r.north.length - 1)] - r.east[Math.max(i - 1, 0)];
          const tl = Math.hypot(tn, te) || 1;
          const off = side * r.halfWidth[i] * 1.1;
          f.at(n + (te / tl) * off, e - (tn / tl) * off, sh);
          bank.push(Math.min(1, Math.max(0, 90 * sh.curvature)));
        }
      }
    }
    console.log(`seed ${seed} lake shore ${q(lake)}`);
    console.log(`seed ${seed} lake bed  ${q(bed)}`);
    console.log(`seed ${seed} river bank ${q(bank)}`);
  }
});
