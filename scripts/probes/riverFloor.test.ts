// Round V A3: the rivers on the model's floors. Every ~200 m of each river (kind 0) where the threshold slopes reach
// (ErosionSample.m > 0.5): on a model's floor line (ErosionSample.fin) or not, with the model's ground and the slopes'
// ground there against the water. RF2_SEEDS.
import { it } from 'vitest';
import { debugMacro, hydrology } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
it('river floors', () => {
  for (const seed of (env.RF2_SEEDS ?? '42').split(',').map(Number)) {
    setWorldSeed(seed);
    const rivers = hydrology.rivers as unknown as Array<{ north: Float64Array; east: Float64Array; level: Float64Array; s: Float64Array; kind?: number }>;
    let inMask = 0, off = 0, offHigh = 0;
    const worst: Array<[number, string]> = [];
    rivers.forEach((L, li) => {
      if (L.kind) return;
      let last = -1e9;
      for (let i = 0; i < L.north.length; i++) {
        if (L.s[i] - last < 200) continue;
        last = L.s[i];
        const m = debugMacro(L.north[i], L.east[i]);
        if (!m || !(m.s.m > 0.5)) continue;
        inMask += 0.2;
        if (m.s.fin) continue;
        off += 0.2;
        const over = m.slope - L.level[i];
        if (over > 50) offHigh += 0.2;
        worst.push([over, `line ${li} at ${L.north[i].toFixed(0)},${L.east[i].toFixed(0)}: water ${L.level[i].toFixed(0)}, model's ground ${m.model.toFixed(0)}, slopes' ground ${m.slope.toFixed(0)}`]);
      }
    });
    worst.sort((a, b) => b[0] - a[0]);
    console.log(`RF seed ${seed}: river km in the slopes (m > 0.5) ${inMask.toFixed(1)}; not on a model floor ${off.toFixed(1)} km, of it with the slopes' ground > 50 m over the water ${offHigh.toFixed(1)} km`);
    for (const [o, t] of worst.slice(0, 6)) console.log(`   ${o.toFixed(0)} m: ${t}`);
  }
  setWorldSeed(0);
});
