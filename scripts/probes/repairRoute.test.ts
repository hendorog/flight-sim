// Repair probe: how high each lake outlet's way out rises over its water (StreamReport.outletSill), and the outlets' endings.
import { it } from 'vitest';
import { hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('outlet sills', () => {
  for (const seed of [1, 42, 777777]) {
    setWorldSeed(seed);
    const r = hydrology.streamReport!;
    const a = [...r.outletSill].sort((x, y) => x - y);
    const c = (t: number) => a.filter((v) => v > t).length;
    console.log(`seed ${seed}: outlets ${a.length} sill p50 ${a[a.length >> 1]?.toFixed(1)} p90 ${a[Math.floor(a.length * 0.9)]?.toFixed(1)} max ${a[a.length - 1]?.toFixed(1)}; >5 ${c(5)} >10 ${c(10)} >20 ${c(20)} >30 ${c(30)} >40 ${c(40)} >60 ${c(60)} >100 ${c(100)}; ends ${JSON.stringify(r.outletEnds)} none ${r.outletNone} high ${r.outletHigh} toLake ${r.outletToLake}`);
  }
  setWorldSeed(0);
});
