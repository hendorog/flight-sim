// Probe: a water wall point (waterWalls) and its neighbours: ground, standing water, which lake (tarn or pond).
//   WP_SEED=42 WP=-55800,6850 npx vitest run --config scripts/probes/vitest.config.ts wallPoint --silent=false --disable-console-intercept
import { it } from 'vitest';
import { hydrology, makeSample, naturalHeight, naturalHeightSmooth, sampleTerrain } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('wall point', () => {
  setWorldSeed(Number(process.env.WP_SEED ?? 42));
  const s = makeSample();
  const lm: any = hydrology.lakeMask;
  for (const p of (process.env.WP ?? '-55800,6850').split(';')) {
    const [n0, e0] = p.split(',').map(Number);
    for (const [dn, de] of [[0, 0], [50, 0], [-50, 0], [0, 50], [0, -50]]) {
      const n = n0 + dn, e = e0 + de;
      sampleTerrain(n, e, s);
      const lv = lm.at(n, e, s.ground);
      const ch: any[] = []; const k = (hydrology.network as any).channels(n, e, ch); const near = ch.slice(0, k).map((c) => `${c.line}k${c.kind} d${c.dist.toFixed(0)} lv${c.level.toFixed(0)} b${c.breach.toFixed(0)}`).join(' ');
      console.log(`WP ${n},${e}: ground ${s.ground.toFixed(1)} standing ${s.standing.toFixed(1)} river ${s.river.toFixed(1)} natural ${naturalHeight(n, e).toFixed(1)} smooth ${naturalHeightSmooth(n, e).toFixed(1)} fill ${(() => { const nat = naturalHeight(n, e); return (hydrology.network as any).fill?.(n, e, nat).toFixed(1); })()} rimlv ${((hydrology.network as any).tarnRim?.(n, e) ?? -Infinity).toFixed(1)} mask ${lv.toFixed(1)} tarn ${lm.tarnHit} field ${lm.field.toFixed(1)} ch ${near}`);
    }
  }
  setWorldSeed(0);
});
