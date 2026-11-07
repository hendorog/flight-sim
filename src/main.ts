// Simulator entry point. Everything lives in src/sim; see Simulator.ts for the boot order and frame loop
// and params.ts for the URL parameters.
//
// A seeded world's macro model (src/world/terrain/macroCache.ts) is worked out first, in one worker, and handed to
// the world build the Simulator's constructor starts (and from there to the terrain workers).

import { showBootError } from './sim/overlays';
import { Simulator } from './sim/Simulator';
import { parseParams } from './sim/params';
import { chooseSeed } from './sim/seedChoice';
import { chooseEra } from './sim/eraChoice';
import { browserStore } from './sim/resume';
import { prepareSeededModel } from './world/terrain/macroCache';

async function start(): Promise<void> {
  const params = parseParams(location.search);
  const store = browserStore();
  const seed = chooseSeed(params, store).seed;
  if (seed !== 0) {
    const note = document.createElement('div');
    note.textContent = 'Shaping the land';
    note.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#000;color:#bbb;font:16px system-ui,sans-serif';
    document.body.append(note);
    const t0 = performance.now();
    const prep = await prepareSeededModel(seed, chooseEra(params, store).id);
    // (For the automation API and boot measurements.)
    (window as unknown as { __terrainModel?: unknown }).__terrainModel = { ...prep, totalMs: performance.now() - t0 };
    console.info(`[boot] terrain model for seed ${seed}: ${prep.source}, ${Math.round(performance.now() - t0)} ms`);
    note.remove();
  }
  const sim = new Simulator();
  await sim.boot();
}

start().catch((err: unknown) => {
  console.error('[sim] boot failed', err);
  showBootError(err);
});
