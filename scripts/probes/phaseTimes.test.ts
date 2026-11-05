// Probe: the network build's phases (streams.ts tracePhases, riverNetwork.ts phases), min over rounds per seed.
import { it } from 'vitest';
import { hydrology, siteMs } from '../../src/world/terrain/heightfield';
import * as HF from '../../src/world/terrain/heightfield';
import { setWorldSeed } from '../../src/world/worldSeed';
it('phases', () => {
  for (const seed of (process.env.PH_SEEDS ?? '42,7').split(',').map(Number)) {
    let best: number[] | null = null; let tr: number[] | null = null; let ms = Infinity; let site = Infinity; let tot = Infinity;
    for (let r = 0; r < 4; r++) {
      setWorldSeed(0); const t0 = performance.now(); setWorldSeed(seed); tot = Math.min(tot, performance.now() - t0); site = Math.min(site, (HF as any).siteMs);
      const rep: any = hydrology.streamReport;
      if (rep.ms < ms) { ms = rep.ms; best = rep.phases; tr = rep.tracePhases; }
    }
    console.log(`PHASES seed ${seed}: total ${tot.toFixed(0)} site ${site.toFixed(0)} streams ${ms.toFixed(0)} ms (trace phases ${tr!.map((v) => v.toFixed(0)).join('/')}); network phases ${best!.map((v) => v.toFixed(0)).join('/')}`);
  }
  setWorldSeed(0);
});
