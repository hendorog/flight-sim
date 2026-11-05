// Repair probe: hollows filled to their sills (streams.ts FillMask): how many, how much ground, how deep.
import { it } from 'vitest';
import { hydrology, makeSample, sampleTerrain, naturalHeight } from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('fill', () => {
  for (const seed of (process.env.REPAIR_SEEDS ?? '1,42,777777').split(',').map(Number)) {
    setWorldSeed(seed);
    const rep = hydrology.streamReport!;
    // Sample the world on a 250 m grid: where the fill raised the ground, and by how much.
    const s = makeSample();
    let n = 0, raised = 0, raised5 = 0, raised20 = 0, worst = 0, at = '';
    const net = hydrology.network!;
    for (let i = -600; i < 600; i++) for (let j = -600; j < 600; j++) {
      const pn = i * 250 + 125, pe = j * 250 + 125;
      const h0 = naturalHeight(pn, pe);
      const h1 = net.fill ? net.fill(pn, pe, h0) : h0;
      n++;
      const d = h1 - h0;
      if (d > 0.5) raised++;
      if (d > 5) raised5++;
      if (d > 20) raised20++;
      if (d > worst) { worst = d; at = `${(pn / 1000).toFixed(2)},${(pe / 1000).toFixed(2)}`; }
    }
    void s; void sampleTerrain;
    console.log(`seed ${seed}: fills ${rep.fills}; ground raised >0.5 m ${(raised * 0.0625).toFixed(0)} km2, >5 m ${(raised5 * 0.0625).toFixed(0)} km2, >20 m ${(raised20 * 0.0625).toFixed(1)} km2 (of ${(n * 0.0625).toFixed(0)}); deepest ${worst.toFixed(1)} m at ${at}; trace ${rep.ms.toFixed(0)} ms`);
  }
  setWorldSeed(0);
});
